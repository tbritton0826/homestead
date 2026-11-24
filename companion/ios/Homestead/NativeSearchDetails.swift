import SwiftUI

private struct SearchDetailMetadataField: Identifiable {
    let label: String
    let value: String
    var id: String { label }
}

struct NativeSearchResultRow: View {
    let hit: NativeSearchHit
    let client: HomesteadClient?
    private var type: String { hit.mediaType.isEmpty ? hit.source : hit.mediaType.replacingOccurrences(of: "-", with: " ").capitalized }
    var body: some View {
        HStack(spacing: 12) {
            NativeArtwork(path: hit.posterPath, client: client, symbol: hit.isBook ? "book" : type.lowercased().contains("music") ? "music.note" : "film")
                .frame(width: 42, height: 62).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                Text(hit.title).font(.subheadline.bold()).lineLimit(2)
                Text([type, hit.year].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                Text(SearchPresentation.statusLabel(hit.status)).font(.caption2.bold())
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(hit.status == "downloading" ? Color.orange.opacity(0.3) : Color.accentColor.opacity(0.12), in: Capsule())
            }
            Spacer(minLength: 0)
            if hit.requestTarget != nil {
                Text(["discovery", "missing", "not-requested", "not-owned"].contains(hit.status) ? "+ Request" : SearchPresentation.statusLabel(hit.status))
                    .font(.caption2.weight(.semibold)).lineLimit(2).padding(8)
                    .overlay { Capsule().stroke(Color.accentColor.opacity(0.5)) }
            }
        }.padding(.vertical, 6).accessibilityElement(children: .combine)
    }
}

struct NativeSearchDetails: View {
    let hit: NativeSearchHit
    let client: HomesteadClient?
    @State private var detail: IndexValue = .object([:])
    @State private var loading = false
    @State private var error: String?
    @State private var viewing: ProfileMediaFile?
    private var row: IndexValue { detail["item"] ?? hit.payload }
    private var poster: String? { SearchPresentation.poster(row) ?? hit.posterPath }
    private var banner: String? { SearchPresentation.banner(row) ?? hit.bannerPath }
    private var overview: String { row["overview"]?.text ?? row["description"]?.text ?? hit.summary }
    private var cast: [IndexValue] { detail["cast"]?.list ?? row["credits"]?["cast"]?.list ?? [] }
    private var genres: [IndexValue] { detail["genres"]?.list ?? row["genres"]?.list ?? [] }
    private var trailers: [IndexValue] { detail["trailers"]?.list ?? [] }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ZStack(alignment: .bottomLeading) {
                    if let banner { NativeArtwork(path: banner, client: client).frame(height: 330) }
                    else { Color.secondary.opacity(0.08).frame(height: 280) }
                    LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .top, endPoint: .bottom)
                    HStack(alignment: .bottom, spacing: 16) {
                        NativeArtwork(path: poster, client: client, symbol: hit.isBook ? "book" : "film")
                            .frame(width: 108, height: 165).clipShape(RoundedRectangle(cornerRadius: 14))
                        VStack(alignment: .leading, spacing: 8) {
                            Text(hit.title).font(.title.bold()).foregroundStyle(.white)
                            Text([hit.year, hit.mediaType.capitalized, runtime].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(.white.opacity(0.8))
                            Text(hit.source).font(.caption).foregroundStyle(.white.opacity(0.7))
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.padding()
                }.frame(height: banner == nil ? 280 : 330).clipShape(RoundedRectangle(cornerRadius: 20))
                if let error { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load() } } }
                if !genres.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(Array(genres.enumerated()), id: \.offset) { _, genre in Text(genre["name"]?.text ?? genre.text ?? "").homesteadLibraryPill() }
                        }
                    }
                }
                if hit.isBook { BookDetailActions(title: hit.title, files: hit.mediaFiles, client: client, bookID: hit.id, artwork: poster) }
                if let target = hit.requestTarget, let client {
                    MediaRequestControls(target: target, title: hit.title, client: client)
                        .padding().homesteadPanel(radius: 18)
                }
                if !trailers.isEmpty {
                    ForEach(Array(trailers.enumerated()), id: \.offset) { _, trailer in
                        if let key = trailer["key"]?.text, trailer["site"]?.text?.lowercased() == "youtube",
                           key.range(of: "^[a-zA-Z0-9_-]{6,32}$", options: .regularExpression) != nil,
                           let url = URL(string: "https://www.youtube.com/watch?v=" + key) {
                            Link(destination: url) { Label(trailer["name"]?.text ?? "Watch Trailer", systemImage: "play.rectangle") }
                        }
                    }
                }
                metadata
                Text("Overview").font(.title2.bold())
                Text(overview.isEmpty ? "No description is available." : overview)
                if !cast.isEmpty {
                    Text("Cast").font(.title2.bold())
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: 12) {
                            ForEach(Array(cast.prefix(40).enumerated()), id: \.offset) { _, person in
                                VStack(alignment: .leading, spacing: 6) {
                                    NativeArtwork(path: SearchPresentation.tmdb(person["profilePath"]?.text ?? person["profile_path"]?.text), client: client, symbol: "person")
                                        .frame(width: 100, height: 140).clipShape(RoundedRectangle(cornerRadius: 12))
                                    Text(person["name"]?.text ?? "Cast member").font(.caption.bold())
                                    if let character = person["character"]?.text { Text(character).font(.caption2).foregroundStyle(.secondary) }
                                }.frame(width: 100, alignment: .leading)
                            }
                        }
                    }
                }
                let related = detail["related"]?.list ?? []
                if !related.isEmpty {
                    Text("Related").font(.title2.bold())
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(Array(related.enumerated()), id: \.offset) { index, item in
                                let next = NativeSearchMapping.hit(item, source: "Seerr", fallbackID: String(index))
                                NavigationLink {
                                    NativeSearchDetails(hit: next, client: client)
                                } label: {
                                    PosterTile(title: next.title, subtitle: next.year, path: next.posterPath, symbol: "film", client: client).frame(width: 120)
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
                ForEach(hit.mediaFiles.filter { !hit.isBook || (!$0.audio && !$0.readable) }) { file in
                    Button { viewing = file } label: { Label(file.title, systemImage: file.playable ? "play.circle" : "photo").frame(minHeight: 44) }
                }
            }.padding().frame(maxWidth: 1000, alignment: .leading).frame(maxWidth: .infinity)
        }.homesteadCanvas().navigationTitle(hit.title).navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .task(id: hit.id) { await load() }
            .fullScreenCover(item: $viewing) { file in if let client { NativeMediaViewer(initial: file, files: hit.mediaFiles, client: client) } }
        .homesteadLoading(loading, message: "Loading details…")
    }
    private var runtime: String {
        let text = row["runtime"]?.text ?? row["episodeRunTime"]?.list.first?.text ?? ""
        return text.isEmpty ? "" : text + " min"
    }
    private var tmdbScore: Int? {
        let text: String? = row["voteAverage"]?.text ?? row["vote_average"]?.text
        guard let text, let value = Double(text), value.isFinite else { return nil }
        let bounded: Double = max(0.0, min(10.0, value))
        return Int(bounded * 10.0)
    }
    private var metadataFields: [SearchDetailMetadataField] {
        let releaseDate: String? = row["releaseDate"]?.text ?? row["release_date"]?.text ?? row["firstAirDate"]?.text
        let language: String? = row["originalLanguage"]?.text ?? row["original_language"]?.text
        var fields: [SearchDetailMetadataField] = []
        func add(_ label: String, _ value: String?) {
            guard let value, !value.isEmpty else { return }
            fields.append(SearchDetailMetadataField(label: label, value: value))
        }
        add("Release Date", releaseDate)
        add("Language", language)
        add("Runtime", runtime)
        add("Source", hit.source)
        return fields
    }
    private var metadata: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let score = tmdbScore {
                Label("TMDB \(score)%", systemImage: "star.fill")
            }
            if let score = detail["ratings"]?["rt"]?["criticsScore"]?.text {
                Label("RT \(score)%", systemImage: "star")
            }
            ForEach(metadataFields) { field in
                HStack {
                    Text(field.label).font(.subheadline.bold())
                    Spacer()
                    Text(field.value).font(.subheadline)
                }
            }
        }.padding().homesteadPanel(radius: 18)
    }
    private func load() async {
        guard !loading, let target = hit.requestTarget, target.seerr, let client else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let response: IndexValue = try await client.request("api/integrations/seerr/media/\(target.kind)/\(target.providerID)/details", timeout: 35)
            try Task.checkCancellation()
            guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Unable to load details.") }
            detail = response
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
