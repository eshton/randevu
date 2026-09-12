import Foundation

/// Exposes the room and the human's instruction queue to the user's own agent over a
/// loopback MCP server, so every outgoing message is composed by the agent.
@MainActor
final class AgentBridge: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var lastError: String?

    private let store: RoomStore
    private let settings: AppSettings
    private var server: LocalMCPServer?

    private static let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    init(store: RoomStore, settings: AppSettings) {
        self.store = store
        self.settings = settings
    }

    var endpointURL: String { server?.endpointURL ?? "" }

    func start() {
        stop()
        let server = LocalMCPServer(
            port: settings.bridgePort,
            token: settings.bridgeToken,
            tools: Self.tools,
            instructions: Self.serverInstructions
        ) { [weak self] name, arguments in
            guard let self else { return .failure("Prata is no longer running.") }
            return await self.invoke(name, arguments)
        }

        do {
            try server.start()
            self.server = server
            isRunning = true
            lastError = nil
            prataLog("agent bridge listening: \(server.endpointURL)")
        } catch {
            isRunning = false
            lastError = error.localizedDescription
            prataLog("agent bridge failed to start — \(error.localizedDescription)")
        }
    }

    func stop() {
        server?.stop()
        server = nil
        isRunning = false
    }

    // MARK: - Tools

    private static let serverInstructions = """
    Prata is the desk of the human you work for. They type instructions here instead of \
    posting into the shared Randevu rooms themselves. Several rooms can be open at once.

    Workflow: call prata_pending to see what your human wants said, and in which room. \
    Use prata_rooms for the list of rooms and prata_transcript for the conversation so \
    far. Compose the actual message yourself, within their mandate, then call \
    prata_send_reply — that posts it into the room and clears the instruction. If an \
    instruction should not be sent, call prata_dismiss with a reason.

    Every tool takes an optional `room`. Leave it out and Prata uses the room the \
    instructions belong to, falling back to the one the human has open.

    Never paste your human's raw wording without judgement; they expect you to phrase it.
    """

    private static let roomArgument: [String: Any] = [
        "type": "string",
        "description": "room code; defaults to the room the instructions belong to",
    ]

    private static let tools: [LocalTool] = [
        LocalTool(
            name: "prata_rooms",
            description: "The rooms Prata is watching, with their connection state and unread counts.",
            inputSchema: ["type": "object", "properties": [:]]
        ),
        LocalTool(
            name: "prata_pending",
            description: "Instructions your human typed in Prata that you have not acted on yet, tagged with the room each belongs to. Check this before replying.",
            inputSchema: ["type": "object", "properties": [:]]
        ),
        LocalTool(
            name: "prata_transcript",
            description: "A Randevu room conversation as Prata currently sees it.",
            inputSchema: [
                "type": "object",
                "properties": [
                    "limit": ["type": "number", "description": "how many of the most recent messages to return (default 30)"],
                    "room": roomArgument,
                ],
            ]
        ),
        LocalTool(
            name: "prata_send_reply",
            description: "Post a message into a room on your human's behalf and mark the pending instructions as handled.",
            inputSchema: [
                "type": "object",
                "properties": [
                    "text": ["type": "string", "description": "the message to post — your wording, not your human's raw text"],
                    "type": ["type": "string", "description": "optional message type, e.g. offer/counter/accept/question"],
                    "room": roomArgument,
                    "instruction_ids": [
                        "type": "array",
                        "items": ["type": "string"],
                        "description": "which instructions this covers; defaults to all pending ones in that room",
                    ],
                ],
                "required": ["text"],
            ]
        ),
        LocalTool(
            name: "prata_dismiss",
            description: "Mark instructions as handled without posting anything, with a reason your human will see.",
            inputSchema: [
                "type": "object",
                "properties": [
                    "reason": ["type": "string"],
                    "room": roomArgument,
                    "instruction_ids": [
                        "type": "array",
                        "items": ["type": "string"],
                        "description": "defaults to all pending ones in that room",
                    ],
                ],
                "required": ["reason"],
            ]
        ),
    ]

    private func invoke(_ name: String, _ arguments: [String: Any]) async -> ToolOutcome {
        switch name {
        case "prata_rooms":
            guard !store.ordered.isEmpty else { return .text("(no rooms configured in Prata)") }
            let lines = store.ordered.map { session in
                let marks = [
                    session.id == store.selectedRoomID ? "open" : nil,
                    session.hasUnread ? "\(session.unreadCount) unread" : nil,
                    session.pendingInstructions.isEmpty ? nil : "\(session.pendingInstructions.count) pending",
                ].compactMap { $0 }
                let suffix = marks.isEmpty ? "" : " [\(marks.joined(separator: ", "))]"
                return "- \(session.id) — \(session.displayName), \(Self.describe(session.connection))\(suffix)"
            }
            return .text("Rooms, most relevant first:\n" + lines.joined(separator: "\n"))

        case "prata_pending":
            let sessions = store.sessionsWithPendingInstructions
            guard !sessions.isEmpty else {
                return .text("(no pending instructions — your human has not asked for anything new)")
            }
            let lines = sessions.flatMap { session in
                session.pendingInstructions.map { instruction in
                    "- [\(instruction.id.uuidString)] room=\(session.id) (\(session.displayName)) \(Self.formatter.string(from: instruction.createdAt)): \(instruction.text)"
                }
            }
            return .text("Pending instructions from your human:\n" + lines.joined(separator: "\n"))

        case "prata_transcript":
            guard let session = resolveSession(arguments, ids: []) else { return .failure(Self.noRoom) }
            let limit = (arguments["limit"] as? NSNumber)?.intValue ?? 30
            let slice = session.messages.suffix(max(1, limit))
            guard !slice.isEmpty else { return .text("(\(session.id) is empty)") }
            let lines = slice.map { message in
                "#\(message.seq) \(message.from)\(message.type.map { " (\($0))" } ?? ""): \(message.text)"
            }
            return .text("Room \(session.id):\n" + lines.joined(separator: "\n"))

        case "prata_send_reply":
            guard let text = (arguments["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty
            else { return .failure("`text` is required.") }

            let ids = Self.uuids(from: arguments["instruction_ids"])
            guard let session = resolveSession(arguments, ids: ids) else { return .failure(Self.noRoom) }

            do {
                try await session.sendAsAgent(text: text, type: arguments["type"] as? String)
            } catch {
                return .failure("Could not post the message: \(error.localizedDescription)")
            }
            session.resolveInstructions(ids, as: .sent, note: text)
            return .text("Posted into \(session.id) as \"\(settings.displayName)\".")

        case "prata_dismiss":
            guard let reason = arguments["reason"] as? String, !reason.isEmpty else {
                return .failure("`reason` is required.")
            }
            let ids = Self.uuids(from: arguments["instruction_ids"])
            guard let session = resolveSession(arguments, ids: ids) else { return .failure(Self.noRoom) }
            session.resolveInstructions(ids, as: .dismissed, note: reason)
            return .text("Marked as handled in \(session.id) without posting.")

        default:
            return .failure("Unknown tool: \(name)")
        }
    }

    private static let noRoom = "No such room in Prata — prata_rooms lists them."

    /// An explicit `room` wins; otherwise the instructions decide, then whatever is
    /// waiting, then the room the human has open.
    private func resolveSession(_ arguments: [String: Any], ids: [UUID]) -> RoomSession? {
        if let room = (arguments["room"] as? String)?.trimmingCharacters(in: .whitespaces), !room.isEmpty {
            return store.session(id: room)
        }
        if let owner = ids.lazy.compactMap({ self.store.session(containing: $0) }).first {
            return owner
        }
        return store.sessionsWithPendingInstructions.first ?? store.active
    }

    private static func describe(_ connection: RoomSession.Connection) -> String {
        switch connection {
        case .idle: "stopped"
        case .connecting: "connecting"
        case .live: "live"
        case .failed(let message): "failed: \(message)"
        }
    }

    private static func uuids(from value: Any?) -> [UUID] {
        guard let raw = value as? [String] else { return [] }
        return raw.compactMap(UUID.init(uuidString:))
    }
}
