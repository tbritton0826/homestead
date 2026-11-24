import SwiftUI
import Foundation

struct ProfileFolderControl: View {
    @Bindable var queue: ProfileMediaQueue
    let target: ProfileUploadTarget
    let client: HomesteadClient
    @State private var selecting = false
    var body: some View {
        Section("Photo destination") {
            Button { selecting = true } label: {
                LabeledContent("Folder", value: ProfileFolderPath.title(for: queue.photoCategory) + (queue.photoFolder.isEmpty ? "" : "/" + queue.photoFolder))
            }.disabled(queue.uploading || queue.preparing)
            if !queue.photoFolder.isEmpty { Button("Use default folder") { queue.photoFolder = "" }.disabled(queue.uploading) }
            Text("Choose or create a folder within this profile's selected photo tab. Videos keep their existing video destination.").font(.caption)
        }.sheet(isPresented: $selecting) {
            NativeProfileFolderPicker(target: target, client: client, type: queue.photoCategory, selected: $queue.photoFolder)
        }
    }
}

private struct NativeProfileFolderPicker: View {
    let target: ProfileUploadTarget
    let client: HomesteadClient
    let type: String
    @Binding var selected: String
    @Environment(\.dismiss) private var dismiss
    @State private var parent = ""
    @State private var folders: [ProfileFolderOption] = []
    @State private var loading = false
    @State private var creating = false
    @State private var supported = false
    @State private var message: String?
    @State private var naming = false
    @State private var newName = ""
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(ProfileFolderPath.title(for: type) + (parent.isEmpty ? "" : "/" + parent)).font(.headline)
                    if !parent.isEmpty {
                        Button("Up one folder", systemImage: "arrow.up") { parent = (parent as NSString).deletingLastPathComponent }
                    }
                    if let message { Text(message).foregroundStyle(.orange) }
                }
                if supported {
                    Section("Folders") {
                        ForEach(folders) { folder in
                            Button { parent = folder.path } label: { Label(folder.name, systemImage: "folder") }
                        }
                        if folders.isEmpty && !loading { Text("No subfolders here.").foregroundStyle(.secondary) }
                        Button("Create new folder", systemImage: "folder.badge.plus") { newName = ""; naming = true }
                    }
                }
            }.disabled(creating).homesteadCanvas().navigationTitle("Choose Photo Folder").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(creating) }
                    ToolbarItem(placement: .confirmationAction) { Button("Use this folder") { selected = parent; dismiss() }.disabled(!supported || loading || creating) }
                    ToolbarItem(placement: .bottomBar) { Button("Refresh folders", systemImage: "arrow.clockwise") { Task { await load() } }.disabled(loading || creating) }
                }
                .alert("New folder", isPresented: $naming) {
                    TextField("Folder name", text: $newName)
                    Button("Create") { Task { await create() } }
                    Button("Cancel", role: .cancel) {}
                } message: { Text("Create inside the current profile folder.") }
                .interactiveDismissDisabled(creating)
                .task(id: parent) { await load() }
        }
        .homesteadLoading(loading, message: "Loading folders…")
    }
    @MainActor private func load() async {
        loading = true; supported = false; message = nil; folders = []
        let requestedParent = parent
        defer { if parent == requestedParent { loading = false } }
        do {
            try ProfileFolderPath.validate(requestedParent)
            let query = [URLQueryItem(name: "library", value: target.library), URLQueryItem(name: "profileId", value: target.id),
                         URLQueryItem(name: "type", value: type), URLQueryItem(name: "parent", value: requestedParent)]
            let response: ProfileFolderListing = try await client.request("api/adult/profile-folders", query: query)
            try Task.checkCancellation()
            guard response.ok, response.version == 1, response.parent == requestedParent, parent == requestedParent else {
                throw CompanionError.message("The server did not confirm this folder.")
            }
            for folder in response.folders {
                guard folder.path == (try ProfileFolderPath.child(parent: requestedParent, name: folder.name)) else { throw CompanionError.message("Invalid folder response.") }
            }
            folders = response.folders; supported = true
        } catch { if !Task.isCancelled && parent == requestedParent { message = "Folders could not be loaded. The v3.6 server update and profile-edit permission are required. " + error.localizedDescription } }
    }
    @MainActor private func create() async {
        guard supported, !loading, !creating else { return }
        creating = true; message = nil
        defer { creating = false }
        do {
            let expected = try ProfileFolderPath.child(parent: parent, name: newName)
            let payload = ["library": target.library, "profileId": target.id, "type": type, "parent": parent, "name": newName]
            let body = try JSONEncoder().encode(payload)
            let response: IndexValue = try await client.request("api/adult/profile-folders", method: "POST", body: body)
            guard response["ok"]?.flag == true, response["version"]?.text == "1", response["path"]?.text == expected else {
                throw CompanionError.message("The server did not confirm the new folder.")
            }
            parent = expected
        } catch { message = error.localizedDescription + " Refresh folders before retrying; the folder may already have been created." }
    }
}
