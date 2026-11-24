import SwiftUI

struct GlobalAddButton: ViewModifier {
    let open: () -> Void
    var visible: Bool
    init(visible: Bool = true, open: @escaping () -> Void) { self.visible = visible; self.open = open }
    @State private var profileAction: ProfileAddAction?
    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
            if visible || profileAction != nil { Button(action: { if let profileAction { profileAction.open() } else { open() } }) {
                Image(systemName: "plus").font(.title2.weight(.semibold))
                    .foregroundStyle(.white).frame(width: 54, height: 54)
                    .modifier(HomesteadAddStyle())
                    .shadow(color: .black.opacity(0.18), radius: 6, y: 3)
            }.accessibilityLabel(profileAction == nil ? "Add to Homestead" : "Add media to profile")
                .padding(.trailing, 18).padding(.vertical, 8) }
        }.onPreferenceChange(ProfileAddActionKey.self) { profileAction = $0 }
    }
}

struct AddHub: View {
    @State private var showPetWizard = false
    @State private var showInventoryWizard = false
    @State private var inventoryAllowed = false
    let client: HomesteadClient
    var familySection: FamilySection? = nil
    var mediaOnly = false
    let search: () -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                if familySection == nil { Section {
                    Button { dismiss(); search() } label: { Label("Find and request media", systemImage: "magnifyingglass") }
                    NavigationLink { RequestQueuePage(client: client) } label: { Label("Requests", systemImage: "arrow.down.circle") }
                } }
                if !mediaOnly && (familySection == nil || familySection == .recipes || familySection == .home) { Section("Recipes") {
                    NavigationLink("Add recipe") { NativeRecipeForm(client: client) }
                    NavigationLink("Add quick instruction") { NativeRecipeForm(client: client, draft: NativeRecipeDraft(quick: true)) }
                    NavigationLink("Create category") { NativeCategoryForm(client: client) }
                } }
                if familySection == nil { Section("Other entries") {
                    if inventoryAllowed { Button("Add Inventory item or Yu-Gi-Oh! card") { showInventoryWizard = true } }
                    NavigationLink("Manual library entry") { NativeIntakeForm(client: client) }
                } }
                if familySection == .pets || familySection == .home {
                    Button("Add pet or pet media") { showPetWizard = true }
                }
                if let familySection, familySection != .recipes && familySection != .home && familySection != .pets {
                    Text("The native \(familySection.title) Add wizard is not available yet.").foregroundStyle(.secondary)
                }
            }.navigationTitle(familySection.map { "Add to " + $0.title } ?? "Add")
                .navigationBarTitleDisplayMode(.inline).homesteadCanvas()
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
                .sheet(isPresented: $showPetWizard, onDismiss: { dismiss() }) { NativePetWizard(client: client) }
                .sheet(isPresented: $showInventoryWizard, onDismiss: { dismiss() }) { NativeInventoryWizard(client: client) }
                .task {
                    guard familySection == nil else { return }
                    do {
                        let config: IndexValue = try await client.request("api/setup-config")
                        let session: IndexValue = try await client.request("api/auth/session")
                        let role = session["user"]?["role"]?.text ?? ""
                        inventoryAllowed = InventoryCatalog.visible(session: session, config: config) &&
                            (session["authEnabled"]?.flag == false || ["owner", "admin"].contains(role)) && session["user"]?["readOnly"]?.flag != true
                    } catch { inventoryAllowed = false }
                }
        }
    }
}
