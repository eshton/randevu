import Foundation
import Network

struct LocalTool {
    let name: String
    let description: String
    /// JSON Schema for the tool arguments.
    let inputSchema: [String: Any]
}

enum ToolOutcome {
    case text(String)
    case failure(String)
}

/// A loopback-only MCP server over Streamable HTTP. Replies are plain JSON (the spec
/// allows it for POST), so no SSE stream is needed on this side.
final class LocalMCPServer {
    typealias Invoker = @Sendable (String, [String: Any]) async -> ToolOutcome

    private let queue = DispatchQueue(label: "com.akoskovacs.prata.bridge")
    private let tools: [LocalTool]
    private let invoke: Invoker
    private let basePath: String
    private let serverInstructions: String
    private var listener: NWListener?

    let port: UInt16

    init(port: UInt16, token: String, tools: [LocalTool], instructions: String, invoke: @escaping Invoker) {
        self.port = port
        // The token lives in the path so any local process needs to know it to reach the room.
        self.basePath = "/mcp/\(token)"
        self.tools = tools
        self.serverInstructions = instructions
        self.invoke = invoke
    }

    var endpointURL: String { "http://127.0.0.1:\(port)\(basePath)" }

    func start() throws {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "Prata", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid port."])
        }
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)

        let listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - HTTP plumbing

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        read(connection, buffer: Data())
    }

    private func read(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            guard error == nil else { connection.cancel(); return }

            var buffer = buffer
            if let data { buffer.append(data) }

            if let request = HTTPRequest(buffer) {
                self.handle(request, on: connection)
                return
            }
            if isComplete { connection.cancel(); return }
            self.read(connection, buffer: buffer)
        }
    }

    private func handle(_ request: HTTPRequest, on connection: NWConnection) {
        guard request.path.hasPrefix(basePath) else {
            respond(connection, status: 404, reason: "Not Found")
            return
        }
        switch request.method {
        case "DELETE":
            respond(connection, status: 200, reason: "OK")
            return
        case "POST":
            break
        default:
            // No server-initiated stream on this endpoint.
            respond(connection, status: 405, reason: "Method Not Allowed")
            return
        }

        guard let payload = try? JSONSerialization.jsonObject(with: request.body) else {
            respond(connection, status: 400, reason: "Bad Request")
            return
        }

        Task { [weak self] in
            guard let self else { return }
            let envelopes: [[String: Any]]
            if let single = payload as? [String: Any] {
                envelopes = [single]
            } else if let batch = payload as? [[String: Any]] {
                envelopes = batch
            } else {
                self.respond(connection, status: 400, reason: "Bad Request")
                return
            }

            var replies: [[String: Any]] = []
            for envelope in envelopes {
                if let reply = await self.dispatch(envelope) { replies.append(reply) }
            }

            guard !replies.isEmpty else {
                // Notifications only.
                self.respond(connection, status: 202, reason: "Accepted")
                return
            }
            let body = replies.count == 1 ? replies[0] as Any : replies as Any
            guard let data = try? JSONSerialization.data(withJSONObject: body) else {
                self.respond(connection, status: 500, reason: "Internal Server Error")
                return
            }
            self.respond(
                connection,
                status: 200,
                reason: "OK",
                headers: ["Content-Type": "application/json"],
                body: data
            )
        }
    }

    // MARK: - JSON-RPC

    private func dispatch(_ envelope: [String: Any]) async -> [String: Any]? {
        let method = envelope["method"] as? String ?? ""
        let id = envelope["id"]

        // No id means a notification — nothing to reply with.
        guard let id else { return nil }

        switch method {
        case "initialize":
            return success(id: id, result: [
                "protocolVersion": "2025-06-18",
                "capabilities": ["tools": [:]],
                "serverInfo": ["name": "prata-bridge", "version": "0.1.0"],
                "instructions": serverInstructions,
            ])

        case "ping":
            return success(id: id, result: [:])

        case "tools/list":
            let list = tools.map { tool -> [String: Any] in
                ["name": tool.name, "description": tool.description, "inputSchema": tool.inputSchema]
            }
            return success(id: id, result: ["tools": list])

        case "tools/call":
            let params = envelope["params"] as? [String: Any] ?? [:]
            guard let name = params["name"] as? String else {
                return failure(id: id, code: -32602, message: "Missing tool name.")
            }
            let arguments = params["arguments"] as? [String: Any] ?? [:]
            switch await invoke(name, arguments) {
            case .text(let text):
                return success(id: id, result: ["content": [["type": "text", "text": text]]])
            case .failure(let message):
                return success(id: id, result: [
                    "content": [["type": "text", "text": message]],
                    "isError": true,
                ])
            }

        default:
            return failure(id: id, code: -32601, message: "Unknown method: \(method)")
        }
    }

    private func success(id: Any, result: [String: Any]) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id, "result": result]
    }

    private func failure(id: Any, code: Int, message: String) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id, "error": ["code": code, "message": message]]
    }

    private func respond(
        _ connection: NWConnection,
        status: Int,
        reason: String,
        headers: [String: String] = [:],
        body: Data = Data()
    ) {
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        var allHeaders = headers
        allHeaders["Content-Length"] = String(body.count)
        allHeaders["Connection"] = "close"
        for (key, value) in allHeaders {
            head += "\(key): \(value)\r\n"
        }
        head += "\r\n"

        var out = Data(head.utf8)
        out.append(body)
        connection.send(content: out, completion: .contentProcessed { _ in connection.cancel() })
    }
}

private struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data

    /// Returns nil while the request is still incomplete, so the caller keeps reading.
    init?(_ data: Data) {
        guard let separator = data.range(of: Data("\r\n\r\n".utf8)),
              let headerText = String(data: data[data.startIndex..<separator.lowerBound], encoding: .utf8)
        else { return nil }

        var lines = headerText.components(separatedBy: "\r\n")
        guard !lines.isEmpty else { return nil }
        let requestLine = lines.removeFirst().split(separator: " ")
        guard requestLine.count >= 2 else { return nil }

        method = String(requestLine[0])
        path = String(requestLine[1])

        var parsed: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[line.startIndex..<colon].lowercased()
            parsed[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        headers = parsed

        let expected = Int(parsed["content-length"] ?? "0") ?? 0
        let bodyStart = separator.upperBound
        guard data.distance(from: bodyStart, to: data.endIndex) >= expected else { return nil }
        body = data[bodyStart..<data.index(bodyStart, offsetBy: expected)]
    }
}
