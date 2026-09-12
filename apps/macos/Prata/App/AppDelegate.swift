import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let settings = AppSettings()
    let islandModel = IslandModel()
    lazy var store = RoomStore(settings: settings)
    lazy var bridge = AgentBridge(store: store, settings: settings)

    private var islandPanel: NSPanel?
    private var chatWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard !handedOffToRunningInstance() else { return }

        store.onIncoming = { [weak self] _, _ in self?.islandModel.pop() }
        makeIslandPanel()
        store.start()
        bridge.start()

        store.$sessions
            .map(\.count)
            .removeDuplicates()
            .sink { [weak self] count in self?.resizeIsland(for: count) }
            .store(in: &cancellables)

        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.repositionIsland() }
        }

        if !settings.isConfigured { showChat() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showChat()
        return true
    }

    /// A second instance would fight over the island panel and fail to bind the bridge
    /// port, so hand focus to the one already running and quit. Only the newer instance
    /// backs off — comparing launch order keeps two simultaneous starts from both quitting.
    private func handedOffToRunningInstance() -> Bool {
        guard let bundleID = Bundle.main.bundleIdentifier else { return false }
        let me = NSRunningApplication.current
        let older = NSRunningApplication
            .runningApplications(withBundleIdentifier: bundleID)
            .filter { $0.processIdentifier != me.processIdentifier }
            .first { Self.startedFirst($0, me) }

        guard let older else { return false }
        prataLog("another instance is already running (pid \(older.processIdentifier)) — this one will quit.")
        older.activate()
        NSApp.terminate(nil)
        return true
    }

    private static func startedFirst(_ candidate: NSRunningApplication, _ me: NSRunningApplication) -> Bool {
        if let theirs = candidate.launchDate, let mine = me.launchDate, theirs != mine {
            return theirs < mine
        }
        return candidate.processIdentifier < me.processIdentifier
    }

    // MARK: - Island

    private func makeIslandPanel() {
        let size = IslandMetrics.size(for: store.sessions.count)
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = false

        let root = IslandView(
            model: islandModel,
            onOpen: { [weak self] room in self?.showChat(room: room) },
            onDragMoved: { [weak self] point in self?.moveIsland(towards: point) },
            onDragEnded: { [weak self] in self?.settings.persistIslandAnchor() }
        )
        .environmentObject(store)
        .environmentObject(settings)
        .environmentObject(bridge)

        let hosting = NSHostingView(rootView: root)
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.autoresizingMask = [.width, .height]
        panel.contentView = hosting

        islandPanel = panel
        repositionIsland()
        prataLog("island frame: \(panel.frame) (edge: \(settings.islandAnchor.edge.rawValue))")
        panel.orderFrontRegardless()
    }

    private func repositionIsland() {
        guard let islandPanel,
              let screen = IslandPlacement.screen(for: settings.islandAnchor) else { return }
        islandPanel.setFrameOrigin(
            IslandPlacement.panelOrigin(
                for: settings.islandAnchor,
                on: screen,
                panelSize: islandPanel.frame.size
            )
        )
    }

    /// The panel has to be long enough for every room the row can show.
    private func resizeIsland(for count: Int) {
        guard let islandPanel else { return }
        let size = IslandMetrics.size(for: count)
        guard islandPanel.frame.size != size else { return }
        islandPanel.setContentSize(size)
        repositionIsland()
    }

    /// Snaps the island onto the rail nearest the cursor while it is being dragged.
    private func moveIsland(towards point: CGPoint) {
        let screen = IslandPlacement.screen(containing: point)
        let anchor = IslandPlacement.anchor(for: point, on: screen, current: settings.islandAnchor)
        guard anchor != settings.islandAnchor else { return }
        settings.islandAnchor = anchor
        repositionIsland()
    }

    var isIslandVisible: Bool { islandPanel?.isVisible ?? false }

    func toggleIsland() {
        guard let islandPanel else { return }
        if islandPanel.isVisible {
            islandPanel.orderOut(nil)
        } else {
            repositionIsland()
            islandPanel.orderFrontRegardless()
        }
    }

    // MARK: - Chat window

    func showChat(room: String? = nil) {
        islandModel.settle()
        if let room, !room.isEmpty { store.select(room) }
        store.isChatVisible = true

        if chatWindow == nil {
            let root = ChatView()
                .environmentObject(store)
                .environmentObject(settings)
                .environmentObject(bridge)

            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 460, height: 560),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = "Prata"
            window.titlebarAppearsTransparent = true
            window.appearance = NSAppearance(named: .darkAqua)
            window.backgroundColor = NSColor(PrataTheme.background)
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: root)
            window.delegate = self
            window.center()
            chatWindow = window
        }

        NSApp.activate(ignoringOtherApps: true)
        chatWindow?.makeKeyAndOrderFront(nil)
    }

    func windowDidBecomeKey(_ notification: Notification) {
        store.isChatVisible = true
        store.markSelectedRead()
    }

    func windowDidResignKey(_ notification: Notification) {
        store.isChatVisible = false
    }

    func windowWillClose(_ notification: Notification) {
        store.isChatVisible = false
    }
}
