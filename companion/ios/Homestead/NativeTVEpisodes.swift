import SwiftUI

struct NativeTVEpisodes: View {
    let item: MediaItem
    let seasons: [MediaSeason]
    let client: HomesteadClient?
    @State private var response: IndexValue?
    @State private var selected: Int?
    @State private var loading = false
    @State private var error: String?
    @State private var viewing: ProfileMediaFile?
    @State private var searching: TVEpisode?
    @State private var requesting = false
    private var episodes: [TVEpisode] { TVEpisodeCatalog.build(response, seasons: seasons) }
    private var numbers: [Int] { Set(seasons.map(\.number) + episodes.map(\.season)).sorted() }
    private var active: Int? { selected.flatMap { numbers.contains($0) ? $0 : nil } ?? numbers.first(where: { $0 > 0 }) ?? numbers.first }
    private var visible: [TVEpisode] { episodes.filter { $0.season == active } }
    private var playback: [ProfileMediaFile] { visible.compactMap(\.file) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Episodes").font(.title2.bold())
                Spacer()
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh episode availability").disabled(loading)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(numbers, id: \.self) { number in
                        let entries = episodes.filter { $0.season == number }
                        let known = seasons.first { $0.number == number }
                        let available = entries.filter { $0.file != nil }.count
                        let total = max(entries.count, known?.total ?? 0)
                        Button { selected = number } label: {
                            VStack(spacing: 5) {
                                Text(number < 0 ? "Other episodes" : number == 0 ? "Specials" : "Season \(number)").font(.subheadline.weight(.semibold))
                                Text("\(available)/\(total)").font(.caption.monospacedDigit())
                            }.padding(.horizontal, 14).padding(.vertical, 9)
                        }.buttonStyle(.plain).homesteadLibraryPill(selected: active == number)
                    }
                }
            }
            if loading { ProgressView("Updating episodes…") }
            if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
            if let warning = response?["warning"]?.text, !warning.isEmpty { Text(warning).font(.caption).foregroundStyle(.secondary) }
            LazyVStack(spacing: 12) {
                ForEach(visible) { episode in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 12) {
                            NativeArtwork(path: episode.artwork, client: client, symbol: "tv")
                                .frame(width: 112, height: 66).clipShape(RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 5) {
                                Text(episode.season < 0 ? "Local episode" : episode.code).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                Text(episode.title).font(.subheadline.weight(.semibold)).lineLimit(3)
                                Text(episode.statusLabel).font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                                    .background(.secondary.opacity(0.12), in: Capsule())
                            }
                            Spacer(minLength: 0)
                        }
                        if let file = episode.file {
                            Button { viewing = file } label: { Label("Play", systemImage: "play.fill").frame(minHeight: 44) }.disabled(client == nil)
                        } else if episode.canSearch {
                            Button { searching = episode } label: { Label("Interactive Search", systemImage: "magnifyingglass").frame(minHeight: 44) }.disabled(client == nil)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(12).homesteadPanel(radius: 14)
                }
            }
            if visible.isEmpty && !loading { Text("No downloaded episodes in this season. Refresh to check episode details.").foregroundStyle(.secondary) }
            if item.detail.providerID != nil && response?["canSearch"]?.flag != true {
                Button("Request missing seasons or episodes") { requesting = true }
                    .disabled(client == nil)
            }
        }
        .task(id: item.id) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
            if let sender = notification.object as? HomesteadClient, sender === client, error != nil { Task { await load() } }
        }
        .sheet(item: $searching, onDismiss: { Task { await load() } }) { episode in
            if let client { EpisodeReleaseSearch(item: item, episode: episode, client: client) }
        }
        .sheet(isPresented: $requesting) {
            if let client, let id = item.detail.providerID {
                EpisodeSeasonRequest(title: item.title, providerID: id, selectedSeason: active, client: client)
            }
        }
        .fullScreenCover(item: $viewing) { file in
            if let client { NativeMediaViewer(initial: file, files: playback, client: client, mediaTitle: item.title, artwork: item.poster) }
        }
    }
    @MainActor private func load() async {
        guard let client, !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let next: IndexValue = try await client.request("api/tv/episodes", query: [URLQueryItem(name: "showId", value: item.id)], timeout: 50)
            try Task.checkCancellation()
            guard next["ok"]?.flag == true else { throw CompanionError.message("Episode details are unavailable.") }
            response = next
        } catch { if !Task.isCancelled { self.error = "Episode details could not refresh. Local playback remains available. " + error.localizedDescription } }
    }
}

private struct EpisodeReleaseSearch: View {
    let item: MediaItem
    let episode: TVEpisode
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    @State private var releases: [TVRelease] = []
    @State private var token = ""
    @State private var loading = false
    @State private var checked = false
    @State private var submitted = false
    @State private var message: String?
    @State private var chosen: TVRelease?
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    Text(item.title).font(.headline)
                    Text(episode.code + " · " + episode.title).font(.subheadline)
                    if loading { ProgressView("Searching Sonarr…") }
                    if let message { Text(message).font(.footnote) }
                    if checked && releases.isEmpty && !loading { Text("No matching releases found. Check Sonarr's configured indexers or try again later.").foregroundStyle(.secondary) }
                    ForEach(releases) { release in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(release.title).font(.subheadline.bold())
                            Text(release.summary).font(.caption)
                            ForEach(release.rejections, id: \.self) { reason in Text(reason).font(.caption).foregroundStyle(.orange) }
                            Button("Download this release") { chosen = release }
                                .buttonStyle(.bordered).disabled(!release.canDownload || loading || submitted)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(14).homesteadPanel(radius: 14)
                    }
                    if !submitted { Button("Search again") { Task { await search() } }.disabled(loading) }
                }.padding()
            }.homesteadCanvas().navigationTitle("Interactive Search").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(loading && submitted) } }
        }
        .presentationDetents([.large]).presentationDragIndicator(.visible).interactiveDismissDisabled(loading && submitted)
        .task { await search() }
        .confirmationDialog("Send this release to Sonarr?", isPresented: Binding(get: { chosen != nil }, set: { if !$0 { chosen = nil } }), titleVisibility: .visible) {
            if let release = chosen { Button("Download") { Task { await grab(release) } } }
            Button("Cancel", role: .cancel) { chosen = nil }
        }
    }
    @MainActor private func search() async {
        guard !loading, !submitted, let id = episode.episodeID else { return }
        loading = true; message = nil; token = ""; releases = []
        defer { loading = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["showId": item.id, "episodeId": id])
            let result: IndexValue = try await client.request("api/tv/episodes/search", method: "POST", body: body, timeout: 90)
            try Task.checkCancellation()
            guard result["ok"]?.flag == true, let next = result["searchToken"]?.text else { throw CompanionError.message("Search could not complete.") }
            token = next; releases = result["releases"]?.list.compactMap(TVRelease.init) ?? []; checked = true
        } catch { if !Task.isCancelled { message = error.localizedDescription } }
    }
    @MainActor private func grab(_ release: TVRelease) async {
        guard !loading, !submitted, !token.isEmpty, let id = episode.episodeID else { return }
        loading = true; submitted = true; chosen = nil
        defer { loading = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["showId": item.id, "episodeId": id, "searchToken": token, "releaseId": release.id])
            let result: IndexValue = try await client.request("api/tv/episodes/grab", method: "POST", body: body, timeout: 80)
            guard result["ok"]?.flag == true else { throw CompanionError.message("Release was not confirmed.") }
            message = result["message"]?.text ?? "Request sent. Refresh episodes to follow download/import status."
        } catch { message = error.localizedDescription + " Check Sonarr or refresh episode status before another attempt; the request may have arrived." }
    }
}

private struct EpisodeSeasonRequest: View {
    let title: String
    let providerID: String
    let selectedSeason: Int?
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(title).font(.headline)
                    Text("Your request service accepts seasons. Choose a season containing the missing episodes; episode-by-episode release selection requires an administrator's Sonarr search.").font(.footnote).foregroundStyle(.secondary)
                    MediaRequestControls(target: MediaRequestTarget(kind: "tv", providerID: providerID, item: .object([:])), title: title, client: client, initialSeason: selectedSeason)
                }.padding()
            }.homesteadCanvas().navigationTitle("Request episodes").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }.presentationDetents([.large])
    }
}
