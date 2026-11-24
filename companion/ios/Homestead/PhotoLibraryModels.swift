import Foundation

enum PhotoLibraryCatalog {
    static func albums(_ response: IndexValue) -> [MediaItem] {
        (response["albums"]?.list ?? []).compactMap { row in
            guard let id = row["id"]?.text else { return nil }
            let files = PlaybackCatalog.files(row).filter { !$0.playable && !$0.readable }
            return MediaItem(id: id, title: row["title"]?.text ?? row["name"]?.text ?? "Photo album", category: .photos,
                             year: "", overview: row["truncated"]?.flag == true ? "Showing the first 5,000 photos in this album." : "", poster: row["poster"]?.text, addedAt: nil, fileCount: files.count, files: files, folderRoot: row["path"]?.text ?? row["sourcePath"]?.text)
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    static func mergingFolders(_ index: IndexValue, library: String, folders: [IndexValue]) -> IndexValue {
        var root = index.fields
        var libraries = (index["libraries"] ?? index).fields
        let collection = libraries[library] ?? .object([:])
        var records = collection.fields
        if !collection.list.isEmpty {
            for (offset, row) in collection.list.enumerated() { records[row["id"]?.text ?? String(offset)] = row }
        }
        for folder in folders {
            guard let id = folder["id"]?.text else { continue }
            let source = folder["sourcePath"]?.text ?? folder["folderPath"]?.text
            if let source { records = records.filter { ($0.value["sourcePath"]?.text ?? $0.value["folderPath"]?.text) != source } }
            var fields = folder.fields
            if library == "adultPhotos", fields["poster"] == nil,
               let photo = PlaybackCatalog.files(folder).first(where: { !$0.playable && !$0.readable }) { fields["poster"] = .string(photo.path) }
            records[id] = .object(fields)
        }
        libraries[library] = .object(records); root["libraries"] = .object(libraries)
        return .object(root)
    }
    static func videos(_ row: IndexValue, source: String, fallbackID: String) -> [NativeSearchHit] {
        let parent = NativeSearchMapping.hit(row, source: source, fallbackID: fallbackID)
        let files = PlaybackCatalog.files(row).filter(\.video)
        return files.map { file in
            var hit = NativeSearchHit(id: source + ":" + file.path, title: file.title, source: source, summary: parent.title)
            hit.mediaFiles = [file]; hit.payload = row; hit.mediaType = "video"
            if let poster = parent.posterPath, !ProfileMediaFile(path: poster, title: "", video: false).fileExtension.isEmpty,
               !["mp4", "mkv", "mov", "m4v", "webm", "avi", "wmv", "ts", "m2ts"].contains(ProfileMediaFile(path: poster, title: "", video: false).fileExtension) {
                hit.posterPath = poster
            }
            return hit
        }
    }
}
