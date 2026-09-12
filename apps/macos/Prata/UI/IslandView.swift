import AppKit
import SwiftUI

@MainActor
final class IslandModel: ObservableObject {
    @Published var isHovering = false
    @Published var isDragging = false
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
    static let avatarSize: CGFloat = 44
    /// Even gap around the avatars on three sides (and to the bezel on the fourth).
    static let padding: CGFloat = 10
    static let gap: CGFloat = 8
    /// How far the concave fillets flare along the bezel.
    static let notch: CGFloat = 14
    /// Beyond this the row would be longer than it is useful; the order puts the rooms
    /// worth seeing at the front anyway.
    static let maxVisibleRooms = 6

    /// The island's extent along the rail with `count` avatars in it.
    static func length(for count: Int) -> CGFloat {
        let rooms = CGFloat(max(count, 1))
        return padding * 2 + rooms * avatarSize + (rooms - 1) * gap
    }

    /// Square, so the same panel fits the island welded to any of the four edges.
    static func size(for count: Int) -> CGSize {
        let side = max(140, length(for: min(count, maxVisibleRooms)) + notch * 2 + 16)
        return CGSize(width: side, height: side)
    }
}

struct IslandView: View {
    @EnvironmentObject private var store: RoomStore
    @EnvironmentObject private var settings: AppSettings
    @ObservedObject var model: IslandModel

    /// The room that was clicked, or nil when there is none to open.
    var onOpen: (String?) -> Void
    /// Reports the cursor in screen coordinates; the window owner snaps it onto a rail.
    var onDragMoved: (CGPoint) -> Void
    var onDragEnded: () -> Void

    private static let space = "island"

    private let avatarCornerRatio: CGFloat = 0.3

    /// Collapsed, the island is just a nub poking out of the bezel.
    private let collapsedDepth: CGFloat = 9
    private let collapsedLength: CGFloat = 44
    private let collapsedNotch: CGFloat = 7

    /// Past this the press counts as a drag rather than a click on the island.
    private let dragSlop: CGFloat = 4

    /// dampingFraction 0.58 overshoots by roughly 10% before settling.
    private let bounce = Animation.spring(response: 0.38, dampingFraction: 0.58)

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let all = Array(store.ordered.prefix(IslandMetrics.maxVisibleRooms))
            let shown = visibleRooms(from: all)
            let count = shown.count

            ZStack(alignment: .topLeading) {
                LiquidIslandShape(
                    edge: edge,
                    width: islandDepth(count),
                    height: islandLength(count),
                    cornerRadius: islandCornerRadius(count),
                    notchRadius: count == 0 ? collapsedNotch : IslandMetrics.notch
                )
                .fill(.black)

                // Every room stays in the tree; the hidden ones shrink into the island
                // instead of being inserted and removed, so the avatars and the
                // silhouette move on one timeline rather than two.
                ForEach(all) { session in
                    let slot = shown.firstIndex { $0.id == session.id }
                    IslandAvatar(
                        session: session,
                        image: settings.avatar(for: session.id),
                        isActive: store.isActive(session),
                        cornerRatio: avatarCornerRatio
                    )
                    .scaleEffect(slot == nil ? 0.25 : 1, anchor: collapseAnchor)
                    .opacity(slot == nil ? 0 : 1)
                    .position(
                        slot.map { slotCenter(in: size, index: $0, of: count) }
                            ?? center(in: size, depth: islandDepth(count) / 2)
                    )
                }

                // Stays on top so a click anywhere on the island is caught here and
                // resolved to a room by position — overlapping hover targets would
                // otherwise flicker as the cursor crosses between avatars.
                Color.clear
                    .frame(width: hitArea(count).width, height: hitArea(count).height)
                    .contentShape(Rectangle())
                    // Both must come before .position — it expands to fill the parent,
                    // so anything attached after it would track the whole panel.
                    .onHover { hovering in
                        model.isHovering = hovering
                        store.freezeOrdering(hovering)
                    }
                    .gesture(dragGesture(in: size, rooms: shown))
                    .position(center(in: size, depth: hoverDepth(count) / 2))
            }
            .coordinateSpace(name: Self.space)
            .animation(bounce, value: animationKey(all: all, shown: shown))
        }
    }

    /// Everything the island's layout reacts to, so one spring drives the whole change.
    private func animationKey(all: [RoomSession], shown: [RoomSession]) -> String {
        let visible = Set(shown.map(\.id))
        return all
            .map { "\($0.id)\(visible.contains($0.id) ? "+" : "-")\(store.isActive($0) ? "a" : "i")" }
            .joined(separator: ",")
    }

    // MARK: - Dragging

    /// One gesture covers both jobs: a press that never really moves opens a chat,
    /// anything further drags the island along the rails. Reading `NSEvent.mouseLocation`
    /// rather than the gesture translation keeps it steady while the window is being
    /// moved out from under the cursor.
    private func dragGesture(in size: CGSize, rooms: [RoomSession]) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
            .onChanged { value in
                if !model.isDragging {
                    let travelled = hypot(value.translation.width, value.translation.height)
                    guard travelled > dragSlop else { return }
                    model.isDragging = true
                }
                onDragMoved(NSEvent.mouseLocation)
            }
            .onEnded { value in
                let wasDragging = model.isDragging
                model.isDragging = false
                if wasDragging {
                    onDragEnded()
                } else {
                    onOpen(room(at: value.startLocation, in: size, rooms: rooms))
                }
            }
    }

    private func room(at point: CGPoint, in size: CGSize, rooms: [RoomSession]) -> String? {
        let hit = rooms.indices.first { index in
            slotRect(in: size, index: index, of: rooms.count).contains(point)
        }
        return (hit.map { rooms[$0] } ?? rooms.first)?.id
    }

    // MARK: - What the island shows

    /// Hovering opens the whole row; otherwise only the rooms that have something to
    /// say are worth taking screen space for.
    private func visibleRooms(from all: [RoomSession]) -> [RoomSession] {
        if model.isHovering || model.isDragging { return all }

        let talking = all.filter(\.hasUnread)
        if !talking.isEmpty { return talking }
        if model.isPopped, let latest = all.first { return [latest] }
        return []
    }

    // MARK: - State-derived geometry

    private var edge: IslandEdge { settings.islandAnchor.edge }

    /// Depth reaches in from the bezel; length runs along it.
    private func islandDepth(_ count: Int) -> CGFloat {
        count == 0 ? collapsedDepth : IslandMetrics.avatarSize + IslandMetrics.padding * 2
    }

    private func islandLength(_ count: Int) -> CGFloat {
        count == 0 ? collapsedLength : IslandMetrics.length(for: count)
    }

    /// Concentric with the avatar's corner, so the black band stays an even width as it
    /// curves around it.
    private func islandCornerRadius(_ count: Int) -> CGFloat {
        count == 0
            ? collapsedDepth / 2
            : IslandMetrics.avatarSize * avatarCornerRatio + IslandMetrics.padding
    }

    /// Grows with the island so moving onto an avatar doesn't drop the hover and make
    /// it collapse under the cursor. Collapsed, it hugs the nub so the island can't be
    /// woken from a distance.
    private func hoverDepth(_ count: Int) -> CGFloat {
        count == 0 ? 11 : islandDepth(count)
    }

    private func hitArea(_ count: Int) -> CGSize {
        let depth = hoverDepth(count)
        let length = count == 0 ? collapsedLength : islandLength(count) + IslandMetrics.notch * 2
        return edge.isVertical
            ? CGSize(width: depth, height: length)
            : CGSize(width: length, height: depth)
    }

    /// Collapsed, the avatars shrink back towards the bezel.
    private var collapseAnchor: UnitPoint {
        switch edge {
        case .right: .trailing
        case .left: .leading
        case .top: .top
        case .bottom: .bottom
        }
    }

    /// The point `depth` in from the welded edge, centred on the rail.
    private func center(in size: CGSize, depth: CGFloat) -> CGPoint {
        switch edge {
        case .right: CGPoint(x: size.width - depth, y: size.height / 2)
        case .left: CGPoint(x: depth, y: size.height / 2)
        case .top: CGPoint(x: size.width / 2, y: depth)
        case .bottom: CGPoint(x: size.width / 2, y: size.height - depth)
        }
    }

    /// Where the `index`-th avatar sits, laid out along the rail around the centre.
    private func slotCenter(in size: CGSize, index: Int, of count: Int) -> CGPoint {
        let step = IslandMetrics.avatarSize + IslandMetrics.gap
        let offset = CGFloat(index) * step - CGFloat(count - 1) * step / 2
        let middle = center(in: size, depth: islandDepth(count) / 2)
        return edge.isVertical
            ? CGPoint(x: middle.x, y: middle.y + offset)
            : CGPoint(x: middle.x + offset, y: middle.y)
    }

    private func slotRect(in size: CGSize, index: Int, of count: Int) -> CGRect {
        let side = IslandMetrics.avatarSize + IslandMetrics.gap
        let middle = slotCenter(in: size, index: index, of: count)
        return CGRect(
            x: middle.x - side / 2,
            y: middle.y - side / 2,
            width: side,
            height: side
        )
    }
}

/// One room in the island row. Inactive rooms are drained of colour so the ones with
/// something to say read first.
private struct IslandAvatar: View {
    @ObservedObject var session: RoomSession
    let image: NSImage?
    let isActive: Bool
    let cornerRatio: CGFloat

    var body: some View {
        AvatarView(image: image, name: session.displayName, cornerRatio: cornerRatio)
            .frame(width: IslandMetrics.avatarSize, height: IslandMetrics.avatarSize)
            .grayscale(isActive ? 0 : 1)
            .opacity(isActive ? 1 : 0.55)
            .overlay(alignment: .topTrailing) { unreadDot }
    }

    @ViewBuilder
    private var unreadDot: some View {
        if session.hasUnread {
            Circle()
                .fill(Color(red: 0.96, green: 0.55, blue: 0.12))
                .frame(width: 11, height: 11)
                .overlay(Circle().strokeBorder(.black, lineWidth: 2))
                .offset(x: 1, y: -1)
        }
    }
}
