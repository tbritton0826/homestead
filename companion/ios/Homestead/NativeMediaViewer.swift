import SwiftUI
import AVKit
import Combine
import ImageIO

@MainActor final class PlaybackSession: ObservableObject {
    @Published var player: AVPlayer?
    @Published var error: String?
    @Published var syncMessage: String?
    @Published var resumeAt: Double = 0
    private var client: HomesteadClient?
    private var file: ProfileMediaFile?
    private var observer: Any?
    private var status: AnyCancellable?
    private var ended: AnyCancellable?
    private var rate: AnyCancellable?
    private var pending: Data?
    private var saving = false
    private var stopped = false
    private var opening = false
    private var openGeneration = UUID()
    private var openingAsset: AVURLAsset?
    private var openingDeadline: Task<Void, Never>?
    private var readyDeadline: Task<Void, Never>?
    @Published private(set) var duration: Double = 0
    @Published private(set) var position: Double = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var speed: Float = 1
    private var clockObserver: Any?
    @Published private(set) var seeking = false
    private var playRequest = UUID()
    @Published private(set) var started = false
    // AVKit covers the inline host while presenting its own fullscreen controller.
    // That disappearance is not the user closing this playback session.
    var presentingFullscreen = false

    func open(_ file: ProfileMediaFile, client: HomesteadClient) async {
        guard player == nil, !stopped, !opening else { return }
        let generation = UUID(); openGeneration = generation
        opening = true; error = nil; syncMessage = nil; position = 0; duration = 0
        openingDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(35)) } catch { return }
            guard let self, self.openGeneration == generation, self.opening, !self.stopped else { return }
            self.error = "Opening media timed out. Check your connection and retry."
            self.openingAsset?.cancelLoading()
        }
        defer { if openGeneration == generation { opening = false; openingAsset = nil; openingDeadline?.cancel(); openingDeadline = nil } }
        self.client = client; self.file = file
        do {
            guard !client.isClosed, let url = ProfileMediaFile.url(path: file.path, server: client.baseURL, preview: false) else {
                throw CompanionError.message("This media address is unavailable.")
            }
            do {
                let history: PlaybackHistory = try await client.request("api/account/playback", timeout: 5)
                if history.ok, generation == openGeneration { resumeAt = history.entries[PlaybackCatalog.key(file)]?.resume ?? 0 }
            } catch { if generation == openGeneration { syncMessage = "Resume history could not be checked. Playback can still start; check your server connection to restore sync." } }
            guard generation == openGeneration, !stopped else { return }
            try Task.checkCancellation()
            let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: client.familySessionCookies])
            openingAsset = asset
            guard try await asset.load(.isPlayable) else { throw CompanionError.message("This file needs a compatible format or server transcoding.") }
            let loadedDuration = try await asset.load(.duration).seconds
            try Task.checkCancellation()
            guard generation == openGeneration, !stopped, !client.isClosed, error == nil else { return }
            duration = loadedDuration.isFinite ? loadedDuration : 0
            if resumeAt >= duration { resumeAt = 0 }
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: file.audio ? .default : .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
            let item = AVPlayerItem(asset: asset)
            let player = AVPlayer(playerItem: item)
            self.player = player
            readyDeadline = Task { [weak self, weak item] in
                do { try await Task.sleep(for: .seconds(25)) } catch { return }
                guard let self, let item, self.openGeneration == generation, !self.stopped, item.status == .unknown else { return }
                self.error = "Media did not become ready. Check your connection and retry."
                self.player?.pause()
            }
            rate = player.publisher(for: \.rate).receive(on: RunLoop.main).sink { [weak self] value in
                guard self?.openGeneration == generation else { return }
                self?.isPlaying = value > 0
                if value > 0 { self?.started = true }
                else { self?.save() }
            }
            status = item.publisher(for: \.status).receive(on: RunLoop.main).sink { [weak self] value in
                guard self?.openGeneration == generation else { return }
                if value != .unknown { self?.readyDeadline?.cancel() }
                if value == .failed { self?.error = "Playback failed. Check the server connection and file codec; this pass uses direct playback." }
            }
            ended = NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime, object: item).receive(on: RunLoop.main).sink { [weak self] _ in if self?.openGeneration == generation { self?.save(completed: true) } }
            clockObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
                Task { @MainActor [weak self] in
                    guard let self, self.openGeneration == generation, time.seconds.isFinite else { return }
                    self.position = max(0, time.seconds)
                }
            }
            observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 15, preferredTimescale: 600), queue: .main) { [weak self] _ in
                guard let session = self else { return }
                Task { @MainActor in if session.openGeneration == generation { session.save() } }
            }
            if !PlaybackPresentation.needsChoice(resume: resumeAt) { play(resume: false) }
        } catch { if generation == openGeneration && !Task.isCancelled && !stopped { self.error = error.localizedDescription } }
    }
    func retry(_ file: ProfileMediaFile, client: HomesteadClient) async {
        stop(); stopped = false; started = false; resumeAt = 0; error = nil
        await open(file, client: client)
    }
    func play(resume: Bool) {
        guard let player, !stopped, error == nil else { return }
        guard !seeking else { return }
        let generation = openGeneration
        let request = UUID(); playRequest = request; seeking = true
        let target = PlaybackPresentation.boundedSeek(resume ? resumeAt : 0, duration: duration)
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player] finished in
            Task { @MainActor in
                guard let self, let player, self.openGeneration == generation, self.playRequest == request, !self.stopped else { return }
                self.seeking = false
                guard finished else { self.error = "Playback could not start at the chosen position. Retry to choose again."; return }
                self.started = true; self.resumeAt = 0; self.position = target
                player.play(); player.rate = self.speed
            }
        }
    }
    func seek(_ seconds: Double) {
        guard let player, started, !stopped else { return }
        let target = PlaybackPresentation.boundedSeek(seconds, duration: duration)
        position = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
    }
    func toggle() {
        guard started, !seeking, let player else { return }
        if isPlaying { pause() }
        else if duration > 0 && position >= duration - 1 { play(resume: false) }
        else { player.play(); player.rate = speed }
    }
    func setSpeed(_ value: Float) {
        guard [Float(0.75), 1, 1.25, 1.5, 1.75, 2].contains(value) else { return }
        speed = value
        if isPlaying { player?.rate = speed }
    }
    func save(completed: Bool = false) {
        guard !seeking, let player, let file, duration > 0, let client, !client.isClosed else { return }
        let time = completed ? duration : player.currentTime().seconds
        guard time.isFinite, time >= 0 else { return }
        guard started || time > 0 else { return }
        started = true
        pending = try? JSONSerialization.data(withJSONObject: ["id": PlaybackCatalog.key(file), "position": time, "duration": duration])
        guard !saving else { return }
        saving = true
        Task { [self] in
            while let body = pending, !client.isClosed {
                pending = nil
                do {
                    let response: BasicResponse = try await client.request("api/account/playback", method: "PUT", body: body, timeout: 5)
                    if !response.ok { throw CompanionError.message("Save failed") }
                    syncMessage = nil
                } catch { syncMessage = "Position could not sync. Check the server connection." }
            }
            saving = false
        }
    }
    func pause() { playRequest = UUID(); seeking = false; player?.pause(); save() }
    func stop() {
        guard !stopped else { return }; stopped = true; openGeneration = UUID(); opening = false
        readyDeadline?.cancel(); openingDeadline?.cancel(); openingAsset?.cancelLoading()
        pause()
        if let observer { player?.removeTimeObserver(observer) }; observer = nil
        if let clockObserver { player?.removeTimeObserver(clockObserver) }; clockObserver = nil
        isPlaying = false
        status = nil; ended = nil; rate = nil
        player?.replaceCurrentItem(with: nil); player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

private struct SystemPlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    let session: PlaybackSession
    func makeCoordinator() -> Coordinator { Coordinator(session: session) }
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.delegate = context.coordinator
        controller.player = player
        controller.allowsPictureInPicturePlayback = false
        controller.allowsVideoFrameAnalysis = false
        return controller
    }
    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: Coordinator) {
        let current = controller.player === coordinator.session.player
        controller.delegate = nil
        controller.player = nil
        if current { coordinator.session.stop() }
    }
    @MainActor final class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        let session: PlaybackSession
        init(session: PlaybackSession) { self.session = session }
        func playerViewController(_ playerViewController: AVPlayerViewController,
                                  willBeginFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
            session.presentingFullscreen = true
            coordinator.animate(alongsideTransition: nil) { [weak self] context in
                if context.isCancelled { self?.session.presentingFullscreen = false }
            }
        }
        func playerViewController(_ playerViewController: AVPlayerViewController,
                                  willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
            coordinator.animate(alongsideTransition: nil) { [weak self] context in
                self?.session.presentingFullscreen = context.isCancelled
            }
        }
    }
}

struct NativeMediaViewer: View {
    let initial: ProfileMediaFile
    let files: [ProfileMediaFile]
    let client: HomesteadClient
    let readAlongFiles: [ProfileMediaFile]
    let mediaTitle: String?
    let artwork: String?
    @State private var active: ProfileMediaFile
    @State private var showReadAlong: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var playback = PlaybackSession()
    @State private var selected = ""
    @State private var photoControlsVisible = true
    private var photos: [ProfileMediaFile] {
        var seen = Set<String>()
        return (files + [initial]).filter { !$0.playable && seen.insert($0.id).inserted }
    }
    private var photoIndex: Int { photos.firstIndex { $0.id == selected } ?? 0 }
    init(initial: ProfileMediaFile, files: [ProfileMediaFile], client: HomesteadClient, readAlongFiles: [ProfileMediaFile] = [], startReadAlong: Bool = false, mediaTitle: String? = nil, artwork: String? = nil) {
        self.initial = initial; self.files = files; self.client = client
        self.mediaTitle = mediaTitle; self.artwork = artwork
        _active = State(initialValue: initial)
        self.readAlongFiles = readAlongFiles.filter(\.readable)
        _showReadAlong = State(initialValue: startReadAlong && initial.audio && !readAlongFiles.isEmpty)
        _selected = State(initialValue: initial.id)
    }
    private var queue: [ProfileMediaFile] { files.filter { active.audio ? $0.audio : $0.video } }
    private var queueIndex: Int? { queue.firstIndex { $0.id == active.id } }
    private func changeTrack(_ offset: Int) {
        guard let index = queueIndex, queue.indices.contains(index + offset) else { return }
        playback.pause(); active = queue[index + offset]
    }
    var body: some View {
        VStack(spacing: 0) {
            if active.playable { HStack {
                Button("Close") { playback.stop(); dismiss() }.frame(minHeight: 44)
                Spacer(minLength: 8)
                Text(mediaTitle ?? PlaybackPresentation.cleanTitle(active.title)).font(.headline).lineLimit(2)
                Spacer(minLength: 8)
            }.padding(.horizontal).padding(.vertical, 6) }
            if active.playable {
                playableContent
            } else {
                GeometryReader { viewport in
                TabView(selection: $selected) {
                    ForEach(photos) { file in
                        FullscreenPhoto(path: file.path, client: client,
                                        active: abs((photos.firstIndex { $0.id == file.id } ?? 0) - photoIndex) <= 1,
                                        selected: selected == file.id,
                                        toggleControls: { photoControlsVisible.toggle() })
                            .frame(width: viewport.size.width, height: viewport.size.height)
                            .clipped().tag(file.id)
                    }
                }.tabViewStyle(.page(indexDisplayMode: .never))
                    .frame(width: viewport.size.width, height: viewport.size.height)
                    .clipped()
                    .overlay(alignment: .top) {
                        if photoControlsVisible {
                            HStack {
                                Button("Close") { dismiss() }.frame(minWidth: 44, minHeight: 44)
                                Spacer()
                                Text(photos[photoIndex].title).font(.headline).lineLimit(1)
                                Spacer()
                                Button { photoControlsVisible = false } label: {
                                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                                        .frame(width: 44, height: 44)
                                }.accessibilityLabel("Hide controls for fullscreen photo")
                            }.padding(.horizontal).padding(.top, 8).background(.black.opacity(0.65))
                        }
                    }
                    .overlay(alignment: .bottom) {
                        if photoControlsVisible {
                            HStack {
                                Button { selected = photos[photoIndex - 1].id } label: {
                                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                                }.disabled(photoIndex == 0).accessibilityLabel("Previous photo")
                                Text("\(photoIndex + 1) of \(photos.count)").monospacedDigit()
                                Button { selected = photos[photoIndex + 1].id } label: {
                                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                                }.disabled(photoIndex == photos.count - 1).accessibilityLabel("Next photo")
                            }.padding(.horizontal).background(.black.opacity(0.65), in: Capsule()).padding(.bottom, 12)
                        }
                    }
                }
            }
        }.background(Color.black.ignoresSafeArea()).preferredColorScheme(.dark)
            .statusBarHidden(!initial.playable && !photoControlsVisible)
            .task(id: active.id) {
                if active.playable { await playback.retry(active, client: client) }
            }
            .onChange(of: scenePhase) { _, phase in if phase == .background { playback.pause() } }
            .onDisappear { if !playback.presentingFullscreen { playback.stop() } }
    }
    @ViewBuilder private var playableContent: some View {
        if let error = playback.error {
            VStack {
                ContentUnavailableView("Unable to play", systemImage: "play.slash", description: Text(error))
                Button("Retry") { Task { await playback.retry(active, client: client) } }
            }
        } else {
            VStack(spacing: 12) {
                if let player = playback.player {
                    if active.audio {
                        audioContent
                    } else {
                        SystemPlayer(player: player, session: playback).disabled(!playback.started)
                    }
                } else { Spacer(); HomesteadLoadingCard(message: "Opening media…"); Spacer() }
                if let message = playback.syncMessage { Text(message).font(.caption).foregroundStyle(.secondary).padding(.horizontal) }
            }.overlay {
                if !playback.started && PlaybackPresentation.needsChoice(resume: playback.resumeAt) && playback.player != nil {
                    ResumeChoiceCard(title: mediaTitle ?? PlaybackPresentation.cleanTitle(active.title), position: playback.resumeAt) { playback.play(resume: $0) }.disabled(playback.seeking)
                } else if playback.seeking { HomesteadLoadingCard(message: "Starting playback…") }
            }
        }
    }
    @ViewBuilder private var audioContent: some View {
        if showReadAlong {
            audioControls(compact: true)
            BookReadingView(files: readAlongFiles, client: client)
        } else {
            ScrollView { VStack(spacing: 24) { audioControls(compact: false) }.padding(.vertical, 20) }
        }
    }
    private func audioControls(compact: Bool) -> some View {
        VStack(spacing: 10) {
            NativeAudioPlayer(session: playback, file: active, title: mediaTitle, artwork: artwork, client: client, compact: compact,
                              previous: queueIndex.map { $0 > 0 } == true ? { changeTrack(-1) } : nil,
                              next: queueIndex.map { $0 + 1 < queue.count } == true ? { changeTrack(1) } : nil)
            if !readAlongFiles.isEmpty {
                Button { showReadAlong.toggle() } label: { Label(showReadAlong ? "Close Read Along" : "Read Along", systemImage: "book") }
                    .buttonStyle(.bordered).controlSize(.small)
            }
        }.padding(.horizontal, 16)
    }
}

private struct FullscreenPhoto: View {
    let path: String
    let client: HomesteadClient
    let active: Bool
    let selected: Bool
    let toggleControls: () -> Void
    @State private var image: UIImage?
    @State private var error: String?
    @State private var attempt = 0
    var body: some View {
        Group {
            if let image { ZoomPhoto(image: image, selected: selected, toggleControls: toggleControls) }
            else if let error {
                VStack { Text(error); Button("Retry") { attempt += 1 }; Button("Show controls", action: toggleControls) }
                    .padding().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            else {
                HomesteadLoadingCard(message: "Loading photo…").frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle()).onTapGesture(perform: toggleControls)
            }
        }.task(id: "\(active)-\(attempt)") {
            guard active, image == nil else { return }
            error = nil
            do {
                let data = try await client.profileImage(path, preview: false)
                let decoded = await Task.detached(priority: .userInitiated) { NativeImageDecoder.thumbnail(data, maximumPixelSize: 4096) }.value
                guard let thumbnail = decoded else { throw CompanionError.message("Unsupported image format.") }
                try Task.checkCancellation()
                image = UIImage(cgImage: thumbnail)
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }.onChange(of: active) { _, value in if !value { image = nil } }
    }
}

private struct ZoomPhoto: UIViewRepresentable {
    let image: UIImage
    let selected: Bool
    let toggleControls: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> PhotoScrollView {
        let scroll = PhotoScrollView()
        scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 5
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.bounces = false; scroll.bouncesZoom = false
        scroll.alwaysBounceHorizontal = false; scroll.alwaysBounceVertical = false
        scroll.clipsToBounds = true
        scroll.panGestureRecognizer.isEnabled = false
        scroll.delegate = context.coordinator
        let view = scroll.imageView
        view.contentMode = .scaleAspectFit
        scroll.addSubview(view)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:)))
        tap.numberOfTapsRequired = 2; scroll.addGestureRecognizer(tap)
        let singleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.singleTap))
        singleTap.require(toFail: tap)
        scroll.addGestureRecognizer(singleTap)
        return scroll
    }
    func updateUIView(_ scroll: PhotoScrollView, context: Context) {
        context.coordinator.toggleControls = toggleControls
        scroll.display(image)
        if !selected { scroll.resetToFit() }
    }
    final class Coordinator: NSObject, UIScrollViewDelegate {
        var toggleControls: (() -> Void)?
        @objc func singleTap() { toggleControls?() }
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { (scrollView as? PhotoScrollView)?.imageView }
        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            // At fit size, horizontal drags belong to the gallery pager. Pinch
            // stays enabled; once enlarged, drags pan the photo instead.
            (scrollView as? PhotoScrollView)?.centerImage()
            scrollView.panGestureRecognizer.isEnabled = scrollView.zoomScale > 1.01
        }
        func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
            scrollViewDidZoom(scrollView)
        }
        @objc func doubleTap(_ gesture: UITapGestureRecognizer) {
            guard let scroll = gesture.view as? UIScrollView else { return }
            scroll.setZoomScale(scroll.zoomScale > 1 ? 1 : 3, animated: true)
        }
    }
}

private final class PhotoScrollView: UIScrollView {
    let imageView = UIImageView()
    private var previousSize: CGSize = .zero
    func display(_ image: UIImage) {
        guard imageView.image !== image else { return }
        imageView.image = image
        previousSize = .zero
        setNeedsLayout()
    }
    func resetToFit() {
        guard zoomScale != 1 else { return }
        setZoomScale(1, animated: false)
        centerImage()
        contentOffset = CGPoint(x: -contentInset.left, y: -contentInset.top)
    }
    func centerImage() {
        let padding = PhotoViewportGeometry.centering(content: contentSize, viewport: bounds.size)
        let insets = UIEdgeInsets(top: padding.height, left: padding.width, bottom: padding.height, right: padding.width)
        if contentInset != insets { contentInset = insets }
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != previousSize, bounds.width > 0, bounds.height > 0, let image = imageView.image else { return }
        previousSize = bounds.size
        setZoomScale(1, animated: false)
        imageView.frame = CGRect(origin: .zero, size: PhotoViewportGeometry.fittedSize(image: image.size, viewport: bounds.size))
        contentSize = imageView.frame.size
        centerImage()
        contentOffset = CGPoint(x: -contentInset.left, y: -contentInset.top)
    }
}
