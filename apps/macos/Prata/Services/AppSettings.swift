import AppKit
import Combine
import Security

/// A room the human has saved. Every one of them gets a live session, so the island can
/// show all of them side by side.
struct SavedRoom: Identifiable, Codable, Equatable {
    let id: String
    var peerName: String
    var endpoint: String
    var lastUsedAt: Date

    var endpointURL: URL {
        URL(string: endpoint) ?? URL(string: AppSettings.defaultEndpoint)!
    }
}

@MainActor
final class AppSettings: ObservableObject {
    private enum Key {
        static let roomId = "room.id"
        static let displayName = "room.displayName"
        static let peerName = "room.peerName"
        static let endpoint = "room.endpoint"
        static let savedRooms = "rooms.v1"
        static let bridgePort = "bridge.port"
        static let bridgeToken = "bridge.token"
        static let islandAnchor = "island.anchor.v1"
    }

    nonisolated static let defaultEndpoint = "https://mcp.randevu.run/mcp"
    static let defaultBridgePort: UInt16 = 4599

    /// The room the chat window is showing. The others keep running in the background.
    @Published private(set) var roomId: String { didSet { defaults.set(roomId, forKey: Key.roomId) } }
    @Published var displayName: String { didSet { defaults.set(displayName, forKey: Key.displayName) } }
    @Published var peerName: String { didSet { defaults.set(peerName, forKey: Key.peerName); syncCurrentRoomDetails() } }
    @Published var endpoint: String { didSet { defaults.set(endpoint, forKey: Key.endpoint); syncCurrentRoomDetails() } }
    @Published private(set) var savedRooms: [SavedRoom] = [] { didSet { persistSavedRooms() } }
    /// One avatar per room, keyed by room id.
    @Published private(set) var avatars: [String: NSImage] = [:]
    /// Changes on every mouse move while the island is being dragged, so it is written
    /// out by `persistIslandAnchor()` once the drag finishes rather than on every set.
    @Published var islandAnchor: IslandAnchor

    let bridgePort: UInt16
    let bridgeToken: String

    private let defaults = UserDefaults.standard

    init() {
        roomId = defaults.string(forKey: Key.roomId) ?? ""
        displayName = defaults.string(forKey: Key.displayName) ?? NSFullUserName()
        peerName = defaults.string(forKey: Key.peerName) ?? ""
        endpoint = defaults.string(forKey: Key.endpoint) ?? Self.defaultEndpoint

        if let data = defaults.data(forKey: Key.islandAnchor),
           let decoded = try? JSONDecoder().decode(IslandAnchor.self, from: data) {
            islandAnchor = decoded
        } else {
            islandAnchor = .default
        }

        if let data = defaults.data(forKey: Key.savedRooms),
           let decoded = try? JSONDecoder().decode([SavedRoom].self, from: data) {
            savedRooms = decoded.sorted { $0.lastUsedAt > $1.lastUsedAt }
        }

        let storedPort = defaults.integer(forKey: Key.bridgePort)
        bridgePort = storedPort > 0 && storedPort <= 65535 ? UInt16(storedPort) : Self.defaultBridgePort
        defaults.set(Int(bridgePort), forKey: Key.bridgePort)

        if let token = defaults.string(forKey: Key.bridgeToken), !token.isEmpty {
            bridgeToken = token
        } else {
            bridgeToken = Self.makeToken()
            defaults.set(bridgeToken, forKey: Key.bridgeToken)
        }

        registerCurrentRoom()
        loadAvatars()
    }

    /// Guards the loopback bridge: a local process has to know this to reach the room.
    private static func makeToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            return UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    var endpointURL: URL {
        URL(string: endpoint) ?? URL(string: Self.defaultEndpoint)!
    }

    var isConfigured: Bool { !savedRooms.isEmpty }

    func persistIslandAnchor() {
        guard let data = try? JSONEncoder().encode(islandAnchor) else { return }
        defaults.set(data, forKey: Key.islandAnchor)
    }

    // MARK: - Rooms

    /// Carries over the room from the single-room build.
    private func registerCurrentRoom() {
        let id = roomId.trimmingCharacters(in: .whitespaces)
        guard !id.isEmpty, !savedRooms.contains(where: { $0.id == id }) else { return }
        savedRooms.insert(
            SavedRoom(id: id, peerName: peerName, endpoint: endpoint, lastUsedAt: Date()),
            at: 0
        )
    }

    @discardableResult
    func addRoom(id: String) -> Bool {
        let trimmed = id.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return false }
        if !savedRooms.contains(where: { $0.id == trimmed }) {
            savedRooms.insert(
                SavedRoom(id: trimmed, peerName: "", endpoint: Self.defaultEndpoint, lastUsedAt: Date()),
                at: 0
            )
        }
        selectRoom(id: trimmed)
        return true
    }

    /// `roomId` is set before the mirrored fields, so `syncCurrentRoomDetails()` writes
    /// them onto the room being switched *to* rather than the one being left.
    func selectRoom(id: String) {
        let trimmed = id.trimmingCharacters(in: .whitespaces)
        guard trimmed != roomId else { return }
        let room = savedRooms.first { $0.id == trimmed }
        roomId = trimmed
        peerName = room?.peerName ?? ""
        endpoint = room.map { $0.endpoint.isEmpty ? Self.defaultEndpoint : $0.endpoint } ?? Self.defaultEndpoint
        touch(roomId: trimmed, at: Date())
    }

    func forgetRoom(_ room: SavedRoom) {
        savedRooms.removeAll { $0.id == room.id }
        avatars[room.id] = nil
        try? FileManager.default.removeItem(at: Self.avatarURL(room: room.id))
        RoomSession.forgetInstructions(room: room.id)
    }

    /// Drives the island's recency order.
    func touch(roomId id: String, at date: Date) {
        guard let index = savedRooms.firstIndex(where: { $0.id == id }),
              savedRooms[index].lastUsedAt < date
        else { return }
        savedRooms[index].lastUsedAt = date
    }

    /// Keeps the stored entry in step when the peer name or endpoint is edited.
    private func syncCurrentRoomDetails() {
        let id = roomId.trimmingCharacters(in: .whitespaces)
        guard let index = savedRooms.firstIndex(where: { $0.id == id }) else { return }
        guard savedRooms[index].peerName != peerName || savedRooms[index].endpoint != endpoint else { return }
        savedRooms[index].peerName = peerName
        savedRooms[index].endpoint = endpoint
    }

    private func persistSavedRooms() {
        guard let data = try? JSONEncoder().encode(savedRooms) else { return }
        defaults.set(data, forKey: Key.savedRooms)
    }

    // MARK: - Avatars

    func avatar(for roomId: String) -> NSImage? {
        avatars[roomId] ?? avatars[Self.sharedAvatarKey]
    }

    func setAvatar(from url: URL, for roomId: String) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        guard !roomId.isEmpty, let image = NSImage(contentsOf: url) else { return }
        avatars[roomId] = image

        let destination = Self.avatarURL(room: roomId)
        try? FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if let data = image.pngData() {
            try? data.write(to: destination)
        }
    }

    private func loadAvatars() {
        // The single-room build kept one avatar; it stays as the fallback for rooms
        // that have not been given their own.
        if let legacy = NSImage(contentsOf: Self.legacyAvatarURL) {
            avatars[Self.sharedAvatarKey] = legacy
        }
        for room in savedRooms {
            if let image = NSImage(contentsOf: Self.avatarURL(room: room.id)) {
                avatars[room.id] = image
            }
        }
    }

    private static let sharedAvatarKey = ""

    private static var supportDirectory: URL {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Prata")
    }

    private static var legacyAvatarURL: URL {
        supportDirectory.appendingPathComponent("avatar.png")
    }

    private static func avatarURL(room: String) -> URL {
        let safe = String(room.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
        return supportDirectory
            .appendingPathComponent("avatars")
            .appendingPathComponent("\(safe).png")
    }
}

private extension NSImage {
    func pngData() -> Data? {
        guard let tiff = tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }
}
