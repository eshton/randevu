import SwiftUI

@MainActor
final class IslandModel: ObservableObject {
    @Published var isHovering = false
    @Published private(set) var isPopped = false

    private var popTask: Task<Void, Never>?

    func pop(for seconds: Double = 6) {
        popTask?.cancel()
        isPopped = true
        popTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.isPopped = false
        }
    }

    func settle() {
        popTask?.cancel()
        popTask = nil
        isPopped = false
    }
}

enum IslandMetrics {
    static let size = CGSize(width: 320, height: 190)
}

struct IslandView: View {
    @EnvironmentObject private var store: RoomStore
    @EnvironmentObject private var settings: AppSettings
    @ObservedObject var model: IslandModel

    var onOpen: () -> Void

    private let labelFont = NSFont.systemFont(ofSize: 12, weight: .medium)

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let centerY = size.height / 2
            let bubbleX = size.width - bubbleOffset

            ZStack(alignment: .topLeading) {
                LiquidIslandShape(
                    bubbleRadius: bubbleRadius,
                    bubbleOffset: bubbleOffset,
                    pillHeight: pillHeight,
                    labelWidth: labelWidth
                )
                .shadow(color: .black.opacity(0.35), radius: 10, x: -3, y: 2)

                if labelWidth > 1 {
                    Text(label)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(1)
                        .fixedSize()
                        .position(x: bubbleX - bubbleRadius - 8 - measuredLabelWidth / 2, y: centerY)
                        .transition(.opacity)
                }

                if bubbleRadius > 1 {
                    AvatarView(
                        image: settings.avatar,
                        name: store.peerDisplayName,
                        isAsleep: isAsleep
                    )
                    .frame(width: bubbleRadius * 2, height: bubbleRadius * 2)
                    .overlay(alignment: .topTrailing) { unreadBadge }
                    .position(x: bubbleX, y: centerY)
                }

                Color.clear
                    .frame(width: hoverWidth, height: hoverHeight)
                    .contentShape(Rectangle())
                    .position(x: size.width - hoverWidth / 2, y: centerY)
                    .onHover { hovering in
                        model.isHovering = hovering
                    }
                    .onTapGesture(perform: onOpen)
            }
        }
        .frame(width: IslandMetrics.size.width, height: IslandMetrics.size.height)
        .animation(.spring(response: 0.42, dampingFraction: 0.68), value: model.isHovering)
        .animation(.spring(response: 0.42, dampingFraction: 0.62), value: model.isPopped)
        .animation(.spring(response: 0.42, dampingFraction: 0.68), value: store.unreadCount)
    }

    // MARK: - State-derived geometry

    private var showsDetail: Bool { model.isHovering || model.isPopped }
    private var isAsleep: Bool { store.unreadCount == 0 && !model.isPopped }

    private var bubbleRadius: CGFloat {
        if model.isPopped { return 27 }
        if model.isHovering { return 23 }
        return store.unreadCount > 0 ? 15 : 0
    }

    private var bubbleOffset: CGFloat {
        if model.isPopped { return 44 }
        if model.isHovering { return 36 }
        return store.unreadCount > 0 ? 19 : 6
    }

    private var pillHeight: CGFloat {
        showsDetail ? 62 : 78
    }

    private var measuredLabelWidth: CGFloat {
        (label as NSString).size(withAttributes: [.font: labelFont]).width.rounded(.up)
    }

    private var labelWidth: CGFloat {
        showsDetail ? measuredLabelWidth + 24 + bubbleRadius : 0
    }

    private var hoverWidth: CGFloat {
        showsDetail ? min(IslandMetrics.size.width, bubbleOffset + bubbleRadius + labelWidth + 20) : 54
    }

    private var hoverHeight: CGFloat {
        showsDetail ? 76 : 96
    }

    private var label: String {
        if !settings.isConfigured { return "set up a room" }
        if store.unreadCount > 0 {
            return store.unreadCount == 1 ? "1 new message" : "\(store.unreadCount) new messages"
        }
        if store.peerAwaitingHuman { return "\(store.peerDisplayName) · asking their human" }
        switch store.connection {
        case .failed: return "offline"
        case .connecting: return "connecting…"
        case .idle: return "idle"
        case .live: return "\(store.peerDisplayName) · asleep"
        }
    }

    @ViewBuilder
    private var unreadBadge: some View {
        if store.unreadCount > 0 {
            Text("\(min(store.unreadCount, 99))")
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .foregroundStyle(.black)
                .padding(.horizontal, 4)
                .frame(minWidth: 14, minHeight: 14)
                .background(Color(red: 0.94, green: 0.70, blue: 0.24), in: Capsule())
                .offset(x: 3, y: -3)
        }
    }
}
