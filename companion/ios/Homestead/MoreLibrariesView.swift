import SwiftUI

private struct GlobalSearchActionKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}
extension EnvironmentValues {
    var openGlobalSearch: () -> Void {
        get { self[GlobalSearchActionKey.self] }
        set { self[GlobalSearchActionKey.self] = newValue }
    }
}

struct MoreLibrariesView: View {
    @Bindable var model: CompanionModel
    let openSettings: () -> Void
    @State private var plugins: [PluginLibrary] = []
    @State private var loading = false
    @State private var inventoryVisible = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            List {
                Section("Libraries") {
                    if inventoryVisible, let client = model.client {
                        NavigationLink { NativeInventoryPage(client: client) } label: { Label("Inventory", systemImage: "shippingbox") }
                    }
                    NavigationLink { SharedCollectionsView(client: model.client) } label: {
                        Label("Shared Collections", systemImage: "rectangle.stack")
                    }
                    ForEach(plugins) { plugin in
                        if let client = model.client {
                            NavigationLink { PluginLibraryView(plugin: plugin, client: client) } label: {
                                Label(plugin.title, systemImage: "puzzlepiece.extension")
                            }
                        }
                    }
                    if let error { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load() } } }
                    if model.adultPrivacy.hidden {
                        Text("Selected plugin libraries are hidden while Adult visibility is locked.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section { Button(action: openSettings) { Label("Settings", systemImage: "gearshape") } }
            }
            .navigationTitle("More").navigationBarTitleDisplayMode(.inline)
            .homesteadCanvas().task { await load() }.refreshable { await load() }
        }
        .homesteadLoading(loading, message: "Loading libraries…")
    }
    private func load() async {
        plugins = []; error = nil; inventoryVisible = false
        guard let client = model.client else { return }
        loading = true
        defer { loading = false }
        do {
            let config: IndexValue = try await client.request("api/setup-config")
            let session: IndexValue = try await client.request("api/auth/session")
            inventoryVisible = InventoryCatalog.visible(session: session, config: config)
            guard config["subscription"]?["features"]?["plugins"]?.flag == true else { return }
            let catalogue: IndexValue = try await client.request("api/plugins")
            try Task.checkCancellation()
            let user = session["user"]
            let permissions = user?["allowedLibraries"]?.list.compactMap(\.text) ?? []
            let unrestricted = user?["role"]?.text == "owner" || permissions.contains("*") || session["authEnabled"]?.flag == false
            plugins = PluginLibrary.catalogue(catalogue, hidden: false).filter {
                guard !PluginVisibility.concealed($0.id, adultHidden: model.adultPrivacy.hidden, selected: model.adultPrivacy.hiddenPluginIDs) else { return false }
                let allowed = unrestricted || permissions.contains($0.permission)
                let adultPlugin = ["panty-archive", "dominion"].contains($0.id)
                return allowed && (!adultPlugin || !AdultAccess.sections(session: session, config: config).isEmpty)
            }
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
}

struct PluginLibraryView: View {
    let plugin: PluginLibrary
    let client: HomesteadClient
    @Environment(\.adultHidden) private var hidden
    @Environment(\.hiddenPluginIDs) private var hiddenPlugins
    var body: some View {
        Group {
            if PluginVisibility.concealed(plugin.id, adultHidden: hidden, selected: hiddenPlugins) {
                ContentUnavailableView("Library hidden", systemImage: "lock")
            } else if plugin.id == "homestead-ai-assistant" {
                NativeAIView(plugin: plugin, client: client)
            } else {
                ContentUnavailableView("Native adapter required", systemImage: "puzzlepiece.extension", description: Text("This plugin has no native iOS screen yet."))
            }
        }.homesteadCanvas()
    }
}
