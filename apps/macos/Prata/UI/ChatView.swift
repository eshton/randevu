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
    @EnvironmentObject private var bridge: AgentBridge

    @State private var showsSettings = false

    var body: some View {
        VStack(spacing: 0) {
            if store.ordered.count > 1 {
                RoomStrip()
                Divider().overlay(PrataTheme.stroke)
            }

            if let session = store.active {
                RoomChat(session: session, showsSettings: $showsSettings)
            } else {
                emptyState
            }
        }
        .background(PrataTheme.background)
        .frame(minWidth: 420, minHeight: 460)
        .sheet(isPresented: $showsSettings) {
            SettingsView()
                .environmentObject(settings)
                .environmentObject(bridge)
        }
        .onAppear {
            if !settings.isConfigured { showsSettings = true }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text("No rooms yet.")
                .font(.system(size: 13))
                .foregroundStyle(.white)
            Text("Add a room code in settings — you can run several rooms at once.")
                .font(.system(size: 11))
                .foregroundStyle(PrataTheme.secondaryText)
                .multilineTextAlignment(.center)
            Button("Settings") { showsSettings = true }
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The same order the island uses: rooms with traffic first, then most recent.
private struct RoomStrip: View {
    @EnvironmentObject private var store: RoomStore
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(store.ordered) { session in
                    Button {
                        store.select(session.id)
                    } label: {
                        RoomStripAvatar(
                            session: session,
                            image: settings.avatar(for: session.id),
                            isActive: store.isActive(session),
                            isSelected: session.id == store.selectedRoomID
                        )
                    }
                    .buttonStyle(.plain)
                    .help(session.displayName)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .background(PrataTheme.surface)
    }
}

private struct RoomStripAvatar: View {
    @ObservedObject var session: RoomSession
    let image: NSImage?
    let isActive: Bool
    let isSelected: Bool

    var body: some View {
        AvatarView(image: image, name: session.displayName, cornerRatio: 0.32)
            .frame(width: 28, height: 28)
            .grayscale(isActive ? 0 : 1)
            .opacity(isActive ? 1 : 0.55)
            .overlay(
                RoundedRectangle(cornerRadius: 28 * 0.32, style: .continuous)
                    .strokeBorder(PrataTheme.accent, lineWidth: isSelected ? 2 : 0)
            )
            .overlay(alignment: .topTrailing) {
                if session.hasUnread {
                    Circle()
                        .fill(Color(red: 0.96, green: 0.55, blue: 0.12))
                        .frame(width: 8, height: 8)
                        .offset(x: 2, y: -2)
                }
            }
    }
}

private struct RoomChat: View {
    @EnvironmentObject private var store: RoomStore
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var bridge: AgentBridge
    @ObservedObject var session: RoomSession
    @Binding var showsSettings: Bool

    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(PrataTheme.stroke)
            transcript
            Divider().overlay(PrataTheme.stroke)
            composer
        }
        .onAppear { inputFocused = true }
        .onChange(of: session.id) { _, _ in inputFocused = true }
    }

    private var header: some View {
        HStack(spacing: 10) {
            AvatarView(image: settings.avatar(for: session.id), name: session.displayName)
                .frame(width: 30, height: 30)

            VStack(alignment: .leading, spacing: 1) {
                Text(session.displayName)
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
                    if session.messages.isEmpty {
                        Text("No messages in this room yet.")
                            .font(.system(size: 12))
                            .foregroundStyle(PrataTheme.secondaryText)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    }
                    ForEach(session.messages) { message in
                        MessageRow(message: message, isMine: message.isMine(myName: settings.displayName))
                            .id(message.id)
                    }

                    ForEach(session.pendingInstructions) { instruction in
                        InstructionRow(instruction: instruction) {
                            session.discardInstruction(instruction.id)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
            }
            .onChange(of: session.messages.count) { _, _ in
                guard let last = session.messages.last else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                TextField("What should your agent tell \(session.displayName)'s agent?", text: $session.draft)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
                    .focused($inputFocused)
                    .onSubmit { session.queueForAgent() }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(PrataTheme.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(PrataTheme.stroke))

                Button {
                    session.queueForAgent()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.black)
                        .frame(width: 32, height: 32)
                        .background(PrataTheme.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(isDraftEmpty)
                .opacity(isDraftEmpty ? 0.4 : 1)
            }

            HStack(spacing: 5) {
                Image(systemName: bridge.isRunning ? "point.3.filled.connected.trianglepath.dotted" : "exclamationmark.triangle.fill")
                    .font(.system(size: 9))
                Text(agentHint)
                    .font(.system(size: 10))
                Spacer()
            }
            .foregroundStyle(bridge.isRunning ? PrataTheme.secondaryText : Color.orange.opacity(0.9))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(PrataTheme.background)
    }

    private var isDraftEmpty: Bool {
        session.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var agentHint: String {
        guard bridge.isRunning else { return "The agent bridge is not running — check the error in settings." }
        let pending = store.sessions.reduce(0) { $0 + $1.pendingInstructions.count }
        if pending == 0 { return "Your agent phrases and posts this — it does not go straight into the room." }
        return pending == 1
            ? "1 instruction is waiting for your agent. Mention it in a chat turn."
            : "\(pending) instructions are waiting for your agent. Mention them in a chat turn."
    }

    private var statusColor: Color {
        switch session.connection {
        case .live: return Color.green.opacity(0.8)
        case .connecting: return PrataTheme.accent
        case .failed: return Color.red.opacity(0.8)
        case .idle: return Color.gray
        }
    }

    private var statusText: String {
        if session.peerAwaitingHuman { return "waiting on their human" }
        switch session.connection {
        case .live: return session.id
        case .connecting: return "connecting…"
        case .failed(let message): return message
        case .idle: return "stopped"
        }
    }
}

private struct InstructionRow: View {
    let instruction: Instruction
    let onDiscard: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 3) {
            HStack(spacing: 6) {
                Image(systemName: "clock")
                    .font(.system(size: 9))
                Text("waiting for your agent")
                    .font(.system(size: 10, weight: .semibold))
                Button(action: onDiscard) {
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                }
                .buttonStyle(.plain)
                .help("Discard instruction")
            }
            .foregroundStyle(PrataTheme.secondaryText)

            Text(instruction.text)
                .font(.system(size: 13))
                .foregroundStyle(PrataTheme.accent.opacity(0.95))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 320, alignment: .leading)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(PrataTheme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                        .foregroundStyle(PrataTheme.accent.opacity(0.45))
                )
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
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
