import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let settings = AppSettings()
    let islandModel = IslandModel()
    lazy var store = RoomStore(settings: settings)

    private var islandPanel: NSPanel?
    private var chatWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        store.onIncoming = { [weak self] _ in self?.islandModel.pop() }
        makeIslandPanel()
        store.start()

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

    // MARK: - Island

    private func makeIslandPanel() {
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: IslandMetrics.size),
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

        let root = IslandView(model: islandModel) { [weak self] in self?.showChat() }
            .environmentObject(store)
            .environmentObject(settings)

        let hosting = NSHostingView(rootView: root)
        hosting.frame = NSRect(origin: .zero, size: IslandMetrics.size)
        panel.contentView = hosting

        islandPanel = panel
        repositionIsland()
        panel.orderFrontRegardless()
    }

    private func repositionIsland() {
        guard let islandPanel, let screen = NSScreen.main else { return }
        let frame = screen.frame
        islandPanel.setFrameOrigin(
            NSPoint(
                x: frame.maxX - IslandMetrics.size.width,
                y: frame.midY - IslandMetrics.size.height / 2
            )
        )
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

    func showChat() {
        islandModel.settle()
        store.markRead()
        store.isChatVisible = true

        if chatWindow == nil {
            let root = ChatView()
                .environmentObject(store)
                .environmentObject(settings)

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
        store.markRead()
    }

    func windowDidResignKey(_ notification: Notification) {
        store.isChatVisible = false
    }

    func windowWillClose(_ notification: Notification) {
        store.isChatVisible = false
    }
}
