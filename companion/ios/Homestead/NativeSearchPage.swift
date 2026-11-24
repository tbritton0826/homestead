import SwiftUI
import Observation

private struct NativeSearchScope: Hashable {
    let query: String
    let adultHidden: Bool
    let hiddenPlugins: Set<String>?
}

struct NativeSearchPage: View {
    @Environment(\.adultHidden) private var adultHidden
    @Environment(\.hiddenPluginIDs) private var hiddenPlugins
    let client: HomesteadClient?
    var onClose: (() -> Void)? = nil
    var ownedItems: [MediaItem] = []
    @State private var search = NativeSearchModel()
    @State private var query = ""
    var body: some View {
        NavigationStack {
            List {
                ForEach(search.issues, id: \.self) { Text($0).font(.footnote).foregroundStyle(.orange) }
                ForEach(SearchPresentation.groups(search.hits)) { group in
                Section(group.id) {
                ForEach(group.hits) { hit in
                    NavigationLink {
                        if let recipe = hit.recipe {
                            RecipeDetailView(recipe: recipe, client: client, onSaved: { saved in
                                search.hits = search.hits.map { item in
                                    item.recipe?.id == saved.id ? NativeSearchHit(id: item.id, title: saved.title, source: item.source, summary: saved.description ?? item.summary, recipe: saved, posterPath: saved.image) : item
                                }
                            })
                        } else if let owned = MediaDetailCatalog.ownedItem(hit, items: ownedItems) {
                            MediaDetails(item: owned, client: client)
                        } else {
                            NativeSearchDetails(hit: hit, client: client)
                        }
                    } label: {
                        NativeSearchResultRow(hit: hit, client: client)
                    }
                    .listRowBackground(Color.clear.homesteadPanel(radius: 16))
                    .listRowSeparator(.hidden)
                }
                }
                }
                if !search.loading && search.hits.isEmpty {
                    ContentUnavailableView(query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 ? "Search Homestead" : "No results",
                        systemImage: "magnifyingglass",
                        description: Text("Search your libraries, recipes, and enabled search services."))
                }
            }
            .listStyle(.plain).listRowSpacing(10).homesteadCanvas()
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 8) {
                    HStack {
                        Text("GLOBAL SEARCH").font(.caption).tracking(1.5).foregroundStyle(.secondary)
                        Spacer()
                        if let onClose { Button("Close", action: onClose).buttonStyle(.bordered) }
                    }.padding(.horizontal, 16).padding(.top, 12)
                    LibrarySearchField(text: $query, prompt: "Search Homestead")
                        .padding(.horizontal, 12).padding(.bottom, 8)
                }.background { HomesteadBackdrop() }
            }
            .task(id: NativeSearchScope(query: query, adultHidden: adultHidden, hiddenPlugins: hiddenPlugins)) {
                await search.run(query, client: client, adultHidden: adultHidden, hiddenPlugins: hiddenPlugins, ownedItems: ownedItems)
            }
        }
        .homesteadLoading(search.loading, message: "Searching Homestead…")
    }
}

@MainActor @Observable
private final class NativeSearchModel {
    var hits: [NativeSearchHit] = []
    var issues: [String] = []
    var loading = false
    private var generation = UUID()

    func run(_ input: String, client: HomesteadClient?, adultHidden: Bool, hiddenPlugins: Set<String>?, ownedItems: [MediaItem]) async {
        let token = UUID()
        generation = token
        hits = []; issues = []; loading = false
        let query = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2, let client, !client.isClosed else { return }
        do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
        guard token == generation, !Task.isCancelled else { return }
        loading = true
        defer { if token == generation { loading = false } }
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            let config: IndexValue = try await client.request("api/setup-config")
            try Task.checkCancellation()
            guard token == generation else { return }
            guard session["ok"]?.flag == true,
                  session["authEnabled"]?.flag == false || session["user"] != nil else { throw CompanionError.unauthorized }
            let user = session["user"]
            let owner = user?["role"]?.text == "owner"
            let permissions = user?["allowedLibraries"]?.list.compactMap(\.text) ?? []
            let unrestricted = owner || permissions.contains("*") || session["authEnabled"]?.flag == false
            func allowed(_ library: String) -> Bool {
                if adultHidden && !AdultVisibilityPolicy.safeLibrary(library) { return false }
                let permission = NativeSearchMapping.libraryPermission(library)
                return config["enabledLibraries"]?[permission]?.flag == true && (unrestricted || permissions.contains(permission))
            }
            // Read the account-filtered server index; do not search the phone's browsing snapshot.
            do {
                let index = try await client.searchIndex()
                try Task.checkCancellation()
                guard token == generation else { return }
                let libraries = index["libraries"]?.fields ?? [:]
                var ownedByIdentity: [String: MediaItem] = [:]
                for item in ownedItems {
                    for identity in item.identities { ownedByIdentity[item.category.rawValue + ":" + identity] = item }
                }
                var books = ownedItems.filter { $0.category == .books }
                if books.isEmpty && allowed("books") {
                    let links: IndexValue? = try? await client.request("api/books/edition-links", timeout: 8)
                    let bookRoot = IndexValue.object(["libraries": .object(libraries.filter { ["books", "audiobooks"].contains($0.key) })])
                    books = (try? MediaIndex(root: bookRoot, editionLinks: links?["links"] ?? .object([:])))?.items ?? []
                }
                if allowed("books") {
                    for book in books {
                        var hit = NativeSearchHit(id: book.id, title: book.title, source: "Books", summary: book.overview, mediaFiles: book.files, isBook: true, posterPath: book.poster, bannerPath: book.banner)
                        hit.year = book.year; hit.mediaType = "book"
                        if NativeSearchMapping.matches(hit, query: query) { hits.append(hit) }
                    }
                }
                for (library, collection) in libraries.sorted(by: { $0.key < $1.key }) where allowed(library) {
                    if ["books", "audiobooks"].contains(library) { continue }
                    let rows = collection.fields.isEmpty
                        ? collection.list.enumerated().map { (String($0.offset), $0.element) }
                        : collection.fields.sorted(by: { $0.key < $1.key }).map { ($0.key, $0.value) }
                    let matches = rows.map { row in
                        let category = MediaCategory.allCases.first { $0.aliases.contains(library) }
                        let owned = category.flatMap { ownedByIdentity[$0.rawValue + ":" + (row.1["id"]?.text ?? row.0)] }
                        var fields = row.1.fields
                        if let owned {
                            if let poster = owned.poster { fields["poster"] = .string(poster) }
                            if let banner = owned.banner { fields["banner"] = .string(banner) }
                            if !owned.overview.isEmpty { fields["overview"] = .string(owned.overview) }
                        }
                        var hit = NativeSearchMapping.hit(.object(fields), source: category?.title ?? library.capitalized, fallbackID: row.0)
                        hit.isBook = ["books", "audiobooks"].contains(library)
                        return (hit, row.1)
                    }
                        .filter { NativeSearchMapping.matches($0.0, query: query) }
                        .map { pair in
                            var hit = pair.0
                            hit.mediaFiles = PlaybackCatalog.files(pair.1, includeBooks: hit.isBook)
                            return hit
                        }
                    hits += matches
                }
            } catch { try report(error, source: "Library", token: token) }

            let recipesAllowed = config["enabledLibraries"]?["family"]?.flag == true &&
                (unrestricted || permissions.contains("family") || permissions.contains("recipes"))
            if recipesAllowed && config["familySublibraries"]?["recipes"]?.flag != false {
                do {
                    let response: RecipesResponse = try await client.request("api/recipes")
                    try Task.checkCancellation()
                    guard token == generation else { return }
                    for recipe in response.recipes {
                        let ingredients = (recipe.ingredients ?? []).joined(separator: " ")
                        let description = recipe.description ?? ""
                        let category = recipe.category ?? ""
                        let notes = recipe.notes ?? ""
                        let summary = [category, description, notes, ingredients].joined(separator: " ")
                        let hit = NativeSearchHit(id: "recipe:" + recipe.id, title: recipe.title, source: "Recipes", summary: summary, recipe: recipe, posterPath: recipe.image)
                        if NativeSearchMapping.matches(hit, query: query) { hits.append(hit) }
                    }
                } catch { try report(error, source: "Recipes", token: token) }
            }

            if config["subscription"]?["features"]?["externalIntegrations"]?.flag == true {
                if allowed("movies") || allowed("tvshows") {
                    await remote(client, path: "api/integrations/seerr/search", parameter: "query", query: query, source: "Seerr", token: token) { row in
                        let kind = NativeSearchMapping.text(row, keys: ["mediaType", "media_type"])
                        return kind == "person" || (kind == "movie" && allowed("movies")) || (kind == "tv" && allowed("tvshows"))
                    }
                }
                if allowed("books") || allowed("music") {
                    await remote(client, path: "api/acquisition/search", query: query, source: "Books & music discovery", token: token) {
                        allowed($0["library"]?.text ?? "")
                    }
                }
                if allowed("youtube") {
                    await remote(client, path: "api/youtube/search/channels", query: query, source: "YouTube", token: token)
                }
            }
            try Task.checkCancellation()
            if config["subscription"]?["features"]?["plugins"]?.flag == true {
                do {
                    let preferences: IndexValue = try await client.request("api/account/preferences")
                    let catalogue: IndexValue = try await client.request("api/plugins")
                    for plugin in catalogue["plugins"]?.list ?? [] {
                        guard let id = plugin["id"]?.text,
                              id.range(of: "^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$", options: .regularExpression) != nil,
                              !PluginVisibility.concealed(id, adultHidden: adultHidden, selected: hiddenPlugins),
                              (unrestricted || permissions.contains("plugin:" + id) || (plugin["navigation"]?["section"]?.text == "ai" && permissions.contains("ai"))),
                              plugin["valid"]?.flag == true, plugin["enabled"]?.flag == true,
                              plugin["loaded"]?.flag != false, plugin["hostIntegration"]?["search"]?.flag == true,
                              preferences["preferences"]?["pluginSearch"]?[id]?.flag == true else { continue }
                        await remote(client, path: "api/plugins/\(id)/host/search", query: query, source: plugin["name"]?.text ?? id, token: token)
                    }
                } catch { try report(error, source: "Plugins", token: token) }
            }
            guard token == generation, !Task.isCancelled else { return }
            hits = SearchPresentation.applyStatuses(client.requestSnapshot, to: NativeSearchMapping.unique(hits))
            if !hits.isEmpty, let statuses: IndexValue = try? await client.request("api/requests/status", timeout: 8),
               statuses["ok"]?.flag == true, token == generation, !Task.isCancelled {
                client.requestSnapshot = statuses["rows"]?.list ?? []
                hits = SearchPresentation.applyStatuses(client.requestSnapshot, to: hits)
            }
        } catch {
            if token == generation && !Task.isCancelled {
                if case CompanionError.unauthorized = error { hits = [] }
                issues.append(error.localizedDescription)
            }
        }
    }

    private func report(_ error: Error, source: String, token: UUID) throws {
        try Task.checkCancellation()
        guard token == generation else { throw CancellationError() }
        if case CompanionError.unauthorized = error { throw error }
        issues.append(source + ": " + error.localizedDescription)
    }

    private func remote(_ client: HomesteadClient, path: String, parameter: String = "q", query: String,
                        source: String, token: UUID, filter: (IndexValue) -> Bool = { _ in true }) async {
        guard token == generation, !Task.isCancelled else { return }
        do {
            let response: IndexValue = try await client.request(path, query: [URLQueryItem(name: parameter, value: query)])
            try Task.checkCancellation()
            guard token == generation else { return }
            if response["ok"]?.flag == false { throw CompanionError.message(response["message"]?.text ?? "Search failed") }
            let rows = response["results"]?.list ?? []
            let mapped = rows.enumerated().filter { filter($0.element) }.map {
                NativeSearchMapping.hit($0.element, source: source, fallbackID: String($0.offset))
            }
            hits = NativeSearchMapping.unique(hits + mapped)
        } catch {
            if token == generation && !Task.isCancelled { issues.append(source + ": " + error.localizedDescription) }
        }
    }
}
