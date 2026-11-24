import SwiftUI
import AVKit

struct NativeAudioPlayer: View {
    @ObservedObject var session: PlaybackSession
    let file: ProfileMediaFile
    let title: String?
    let artwork: String?
    let client: HomesteadClient
    let compact: Bool
    let previous: (() -> Void)?
    let next: (() -> Void)?
    @State private var dragging = false
    @State private var draftPosition = 0.0
    var body: some View {
        VStack(spacing: compact ? 8 : 22) {
            if !compact {
                NativeArtwork(path: artwork, client: client, symbol: "headphones")
                    .aspectRatio(1, contentMode: .fit).frame(maxWidth: 260, maxHeight: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 24)).shadow(radius: 14)
            }
            if compact {
                HStack(spacing: 8) {
                    Text(PlaybackPresentation.cleanTitle(file.title)).font(.subheadline.bold()).lineLimit(1)
                    Spacer(minLength: 0)
                    speedMenu
                    AudioRoutePicker().frame(width: 36, height: 44).accessibilityLabel("Choose audio output")
                }
            } else {
                VStack(spacing: 4) {
                    Text(PlaybackPresentation.cleanTitle(file.title)).font(.title3.bold()).multilineTextAlignment(.center).lineLimit(3)
                    if let title, title != PlaybackPresentation.cleanTitle(file.title) { Text(title).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center) }
                }
            }
            timeline
            transport
            if !compact {
                HStack {
                    speedMenu
                    Spacer()
                    AudioRoutePicker().frame(width: 44, height: 44).accessibilityLabel("Choose audio output")
                }
            }
        }.padding(compact ? 12 : 20).frame(maxWidth: 680).homesteadPanel(radius: 22).frame(maxWidth: .infinity)
            .disabled(!session.started || session.seeking)
    }
    private var speedMenu: some View {
        Menu {
            ForEach([Float(0.75), 1, 1.25, 1.5, 1.75, 2], id: \.self) { speed in
                Button { session.setSpeed(speed) } label: {
                    if speed == session.speed { Label("\(speed.formatted())×", systemImage: "checkmark") }
                    else { Text("\(speed.formatted())×") }
                }
            }
        } label: { Text("\(session.speed.formatted())×").font(.subheadline.weight(.semibold)).frame(minWidth: 44, minHeight: 44) }
            .accessibilityLabel("Playback speed, \(session.speed.formatted()) times")
    }
    private var timeline: some View {
        VStack(spacing: 3) {
            Slider(value: Binding(get: { dragging ? draftPosition : min(session.position, max(session.duration, 1)) },
                                  set: { draftPosition = $0 }),
                   in: 0...max(session.duration, 1)) { editing in
                if editing { draftPosition = session.position }
                else { session.seek(draftPosition) }
                dragging = editing
            }.accessibilityLabel("Playback position")
                .accessibilityValue(PlaybackPresentation.time(dragging ? draftPosition : session.position))
            HStack {
                Text(PlaybackPresentation.time(dragging ? draftPosition : session.position))
                Spacer()
                Text("−" + PlaybackPresentation.time(max(0, session.duration - (dragging ? draftPosition : session.position))))
            }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
    }
    private var transport: some View {
        ViewThatFits(in: .horizontal) {
            transportRow(spacing: compact ? 8 : 16)
            transportRow(spacing: 2)
        }.frame(maxWidth: .infinity)
    }
    private func transportRow(spacing: CGFloat) -> some View {
        HStack(spacing: spacing) {
            transportButton("backward.end.fill", "Previous track", action: previous)
            transportButton("gobackward.15", "Back 15 seconds") { session.seek(session.position - 15) }
            Button { session.toggle() } label: {
                Image(systemName: session.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: compact ? 24 : 30, weight: .semibold))
                    .frame(width: compact ? 52 : 68, height: compact ? 52 : 68)
            }.buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                .accessibilityLabel(session.isPlaying ? "Pause" : "Play")
            transportButton("goforward.15", "Forward 15 seconds") { session.seek(session.position + 15) }
            transportButton("forward.end.fill", "Next track", action: next)
        }
    }
    private func transportButton(_ symbol: String, _ label: String, action: (() -> Void)?) -> some View {
        Button { action?() } label: { Image(systemName: symbol).font(.title3).frame(minWidth: 40, minHeight: 44) }
            .disabled(action == nil).accessibilityLabel(label)
    }
}

struct ResumeChoiceCard: View {
    let title: String
    let position: Double
    let choose: (Bool) -> Void
    var body: some View {
        VStack(spacing: 16) {
            Text(title).font(.headline).multilineTextAlignment(.center).lineLimit(3)
            Text("Continue where you left off?").font(.subheadline).foregroundStyle(.secondary)
            Button("Resume at " + PlaybackPresentation.time(position)) { choose(true) }
                .buttonStyle(.borderedProminent).controlSize(.large)
            Button("Play from beginning") { choose(false) }.buttonStyle(.bordered).controlSize(.large)
        }.padding(24).frame(maxWidth: 360).homesteadPanel(radius: 24).shadow(radius: 16).padding(20)
            .accessibilityElement(children: .contain)
    }
}

private struct AudioRoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.prioritizesVideoDevices = false
        return view
    }
    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
