import SwiftUI
import Combine

struct AdultLibraryView: View {
    let client: HomesteadClient?
    @State private var sections: [AdultSection] = []
    @Binding var selected: AdultSection
    let refreshRevision: Int
    @State private var index: IndexValue?
    @State private var intimateMetadataSections = Set<AdultSection>()
    @State private var busy = false
    @State private var loaded = false
    @State private var error: String?
    @State private var limit = 100
    @State private var viewing: ProfileMediaFile?
    @State private var looseBusy = false
    @State private var looseRevision = UUID()
    @AppStorage("homestead.profilePosterMetadata") private var showPosterMetadata = true
    private var records: [NativeSearchHit] {
        guard sections.contains(selected), let index else { return [] }
        return AdultAccess.records(index: index, section: selected, allowIntimateMetadata: intimateMetadataSections.contains(selected))
    }
    var body: some View {
        NavigationStack {
            ScrollView { VStack(alignment: .leading, spacing: 16) {
                if let error { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load() } } }
                if loaded && sections.isEmpty {
                    ContentUnavailableView("Adult unavailable", systemImage: "lock.shield",
                        description: Text("This library is disabled or your account does not have access."))
                } else if loaded && records.isEmpty {
                    ContentUnavailableView("No items", systemImage: "rectangle.stack",
                        description: Text("No items are available in this sublibrary."))
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 150), spacing: 10)], spacing: 16) {
                ForEach(Array(records.prefix(limit))) { record in
                    if selected == .adultVideos, let file = record.mediaFiles.first {
                        Button { viewing = file } label: {
                            PosterTile(title: record.title, subtitle: record.summary, path: record.posterPath, symbol: "film", client: client)
                        }.buttonStyle(.plain)
                    } else {
                        AdultProfileGridCard(record: record, client: client, loosePhotos: selected == .adultPhotos, showPosterMetadata: $showPosterMetadata)
                    }
                } }
                if records.count > limit { Button("Show more") { limit += 100 } }
            }.padding().frame(maxWidth: 1100).frame(maxWidth: .infinity) }.homesteadCanvas()
                .homesteadLoading(busy || looseBusy, message: "Loading Adult…")
                .toolbar(.hidden, for: .navigationBar)
                .safeAreaInset(edge: .top, spacing: 0) {
                    CompactLibraryHeader(title: "Adult", symbol: "lock.shield") {
                        if !sections.isEmpty {
                            Picker("Adult sublibrary", selection: $selected) {
                                ForEach(sections) { Text($0.title).tag($0) }
                            }.pickerStyle(.menu)
                        }
                    }
                }
                .fullScreenCover(item: $viewing) { file in
                    if let client { NativeMediaViewer(initial: file, files: records.flatMap(\.mediaFiles), client: client) }
                }
                .onChange(of: selected) { _, _ in limit = 100; error = nil }
                .refreshable { await load() }
                .task(id: refreshRevision) { await load() }
                .task(id: selected) { await loadLooseMedia() }
                .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
                    if let sender = notification.object as? HomesteadClient, sender === client, error != nil { Task { await load() } }
                }
                .onReceive(NotificationCenter.default.publisher(for: .homesteadProfileRefreshed)) { notification in
                    guard let sender = notification.object as? HomesteadClient, sender === client, let index,
                          let id = notification.userInfo?["profileId"] as? String,
                          let library = notification.userInfo?["library"] as? String,
                          let profile = notification.userInfo?["profile"] as? IndexValue else { return }
                    self.index = ProfileDetailRecord.applyingToIndex(index, library: library, id: id, profile: profile)
                }
        }
    }
    @MainActor private func loadLooseMedia() async {
        let section = selected
        guard [.adultPhotos, .adultVideos].contains(section), sections.contains(section), let client, index != nil else { return }
        let revision = UUID(); looseRevision = revision; looseBusy = true
        defer { if looseRevision == revision { looseBusy = false } }
        do {
            let response: IndexValue = try await client.request("api/adult/media-folders", query: [URLQueryItem(name: "library", value: section.rawValue)], timeout: 45)
            try Task.checkCancellation()
            guard selected == section, looseRevision == revision, let current = index else { return }
            guard response["ok"]?.flag == true else { throw CompanionError.message("The media folders could not be checked.") }
            index = PhotoLibraryCatalog.mergingFolders(current, library: section.rawValue, folders: response["folders"]?.list ?? [])
        } catch {
            if !Task.isCancelled && looseRevision == revision { self.error = "Some media folders could not refresh. Indexed files remain available. " + error.localizedDescription }
        }
    }
    @MainActor private func load() async {
        guard let client, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            let config: IndexValue = try await client.request("api/setup-config")
            try Task.checkCancellation()
            let allowed = AdultAccess.sections(session: session, config: config)
            sections = allowed
            if !allowed.contains(selected), let first = allowed.first { selected = first }
            intimateMetadataSections = Set(allowed.filter { AdultAccess.intimateMetadataAllowed(session: session, config: config, section: $0) })
            if !allowed.isEmpty {
                let result = try await client.searchIndex()
                try Task.checkCancellation()
                index = result
            } else { index = nil }
            loaded = true
            await loadLooseMedia()
        } catch {
            if !Task.isCancelled {
                // Keep an already-authorized library usable through transient transport failures.
                if !ConnectionRecovery.isTransient(error) { sections = []; intimateMetadataSections = []; index = nil }
                self.error = error.localizedDescription
            }
        }
    }
}

private struct NativeLooseMediaDetails: View {
    let record: NativeSearchHit
    let client: HomesteadClient?
    @State private var viewing: ProfileMediaFile?
    @State private var selectedFolder = MediaFolderCatalog.all
    private var folderRoot: String { MediaFolderCatalog.root(files: record.mediaFiles, hint: record.payload["sourcePath"]?.text ?? record.payload["path"]?.text) }
    private var visibleFiles: [ProfileMediaFile] { MediaFolderCatalog.filter(record.mediaFiles, root: folderRoot, selected: selectedFolder) }
    var body: some View {
        ScrollView {
            MediaFolderTabs(files: record.mediaFiles, rootHint: record.payload["sourcePath"]?.text ?? record.payload["path"]?.text, selected: $selectedFolder).padding(.horizontal)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 160), spacing: 10)], spacing: 14) {
                ForEach(visibleFiles) { file in
                    Button { viewing = file } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            if file.playable { Image(systemName: "play.rectangle").font(.largeTitle).frame(maxWidth: .infinity, minHeight: 100) }
                            else { NativeArtwork(path: file.path, client: client).aspectRatio(1, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 14)) }
                            Text(file.title).font(.caption).lineLimit(2)
                        }
                    }.buttonStyle(.plain)
                }
            }.padding().padding(.bottom, 80)
        }.homesteadCanvas().navigationTitle(record.title).navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .fullScreenCover(item: $viewing) { file in if let client { NativeMediaViewer(initial: file, files: visibleFiles, client: client) } }
    }
}


private struct AdultProfileGridCard: View {
    let record: NativeSearchHit
    let client: HomesteadClient?
    let loosePhotos: Bool
    @Binding var showPosterMetadata: Bool
    private var metadata: [ProfileMetadataItem] {
        ["Panty size", "Bra size", "Age"].compactMap { label in record.profileMetadata.first { $0.label == label } }
    }
    var body: some View {
        ZStack(alignment: .topTrailing) {
            NavigationLink {
                if loosePhotos { NativeLooseMediaDetails(record: record, client: client) }
                else { AdultProfileDetails(record: record, client: client) }
            } label: {
                PosterTile(title: record.title, subtitle: "", path: record.posterPath, symbol: "person.crop.rectangle", client: client,
                           overlayMetadata: showPosterMetadata ? metadata : [])
            }.buttonStyle(.plain)

        }
    }
}
