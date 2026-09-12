import AppKit
import SwiftUI

/// Which screen edge the island is welded to. `.right` is the silhouette's native
/// orientation; the other edges draw the same shape rotated into place.
enum IslandEdge: String, Codable, CaseIterable {
    case left, right, top, bottom

    /// True when the rail the island slides along runs vertically.
    var isVertical: Bool { self == .left || self == .right }

    var rotationFromRight: Angle {
        switch self {
        case .right: .degrees(0)
        case .bottom: .degrees(90)
        case .left: .degrees(180)
        case .top: .degrees(270)
        }
    }
}

/// Where the island sits: an edge plus how far along that edge, as a 0…1 fraction.
struct IslandAnchor: Codable, Equatable {
    var edge: IslandEdge
    var position: CGFloat
    var screenID: CGDirectDisplayID?

    static let `default` = IslandAnchor(edge: .right, position: 0.5, screenID: nil)
}

enum IslandPlacement {
    /// How much closer to another edge the cursor has to get before the island lets go
    /// of the one it is on. Without it the island flickers between edges near a corner.
    private static let stickiness: CGFloat = 70

    /// The island rides the *visible* frame, which is already inset for the menu bar,
    /// the notch and the Dock — so it can never come to rest underneath any of them.
    static func rail(on screen: NSScreen) -> CGRect { screen.visibleFrame }

    static func screen(containing point: CGPoint) -> NSScreen {
        NSScreen.screens.first { $0.frame.contains(point) }
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }

    static func screen(for anchor: IslandAnchor) -> NSScreen? {
        if let id = anchor.screenID, let match = NSScreen.screens.first(where: { $0.displayID == id }) {
            return match
        }
        // NSScreen.main is nil until something has keyboard focus, which is common for an
        // LSUIElement app that never activates — fall back to the primary screen.
        return NSScreen.main ?? NSScreen.screens.first
    }

    /// Snaps a cursor position onto the nearest rail.
    static func anchor(for point: CGPoint, on screen: NSScreen, current: IslandAnchor) -> IslandAnchor {
        let rail = rail(on: screen)
        var distance: [IslandEdge: CGFloat] = [
            .left: point.x - rail.minX,
            .right: rail.maxX - point.x,
            .bottom: point.y - rail.minY,
            .top: rail.maxY - point.y
        ]
        if screen.displayID == current.screenID {
            distance[current.edge]? -= stickiness
        }

        let edge = distance.min { $0.value < $1.value }?.key ?? current.edge
        let fraction = edge.isVertical
            ? (point.y - rail.minY) / max(rail.height, 1)
            : (point.x - rail.minX) / max(rail.width, 1)

        return IslandAnchor(
            edge: edge,
            position: min(max(fraction, 0), 1),
            screenID: screen.displayID
        )
    }

    static func panelOrigin(for anchor: IslandAnchor, on screen: NSScreen, panelSize: CGSize) -> CGPoint {
        let rail = rail(on: screen)
        // Half the panel: keeps the island whole when its rail position lands near a
        // corner, however long the row of rooms has grown.
        let inset = min(panelSize.width, panelSize.height) / 2

        if anchor.edge.isVertical {
            let centerY = clamp(
                rail.minY + anchor.position * rail.height,
                rail.minY + inset,
                rail.maxY - inset
            )
            let x = anchor.edge == .right ? rail.maxX - panelSize.width : rail.minX
            return CGPoint(x: x, y: centerY - panelSize.height / 2)
        }

        let centerX = clamp(
            rail.minX + anchor.position * rail.width,
            rail.minX + inset,
            rail.maxX - inset
        )
        let y = anchor.edge == .top ? rail.maxY - panelSize.height : rail.minY
        return CGPoint(x: centerX - panelSize.width / 2, y: y)
    }

    private static func clamp(_ value: CGFloat, _ lower: CGFloat, _ upper: CGFloat) -> CGFloat {
        guard lower < upper else { return (lower + upper) / 2 }
        return min(max(value, lower), upper)
    }
}

extension NSScreen {
    var displayID: CGDirectDisplayID? {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }
}
