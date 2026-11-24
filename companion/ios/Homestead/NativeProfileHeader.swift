import SwiftUI
import Foundation
import AVFoundation
import UIKit
import Combine

struct NativeProfileHeader: View {
    let record: NativeSearchHit
    let client: HomesteadClient?
    let posterWidth: Double
    @Binding var biographyExpanded: Bool
    var active = true
    @Environment(\.dynamicTypeSize) private var textSize
    private var biography: String { record.profileBiography }
    private var layout: AnyLayout {
        textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) :
            AnyLayout(HStackLayout(alignment: .top, spacing: 16))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProfileBanner(path: record.bannerPath, client: client, active: active)
                .frame(height: 220).frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 18))
            layout {
                Group {
                    if let poster = record.posterPath { ProfileImage(path: poster, client: client) }
                    else { Image(systemName: "person.crop.rectangle").font(.largeTitle).foregroundStyle(.secondary) }
                }.frame(width: posterWidth, height: posterWidth * 1.38)
                    .background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 14))
                    .accessibilityLabel("Profile poster")
                VStack(alignment: .leading, spacing: 8) {
                    Text(record.title).font(.title2.bold()).padding(.top, textSize.isAccessibilitySize ? 8 : 44)
                    if !biography.isEmpty {
                        Button { withAnimation { biographyExpanded.toggle() } } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(biography).font(.subheadline).foregroundStyle(.secondary)
                                    .lineLimit(biographyExpanded ? nil : 3).multilineTextAlignment(.leading)
                                if biography.count > 160 {
                                    Text(biographyExpanded ? "Show less" : "Read more").font(.caption)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.plain).accessibilityLabel("Biography. " + biography)
                            .accessibilityHint(biographyExpanded ? "Double tap to collapse" : "Double tap to expand")
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.padding(.horizontal, 12).padding(.top, -40)
        }
    }
}

private struct ProfileBanner: View {
    let path: String?
    let client: HomesteadClient?
    let active: Bool
    @Environment(\.homesteadAppearance) private var appearance
    private var video: Bool { path.map { ["mp4", "mov", "m4v", "webm", "m3u8"].contains(ProfileMediaFile(path: $0, title: "", video: true).fileExtension) } ?? false }
    var body: some View {
        ZStack {
            appearance.color.opacity(0.08)
            if let path {
                if video, let client { ProfileBannerVideo(path: path, client: client, active: active) }
                else { NativeArtwork(path: path, client: client).accessibilityHidden(true) }
            }
        }
    }
}

private struct ProfileBannerVideo: View {
    let path: String
    let client: HomesteadClient
    let active: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?
    @State private var asset: AVURLAsset?
    @State private var failed = false
    @State private var attempt = 0
    @State private var status: AnyCancellable?
    var body: some View {
        ZStack {
            if let player { BannerPlayerSurface(player: player).allowsHitTesting(false).accessibilityHidden(true) }
            if failed {
                VStack {
                    Text("Banner video unavailable. Check its format and server connection.").font(.caption).multilineTextAlignment(.center)
                    Button { attempt += 1 } label: { Label("Retry banner video", systemImage: "arrow.clockwise") }
                }.padding()
            }
        }
        .task(id: ImageLoadKey(path: active ? path : nil, attempt: attempt)) { await load() }
        .onDisappear { stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active && active && !reduceMotion { player?.play() } else { player?.pause() }
        }
        .onChange(of: reduceMotion) { _, reduced in if reduced || !active || scenePhase != .active { player?.pause() } else { player?.play() } }
    }
    @MainActor private func load() async {
        stop(); failed = false
        guard active else { return }
        guard !client.isClosed, let url = ProfileMediaFile.url(path: path, server: client.baseURL, preview: false) else { failed = true; return }
        let media = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: client.familySessionCookies])
        asset = media
        do {
            guard try await media.load(.isPlayable) else { failed = true; return }
            try Task.checkCancellation()
            guard asset === media, !client.isClosed else { return }
            let queue = AVQueuePlayer()
            queue.isMuted = true
            looper = AVPlayerLooper(player: queue, templateItem: AVPlayerItem(asset: media))
            player = queue
            if let current = queue.currentItem {
                status = current.publisher(for: \.status).receive(on: RunLoop.main).sink { value in
                    if value == .failed { failed = true; queue.pause() }
                }
            }
            if active, !reduceMotion, scenePhase == .active { queue.play() }
        } catch { if !Task.isCancelled { failed = true } }
    }
    @MainActor private func stop() {
        asset?.cancelLoading(); asset = nil
        status = nil
        player?.pause(); looper?.disableLooping(); looper = nil
        player?.removeAllItems(); player = nil
    }
}

private struct BannerPlayerSurface: UIViewRepresentable {
    let player: AVPlayer
    func makeUIView(context: Context) -> BannerPlayerView { BannerPlayerView(frame: .zero) }
    func updateUIView(_ view: BannerPlayerView, context: Context) { view.playerLayer.player = player }
}
private final class BannerPlayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    override init(frame: CGRect) { super.init(frame: frame); playerLayer.videoGravity = .resizeAspectFill }
    required init?(coder: NSCoder) { super.init(coder: coder); playerLayer.videoGravity = .resizeAspectFill }
}
