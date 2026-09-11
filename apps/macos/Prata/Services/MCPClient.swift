import Foundation

/// Errors surfaced by the MCP transport. `.session` means the server forgot our
/// session and the call is safe to retry after re-initializing.
struct MCPClientError: LocalizedError {
    enum Kind { case transport, session, tool }

    let kind: Kind
    let message: String

    var errorDescription: String? { message }
}

/// Minimal client for the MCP "Streamable HTTP" transport: one POST per JSON-RPC
/// request, replies arrive either as JSON or as a short SSE stream.
actor MCPClient {
    private let endpoint: URL
    private let clientName: String
    private let clientVersion: String
    private let urlSession: URLSession
    private let protocolVersion = "2025-06-18"

    private var sessionID: String?
    private var idCounter = 0

    init(endpoint: URL, clientName: String = "Prata", clientVersion: String = "0.1.0", timeout: TimeInterval = 90) {
        self.endpoint = endpoint
        self.clientName = clientName
        self.clientVersion = clientVersion

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout + 30
        configuration.waitsForConnectivity = true
        self.urlSession = URLSession(configuration: configuration)
    }

    func callTool(_ name: String, arguments: [String: Any]) async throws -> String {
        if sessionID == nil {
            try await initializeSession()
        }
        do {
            return try await performToolCall(name, arguments: arguments)
        } catch let error as MCPClientError where error.kind == .session {
            sessionID = nil
            try await initializeSession()
            return try await performToolCall(name, arguments: arguments)
        }
    }

    func reset() {
        sessionID = nil
    }

    // MARK: - JSON-RPC

    private func initializeSession() async throws {
        let params: [String: Any] = [
            "protocolVersion": protocolVersion,
            "capabilities": [:],
            "clientInfo": ["name": clientName, "version": clientVersion],
        ]
        let (data, response) = try await post(body: request(method: "initialize", params: params), withSession: false)
        if let id = response.value(forHTTPHeaderField: "Mcp-Session-Id"), !id.isEmpty {
            sessionID = id
        }
        _ = try result(from: data, response: response)

        let notification: [String: Any] = ["jsonrpc": "2.0", "method": "notifications/initialized"]
        _ = try? await post(body: notification, withSession: true)
    }

    private func performToolCall(_ name: String, arguments: [String: Any]) async throws -> String {
        let params: [String: Any] = ["name": name, "arguments": arguments]
        let (data, response) = try await post(body: request(method: "tools/call", params: params), withSession: true)
        let result = try result(from: data, response: response)

        let blocks = result["content"] as? [[String: Any]] ?? []
        let text = blocks.compactMap { $0["text"] as? String }.joined(separator: "\n")
        if result["isError"] as? Bool == true {
            throw MCPClientError(kind: .tool, message: text.isEmpty ? "Tool \(name) returned an error." : text)
        }
        return text
    }

    private func request(method: String, params: [String: Any]) -> [String: Any] {
        idCounter += 1
        return ["jsonrpc": "2.0", "id": idCounter, "method": method, "params": params]
    }

    private func post(body: [String: Any], withSession: Bool) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue(protocolVersion, forHTTPHeaderField: "MCP-Protocol-Version")
        if withSession, let sessionID {
            request.setValue(sessionID, forHTTPHeaderField: "Mcp-Session-Id")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw MCPClientError(kind: .transport, message: error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw MCPClientError(kind: .transport, message: "Unexpected response from the server.")
        }
        if http.statusCode == 404 || (http.statusCode == 400 && sessionID != nil) {
            throw MCPClientError(kind: .session, message: "The session expired.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let detail = String(decoding: data.prefix(200), as: UTF8.self)
            throw MCPClientError(kind: .transport, message: "HTTP \(http.statusCode): \(detail)")
        }
        return (data, http)
    }

    private func result(from data: Data, response: HTTPURLResponse) throws -> [String: Any] {
        let contentType = response.value(forHTTPHeaderField: "Content-Type") ?? ""
        let envelopes = Self.jsonObjects(in: data, contentType: contentType)

        guard let envelope = envelopes.last(where: { $0["result"] != nil || $0["error"] != nil }) else {
            throw MCPClientError(kind: .transport, message: "Could not parse the server response.")
        }
        if let error = envelope["error"] as? [String: Any] {
            let message = error["message"] as? String ?? "unknown error"
            let code = error["code"] as? Int ?? 0
            throw MCPClientError(kind: code == -32001 ? .session : .tool, message: message)
        }
        return envelope["result"] as? [String: Any] ?? [:]
    }

    private static func jsonObjects(in data: Data, contentType: String) -> [[String: Any]] {
        guard contentType.contains("text/event-stream") else {
            return [(try? JSONSerialization.jsonObject(with: data)) as? [String: Any]].compactMap { $0 }
        }
        let text = String(decoding: data, as: UTF8.self)
        return text.split(whereSeparator: \.isNewline).compactMap { line in
            guard line.hasPrefix("data:") else { return nil }
            let payload = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
            guard let payloadData = payload.data(using: .utf8) else { return nil }
            return (try? JSONSerialization.jsonObject(with: payloadData)) as? [String: Any]
        }
    }
}
