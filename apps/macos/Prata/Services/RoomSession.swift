import Foundation

/// Something the human typed in Prata for their agent to act on. Prata never posts it
/// to the room itself — the agent drains the queue and composes the actual reply.
struct Instruction: Identifiable, Codable, Equatable {
    enum State: String, Codable { case pending, sent, dismissed }

    let id: UUID
    let createdAt: Date
    let text: String
    var state: State
    var note: String?
}

/// One room: its own long-poll loop, transcript, unread count and agent queue.
///
/// Every saved room gets a live session rather than only the one on screen, so the
/// island can show at a glance which of them are talking.
@MainActor
final class RoomSession: ObservableObject, Identifiable {
    enum Connection: Equatable {
        case idle
        case connecting
        case live
        case failed(String)
    }

    let id: String
    @Published private(set) var peerName: String
    @Published private(set) var messages: [RoomMessage] = []
    @Published private(set) var instructions: [Instruction] = []
    @Published private(set) var connection: Connection = .idle
    @Published private(set) var unreadCount = 0
    @Published private(set) var peerAwaitingHuman = false
    /// Drives the island's recency order.
    @Published private(set) var lastActivityAt: Date
    @Published var draft = ""

    /// Set while the chat window is showing this room; suppresses the unread badge.
    var isVisible = false
    /// Fired when a message from the other party lands — the island uses it to pop out.
    var onIncoming: ((RoomSession, RoomMessage) -> Void)?
    /// Fired whenever something happened that the island row depends on.
    var onChange: ((RoomSession) -> Void)?

    private let settings: AppSettings
    private var endpoint: URL
    private var listener: RandevuClient
    private var sender: RandevuClient
    private var loop: Task<Void, Never>?
    private var cursor = 0
    private var seenSeqs = Set<Int>()
    private var didLoadHistory = false

    init(id: String, peerName: String, endpoint: URL, lastActivityAt: Date, settings: AppSettings) {
        self.id = id
        self.peerName = peerName
        self.endpoint = endpoint
        self.lastActivityAt = lastActivityAt
        self.settings = settings
        self.listener = RandevuClient(endpoint: endpoint)
        self.sender = RandevuClient(endpoint: endpoint)
        self.instructions = Self.loadInstructions(room: id)
    }

    /// Falls back to whoever is talking in the room when no name has been set for it.
    var displayName: String {
        let named = peerName.trimmingCharacters(in: .whitespaces)
        if !named.isEmpty { return named }
        let others = messages.first { !$0.isMine(myName: settings.displayName) }
        return others?.from ?? id
    }

    var hasUnread: Bool { unreadCount > 0 }

    var pendingInstructions: [Instruction] {
        instructions.filter { $0.state == .pending }
    }

    // MARK: - Lifecycle

    func start() {
        guard loop == nil, !id.isEmpty else { return }
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        connection = .idle
    }

    func restart() {
        stop()
        messages = []
        seenSeqs = []
        cursor = 0
        didLoadHistory = false
        unreadCount = 0
        peerAwaitingHuman = false
        listener = RandevuClient(endpoint: endpoint)
        sender = RandevuClient(endpoint: endpoint)
        start()
        onChange?(self)
    }

    /// Picks up edits made in settings. Only an endpoint change needs the loop torn down.
    func update(peerName: String, endpoint: URL) {
        if peerName != self.peerName { self.peerName = peerName }
        guard endpoint != self.endpoint else { return }
        self.endpoint = endpoint
        restart()
    }

    func markRead() {
        guard unreadCount > 0 else { return }
        unreadCount = 0
        onChange?(self)
    }

    // MARK: - Agent queue

    /// The composer queues for the agent; it never posts to the room directly.
    func queueForAgent() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        instructions.append(Instruction(id: UUID(), createdAt: Date(), text: text, state: .pending))
        persistInstructions()
        prataLog("instruction queued for the agent — room=\(id) (\(pendingInstructions.count) waiting)")
    }

    func resolveInstructions(_ ids: [UUID], as state: Instruction.State, note: String?) {
        let targets = ids.isEmpty ? pendingInstructions.map(\.id) : ids
        for id in targets {
            guard let index = instructions.firstIndex(where: { $0.id == id }) else { continue }
            instructions[index].state = state
            instructions[index].note = note
        }
        persistInstructions()
    }

    func discardInstruction(_ id: UUID) {
        instructions.removeAll { $0.id == id }
        persistInstructions()
    }

    func contains(instruction id: UUID) -> Bool {
        instructions.contains { $0.id == id }
    }

    /// Posts into the room on the agent's behalf, under the human's display name.
    func sendAsAgent(text: String, type: String?) async throws {
        try await sender.send(roomId: id, from: settings.displayName, text: text, type: type)
        lastActivityAt = Date()
        onChange?(self)
    }

    // MARK: - Instruction storage

    private static let legacyKey = "outbox.v1"

    private static func storageKey(room: String) -> String { "outbox.v2.\(room)" }

    /// The single-room build kept one queue; hand it to whichever room was open then.
    static func migrateLegacyInstructions(into room: String) {
        let defaults = UserDefaults.standard
        guard let legacy = defaults.data(forKey: legacyKey) else { return }
        if !room.isEmpty, defaults.data(forKey: storageKey(room: room)) == nil {
            defaults.set(legacy, forKey: storageKey(room: room))
        }
        defaults.removeObject(forKey: legacyKey)
    }

    static func forgetInstructions(room: String) {
        UserDefaults.standard.removeObject(forKey: storageKey(room: room))
    }

    private static func loadInstructions(room: String) -> [Instruction] {
        guard let data = UserDefaults.standard.data(forKey: storageKey(room: room)) else { return [] }
        return (try? JSONDecoder().decode([Instruction].self, from: data)) ?? []
    }

    private func persistInstructions() {
        // Keep the tail bounded so the store cannot grow without limit.
        if instructions.count > 200 {
            instructions.removeFirst(instructions.count - 200)
        }
        guard let data = try? JSONEncoder().encode(instructions) else { return }
        UserDefaults.standard.set(data, forKey: Self.storageKey(room: id))
    }

    // MARK: - Long-poll loop

    private func run() async {
        var backoffSeconds: UInt64 = 2
        prataLog("listener starting — room=\(id), endpoint=\(endpoint.absoluteString)")

        while !Task.isCancelled {
            if connection != .live { connection = .connecting }

            do {
                let batch: RoomTranscript
                if didLoadHistory {
                    batch = try await listener.waitForMessage(roomId: id, after: cursor)
                } else {
                    batch = try await listener.receive(roomId: id, after: 0)
                    didLoadHistory = true
                }
                connection = .live
                backoffSeconds = 2
                apply(batch)
            } catch is CancellationError {
                return
            } catch {
                connection = .failed(error.localizedDescription)
                prataLog("connection failed (\(id)) — \(error.localizedDescription); retrying in \(backoffSeconds)s")
                try? await Task.sleep(nanoseconds: backoffSeconds * 1_000_000_000)
                backoffSeconds = min(backoffSeconds * 2, 30)
            }
        }
    }

    private func apply(_ batch: RoomTranscript) {
        cursor = max(cursor, batch.cursor)
        peerAwaitingHuman = batch.peerAwaitingHuman

        let fresh = batch.messages.filter { seenSeqs.insert($0.seq).inserted }
        guard !fresh.isEmpty else { return }
        prataLog("\(fresh.count) new messages, cursor=\(cursor), room=\(id), me=\(settings.displayName)")

        messages.append(contentsOf: fresh)
        messages.sort { $0.seq < $1.seq }
        if let last = messages.last?.seq { cursor = max(cursor, last) }
        lastActivityAt = Date()

        let incoming = fresh.filter { !$0.isMine(myName: settings.displayName) }
        guard let latest = incoming.last else {
            onChange?(self)
            return
        }
        if !isVisible { unreadCount += incoming.count }
        onIncoming?(self, latest)
    }
}
