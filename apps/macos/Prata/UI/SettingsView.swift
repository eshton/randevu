import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var bridge: AgentBridge
    @Environment(\.dismiss) private var dismiss

    @State private var didCopy = false
    @State private var newRoomId = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Settings")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)

            HStack(spacing: 12) {
                AvatarView(image: settings.avatar(for: settings.roomId), name: settings.peerName)
                    .frame(width: 52, height: 52)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Avatar for the selected room")
                        .font(.system(size: 11))
                        .foregroundStyle(PrataTheme.secondaryText)
                    Button("Choose image…", action: pickAvatar)
                        .controlSize(.small)
                        .disabled(settings.roomId.isEmpty)
                }
            }

            addRoom
            savedRooms
            field("Your name", text: $settings.displayName, placeholder: "Akos")
            field("Their name", text: $settings.peerName, placeholder: "Agoston")
            field("MCP endpoint", text: $settings.endpoint, placeholder: AppSettings.defaultEndpoint)

            Divider().overlay(PrataTheme.stroke)

            VStack(alignment: .leading, spacing: 6) {
                Text("Agent bridge")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                Text(bridge.isRunning
                     ? "Add this to your agent as an MCP connector. Every outgoing message is sent by the agent."
                     : "The bridge is not running: \(bridge.lastError ?? "unknown error")")
                    .font(.system(size: 10))
                    .foregroundStyle(bridge.isRunning ? PrataTheme.secondaryText : Color.orange.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    Text(bridge.endpointURL.isEmpty ? "—" : bridge.endpointURL)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(PrataTheme.surface, in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(PrataTheme.stroke))

                    Button(didCopy ? "Copied" : "Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(bridge.endpointURL, forType: .string)
                        didCopy = true
                    }
                    .controlSize(.small)
                    .disabled(bridge.endpointURL.isEmpty)
                }
            }

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

    private var addRoom: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("New room")
                .font(.system(size: 11))
                .foregroundStyle(PrataTheme.secondaryText)
            HStack(spacing: 6) {
                TextField("rdv-…", text: $newRoomId)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(.white)
                    .onSubmit(addTypedRoom)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(PrataTheme.surface, in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(PrataTheme.stroke))

                Button("Add", action: addTypedRoom)
                    .controlSize(.small)
                    .disabled(newRoomId.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func addTypedRoom() {
        guard settings.addRoom(id: newRoomId) else { return }
        newRoomId = ""
    }

    @ViewBuilder
    private var savedRooms: some View {
        if !settings.savedRooms.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Rooms")
                    .font(.system(size: 11))
                    .foregroundStyle(PrataTheme.secondaryText)

                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(settings.savedRooms.sorted { $0.lastUsedAt > $1.lastUsedAt }) { room in
                            savedRoomRow(room)
                        }
                    }
                }
                .frame(maxHeight: 108)
            }
        }
    }

    private func savedRoomRow(_ room: SavedRoom) -> some View {
        let isCurrent = room.id == settings.roomId

        return HStack(spacing: 6) {
            Button {
                settings.selectRoom(id: room.id)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isCurrent ? "largecircle.fill.circle" : "circle")
                        .font(.system(size: 10))
                        .foregroundStyle(isCurrent ? PrataTheme.accent : PrataTheme.secondaryText)
                    Text(room.id)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.white.opacity(isCurrent ? 1 : 0.8))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if !room.peerName.isEmpty {
                        Text(room.peerName)
                            .font(.system(size: 10))
                            .foregroundStyle(PrataTheme.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button {
                settings.forgetRoom(room)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(PrataTheme.secondaryText)
            }
            .buttonStyle(.plain)
            .help("Forget")
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 7)
                .fill(isCurrent ? PrataTheme.accent.opacity(0.12) : PrataTheme.surface)
        )
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(PrataTheme.stroke))
    }

    private func pickAvatar() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        settings.setAvatar(from: url, for: settings.roomId)
    }
}
