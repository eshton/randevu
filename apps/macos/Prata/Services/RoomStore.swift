import Combine
import Foundation

/// stderr is unbuffered, so these survive output redirection.
func prataLog(_ message: String) {
    fputs("Prata: \(message)\n", stderr)
}

@MainActor
final class RoomStore: ObservableObject {
    enum Connection: Equatable {
        case idle
        case connecting
        case live
        case failed(String)
    }

    @Published private(set) var messages: [RoomMessage] = []
    @Published private(set) var connection: Connection = .idle
    @Published private(set) var unreadCount = 0
    @Published private(set) var peerAwaitingHuman = false
    @Published private(set) var isSending = false
    @Published var draft = ""

    /// Fired when a message from the other party lands — the island uses it to pop out.
    var onIncoming: ((RoomMessage) -> Void)?
    /// Set while the chat window is visible; suppresses the unread badge.
    var isChatVisible = false

    private let settings: AppSettings
    /// Two MCP sessions: the listener parks in a 45s long poll, so sending needs its own.
    private var listener: RandevuClient
    private var sender: RandevuClient
    private var loop: Task<Void, Never>?
    private var cursor = 0
    private var seenSeqs = Set<Int>()
    private var didLoadHistory = false
    private var cancellables = Set<AnyCancellable>()

    init(settings: AppSettings) {
        self.settings = settings
        self.listener = RandevuClient(endpoint: settings.endpointURL)
        self.sender = RandevuClient(endpoint: settings.endpointURL)

        settings.$roomId
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] _ in self?.restart() }
            .store(in: &cancellables)

        settings.$endpoint
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] _ in self?.restart() }
            .store(in: &cancellables)
    }

    var peerDisplayName: String {
        if !settings.peerName.trimmingCharacters(in: .whitespaces).isEmpty { return settings.peerName }
        let other = messages.first { !$0.isMine(myName: settings.displayName) }
        return other?.from ?? "the other agent"
    }

    func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in await self?.run() }
    }

    func restart() {
        loop?.cancel()
        loop = nil
        messages = []
        seenSeqs = []
        cursor = 0
        didLoadHistory = false
        unreadCount = 0
        peerAwaitingHuman = false
        listener = RandevuClient(endpoint: settings.endpointURL)
        sender = RandevuClient(endpoint: settings.endpointURL)
        start()
    }

    func markRead() {
        unreadCount = 0
    }

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, settings.isConfigured, !isSending else { return }
        draft = ""
        isSending = true

        Task {
            defer { isSending = false }
            do {
                try await sender.send(roomId: settings.roomId, from: settings.displayName, text: text)
            } catch {
                draft = text
                connection = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: - Long-poll loop

    private func run() async {
        var backoffSeconds: UInt64 = 2
        prataLog("listener starting — room=\(settings.roomId.isEmpty ? "(none)" : settings.roomId), endpoint=\(settings.endpoint)")

        while !Task.isCancelled {
            guard settings.isConfigured else {
                connection = .idle
                prataLog("no room configured — listener stopped.")
                return
            }
            if connection != .live { connection = .connecting }

            do {
                let batch: RoomTranscript
                if didLoadHistory {
                    batch = try await listener.waitForMessage(roomId: settings.roomId, after: cursor)
                } else {
                    batch = try await listener.receive(roomId: settings.roomId, after: 0)
                    didLoadHistory = true
                }
                connection = .live
                backoffSeconds = 2
                apply(batch)
            } catch is CancellationError {
                return
            } catch {
                connection = .failed(error.localizedDescription)
                prataLog("connection error — \(error.localizedDescription); retrying in \(backoffSeconds)s")
                try? await Task.sleep(nanoseconds: backoffSeconds * 1_000_000_000)
                backoffSeconds = min(backoffSeconds * 2, 30)
            }
        }
    }

    private func apply(_ batch: RoomTranscript) {
        cursor = max(cursor, batch.cursor)
        peerAwaitingHuman = batch.peerAwaitingHuman

        let fresh = batch.messages.filter { seenSeqs.insert($0.seq).inserted }
        prataLog("\(fresh.count) new message(s), cursor=\(cursor), room=\(settings.roomId), me=\(settings.displayName)")
        guard !fresh.isEmpty else { return }

        messages.append(contentsOf: fresh)
        messages.sort { $0.seq < $1.seq }
        if let last = messages.last?.seq { cursor = max(cursor, last) }

        let incoming = fresh.filter { !$0.isMine(myName: settings.displayName) }
        guard let latest = incoming.last else { return }
        if !isChatVisible { unreadCount += incoming.count }
        onIncoming?(latest)
    }
}
