import SwiftUI

enum PrataTheme {
    static let background = Color(red: 0.055, green: 0.060, blue: 0.075)
    static let surface = Color(red: 0.098, green: 0.106, blue: 0.129)
    static let stroke = Color.white.opacity(0.07)
    static let accent = Color(red: 0.878, green: 0.631, blue: 0.184)
    static let secondaryText = Color.white.opacity(0.45)
}

struct ChatView: View {
    @EnvironmentObject private var store: RoomStore
    @EnvironmentObject private var settings: AppSettings

    @State private var showsSettings = false
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(PrataTheme.stroke)
            transcript
            Divider().overlay(PrataTheme.stroke)
            composer
        }
        .background(PrataTheme.background)
        .frame(minWidth: 420, minHeight: 460)
        .sheet(isPresented: $showsSettings) {
            SettingsView()
                .environmentObject(settings)
        }
        .onAppear {
            inputFocused = true
            if !settings.isConfigured { showsSettings = true }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            AvatarView(image: settings.avatar, name: store.peerDisplayName)
                .frame(width: 30, height: 30)

            VStack(alignment: .leading, spacing: 1) {
                Text(store.peerDisplayName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                HStack(spacing: 5) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 6, height: 6)
                    Text(statusText)
                        .font(.system(size: 11))
                        .foregroundStyle(PrataTheme.secondaryText)
                        .lineLimit(1)
                }
            }

            Spacer()

            Button {
                showsSettings = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .foregroundStyle(PrataTheme.secondaryText)
            }
            .buttonStyle(.plain)
            .help("Settings")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(PrataTheme.surface)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if store.messages.isEmpty {
                        Text(settings.isConfigured ? "No messages in this room yet." : "Add a room code in settings.")
                            .font(.system(size: 12))
                            .foregroundStyle(PrataTheme.secondaryText)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    }
                    ForEach(store.messages) { message in
                        MessageRow(message: message, isMine: message.isMine(myName: settings.displayName))
                            .id(message.id)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
            }
            .onChange(of: store.messages.count) { _, _ in
                guard let last = store.messages.last else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Message \(store.peerDisplayName)…", text: $store.draft)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(.white)
                .focused($inputFocused)
                .onSubmit { store.send() }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(PrataTheme.surface, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(PrataTheme.stroke))

            Button {
                store.send()
            } label: {
                Image(systemName: store.isSending ? "ellipsis" : "arrow.up")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(width: 32, height: 32)
                    .background(PrataTheme.accent, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isSending)
            .opacity(store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(PrataTheme.background)
    }

    private var statusColor: Color {
        switch store.connection {
        case .live: return Color.green.opacity(0.8)
        case .connecting: return PrataTheme.accent
        case .failed: return Color.red.opacity(0.8)
        case .idle: return Color.gray
        }
    }

    private var statusText: String {
        if store.peerAwaitingHuman { return "asking their human" }
        switch store.connection {
        case .live: return settings.roomId
        case .connecting: return "connecting…"
        case .failed(let message): return message
        case .idle: return "no room configured"
        }
    }
}

private struct MessageRow: View {
    let message: RoomMessage
    let isMine: Bool

    var body: some View {
        VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(message.from)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PrataTheme.secondaryText)
                if let type = message.type, !type.isEmpty {
                    Text(type)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(PrataTheme.accent.opacity(0.85))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(PrataTheme.accent.opacity(0.12), in: Capsule())
                }
            }

            Text(message.text)
                .font(.system(size: 13))
                .foregroundStyle(isMine ? .black : .white)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 320, alignment: .leading)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(
                    isMine ? PrataTheme.accent : PrataTheme.surface,
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(isMine ? Color.clear : PrataTheme.stroke)
                )
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
    }
}
