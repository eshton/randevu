import AppKit
import Combine

@MainActor
final class AppSettings: ObservableObject {
    private enum Key {
        static let roomId = "room.id"
        static let displayName = "room.displayName"
        static let peerName = "room.peerName"
        static let endpoint = "room.endpoint"
    }

    static let defaultEndpoint = "https://mcp.randevu.run/mcp"

    @Published var roomId: String { didSet { defaults.set(roomId, forKey: Key.roomId) } }
    @Published var displayName: String { didSet { defaults.set(displayName, forKey: Key.displayName) } }
    @Published var peerName: String { didSet { defaults.set(peerName, forKey: Key.peerName) } }
    @Published var endpoint: String { didSet { defaults.set(endpoint, forKey: Key.endpoint) } }
    @Published var avatar: NSImage?

    private let defaults = UserDefaults.standard

    init() {
        roomId = defaults.string(forKey: Key.roomId) ?? ""
        displayName = defaults.string(forKey: Key.displayName) ?? NSFullUserName()
        peerName = defaults.string(forKey: Key.peerName) ?? ""
        endpoint = defaults.string(forKey: Key.endpoint) ?? Self.defaultEndpoint
        avatar = NSImage(contentsOf: Self.avatarURL)
    }

    var endpointURL: URL {
        URL(string: endpoint) ?? URL(string: Self.defaultEndpoint)!
    }

    var isConfigured: Bool {
        !roomId.trimmingCharacters(in: .whitespaces).isEmpty
    }

    func setAvatar(from url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        guard let image = NSImage(contentsOf: url) else { return }
        avatar = image
        try? FileManager.default.createDirectory(
            at: Self.avatarURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if let data = image.pngData() {
            try? data.write(to: Self.avatarURL)
        }
    }

    private static var avatarURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Prata/avatar.png")
    }
}

private extension NSImage {
    func pngData() -> Data? {
        guard let tiff = tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }
}
