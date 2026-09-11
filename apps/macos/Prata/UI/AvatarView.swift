import SwiftUI

struct AvatarView: View {
    let image: NSImage?
    let name: String
    var isAsleep: Bool = false

    var body: some View {
        Group {
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
        .clipShape(Circle())
        .saturation(isAsleep ? 0.12 : 1)
        .opacity(isAsleep ? 0.6 : 1)
        .overlay(Circle().strokeBorder(.white.opacity(0.16), lineWidth: 1))
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}
