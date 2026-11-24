import SwiftUI

struct NativePetPhotoOrganizer: View {
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    @State private var pets: [FamilyRecord] = []
    @State private var groups: [PetPhotoGroup] = []
    @State private var files: [PetPhotoOriginal] = []
    @State private var selectedPets: Set<String> = []
    @State private var selectedFiles: Set<String> = []
    @State private var groupID = ""
    @State private var mode = "move"
    @State private var query = ""
    @State private var folder = ""
    @State private var operationID = UUID()
    @State private var plan: PetPhotoMove?
    @State private var busy = false
    @State private var ready = false
    @State private var error: String?
    @State private var saved = false
    private var locked: Bool { busy || plan != nil }
    private var group: PetPhotoGroup? { groups.first { $0.id == groupID } }
    private var matching: [PetPhotoOriginal] {
        files.filter { query.isEmpty || ($0.name + " " + $0.path).localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        NavigationStack {
            Form {
                if let error { Section { Text(error).foregroundStyle(.orange); if !ready { Button("Retry") { Task { await load() } } } } }
                Section {
                    Picker("Action", selection: $mode) {
                        Text("Organize existing photos").tag("move")
                        Text("Shared folder membership").tag("group")
                    }
                    Text("One original can appear in several pet galleries. Shared folders never create combined pet profiles.").font(.footnote).foregroundStyle(.secondary)
                }.disabled(locked || !ready)
                if mode == "group" { groupSection }
                petSelection.disabled(locked || !ready)
                if mode == "move" { originalSelection.disabled(locked || !ready) }
                if let plan { review(plan) }
                Section {
                    if saved { Label("Saved. Originals are linked without per-pet copies.", systemImage: "checkmark.circle").font(.footnote) }
                    Button(mode == "group" ? "Save folder membership" : plan == nil ? "Review original moves" : saved ? "Verify saved move" : "Move originals") {
                        Task { await submit() }
                    }.disabled(busy || !ready || (mode == "group" ? groupID.isEmpty : plan == nil && (selectedPets.isEmpty || selectedFiles.isEmpty)))
                }
            }.homesteadCanvas().navigationTitle("Organize pet photos").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(busy) } }
                .task { await load() }
                .onChange(of: groupID) { _, _ in selectedPets = Set(group?.petIds ?? []); saved = false }
                .onChange(of: mode) { _, _ in selectedPets = []; selectedFiles = []; groupID = ""; saved = false }
                .homesteadLoading(busy, message: "Updating pet photos…")
        }.interactiveDismissDisabled(busy || plan != nil && !saved)
    }
    private var groupSection: some View {
        Section {
            Picker("Folder", selection: $groupID) {
                Text("Choose a shared folder").tag("")
                ForEach(groups) { row in Text(row.name + (row.confirmed && row.missingPetIds.isEmpty ? "" : " · Needs confirmation")).tag(row.id) }
            }
            if let group {
                Text("\(group.files.count) photos. Changing membership keeps originals in place.").font(.footnote)
                if !group.unresolved.isEmpty { Text("Confirm names: " + group.unresolved.joined(separator: ", ")).foregroundStyle(.orange) }
                if !group.missingPetIds.isEmpty { Text("Some linked pets are missing. Choose the intended profiles before saving.").foregroundStyle(.orange) }
            }
        }.disabled(busy || !ready)
    }
    private var petSelection: some View {
        Section {
            ForEach(pets) { pet in
                Toggle(pet.title, isOn: Binding(get: { selectedPets.contains(pet.id) }, set: { value in
                    if value { selectedPets.insert(pet.id) } else { selectedPets.remove(pet.id) }; saved = false
                }))
            }
        } header: { Text(mode == "group" ? "Pets in this folder" : "Pets in these photos") }
            footer: { Text(mode == "group" ? "Removing an association does not delete the photo or another pet’s link." : "Select one pet for its Photos folder, or several pets for a Shared Photos folder.") }
    }
    private var originalSelection: some View {
        Section {
            TextField("Optional event/date subfolder", text: $folder)
            TextField("Search photos or folders", text: $query)
            Text("\(selectedFiles.count) selected · \(matching.count) matches").font(.caption)
            ForEach(Array(matching.prefix(120))) { file in
                Button {
                    if selectedFiles.contains(file.path) { selectedFiles.remove(file.path) }
                    else if selectedFiles.count < 100 { selectedFiles.insert(file.path) }
                } label: {
                    HStack {
                        Image(systemName: selectedFiles.contains(file.path) ? "checkmark.circle.fill" : "circle")
                        NativeArtwork(path: file.path, client: client, fit: true).frame(width: 44, height: 44)
                        VStack(alignment: .leading) { Text(file.name).lineLimit(2); Text(file.path).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
                    }
                }.accessibilityAddTraits(selectedFiles.contains(file.path) ? .isSelected : [])
            }
        } header: { Text("Existing originals") } footer: { Text("Choose up to 100 photos. Search to narrow large libraries; the first 120 matches are displayed. New device photos can be imported through Add pet media.") }
    }
    private func review(_ plan: PetPhotoMove) -> some View {
        Section {
            ForEach(plan.items) { item in
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.from).font(.caption)
                    Text("→ " + item.to).font(.caption).foregroundStyle(.secondary)
                    if item.done { Label("Saved", systemImage: "checkmark.circle") }
                }.textSelection(.enabled)
            }
        } header: { Text("Review original moves") } footer: { Text("Move each original once. All selected pets reference the destination. These photos leave their previous folders.") }
    }
    private func load() async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let catalog: IndexValue = try await client.request("api/pets")
            guard catalog["canEdit"]?.flag == true else { throw CompanionError.message("This pet library is read-only.") }
            pets = PetCatalog.records(catalog)
            let shared: PetPhotoGroupsResponse = try await client.request("api/pets/photo-groups", timeout: 45)
            let sources: PetPhotoSourcesResponse = try await client.request("api/pets/photo-sources", timeout: 45)
            guard shared.ok && sources.ok else { throw CompanionError.message("Pet photo folders could not load.") }
            groups = shared.groups; files = sources.files; ready = true
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func submit() async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do {
            if mode == "group" {
                let body = try JSONSerialization.data(withJSONObject: ["petIds": selectedPets.sorted()])
                let result: BasicResponse = try await client.request("api/pets/photo-groups/" + groupID, method: "PUT", body: body)
                guard result.ok else { throw CompanionError.message("Membership was not saved.") }; saved = true
            } else if let plan {
                let result: PetPhotoMoveResponse = try await client.request("api/pets/photo-moves/" + plan.id + "/apply", method: "POST", body: Data("{}".utf8), timeout: 120)
                guard result.ok else { throw CompanionError.message("The move was not confirmed. Retry the same reviewed move.") }
                self.plan = result.plan; saved = true
            } else {
                let body = try JSONSerialization.data(withJSONObject: ["requestId": operationID.uuidString, "petIds": selectedPets.sorted(), "paths": selectedFiles.sorted(), "folder": folder])
                let result: PetPhotoMoveResponse = try await client.request("api/pets/photo-moves", method: "POST", body: body, timeout: 60)
                guard result.ok else { throw CompanionError.message("The move could not be prepared.") }; plan = result.plan
            }
            if saved {
                client.invalidateLibraryIndex()
                NotificationCenter.default.post(name: .homesteadPetChanged, object: client)
                NotificationCenter.default.post(name: Notification.Name("homesteadPhotosRefresh"), object: client)
            }
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
