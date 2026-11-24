import SwiftUI

struct MoviePlayAction: View {
    let item: MediaItem
    let client: HomesteadClient?
    @State private var choosingVersion = false
    @State private var viewing: ProfileMediaFile?
    private var versions: [ProfileMediaFile] { MediaDetailCatalog.movieVersions(item.files) }
    var body: some View {
        Button {
            if versions.count == 1 { viewing = versions.first } else { choosingVersion = true }
        } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 44) }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .disabled(versions.isEmpty || client == nil)
            .sheet(isPresented: $choosingVersion, onDismiss: {
                if let file = pendingVersion { pendingVersion = nil; viewing = file }
            }) {
                VersionSelectionCard(title: item.title, versions: versions) { file in
                    pendingVersion = file
                    choosingVersion = false
                }
            }
            .fullScreenCover(item: $viewing) { file in
                if let client { NativeMediaViewer(initial: file, files: versions, client: client, mediaTitle: item.title, artwork: item.poster) }
            }
    }
    @State private var pendingVersion: ProfileMediaFile?
}

private struct VersionSelectionCard: View {
    let title: String
    let versions: [ProfileMediaFile]
    let choose: (ProfileMediaFile) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(title).font(.title3.bold())
                    Text("Choose a version").foregroundStyle(.secondary)
                    ForEach(versions) { file in
                        Button { choose(file) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "play.circle.fill").font(.title2)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(PlaybackPresentation.cleanTitle(file.title)).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                                    Text(file.fileExtension.uppercased()).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                            }.frame(minHeight: 44).padding(14).homesteadPanel(radius: 16)
                        }.buttonStyle(.plain)
                    }
                }.padding()
            }.homesteadCanvas().navigationTitle("Play").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
}

struct MediaFeatureDetails: View {
    let item: MediaItem
    let client: HomesteadClient?
    @State private var live: MediaDetailSnapshot?
    @State private var loading = false
    @State private var error: String?
    private var detail: MediaDetailSnapshot { live ?? item.detail }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if item.category == .movies { MoviePlayAction(item: item, client: client) }
            if !item.overview.isEmpty { Text(item.overview).foregroundStyle(.secondary) }
            if item.category == .tv { NativeTVEpisodes(item: item, seasons: detail.seasons, client: client) }
            if let error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }.disabled(loading)
                }
            }
            MediaCastRibbon(people: detail.cast, client: client)
            MediaRelatedRibbon(items: detail.related, client: client)
            if !loading && error == nil && detail.cast.isEmpty && detail.related.isEmpty {
                Text("Cast and related titles appear when matching metadata is available.").font(.caption).foregroundStyle(.secondary)
            }
        }.homesteadLoading(loading, message: "Loading cast and related titles…")
            .task(id: item.id) { await load() }
    }
    @MainActor private func load() async {
        guard !loading, let client, let id = item.detail.providerID else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let type = item.category == .tv ? "tv" : "movie"
            let response: IndexValue = try await client.request("api/integrations/seerr/media/" + type + "/" + id + "/details", timeout: 35)
            try Task.checkCancellation()
            guard response["ok"]?.flag == true else { throw CompanionError.message("Metadata unavailable") }
            var next = item.detail
            let credits = MediaDetailCatalog.credits(response["cast"])
            let related = MediaDetailCatalog.related(response["related"], defaultType: type)
            if !credits.isEmpty { next.cast = credits }
            if !related.isEmpty { next.related = related }
            if item.category == .tv {
                let metadata = response["item"] ?? .object([:])
                let totals = LibraryBrowseCatalog.rows(metadata["seasons"]).reduce(into: [Int: Int]()) { result, entry in
                    let row = entry.1
                    guard let n = MediaDetailCatalog.number(row["seasonNumber"] ?? row["season_number"]),
                          let count = MediaDetailCatalog.number(row["episodeCount"] ?? row["episode_count"]), n >= 0, count > 0 else { return }
                    result[n] = count
                }
                next.seasons = MediaDetailCatalog.updatingTotals(next.seasons, totals: totals)
            }
            live = next
        } catch { if !Task.isCancelled { self.error = "Extra metadata could not load. Your local media is still available." } }
    }
}

struct SeasonEpisodeBrowser: View {
    let seasons: [MediaSeason]
    let title: String
    let artwork: String?
    let client: HomesteadClient?
    @State private var selected: Int?
    @State private var viewing: ProfileMediaFile?
    private var active: MediaSeason? { seasons.first { $0.number == selected } ?? seasons.first { !$0.files.isEmpty } ?? seasons.first }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Episodes").font(.title2.bold())
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(seasons) { season in
                        Button { selected = season.number } label: {
                            VStack(spacing: 5) {
                                Text(season.title).font(.subheadline.weight(.semibold))
                                Text(season.countLabel).font(.caption.monospacedDigit())
                            }.padding(.horizontal, 14).padding(.vertical, 9)
                        }.buttonStyle(.plain).homesteadLibraryPill(selected: active?.number == season.number)
                            .accessibilityLabel(season.title + ", " + season.countLabel + " episodes")
                    }
                }
            }
            if let active {
                ForEach(active.files) { file in
                    Button { viewing = file } label: {
                        HStack {
                            Image(systemName: "play.circle.fill")
                            Text(PlaybackPresentation.cleanTitle(file.title)).font(.subheadline).lineLimit(2)
                            Spacer()
                        }.frame(minHeight: 44).padding(12).homesteadPanel(radius: 14)
                    }.buttonStyle(.plain).disabled(client == nil)
                }
                if active.files.isEmpty { Text("No downloaded episodes in this season.").foregroundStyle(.secondary) }
            } else { Text("No indexed episodes are available. Refresh the library to check again.").foregroundStyle(.secondary) }
        }.fullScreenCover(item: $viewing) { file in
            if let client { NativeMediaViewer(initial: file, files: active?.files ?? [file], client: client, mediaTitle: title, artwork: artwork) }
        }
    }
}

private struct MediaCastRibbon: View {
    let people: [MediaCredit]
    let client: HomesteadClient?
    var body: some View {
        if !people.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Cast").font(.title2.bold())
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(people) { person in
                            VStack(alignment: .leading, spacing: 6) {
                                NativeArtwork(path: person.poster, client: client, symbol: "person")
                                    .frame(width: 94, height: 130).clipShape(RoundedRectangle(cornerRadius: 14))
                                Text(person.name).font(.caption.bold()).lineLimit(2)
                                Text(person.character).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                            }.frame(width: 94, alignment: .leading)
                        }
                    }
                }
            }
        }
    }
}

private struct MediaRelatedRibbon: View {
    let items: [MediaRelated]
    let client: HomesteadClient?
    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Related").font(.title2.bold())
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(items) { related in
                            NavigationLink { NativeSearchDetails(hit: related.hit, client: client) } label: {
                                PosterTile(title: related.title, subtitle: related.year, path: related.poster, symbol: "film", client: client).frame(width: 120)
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }
}
