import SwiftUI

/// The island silhouette: a rounded container welded to the screen edge.
///
/// The two corners that touch the edge are *concave* fillets that flare along the bezel
/// rather than stopping at a hard 90° corner, so the shape reads as growing out of the
/// display instead of being pasted on top of it.
struct LiquidIslandShape: Shape {
    /// The silhouette is built welded to the right edge and rotated from there, so
    /// `width` always means "depth into the screen" and `height` "length along the edge".
    var edge: IslandEdge
    var width: CGFloat
    var height: CGFloat
    var cornerRadius: CGFloat
    var notchRadius: CGFloat

    var animatableData: AnimatablePair<AnimatablePair<CGFloat, CGFloat>, AnimatablePair<CGFloat, CGFloat>> {
        get {
            AnimatablePair(
                AnimatablePair(width, height),
                AnimatablePair(cornerRadius, notchRadius)
            )
        }
        set {
            width = newValue.first.first
            height = newValue.first.second
            cornerRadius = newValue.second.first
            notchRadius = newValue.second.second
        }
    }

    func path(in rect: CGRect) -> Path {
        let body = rightEdgePath(in: rect)
        guard edge != .right else { return body }

        let center = CGPoint(x: rect.midX, y: rect.midY)
        let rotation = CGAffineTransform(translationX: center.x, y: center.y)
            .rotated(by: edge.rotationFromRight.radians)
            .translatedBy(x: -center.x, y: -center.y)
        return body.applying(rotation)
    }

    private func rightEdgePath(in rect: CGRect) -> Path {
        let edgeX = rect.maxX
        let centerY = rect.midY
        let topY = centerY - height / 2
        let bottomY = centerY + height / 2

        let corner = min(cornerRadius, min(width, height) / 2)
        let notch = max(0, notchRadius)

        // Continuous corners to match the avatar's squircle. The rect is extended past
        // the screen edge so only the left pair is visibly rounded.
        let body = Path(
            roundedRect: CGRect(x: edgeX - width, y: topY, width: width + corner, height: height),
            cornerSize: CGSize(width: corner, height: corner),
            style: .continuous
        )

        guard notch > 0 else { return body }

        return body
            .union(flare(edgeX: edgeX, edgeY: topY, notch: notch, above: true))
            .union(flare(edgeX: edgeX, edgeY: bottomY, notch: notch, above: false))
    }

    /// The concave wedge that welds a corner to the bezel: a square with a quarter disc
    /// bitten out of it.
    private func flare(edgeX: CGFloat, edgeY: CGFloat, notch: CGFloat, above: Bool) -> Path {
        let squareY = above ? edgeY - notch : edgeY
        let square = Path(CGRect(x: edgeX - notch, y: squareY, width: notch, height: notch))

        let biteCenterY = above ? edgeY - notch : edgeY + notch
        let bite = Path(
            ellipseIn: CGRect(
                x: edgeX - notch * 2,
                y: biteCenterY - notch,
                width: notch * 2,
                height: notch * 2
            )
        )
        return square.subtracting(bite)
    }
}
