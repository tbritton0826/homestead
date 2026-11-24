import SwiftUI

struct SharedCollectionsView: View {
    let client: HomesteadClient?
    @State private var collections: [SharedMediaCollection] = []
    @State private var availableMedia: [MediaItem] = []
    @State private var loading = false
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 150), spacing: 10)], alignment: .leading, spacing: 16) {
                    ForEach(collections) { collection in
                        NavigationLink {
                            SharedCollectionDetails(collection: collection, media: availableMedia, client: client)
                        } label: {
                            PosterTile(title: collection.title, subtitle: "\(collection.items.count) items", path: collection.poster, symbol: "rectangle.stack", client: client)
                        }.buttonStyle(.plain)
                    }
                }
                if !loading && error == nil && collections.isEmpty {
                    ContentUnavailableView("No collections available", systemImage: "rectangle.stack", description: Text("Collections containing media available to your account appear here."))
                }
            }.padding().padding(.bottom, 70)
        }.homesteadCanvas().navigationTitle("Shared Collections").navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .task { await load() }.refreshable { await load() }
            .navigationDestination(for: MediaItem.self) { MediaDetails(item: $0, client: client) }
        .homesteadLoading(loading, message: "Loading collections…")
    }
    @MainActor private func load() async {
        guard let client, !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            async let index = client.mediaIndex()
            async let custom: IndexValue = client.request("api/collections/custom")
            async let orders: IndexValue = client.request("api/collections/order-overrides")
            async let appearances: IndexValue = client.request("api/collections/appearance-overrides")
            let (media, saved, order, appearance) = try await (index, custom, orders, appearances)
            try Task.checkCancellation()
            guard !client.isClosed else { return }
            guard saved["ok"]?.flag == true, order["ok"]?.flag == true, appearance["ok"]?.flag == true else {
                throw CompanionError.message("Collections could not be loaded. Please try again.")
            }
            let seedsURL = Bundle.main.url(forResource: "shared-collection-presets", withExtension: "json")
            let seeds = try seedsURL.map { try JSONDecoder().decode([IndexValue].self, from: Data(contentsOf: $0)) } ?? []
            collections = SharedCollectionCatalog.build(media: media.items, custom: saved["collections"]?.list ?? [], seeds: seeds, orders: order["overrides"]?.list ?? [], appearances: appearance["overrides"]?.list ?? [])
            availableMedia = media.items
        } catch {
            if !Task.isCancelled { collections = []; self.error = error.localizedDescription }
        }
    }
}

private struct SharedCollectionDetails: View {
    let collection: SharedMediaCollection
    let media: [MediaItem]
    let client: HomesteadClient?
    @State private var showingOrder = true
    @State private var order: CollectionWatchOrder?
    @State private var loadingOrder = false
    @State private var checkedOrder = false
    @State private var orderError: String?
    @State private var visibleRows = 100
    @State private var playing: ProfileMediaFile?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let banner = collection.banner {
                    ProfileImage(path: banner, client: client).frame(height: 180).frame(maxWidth: .infinity)
                        .clipped().clipShape(RoundedRectangle(cornerRadius: 18))
                }
                if !collection.summary.isEmpty { Text(collection.summary).foregroundStyle(.secondary) }
                Picker("Collection view", selection: $showingOrder) {
                    Text("Watch Order").tag(true)
                    Text("Titles (\(collection.items.count))").tag(false)
                }.pickerStyle(.segmented)
                if showingOrder {
                    watchOrder
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 150), spacing: 10)], alignment: .leading, spacing: 16) {
                        ForEach(collection.items) { item in
                            NavigationLink(value: item) { MediaPoster(item: item, client: client) }.buttonStyle(.plain)
                        }
                    }
                }
            }.padding().padding(.bottom, 70)
        }.homesteadCanvas().navigationTitle(collection.title).navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .task(id: collection.serverID) { await loadOrder() }
            .refreshable { await loadOrder() }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
                if let sender = notification.object as? HomesteadClient, sender === client, orderError != nil {
                    Task { await loadOrder() }
                }
            }
            .fullScreenCover(item: $playing) { file in
                if let client { NativeMediaViewer(initial: file, files: [file], client: client) }
            }
    }

    @ViewBuilder private var watchOrder: some View {
        if loadingOrder || !checkedOrder { ProgressView("Loading watch order…") }
        if let orderError {
            Text(orderError).foregroundStyle(.secondary)
            Button("Retry watch order") { Task { await loadOrder() } }
        }
        if let order {
            Text(order.title).font(.title3.bold())
            Text("\(order.count) order entries · \(collection.items.count) titles").font(.subheadline).foregroundStyle(.secondary)
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(order.sections) { section in
                    let rows = section.rows.filter { $0.number <= visibleRows }
                    if !rows.isEmpty {
                        Text(section.title).font(.headline)
                        ForEach(rows) { row in
                            CollectionOrderEntry(row: row, client: client) { playing = $0 }
                        }
                    }
                }
            }
            if order.count > visibleRows {
                Button("Show next 100") { visibleRows += 100 }.buttonStyle(.bordered).frame(maxWidth: .infinity)
            }
            if order.count == 0 { Text("The saved watch order has no entries yet.").foregroundStyle(.secondary) }
        } else if checkedOrder && !loadingOrder && orderError == nil {
            ContentUnavailableView("No saved watch order", systemImage: "list.number", description: Text("Create or import a watch order in this collection on your Homestead server. Its titles are available in the Titles tab."))
        }
    }

    @MainActor private func loadOrder() async {
        guard let client else { checkedOrder = true; orderError = "Connect to your server to load the watch order."; return }
        guard !loadingOrder else { return }
        loadingOrder = true; orderError = nil
        defer { loadingOrder = false; checkedOrder = true }
        do {
            let id = collection.serverID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? ""
            guard !id.isEmpty else { throw CompanionError.message("This collection has no saved identity.") }
            let response: IndexValue = try await client.request("api/collections/watch-order/" + id)
            guard response["ok"]?.flag == true else { throw CompanionError.message("The watch order could not be loaded.") }
            try Task.checkCancellation()
            guard !client.isClosed else { return }
            order = CollectionWatchOrder.decode(response["order"], media: media)
            visibleRows = 100
        } catch {
            if !Task.isCancelled { orderError = error.localizedDescription }
        }
    }
}

private struct CollectionOrderEntry: View {
    let row: CollectionOrderRow
    let client: HomesteadClient?
    let play: (ProfileMediaFile) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(row.number)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(minWidth: 22)
                VStack(alignment: .leading, spacing: 5) {
                    Text(row.title).font(.headline)
                    Text(row.detail).font(.subheadline).foregroundStyle(.secondary)
                    if !row.date.isEmpty { Text(row.date).font(.caption).foregroundStyle(.secondary) }
                    if row.item == nil { Text("Not available in your library").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }
            if row.episodes.count == 1, let episode = row.episodes.first {
                episodeAction(episode)
            } else if !row.episodes.isEmpty {
                DisclosureGroup("Episodes (\(row.episodes.count))") {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(row.episodes) { episode in episodeAction(episode) }
                    }.padding(.top, 8)
                }
            } else if row.canBrowseTitle, let item = row.item {
                NavigationLink(value: item) { Label("Open title", systemImage: "chevron.right") }.frame(minHeight: 44)
            }
        }.padding(14).homesteadPanel(radius: 16)
    }

    @ViewBuilder private func episodeAction(_ episode: CollectionOrderEpisode) -> some View {
        if let file = episode.file {
            Button { play(file) } label: {
                Label(episode.label, systemImage: "play.circle.fill").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }.buttonStyle(.plain).disabled(client == nil)
        } else {
            Text("\(episode.label) · Not available").font(.subheadline).foregroundStyle(.secondary).frame(minHeight: 44)
        }
    }
}
