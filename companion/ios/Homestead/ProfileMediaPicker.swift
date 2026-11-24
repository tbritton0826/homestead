import SwiftUI
import PhotosUI
import CoreTransferable
import UniformTypeIdentifiers
import Observation
import UIKit
import ImageIO

final class DeviceMediaFile: @unchecked Sendable {
    let url: URL
    init(_ url: URL) { self.url = url }
    deinit { try? FileManager.default.removeItem(at: url) }
}

struct PickedProfileMedia: Transferable {
    let file: DeviceMediaFile
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in try copy(received.file) }
        FileRepresentation(importedContentType: .movie) { received in try copy(received.file) }
    }
    private static func copy(_ source: URL) throws -> Self {
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(source.pathExtension)
        try FileManager.default.copyItem(at: source, to: destination)
        return Self(file: DeviceMediaFile(destination))
    }
}

@MainActor @Observable
final class ProfileMediaQueue {
    struct Item: Identifiable {
        let id = UUID()
        let file: DeviceMediaFile
        let name: String
        let mime: String
        let video: Bool
        let preview: UIImage?
        var uploaded = false
        var error: String?
    }
    var items: [Item] = []
    var preparing = false
    var uploading = false
    var message: String?
    var photoCategory = "photo"
    var photoFolder = ""
    var pending: Bool { items.contains { !$0.uploaded } }

    func addPetDocument(_ url: URL) throws {
        guard !preparing, !uploading else { return }
        let ext = url.pathExtension.lowercased()
        guard ["pdf", "txt", "md", "doc", "docx", "rtf"].contains(ext) else { throw CompanionError.message("Choose a PDF, text, or document file.") }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 64 * 1024 * 1024 else { throw CompanionError.message("Choose documents up to 64 MB.") }
        let local = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        try FileManager.default.copyItem(at: url, to: local)
        items.append(Item(file: DeviceMediaFile(local), name: url.lastPathComponent, mime: "application/octet-stream", video: false, preview: nil))
    }

    func uploadPet(client: HomesteadClient, petID: String, kind: String, folder: String, petIDs: [String] = []) async {
        guard !uploading, !preparing else { return }
        uploading = true; message = nil
        defer { uploading = false }
        for index in items.indices where !items[index].uploaded {
            do {
                let item = items[index]
                try await client.uploadPetMedia(file: item.file.url, name: item.name, petID: petID,
                    kind: item.video ? "videos" : kind, folder: item.video && kind != "videos" ? "" : folder, requestID: item.id, petIDs: item.video ? [] : petIDs)
                items[index].uploaded = true; items[index].error = nil
            } catch {
                items[index].error = error.localizedDescription
                if Task.isCancelled { break }
            }
        }
        message = pending ? "Some files need attention. Confirmed uploads will not be sent again." : "Pet media saved."
    }

    func add(_ selections: [PhotosPickerItem]) async {
        guard !preparing, !uploading else { return }
        preparing = true; message = nil
        defer { preparing = false }
        for selection in selections {
            do {
                guard let picked = try await selection.loadTransferable(type: PickedProfileMedia.self) else {
                    throw CompanionError.message("This item could not be read from Photos.")
                }
                let selectedType = UTType(filenameExtension: picked.file.url.pathExtension)
                let video = selectedType?.conforms(to: .movie) ?? selection.supportedContentTypes.contains { $0.conforms(to: .movie) }
                var owned = picked.file
                let originalSize = try owned.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard originalSize <= (video ? 512 : 32) * 1024 * 1024 else { throw CompanionError.message("Selected media exceeds the upload size limit.") }
                if !video {
                    guard let source = CGImageSourceCreateWithURL(owned.url as CFURL, nil),
                          let identifier = CGImageSourceGetType(source), let imageType = UTType(identifier as String) else {
                        throw CompanionError.message("This photo could not be read. Download the original from iCloud and retry.")
                    }
                    let ext = imageType.preferredFilenameExtension ?? ""
                    if ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif"].contains(ext) {
                        // Keep original HEIC/HEIF and other supported image bytes intact.
                        if owned.url.pathExtension.lowercased() != ext {
                            let renamed = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
                            try FileManager.default.copyItem(at: owned.url, to: renamed)
                            owned = DeviceMediaFile(renamed)
                        }
                    } else {
                        guard let image = UIImage(contentsOfFile: owned.url.path), let data = image.jpegData(compressionQuality: 0.92) else {
                            throw CompanionError.message("This image format could not be prepared for upload.")
                        }
                        let jpeg = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
                        try data.write(to: jpeg); owned = DeviceMediaFile(jpeg)
                    }
                }
                let bytes = try owned.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard bytes > 0, bytes <= (video ? 512 : 32) * 1024 * 1024 else {
                    throw CompanionError.message(video ? "Choose videos smaller than 512 MB." : "Choose images smaller than 32 MB.")
                }
                let ext = owned.url.pathExtension.lowercased()
                let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? (video ? "video/mp4" : "image/jpeg")
                var preview: UIImage?
                if !video, let source = CGImageSourceCreateWithURL(owned.url as CFURL, nil),
                   let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 120, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) {
                    preview = UIImage(cgImage: image)
                }
                items.append(Item(file: owned, name: "\(video ? "Video" : "Photo")-\(UUID().uuidString).\(ext)", mime: mime, video: video, preview: preview))
            } catch { message = error.localizedDescription }
        }
    }

    func upload(client: HomesteadClient, target: ProfileUploadTarget) async {
        guard !uploading, !preparing else { return }
        uploading = true; message = nil
        defer { uploading = false }
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            guard ["owner", "admin"].contains(session["user"]?["role"]?.text ?? "") else {
                throw CompanionError.message("Administrator access is required to upload profile media.")
            }
            for index in items.indices where !items[index].uploaded {
                do {
                    try Task.checkCancellation()
                    let item = items[index]
                    try await client.uploadProfileMedia(file: item.file.url, name: item.name, mime: item.mime, target: target, type: item.video ? "video" : photoCategory,
                                                        destinationFolder: item.video ? "" : photoFolder)
                    items[index].uploaded = true; items[index].error = nil
                } catch {
                    items[index].error = error.localizedDescription + " Check the profile before retrying if the connection was interrupted."
                }
            }
            message = pending ? "Some files were not confirmed. Uploaded files will not be sent again." : "Media uploaded. The server is refreshing this profile's library."
        } catch { message = error.localizedDescription }
    }
}

struct ProfileMediaPicker: View {
    @Bindable var queue: ProfileMediaQueue
    @State private var selections: [PhotosPickerItem] = []
    var body: some View {
        Section("Device media") {
            PhotosPicker(selection: $selections, maxSelectionCount: 20, matching: .any(of: [.images, .videos]), preferredItemEncoding: .current) {
                Label("Choose photos and videos", systemImage: "photo.on.rectangle.angled")
            }.disabled(queue.preparing || queue.uploading)
            Picker("Photo tab", selection: $queue.photoCategory) {
                Text("Photos").tag("photo")
                Text("Nudes").tag("nude")
                Text("Artwork").tag("artwork")
                Text("References").tag("reference")
            }.disabled(queue.uploading).onChange(of: queue.photoCategory) { _, _ in queue.photoFolder = "" }
            ForEach(queue.items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        if let preview = item.preview { Image(uiImage: preview).resizable().scaledToFit().frame(width: 44, height: 44) }
                        Label(item.video ? "Video" : "Photo", systemImage: item.video ? "video" : "photo")
                        Spacer()
                        if item.uploaded { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                        else { Button("Remove") { queue.items.removeAll { $0.id == item.id } }.disabled(queue.uploading || queue.preparing) }
                    }
                    if let error = item.error { Text(error).font(.caption).foregroundStyle(.orange) }
                }
            }
            if let message = queue.message { Text(message).font(.footnote) }
        }.onChange(of: selections) { _, selected in
            guard !selected.isEmpty else { return }
            Task { await queue.add(selected); selections = [] }
        }
        .homesteadLoading(queue.preparing || queue.uploading, message: queue.uploading ? "Uploading media…" : "Preparing selected media…")
    }
}

struct AddProfileMediaView: View {
    let target: ProfileUploadTarget
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    @State private var queue = ProfileMediaQueue()
    var body: some View {
        NavigationStack {
            Form {
                Text(target.name).font(.headline)
                ProfileMediaPicker(queue: queue)
                ProfileFolderControl(queue: queue, target: target, client: client)
                Button("Upload to profile") { Task { await queue.upload(client: client, target: target) } }
                    .disabled(!queue.pending || queue.preparing || queue.uploading)
            }.homesteadCanvas().navigationTitle("Add media").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(queue.preparing || queue.uploading) } }
                .interactiveDismissDisabled(queue.preparing || queue.uploading)
        }
    }
}

struct ProfileAddAction: Equatable {
    let id: String
    let open: () -> Void
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
}
struct ProfileAddActionKey: PreferenceKey {
    static let defaultValue: ProfileAddAction? = nil
    static func reduce(value: inout ProfileAddAction?, nextValue: () -> ProfileAddAction?) { if let next = nextValue() { value = next } }
}
