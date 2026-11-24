import SwiftUI

struct AdultPrivacySettings: View {
    @Bindable var privacy: AdultPrivacy
    let requestPIN: (PINAction) -> Void
    @State private var error: String?
    enum PINAction: String, Identifiable {
        case setup, hide, unlock, change
        var id: String { rawValue }
    }
    var body: some View {
        Section {
            Toggle("Show Adult library", isOn: Binding(get: { !privacy.hidden }, set: { visible in
                error = nil
                if visible { requestPIN(.unlock) }
                else if !privacy.hasPIN { requestPIN(.setup) }
                else { requestPIN(.hide) }
            })).disabled(privacy.storageError != nil)
            if privacy.hasPIN { Button("Change visibility PIN") { requestPIN(.change) }.disabled(privacy.storageError != nil) }
            if let error = privacy.storageError ?? error { Text(error).foregroundStyle(.orange) }
        } header: { Text("Adult visibility") } footer: {
            Text("Hiding removes Adult browsing and history from this app. Showing it again requires your six-digit PIN. Saved for this account on this device; server permissions still apply.")
        }
    }
}

struct PINPrompt: View {
    let privacy: AdultPrivacy
    let action: AdultPrivacySettings.PINAction
    let client: HomesteadClient?
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var pin = ""
    @State private var confirmation = ""
    @State private var error: String?
    @State private var plugins: [PluginLibrary] = []
    @State private var selected: Set<String> = []
    @State private var loadingPlugins = true
    @State private var pluginError: String?
    private var hiding: Bool { action == .setup || action == .hide }
    private var ready: Bool {
        if hiding && (loadingPlugins || pluginError != nil) { return false }
        if action == .hide { return true }
        if action == .unlock { return AdultPIN.valid(current) }
        return AdultPIN.valid(pin) && pin == confirmation && (action != .change || AdultPIN.valid(current))
    }
    var body: some View {
        NavigationStack {
            Form {
                if action != .hide { Section {
                    if action != .setup { SecureField("Current PIN", text: $current).keyboardType(.numberPad) }
                    if action != .unlock {
                        SecureField("New six-digit PIN", text: $pin).keyboardType(.numberPad)
                        SecureField("Confirm new PIN", text: $confirmation).keyboardType(.numberPad)
                    }
                } footer: {
                    if action == .setup { Text("Remember this PIN. Signing out or resetting the app's appearance does not remove it.") }
                } }
                if hiding {
                    Section {
                        if let pluginError {
                            Text(pluginError).foregroundStyle(.orange)
                            Button("Retry") { Task { await loadPlugins() } }
                        }
                        ForEach(plugins) { plugin in
                            Toggle(plugin.title, isOn: Binding(get: { selected.contains(plugin.id) }, set: { hide in
                                if hide { selected.insert(plugin.id) } else { selected.remove(plugin.id) }
                            }))
                        }
                        if !loadingPlugins && pluginError == nil && plugins.isEmpty { Text("No enabled plugin libraries.") }
                    } header: { Text("Also hide these plugins") } footer: {
                        Text("Selected plugins disappear from More and global search with Adult. Unselected plugins stay available. Showing hidden content again requires your PIN.")
                    }
                }
                if let error { Text(error).foregroundStyle(.orange) }
                Button(action == .unlock ? "Show Adult library" : action == .setup ? "Save PIN and hide" : action == .hide ? "Hide selected libraries" : "Save new PIN") {
                    do {
                        switch action {
                        case .setup: try privacy.setPINAndHide(pin, plugins: selected)
                        case .hide: try privacy.hide(plugins: selected)
                        case .unlock: try privacy.unlock(current)
                        case .change: try privacy.changePIN(current: current, new: pin)
                        }
                        current = ""; pin = ""; confirmation = ""; dismiss()
                    } catch { self.error = error.localizedDescription; current = "" }
                }.disabled(!ready)
            }.homesteadLoading(hiding && loadingPlugins, message: "Loading plugins…").homesteadCanvas().navigationTitle(action == .unlock ? "Enter PIN" : "Visibility PIN")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                .onDisappear { current = ""; pin = ""; confirmation = "" }
                .task { if hiding { await loadPlugins() } }
        }
    }
    private func loadPlugins() async {
        loadingPlugins = true; pluginError = nil
        defer { loadingPlugins = false }
        do {
            guard let client else { throw CompanionError.message("Reconnect to load plugins.") }
            let config: IndexValue = try await client.request("api/setup-config")
            if config["subscription"]?["features"]?["plugins"]?.flag == true {
                let response: IndexValue = try await client.request("api/plugins")
                try Task.checkCancellation()
                plugins = PluginLibrary.catalogue(response, hidden: false)
            }
            selected = privacy.hiddenPluginIDs ?? Set(plugins.map(\.id))
        } catch { pluginError = error.localizedDescription }
    }
}

private struct AdultHiddenKey: EnvironmentKey { static let defaultValue = true }
private struct HiddenPluginsKey: EnvironmentKey { static let defaultValue: Set<String>? = nil }
extension EnvironmentValues {
    var hiddenPluginIDs: Set<String>? {
        get { self[HiddenPluginsKey.self] }
        set { self[HiddenPluginsKey.self] = newValue }
    }
    var adultHidden: Bool {
        get { self[AdultHiddenKey.self] }
        set { self[AdultHiddenKey.self] = newValue }
    }
}
