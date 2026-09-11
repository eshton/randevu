import SwiftUI

@main
struct PrataApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra("Prata", systemImage: "circle.lefthalf.filled") {
            Button("Open chat") { appDelegate.showChat() }
                .keyboardShortcut("o")

            Button("Toggle island") { appDelegate.toggleIsland() }

            Divider()

            Button("Reconnect") { appDelegate.store.restart() }

            Divider()

            Button("Quit") { NSApplication.shared.terminate(nil) }
                .keyboardShortcut("q")
        }
    }
}
