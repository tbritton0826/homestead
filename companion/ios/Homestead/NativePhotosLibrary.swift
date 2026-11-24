import SwiftUI
import PhotosUI
import Combine

struct NativePhotosLibrary: View {
    let client: HomesteadClient
    @State private var albums: [MediaItem] = []
    @State private var loading = false
    @State private var error: String?
    @State private var adding = false
    @State private var canEdit = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let error { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load() } } }
            Text("\(albums.count) albums").foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 150), spacing: 10)], spacing: 16) {
                ForEach(albums) { album in
                    NavigationLink { NativePhotoAlbum(album: album, client: client, canEdit: canEdit, changed: { Task { await load() } }) } label: {
                        PosterTile(title: album.title, subtitle: "\(album.files.count) photos", path: album.poster,
                                   symbol: "photo.on.rectangle", client: client)
                    }.buttonStyle(.plain)
                }
            }
            if !loading && error == nil && albums.isEmpty { ContentUnavailableView("No photo albums", systemImage: "photo.on.rectangle") }
        }.frame(maxWidth: .infinity, minHeight: 160)
            .homesteadLoading(loading, message: "Loading Photos…")
            .task { await load() }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
                if let sender = notification.object as? HomesteadClient, sender === client, error != nil { Task { await load() } }
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("homesteadPhotosRefresh"))) { notification in
                if let sender = notification.object as? HomesteadClient, sender === client { Task { await load() } }
            }
            .preference(key: ProfileAddActionKey.self, value: canEdit ? ProfileAddAction(id: "regular-photos", open: { adding = true }) : nil)
            .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { NativePhotoImport(client: client) }
    }
    private func load() async {
        guard !loading else { return }; loading = true; error = nil
        defer { loading = false }
        do {
            let response: IndexValue = try await client.request("api/photos/native", timeout: 45)
            try Task.checkCancellation()
            guard response["ok"]?.flag == true else { throw CompanionError.message("Photos could not be loaded.") }
            albums = PhotoLibraryCatalog.albums(response); canEdit = response["canEdit"]?.flag == true
        } catch { if !Task.isCancelled { self.error = error.localizedDescription; canEdit = false } }
    }
}

private struct NativePhotoAlbum: View {
    let album: MediaItem
    let client: HomesteadClient
    let canEdit: Bool
    let changed: () -> Void
    @State private var adding = false
    @State private var viewing: ProfileMediaFile?
    @State private var files: [ProfileMediaFile] = []
    @State private var refreshError: String?
    @State private var selectedFolder = MediaFolderCatalog.all
    private var folderRoot: String { MediaFolderCatalog.root(files: files, hint: album.folderRoot) }
    private var visibleFiles: [ProfileMediaFile] { MediaFolderCatalog.filter(files, root: folderRoot, selected: selectedFolder) }
    var body: some View {
        ScrollView {
            if let refreshError { Text(refreshError).font(.caption).foregroundStyle(.orange).padding(.horizontal) }
            if !album.overview.isEmpty { Text(album.overview).font(.caption).padding() }
            MediaFolderTabs(files: files, rootHint: album.folderRoot, selected: $selectedFolder).padding(.horizontal)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 160), spacing: 10)], spacing: 14) {
                ForEach(visibleFiles) { file in
                    Button { viewing = file } label: {
                        VStack(alignment: .leading) {
                            NativeArtwork(path: file.path, client: client).aspectRatio(1, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 14))
                            Text(file.title).font(.caption).lineLimit(2)
                        }
                    }.buttonStyle(.plain)
                }
            }.padding().padding(.bottom, 80)
        }.homesteadCanvas().navigationTitle(album.title).navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .onAppear { if files.isEmpty { files = album.files } }
            .refreshable { await reload() }
            .preference(key: ProfileAddActionKey.self, value: canEdit ? ProfileAddAction(id: album.id, open: { adding = true }) : nil)
            .sheet(isPresented: $adding, onDismiss: {
                changed()
                Task {
                    if let response: IndexValue = try? await client.request("api/photos/native", timeout: 45),
                       let updated = PhotoLibraryCatalog.albums(response).first(where: { $0.id == album.id }) { files = updated.files }
                }
            }) { NativePhotoImport(client: client, initialAlbumID: album.id) }
            .fullScreenCover(item: $viewing) { NativeMediaViewer(initial: $0, files: visibleFiles, client: client) }
    }
    private func reload() async {
        refreshError = nil
        do {
            let response: IndexValue = try await client.request("api/photos/native", timeout: 45)
            try Task.checkCancellation()
            if let updated = PhotoLibraryCatalog.albums(response).first(where: { $0.id == album.id }) { files = updated.files }
            else { files = []; refreshError = "This album is no longer available. Return to Photos and refresh." }
            changed()
        } catch { if !Task.isCancelled { refreshError = "The album could not refresh. Pull down to retry. " + error.localizedDescription } }
    }
}

struct NativePhotoImport: View {
    let client: HomesteadClient
    var initialAlbumID = ""
    @Environment(\.dismiss) private var dismiss
    @State private var albums: [IndexValue] = []
    @State private var albumID = ""
    @State private var newAlbum = ""
    @State private var selections: [PhotosPickerItem] = []
    @State private var queue = ProfileMediaQueue()
    @State private var loading = true
    @State private var saving = false
    @State private var canEdit = false
    @State private var message: String?
    @State private var confirm = false
    @State private var submittedAlbumID: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Destination album") {
                    Picker("Album", selection: $albumID) {
                        Text("Select an album").tag("")
                        ForEach(Array(albums.enumerated()), id: \.offset) { _, row in Text(row["name"]?.text ?? "Album").tag(row["id"]?.text ?? "") }
                    }
                    TextField("New album name", text: $newAlbum)
                    Button("Create album") { Task { await createAlbum() } }.disabled(newAlbum.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }.disabled(!canEdit || saving || loading || submittedAlbumID != nil)
                Section("Photos") {
                    PhotosPicker(selection: $selections, maxSelectionCount: 30, matching: .images) { Label("Choose photos", systemImage: "photo.on.rectangle") }
                    ForEach(queue.items) { item in
                        queuedPhoto(item)
                    }
                    if let note = queue.message { Text(note) }
                }.disabled(!canEdit || saving || loading || queue.preparing)
                if let message { Text(message) }
                Button("Refresh albums") { Task { await load() } }.disabled(saving || queue.preparing)
                Button("Save photos") { confirm = true }.disabled(!canEdit || albumID.isEmpty || !queue.pending || saving || queue.preparing)
            }.buttonStyle(.borderless).homesteadCanvas().navigationTitle("Add photos").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(saving || queue.preparing) } }
                .interactiveDismissDisabled(saving || queue.preparing)
                .homesteadLoading(loading || saving || queue.preparing, message: loading ? "Loading photo albums…" : saving ? "Saving photos…" : "Preparing photos…")
                .confirmationDialog("Save these photos to the selected album?", isPresented: $confirm) { Button("Save photos") { Task { await upload() } } }
                .task { await load() }
                .onChange(of: selections) { _, values in Task { await queue.add(values); selections = [] } }
        }
    }
    @ViewBuilder private func queuedPhoto(_ item: ProfileMediaQueue.Item) -> some View {
        HStack {
            if let image = item.preview { Image(uiImage: image).resizable().scaledToFit().frame(width: 44, height: 44) }
            Text(item.name)
            Spacer()
            if !item.uploaded && submittedAlbumID == nil {
                Button("Remove") { queue.items.removeAll { $0.id == item.id } }
                    .accessibilityLabel("Remove " + item.name + " from selection")
            }
            if item.uploaded { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
        }
        if let error = item.error { Text(error).foregroundStyle(.orange) }
    }
    private func load() async {
        loading = true; defer { loading = false }
        do {
            let result: IndexValue = try await client.request("api/photos/native", timeout: 45)
            albums = result["albums"]?.list ?? []; canEdit = result["canEdit"]?.flag == true
            if albums.contains(where: { $0["id"]?.text == initialAlbumID }) { albumID = initialAlbumID }
            message = canEdit ? nil : "Photos is read-only for this account."
        } catch { message = error.localizedDescription }
    }
    private func createAlbum() async {
        saving = true; defer { saving = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["name": newAlbum])
            let result: IndexValue = try await client.request("api/photos/native/albums", method: "POST", body: body)
            guard result["ok"]?.flag == true, let album = result["album"], let id = album["id"]?.text else { throw CompanionError.message("Album creation was not confirmed. Refresh albums before retrying.") }
            albums.append(album); albumID = id; newAlbum = ""; message = nil
        } catch { message = error.localizedDescription }
    }
    private func upload() async {
        guard !saving, canEdit, !albumID.isEmpty else { return }
        saving = true; submittedAlbumID = albumID; defer { saving = false }
        for index in queue.items.indices where !queue.items[index].uploaded {
            do {
                let item = queue.items[index]
                try await client.uploadPhoto(file: item.file.url, name: item.name, albumID: albumID, requestID: item.id)
                queue.items[index].uploaded = true; queue.items[index].error = nil
            } catch { queue.items[index].error = error.localizedDescription; if Task.isCancelled { break } }
        }
        message = queue.pending ? "Some photos need attention. Retry keeps confirmed uploads." : "Photos saved."
    }
}
