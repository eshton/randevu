import Combine
import Foundation

/// stderr is unbuffered, so these survive output redirection.
func prataLog(_ message: String) {
    let stamp = DateFormatter.prataClock.string(from: Date())
    fputs("Prata \(stamp): \(message)\n", stderr)
}

private extension DateFormatter {
    static let prataClock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
}

/// Owns one live `RoomSession` per saved room and keeps them in the order the island
/// shows them: anything active first, then by most recent activity.
@MainActor
final class RoomStore: ObservableObject {
    @Published private(set) var sessions: [RoomSession] = []
    /// The island row, already sorted. Frozen while the pointer is on the island.
    @Published private(set) var ordered: [RoomSession] = []
    @Published private(set) var selectedRoomID = ""
    @Published private(set) var totalUnread = 0

    /// Fired when a message from any room lands — the island uses it to pop out.
    var onIncoming: ((RoomSession, RoomMessage) -> Void)?

    /// Set while the chat window is visible; suppresses the unread badge on the room
    /// it is showing.
    var isChatVisible = false {
        didSet {
            updateVisibility()
            if isChatVisible { markSelectedRead() }
        }
    }

    private let settings: AppSettings
    private var cancellables = Set<AnyCancellable>()
    private var isRunning = false
    /// The row must not shuffle out from under the cursor mid-click.
    private var orderingFrozen = false
    private var orderingStale = false

    init(settings: AppSettings) {
        self.settings = settings
        selectedRoomID = settings.roomId
        RoomSession.migrateLegacyInstructions(into: settings.roomId)

        // These fire on `willSet`, so the emitted value is what gets used — reading the
        // property back inside the sink would still give the old one.
        settings.$savedRooms
            .sink { [weak self] rooms in self?.syncSessions(with: rooms) }
            .store(in: &cancellables)

        settings.$roomId
            .removeDuplicates()
            .sink { [weak self] id in self?.applySelection(id) }
            .store(in: &cancellables)
    }

    // MARK: - Lookup

    var active: RoomSession? { session(id: selectedRoomID) }

    func session(id: String) -> RoomSession? {
        sessions.first { $0.id == id }
    }

    func session(containing instruction: UUID) -> RoomSession? {
        sessions.first { $0.contains(instruction: instruction) }
    }

    var sessionsWithPendingInstructions: [RoomSession] {
        ordered.filter { !$0.pendingInstructions.isEmpty }
    }

    /// Active means "worth looking at": unread traffic, or the room currently open.
    func isActive(_ session: RoomSession) -> Bool {
        session.hasUnread || session.id == selectedRoomID
    }

    // MARK: - Lifecycle

    func start() {
        isRunning = true
        sessions.forEach { $0.start() }
    }

    func restart() {
        sessions.forEach { $0.restart() }
    }

    func select(_ id: String) {
        settings.selectRoom(id: id)
    }

    func markSelectedRead() {
        active?.markRead()
        refresh()
    }

    /// The island freezes the row while the pointer is on it and releases it on exit.
    func freezeOrdering(_ frozen: Bool) {
        guard orderingFrozen != frozen else { return }
        orderingFrozen = frozen
        if !frozen, orderingStale { reorder() }
    }

    // MARK: - Session bookkeeping

    private func syncSessions(with rooms: [SavedRoom]) {
        var existing = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var result: [RoomSession] = []

        for room in rooms {
            if let session = existing.removeValue(forKey: room.id) {
                session.update(peerName: room.peerName, endpoint: room.endpointURL)
                result.append(session)
            } else {
                result.append(makeSession(room))
            }
        }
        for orphan in existing.values { orphan.stop() }

        sessions = result
        prataLog("rooms: \(result.count) — \(result.map(\.id).joined(separator: ", "))")

        if !result.contains(where: { $0.id == selectedRoomID }) {
            let fallback = result.first?.id ?? ""
            settings.selectRoom(id: fallback)
            applySelection(fallback)
        }
        refresh()
    }

    private func makeSession(_ room: SavedRoom) -> RoomSession {
        let session = RoomSession(
            id: room.id,
            peerName: room.peerName,
            endpoint: room.endpointURL,
            lastActivityAt: room.lastUsedAt,
            settings: settings
        )
        session.isVisible = isChatVisible && room.id == selectedRoomID
        session.onChange = { [weak self] session in self?.roomDidChange(session) }
        session.onIncoming = { [weak self] session, message in
            guard let self else { return }
            self.roomDidChange(session)
            self.onIncoming?(session, message)
        }
        if isRunning { session.start() }
        return session
    }

    private func roomDidChange(_ session: RoomSession) {
        settings.touch(roomId: session.id, at: session.lastActivityAt)
        refresh()
    }

    private func applySelection(_ id: String) {
        guard selectedRoomID != id else { return }
        selectedRoomID = id
        updateVisibility()
        if isChatVisible { active?.markRead() }
        refresh()
    }

    private func updateVisibility() {
        for session in sessions {
            session.isVisible = isChatVisible && session.id == selectedRoomID
        }
    }

    private func refresh() {
        totalUnread = sessions.reduce(0) { $0 + $1.unreadCount }
        reorder()
    }

    private func reorder() {
        guard !orderingFrozen else {
            orderingStale = true
            return
        }
        orderingStale = false
        ordered = sessions.sorted { lhs, rhs in
            let left = isActive(lhs), right = isActive(rhs)
            if left != right { return left }
            if lhs.lastActivityAt != rhs.lastActivityAt { return lhs.lastActivityAt > rhs.lastActivityAt }
            return lhs.id < rhs.id
        }
    }
}
