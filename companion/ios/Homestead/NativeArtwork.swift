import SwiftUI
import Combine
import ImageIO

struct NativeArtwork: View {
    let path: String?
    let client: HomesteadClient?
    var symbol = "photo"
    var fit = false
    @State private var image: UIImage?
    @State private var attempt = 0
    @State private var failed = false
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.secondary.opacity(0.12)
                if let image {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: fit ? .fit : .fill)
                        .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                } else if failed {
                    Image(systemName: "arrow.clockwise.circle").font(.title2).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                        .highPriorityGesture(TapGesture().onEnded { attempt += 1 })
                } else { Image(systemName: symbol).font(.title2).foregroundStyle(.secondary) }
            }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }.accessibilityHidden(true)
        .task(id: ImageLoadKey(path: path, attempt: attempt)) {
            image = nil; failed = false
            guard let path, let client, !client.isClosed else { return }
            do {
                let data = try await client.profileImage(path)
                let decoded = await Task.detached(priority: .utility) { NativeImageDecoder.thumbnail(data, maximumPixelSize: 1400) }.value
                try Task.checkCancellation()
                guard let decoded else { failed = true; return }
                image = UIImage(cgImage: decoded)
            } catch { if !Task.isCancelled { failed = true } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
            if let sender = notification.object as? HomesteadClient, sender === client, failed { attempt += 1 }
        }
    }
}
