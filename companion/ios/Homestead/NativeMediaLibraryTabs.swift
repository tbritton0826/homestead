import SwiftUI
import Combine

private extension Notification.Name {
    static let homesteadCollectionsChanged = Notification.Name("homesteadCollectionsChanged")
}

private struct LibraryCollectionTarget: Identifiable {
    let id: String
    let row: IndexValue?
}

@MainActor
struct NativeMediaLibraryTabs: View {
    let client: HomesteadClient
    let category: MediaCategory
    @State private var tab: MediaLibraryTab = .songs
    @State private var snapshot = LibraryBrowseSnapshot()
    @State private var custom: [IndexValue] = []
    @State private var canEdit = false
    @State private var loading = false
    @State private var error: String?
    @State private var query = ""
    @State private var limit = 100
    @State private var viewing: ProfileMediaFile?
    @State private var playback: [ProfileMediaFile] = []
    @State private var editor: LibraryCollectionTarget?
    private var available: [LibraryPlayable] { snapshot.files.filter { category == .music ? $0.file.audio : $0.file.video } }
    private var visibleFiles: [LibraryPlayable] {
        snapshot.files.filter { (tab == .musicVideos ? $0.file.video : $0.file.audio) && (query.isEmpty || ($0.file.title + " " + $0.subtitle).localizedCaseInsensitiveContains(query)) }
    }
    private var groups: [LibraryBrowseGroup] {
        var result: [LibraryBrowseGroup]
        switch tab {
        case .artists, .creators: result = snapshot.people
        case .albums: result = snapshot.albums
        case .series: result = snapshot.series
        case .playlists: result = snapshot.playlists
        default: result = []
        }
        result += LibraryBrowseCatalog.custom(custom, category: category, tab: tab, files: available)
        return result.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(MediaLibraryTab.tabs(category)) { item in
                        Button(item.title) { tab = item; limit = 100 }.buttonStyle(.bordered).tint(tab == item ? Color.accentColor : Color.secondary)
                    }
                }
            }
            TextField("Search " + tab.title.lowercased(), text: $query).textFieldStyle(.roundedBorder)

            if let error { Text(error).foregroundStyle(.orange) }
            HStack {
                Button("Refresh") { Task { await load(force: true) } }.disabled(loading)
                Spacer()
                if canEdit && tab.manual { Button("Create " + (tab == .series ? "series" : tab == .playlists ? "playlist" : "collection")) { editor = LibraryCollectionTarget(id: UUID().uuidString, row: nil) } }
            }
            if tab == .songs || tab == .musicVideos { tracks }
            else { groupGrid }
        }.task(id: category) { tab = category == .music ? .songs : .creators; query = ""; await load(force: false) }
            .onChange(of: query) { _, _ in limit = 100 }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadCollectionsChanged)) { notice in
                if let sender = notice.object as? HomesteadClient, sender === client { Task { await load(force: false) } }
            }
            .fullScreenCover(item: $viewing) { file in NativeMediaViewer(initial: file, files: playback, client: client, artwork: snapshot.files.first { $0.id == file.id }?.poster) }
            .sheet(item: $editor) { target in
                NativeLibraryCollectionEditor(client: client, category: category, tab: tab, files: available, current: target.row) { _ in Task { await load(force: false) } }
            }
        .homesteadLoading(loading && snapshot.files.isEmpty, message: "Loading library…")
    }
    private var tracks: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(visibleFiles.count) " + tab.title.lowercased()).font(.caption).foregroundStyle(.secondary)
            if tab == .songs && !visibleFiles.isEmpty {
                Button { playback = visibleFiles.map(\.file).shuffled(); viewing = playback.first } label: { Label("Shuffle All", systemImage: "shuffle") }
            }
            ForEach(Array(visibleFiles.prefix(limit))) { item in
                Button { playback = visibleFiles.map(\.file); viewing = item.file } label: { NativeLibraryTrackRow(item: item, client: client) }.buttonStyle(.plain)
            }
            if visibleFiles.count > limit { Button("Show more") { limit += 100 } }
            if visibleFiles.isEmpty && !loading { Text("No " + tab.title.lowercased() + " available in this library.").foregroundStyle(.secondary) }
        }
    }
    private var groupGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12)], spacing: 18) {
            ForEach(groups) { group in
                NavigationLink {
                    NativeLibraryGroupDetail(group: group, client: client, canEdit: canEdit, allFiles: available, category: category, tab: tab)
                } label: { PosterTile(title: group.title, subtitle: "\(group.files.count) items", path: group.poster, symbol: category.symbol, client: client) }.buttonStyle(.plain)
            }
            if groups.isEmpty && !loading { Text("No " + tab.title.lowercased() + " yet.").foregroundStyle(.secondary) }
        }
    }
    private func load(force: Bool) async {
        loading = true; error = nil
        defer { loading = false }
        do {
            var index = try await client.searchIndex(force: force)
            if category == .youtube {
                let youtube: IndexValue = try await client.request("youtube-index.json", timeout: 60)
                index = .object(["youtube": youtube["creators"] ?? .object([:])])
            }
            try Task.checkCancellation(); snapshot = LibraryBrowseCatalog.build(index: index, category: category)
            async let saved: IndexValue = client.request("api/collections/custom")
            async let session: IndexValue = client.request("api/auth/session")
            let (result, account) = try await (saved, session)
            try Task.checkCancellation()
            custom = result["collections"]?.list ?? []
            let user = account["user"]
            canEdit = account["ok"]?.flag == true && (account["authEnabled"]?.flag == false || ["owner", "admin"].contains(user?["role"]?.text ?? "")) && user?["readOnly"]?.flag != true
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

@MainActor
private struct NativeLibraryTrackRow: View {
    let item: LibraryPlayable
    let client: HomesteadClient
    var body: some View {
        HStack(spacing: 12) {
            NativeArtwork(path: item.poster, client: client, symbol: item.file.video ? "play.rectangle" : "music.note").frame(width: 55, height: 55).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.file.title).font(.headline).lineLimit(2)
                Text(item.subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(); Image(systemName: "play.circle")
        }.padding(10).homesteadPanel(radius: 12)
    }
}

@MainActor
private struct NativeLibraryGroupDetail: View {
    @Environment(\.dismiss) private var dismiss
    let group: LibraryBrowseGroup
    let client: HomesteadClient
    let canEdit: Bool
    let allFiles: [LibraryPlayable]
    let category: MediaCategory
    let tab: MediaLibraryTab
    @State private var current: LibraryBrowseGroup?
    @State private var viewing: ProfileMediaFile?
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var error: String?
    private var shown: LibraryBrowseGroup { current ?? group }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("\(shown.files.count) items").font(.caption)
                if let error { Text(error).foregroundStyle(.orange) }
                if category == .youtube && shown.saved == nil {
                    YouTubeEpisodeBrowser(files: shown.files, client: client) { viewing = $0 }
                } else {
                    ForEach(shown.files) { item in
                        Button { viewing = item.file } label: { NativeLibraryTrackRow(item: item, client: client) }.buttonStyle(.plain)
                    }
                }
                if shown.files.isEmpty { Text("No available items. Edit this group to add media from your library.").foregroundStyle(.secondary) }
            }.padding()
        }.homesteadCanvas().navigationTitle(shown.title).navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
            .toolbar {
                if canEdit && shown.saved != nil {
                    Button("Edit") { editing = true }.disabled(deleting)
                    Button("Delete", role: .destructive) { confirmingDelete = true }.disabled(deleting)
                }
            }
            .confirmationDialog("Delete this saved group? Media files stay in your library.", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete group", role: .destructive) { Task { await remove() } }
            }
            .fullScreenCover(item: $viewing) { file in NativeMediaViewer(initial: file, files: shown.files.map(\.file), client: client, mediaTitle: shown.title, artwork: shown.files.first { $0.id == file.id }?.poster ?? shown.poster) }
            .sheet(isPresented: $editing) {
                NativeLibraryCollectionEditor(client: client, category: category, tab: tab, files: allFiles, current: shown.saved) { row in
                    current = LibraryBrowseCatalog.custom([row], category: category, tab: tab, files: allFiles).first
                }
            }
    }
    private func remove() async {
        guard !deleting, let id = shown.saved?["id"]?.text else { return }
        deleting = true; defer { deleting = false }
        do {
            let response: IndexValue = try await client.request("api/collections/custom/" + id, method: "DELETE")
            guard response["ok"]?.flag == true else { throw CompanionError.message("The group could not be deleted.") }
            NotificationCenter.default.post(name: .homesteadCollectionsChanged, object: client)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

@MainActor
private struct NativeLibraryCollectionEditor: View {
    let client: HomesteadClient
    let category: MediaCategory
    let tab: MediaLibraryTab
    let files: [LibraryPlayable]
    let current: IndexValue?
    let saved: (IndexValue) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var query = ""
    @State private var selected: [String] = []
    @State private var stage = 0
    @State private var busy = false
    @State private var error: String?
    @State private var identity = UUID().uuidString
    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.orange) }
                if stage == 0 {
                    Section("Details") { TextField("Name", text: $name); TextField("Description", text: $description, axis: .vertical) }
                    Section("Choose media · \(selected.count) selected") {
                        TextField("Search available media", text: $query)
                        ForEach(Array(files.filter { query.isEmpty || ($0.file.title + " " + $0.subtitle).localizedCaseInsensitiveContains(query) }.prefix(200))) { item in
                            Toggle(isOn: Binding(get: { selected.contains(item.id) }, set: { value in
                                if value { if !selected.contains(item.id) { selected.append(item.id) } }
                                else { selected.removeAll { $0 == item.id } }
                            })) { VStack(alignment: .leading) { Text(item.file.title); Text(item.subtitle).font(.caption).foregroundStyle(.secondary) } }
                        }
                        Text("Search to narrow large libraries. Selections keep their chosen order.").font(.caption)
                    }
                } else {
                    Section("Review " + name) {
                        ForEach(Array(selected.enumerated()), id: \.element) { index, id in
                            HStack {
                                Text(files.first { $0.id == id }?.file.title ?? "Unavailable item")
                                Spacer()
                                Button(role: .destructive) { selected.removeAll { $0 == id } } label: { Image(systemName: "trash") }.accessibilityLabel("Remove from group")
                                Button { selected.swapAt(index, index - 1) } label: { Image(systemName: "arrow.up") }.disabled(index == 0)
                                Button { selected.swapAt(index, index + 1) } label: { Image(systemName: "arrow.down") }.disabled(index + 1 >= selected.count)
                            }.buttonStyle(.borderless)
                        }
                    }
                }
                Section {
                    HStack {
                        if stage == 1 { Button("Back") { stage = 0 } }
                        Spacer()
                        Button(stage == 0 ? "Review" : "Save") { if stage == 0 { stage = 1 } else { Task { await save() } } }
                            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }.buttonStyle(.borderless)
                }
            }.disabled(busy).homesteadCanvas().navigationTitle(current == nil ? "Create " + tab.title : "Edit " + tab.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
                .interactiveDismissDisabled(busy)
                .onAppear {
                    name = current?["name"]?.text ?? ""; description = current?["description"]?.text ?? ""
                    selected = (current?["items"]?.list ?? []).compactMap { $0["sourceId"]?.text }
                    identity = current?["id"]?.text ?? identity
                }
        }
    }
    private func save() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let items: [[String: Any]] = selected.enumerated().compactMap { index, id in
                guard let item = files.first(where: { $0.id == id }) else {
                    guard let existing = current?["items"]?.list.first(where: { $0["sourceId"]?.text == id }), var fields = existing.inventoryJSON as? [String: Any] else { return nil }
                    fields["order"] = index + 1; return fields
                }
                return ["library": category.rawValue, "sourceId": id, "sourcePath": item.file.path, "title": item.file.title, "order": index + 1]
            }
            var payload = current?.inventoryJSON as? [String: Any] ?? [:]
            payload["id"] = identity; payload["name"] = name; payload["description"] = description
            payload["library"] = category.rawValue; payload["libraryTab"] = tab.rawValue; payload["items"] = items
            let body = try JSONSerialization.data(withJSONObject: payload)
            let result: IndexValue = try await client.request("api/collections/custom", method: "POST", body: body)
            guard result["ok"]?.flag == true, let row = result["collection"] else { throw CompanionError.message("The group could not be saved.") }
            saved(row)
            NotificationCenter.default.post(name: .homesteadCollectionsChanged, object: client)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

private struct YouTubeEpisodeBrowser: View {
    let files: [LibraryPlayable]
    let client: HomesteadClient
    let play: (ProfileMediaFile) -> Void
    @State private var selectedSeries: String?
    @State private var selectedSeason: String?
    private var series: [String] { Array(Set(files.map { $0.seriesName.isEmpty ? "Other Videos" : $0.seriesName })).sorted { $0.localizedStandardCompare($1) == .orderedAscending } }
    private var activeSeries: String { selectedSeries.flatMap { series.contains($0) ? $0 : nil } ?? series.first ?? "Other Videos" }
    private var seriesFiles: [LibraryPlayable] { files.filter { ($0.seriesName.isEmpty ? "Other Videos" : $0.seriesName) == activeSeries } }
    private var seasons: [String] { Array(Set(seriesFiles.map { $0.seasonName.isEmpty ? "Unsorted" : $0.seasonName })).sorted { $0.localizedStandardCompare($1) == .orderedAscending } }
    private var activeSeason: String { selectedSeason.flatMap { seasons.contains($0) ? $0 : nil } ?? seasons.first ?? "Unsorted" }
    private var visible: [LibraryPlayable] { seriesFiles.filter { ($0.seasonName.isEmpty ? "Unsorted" : $0.seasonName) == activeSeason } }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Series").font(.headline)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(series, id: \.self) { name in
                        Button { selectedSeries = name; selectedSeason = nil } label: {
                            VStack(spacing: 4) { Text(name).font(.subheadline); Text("\(files.filter { ($0.seriesName.isEmpty ? "Other Videos" : $0.seriesName) == name }.count) videos").font(.caption2.monospacedDigit()) }
                        }.buttonStyle(.plain).homesteadLibraryPill(selected: activeSeries == name)
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(seasons, id: \.self) { name in
                        Button { selectedSeason = name } label: {
                            VStack(spacing: 4) { Text(name).font(.subheadline); Text("\(seriesFiles.filter { ($0.seasonName.isEmpty ? "Unsorted" : $0.seasonName) == name }.count) available").font(.caption2.monospacedDigit()) }
                        }.buttonStyle(.plain).homesteadLibraryPill(selected: activeSeason == name)
                    }
                }
            }
            ForEach(visible) { item in
                Button { play(item.file) } label: { NativeLibraryTrackRow(item: item, client: client) }.buttonStyle(.plain)
            }
        }
    }
}
