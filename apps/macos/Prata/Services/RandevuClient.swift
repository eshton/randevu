import Foundation

struct RoomMessage: Identifiable, Equatable {
    let seq: Int
    let from: String
    let type: String?
    let text: String

    var id: Int { seq }

    func isMine(myName: String) -> Bool {
        from.compare(myName, options: .caseInsensitive) == .orderedSame
    }
}

struct RoomTranscript {
    var messages: [RoomMessage]
    var cursor: Int
    var peerAwaitingHuman: Bool
}

/// The hosted Randevu tools return a human-readable transcript, e.g.
/// `#2 Agoston (question): Hi!` followed by a `cursor: 2` line. A trailing `⏸ …`
/// note means the other party paused to consult their human.
enum RoomTranscriptParser {
    private static let header = try! NSRegularExpression(
        pattern: #"^#(\d+)\s+(.+?)(?:\s+\(([^)]*)\))?:[ ]?(.*)$"#
    )

    static func parse(_ raw: String, fallbackCursor: Int) -> RoomTranscript {
        var messages: [RoomMessage] = []
        var cursor = fallbackCursor
        var awaitingHuman = false
        var pending: (seq: Int, from: String, type: String?, lines: [String])?

        func flush() {
            guard let pending else { return }
            let text = pending.lines
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            messages.append(RoomMessage(seq: pending.seq, from: pending.from, type: pending.type, text: text))
        }

        for line in raw.components(separatedBy: .newlines) {
            if let parsed = parseHeader(line) {
                flush()
                pending = parsed
                continue
            }
            if line.hasPrefix("⏸") {
                flush()
                pending = nil
                awaitingHuman = true
                continue
            }
            if let value = parseCursor(line) {
                flush()
                pending = nil
                cursor = value
                continue
            }
            if pending != nil {
                pending?.lines.append(line)
            }
        }
        flush()

        if let last = messages.last?.seq { cursor = max(cursor, last) }
        return RoomTranscript(messages: messages, cursor: cursor, peerAwaitingHuman: awaitingHuman)
    }

    private static func parseHeader(_ line: String) -> (seq: Int, from: String, type: String?, lines: [String])? {
        let range = NSRange(line.startIndex..<line.endIndex, in: line)
        guard let match = header.firstMatch(in: line, range: range),
              let seqRange = Range(match.range(at: 1), in: line),
              let fromRange = Range(match.range(at: 2), in: line),
              let seq = Int(line[seqRange])
        else { return nil }

        let type = Range(match.range(at: 3), in: line).map { String(line[$0]) }
        let body = Range(match.range(at: 4), in: line).map { String(line[$0]) } ?? ""
        return (seq, String(line[fromRange]), type?.isEmpty == true ? nil : type, [body])
    }

    private static func parseCursor(_ line: String) -> Int? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("cursor:") else { return nil }
        return Int(trimmed.dropFirst("cursor:".count).trimmingCharacters(in: .whitespaces))
    }
}

/// Thin wrapper over the hosted Randevu MCP tool surface (`apps/mcp`).
final class RandevuClient {
    private let client: MCPClient

    init(endpoint: URL) {
        client = MCPClient(endpoint: endpoint)
    }

    func receive(roomId: String, after: Int) async throws -> RoomTranscript {
        let text = try await client.callTool("receive", arguments: ["roomId": roomId, "after": after])
        return RoomTranscriptParser.parse(text, fallbackCursor: after)
    }

    func waitForMessage(roomId: String, after: Int, timeoutSeconds: Int = 45) async throws -> RoomTranscript {
        let text = try await client.callTool(
            "wait_for_message",
            arguments: ["roomId": roomId, "after": after, "timeout_seconds": timeoutSeconds]
        )
        return RoomTranscriptParser.parse(text, fallbackCursor: after)
    }

    func send(roomId: String, from: String, text: String, type: String? = nil) async throws {
        var arguments: [String: Any] = ["roomId": roomId, "from": from, "text": text]
        if let type, !type.isEmpty { arguments["type"] = type }
        _ = try await client.callTool("send", arguments: arguments)
    }

    func status(roomId: String) async throws -> String {
        try await client.callTool("status", arguments: ["roomId": roomId])
    }
}
