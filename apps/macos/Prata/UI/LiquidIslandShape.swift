import SwiftUI

/// The gooey backdrop: a pill welded to the screen edge, the avatar bubble and the
/// label capsule, blurred together and alpha-thresholded so they merge like liquid.
/// `Animatable` is required — a `Canvas` reads raw state, so without interpolated
/// `animatableData` the blob would jump between states instead of flowing.
struct LiquidIslandShape: View, Animatable {
    var bubbleRadius: CGFloat
    var bubbleOffset: CGFloat
    var pillHeight: CGFloat
    var labelWidth: CGFloat

    var animatableData: AnimatablePair<AnimatablePair<CGFloat, CGFloat>, AnimatablePair<CGFloat, CGFloat>> {
        get {
            AnimatablePair(
                AnimatablePair(bubbleRadius, bubbleOffset),
                AnimatablePair(pillHeight, labelWidth)
            )
        }
        set {
            bubbleRadius = newValue.first.first
            bubbleOffset = newValue.first.second
            pillHeight = newValue.second.first
            labelWidth = newValue.second.second
        }
    }

    private let pillWidth: CGFloat = 11

    var body: some View {
        Canvas(opaque: false, rendersAsynchronously: false) { context, size in
            context.addFilter(.alphaThreshold(min: 0.42, color: .black))
            context.addFilter(.blur(radius: 9))

            context.drawLayer { layer in
                let centerY = size.height / 2

                // Right half sits off-canvas so only the left side reads as rounded.
                let pill = CGRect(
                    x: size.width - pillWidth,
                    y: centerY - pillHeight / 2,
                    width: pillWidth * 2,
                    height: pillHeight
                )
                layer.fill(Path(roundedRect: pill, cornerRadius: pillWidth), with: .color(.black))

                if labelWidth > 1 {
                    let height: CGFloat = 30
                    let maxX = size.width - bubbleOffset + 2
                    let rect = CGRect(
                        x: maxX - labelWidth,
                        y: centerY - height / 2,
                        width: labelWidth,
                        height: height
                    )
                    layer.fill(Path(roundedRect: rect, cornerRadius: height / 2), with: .color(.black))
                }

                if bubbleRadius > 0.5 {
                    let center = CGPoint(x: size.width - bubbleOffset, y: centerY)
                    let rect = CGRect(
                        x: center.x - bubbleRadius,
                        y: center.y - bubbleRadius,
                        width: bubbleRadius * 2,
                        height: bubbleRadius * 2
                    )
                    layer.fill(Path(ellipseIn: rect), with: .color(.black))
                }
            }
        }
    }
}
