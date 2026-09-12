import SwiftUI

struct AvatarView: View {
    let image: NSImage?
    let name: String
    /// Corner radius as a fraction of the avatar's side, so the squircle keeps its
    /// proportions at every size it's used at.
    var cornerRatio: CGFloat = 0.3

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let shape = RoundedRectangle(cornerRadius: side * cornerRatio, style: .continuous)

            content
                .frame(width: proxy.size.width, height: proxy.size.height)
                .clipShape(shape)
                .overlay(shape.strokeBorder(.white.opacity(0.16), lineWidth: 1))
        }
    }

    @ViewBuilder
    private var content: some View {
        if let image {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFill()
        } else {
            ZStack {
                LinearGradient(
                    colors: [Color(red: 0.90, green: 0.66, blue: 0.24), Color(red: 0.62, green: 0.42, blue: 0.13)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Text(initials)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.black.opacity(0.75))
                    .minimumScaleFactor(0.4)
            }
        }
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}
