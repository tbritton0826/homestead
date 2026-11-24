import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import Combine

struct NativePetsPage: View {
    let client: HomesteadClient
    @State private var records: [FamilyRecord] = []
    @State private var organizing = false
    @State private var canEdit = false
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load() } } }
                    if records.isEmpty && !busy && error == nil { Text("No pets yet. Use + to create a pet profile.").foregroundStyle(.secondary) }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 14)], spacing: 16) {
                        ForEach(records) { pet in
                            NavigationLink {
                                NativePetDetails(record: pet, client: client, canEdit: canEdit)
                            } label: {
                                PosterTile(title: pet.title, subtitle: pet.subtitle, path: pet.poster, symbol: "pawprint", client: client)
                            }.buttonStyle(.plain)
                        }
                    }
                }.padding()
            }.homesteadCanvas().navigationTitle("Pets").navigationBarTitleDisplayMode(.inline)
                .toolbar { if canEdit { Button("Organize photos") { organizing = true } } }
                .sheet(isPresented: $organizing, onDismiss: { Task { await load() } }) { NativePetPhotoOrganizer(client: client) }
                .task { await load() }.refreshable { await load() }
                .onReceive(NotificationCenter.default.publisher(for: .homesteadPetChanged)) { notification in
                    if let sender = notification.object as? HomesteadClient, sender === client { Task { await load() } }
                }
        }
        .homesteadLoading(busy, message: "Loading pets…")
    }
    private func load() async {
        guard !busy else { return }; busy = true; error = nil; canEdit = false
        defer { busy = false }
        do {
            guard let response = try await client.petProfilesIfAvailable() else {
                let index = try await client.searchIndex()
                try Task.checkCancellation()
                records = FamilyCatalog.records(index, library: "pets"); canEdit = false
                error = "Existing pets are available. Creating pets and adding media requires the v3.7 server support."
                return
            }
            try Task.checkCancellation()
            guard response["ok"]?.flag == true else { throw CompanionError.message("Pet profiles could not load. Install the v3.7 server support.") }
            records = PetCatalog.records(response); canEdit = response["canEdit"]?.flag == true
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct NativePetDetails: View {
    let record: FamilyRecord
    let client: HomesteadClient
    let canEdit: Bool
    @State private var fresh: FamilyRecord?
    @State private var showAdd = false
    @State private var active = false
    @State private var refreshError: String?
    private var pet: FamilyRecord { fresh ?? record }
    var body: some View {
        NativeFamilyRecordDetails(record: pet, client: client)
            .safeAreaInset(edge: .top) {
                if let refreshError {
                    HStack { Text(refreshError).font(.caption); Button("Retry") { Task { await reload() } } }.padding(12).homesteadPanel(radius: 14)
                }
            }
            .preference(key: ProfileAddActionKey.self, value: active && canEdit ? ProfileAddAction(id: pet.id, open: { showAdd = true }) : nil)
            .toolbar {
                if canEdit { Button { showAdd = true } label: { Image(systemName: "plus").frame(minWidth: 44, minHeight: 44) }.accessibilityLabel("Add pet media") }
            }
            .onAppear { active = true }.onDisappear { active = false }
            .sheet(isPresented: $showAdd, onDismiss: { Task { await reload() } }) { NativePetWizard(client: client, initialPet: pet) }
    }
    private func reload() async {
        do {
            let response: IndexValue = try await client.request("api/pets/" + record.id)
            guard response["ok"]?.flag == true, let row = response["record"] else { throw CompanionError.message("The pet could not refresh.") }
            fresh = PetCatalog.records(.object(["records": .array([row])])).first; refreshError = nil
        } catch { if !Task.isCancelled { refreshError = "Media may already be saved. The pet could not refresh; retry without resending files." } }
    }
}

struct NativePetWizard: View {
    let client: HomesteadClient
    var initialPet: FamilyRecord? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var records: [FamilyRecord] = []
    @State private var selection = ""
    @State private var target: FamilyRecord?
    @State private var fields: [String: String] = [:]
    @State private var allowed = false
    @State private var busy = false
    @State private var error: String?
    @State private var kind = "photos"
    @State private var folder = ""
    @State private var folders: [ProfileFolderOption] = []
    @State private var newFolder = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var showDocuments = false
    @State private var queue = ProfileMediaQueue()
    @State private var creationID = UUID()
    @State private var destinationLocked = false
    @State private var additionalPets: Set<String> = []
    private var working: Bool { busy || queue.uploading || queue.preparing }
    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.orange); Button("Reload pet access") { Task { await load() } } }
                if !allowed { Text("Loading pet editing access, or this library is read-only.").foregroundStyle(.secondary) }
                if let target { uploadSections(target).disabled(!allowed) }
                else { profileSections.disabled(!allowed) }
            }.disabled(working).homesteadCanvas().navigationTitle(target == nil ? "Add pet" : "Add pet media")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(working) } }
                .task { await load() }
                .onChange(of: photos) { _, values in Task { await queue.add(values); photos = [] } }
                .onChange(of: kind) { _, _ in folder = ""; folders = []; Task { await loadFolders() } }
                .fileImporter(isPresented: $showDocuments, allowedContentTypes: [.data]) { result in
                    do { try queue.addPetDocument(result.get()) } catch { self.error = error.localizedDescription }
                }
                .overlay { if working { HomesteadLoadingCard(message: queue.uploading ? "Saved \(queue.items.filter { $0.uploaded }.count) of \(queue.items.count) files…" : "Preparing…") } }
        }.interactiveDismissDisabled(working)
            .onDisappear { if target != nil { NotificationCenter.default.post(name: .homesteadPetChanged, object: client) } }
    }
    private var profileSections: some View {
        Group {
            Section {
                Picker("Pet", selection: $selection) {
                    Text("Create a new pet").tag("")
                    ForEach(records) { Text($0.title).tag($0.id) }
                }
                if !selection.isEmpty { Button("Add media to selected pet") { target = records.first { $0.id == selection }; Task { await loadFolders() } } }
            }
            if selection.isEmpty {
                Section {
                    ForEach(PetCatalog.fields, id: \.self) { key in
                        TextField(key == "birthday" ? "Birthday (YYYY-MM-DD)" : key.capitalized,
                            text: Binding(get: { fields[key] ?? "" }, set: { fields[key] = $0 }))
                    }
                    Button("Create pet and continue") { Task { await create() } }
                } header: { Text("Pet details") } footer: { Text("Poster, banner, photos, videos, and documents can be added after creating the profile.") }
            }
        }
    }
    private func uploadSections(_ pet: FamilyRecord) -> some View {
        Group {
            Section {
                Text(pet.title).font(.headline)
                Picker("Add", selection: $kind) {
                    ForEach(["photos", "videos", "documents", "poster", "banner"], id: \.self) { Text($0.capitalized).tag($0) }
                }.disabled(!queue.items.isEmpty)
                if kind == "documents" { Button("Choose document") { showDocuments = true } }
                else { PhotosPicker("Choose media", selection: $photos, maxSelectionCount: ["poster", "banner"].contains(kind) ? 1 : 30,
                                    matching: kind == "videos" ? .videos : .images, preferredItemEncoding: .current) }
            }
            if kind == "photos" { petMembership(pet) }
            if !["poster", "banner"].contains(kind) && (kind != "photos" || additionalPets.isEmpty) {
                Section {
                    Text(folder.isEmpty ? kind.capitalized : kind.capitalized + " / " + folder)
                    if !folder.isEmpty { Button("Up one folder") { folder = folder.split(separator: "/").dropLast().joined(separator: "/"); Task { await loadFolders() } } }
                    ForEach(folders) { entry in Button(entry.name) { folder = entry.path; Task { await loadFolders() } } }
                    TextField("New folder", text: $newFolder)
                    Button("Create folder here") { Task { await createFolder() } }.disabled(newFolder.isEmpty)
                } header: { Text("Upload destination") }.disabled(destinationLocked)
            }
            Section {
                ForEach(queue.items) { item in
                    VStack(alignment: .leading) {
                        Text(item.name).lineLimit(2)
                        if item.uploaded { Label("Saved", systemImage: "checkmark.circle") }
                        if let error = item.error { Text(error).font(.caption).foregroundStyle(.orange) }
                        if !item.uploaded { Button("Remove") { queue.items.removeAll { $0.id == item.id }; if queue.items.isEmpty { destinationLocked = false } } }
                    }
                }
                if let message = queue.message { Text(message).font(.footnote) }
                Button("Upload selected files") { uploadFiles(pet) }
                    .disabled(!queue.pending || (["poster", "banner"].contains(kind) && queue.items.count != 1))
            } footer: { Text("Up to 64 MB per file. Confirmed uploads are retained; retries use the same upload identity. Tap Done after saving to refresh the pet.") }
        }
    }
    private func petMembership(_ pet: FamilyRecord) -> some View {
        Section {
            Text(pet.title).font(.headline)
            ForEach(records.filter { $0.id != pet.id }) { other in
                Toggle(other.title, isOn: Binding(get: { additionalPets.contains(other.id) }, set: { value in
                    if value { additionalPets.insert(other.id) } else { additionalPets.remove(other.id) }
                }))
            }
            if !additionalPets.isEmpty { Text(sharedDestination(pet)).font(.caption).foregroundStyle(.secondary) }
        } header: { Text("Pets in these photos") }.disabled(destinationLocked)
    }
    private func sharedDestination(_ pet: FamilyRecord) -> String {
        let names = [pet.title] + records.filter { additionalPets.contains($0.id) }.map(\.title)
        return "One original in Shared Photos / " + names.joined(separator: " + ")
    }
    private func uploadFiles(_ pet: FamilyRecord) {
        destinationLocked = true
        let destination = kind == "photos" && !additionalPets.isEmpty ? "" : folder
        let petIDs = kind == "photos" ? [pet.id] + additionalPets.sorted() : []
        Task { await queue.uploadPet(client: client, petID: pet.id, kind: kind, folder: destination, petIDs: petIDs) }
    }
    private func load() async {
        busy = true; allowed = false; error = nil; defer { busy = false }
        do {
            let response: IndexValue = try await client.request("api/pets")
            records = PetCatalog.records(response); allowed = response["canEdit"]?.flag == true
            if target == nil { target = initialPet }
            if target != nil { await loadFolders() }
        } catch { self.error = error.localizedDescription }
    }
    private func create() async {
        guard !working, allowed else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let response: IndexValue = try await client.request("api/pets", method: "POST", body: PetCatalog.createBody(fields, requestID: creationID))
            guard response["ok"]?.flag == true, let row = response["record"] else { throw CompanionError.message("The pet could not be created.") }
            target = PetCatalog.records(.object(["records": .array([row])])).first
            await loadFolders()
        } catch { self.error = error.localizedDescription }
    }
    private func loadFolders() async {
        guard let target, !["poster", "banner"].contains(kind) else { return }
        let requestedKind = kind, requestedFolder = folder
        do {
            let response: PetCatalog.Folders = try await client.request("api/pets/" + target.id + "/folders", query: [URLQueryItem(name: "kind", value: requestedKind), URLQueryItem(name: "parent", value: requestedFolder)])
            try Task.checkCancellation()
            guard requestedKind == kind, requestedFolder == folder, self.target?.id == target.id else { return }
            guard response.ok else { throw CompanionError.message("Pet folders could not load.") }
            folders = response.folders
        } catch { self.error = error.localizedDescription }
    }
    private func createFolder() async {
        guard let target, !working else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let selected = try ProfileFolderPath.child(parent: folder, name: newFolder)
            let body = try JSONEncoder().encode(["kind": kind, "parent": folder, "name": newFolder])
            let response: IndexValue = try await client.request("api/pets/" + target.id + "/folders", method: "POST", body: body)
            guard response["ok"]?.flag == true else { throw CompanionError.message("Folder creation was not confirmed.") }
            folder = selected; newFolder = ""; await loadFolders()
        } catch { self.error = error.localizedDescription }
    }
}
