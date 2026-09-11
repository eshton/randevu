import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Settings")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)

            HStack(spacing: 12) {
                AvatarView(image: settings.avatar, name: settings.peerName)
                    .frame(width: 52, height: 52)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Avatar for the other party")
                        .font(.system(size: 11))
                        .foregroundStyle(PrataTheme.secondaryText)
                    Button("Choose image…", action: pickAvatar)
                        .controlSize(.small)
                }
            }

            field("Room code", text: $settings.roomId, placeholder: "rdv-…")
            field("Your name", text: $settings.displayName, placeholder: "Your display name")
            field("Their name", text: $settings.peerName, placeholder: "Optional")
            field("MCP endpoint", text: $settings.endpoint, placeholder: AppSettings.defaultEndpoint)

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 360)
        .background(PrataTheme.background)
    }

    private func field(_ title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 11))
                .foregroundStyle(PrataTheme.secondaryText)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .foregroundStyle(.white)
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(PrataTheme.surface, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(PrataTheme.stroke))
        }
    }

    private func pickAvatar() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        settings.setAvatar(from: url)
    }
}
