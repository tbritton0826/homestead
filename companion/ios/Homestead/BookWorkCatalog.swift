import Foundation

enum BookWorkCatalog {
    static func identity(row: IndexValue, match: IndexValue?, key: String, links: IndexValue) -> String {
        let record = row["localId"]?.text ?? row["id"]?.text ?? key
        if let group = links[record]?.text, !group.isEmpty { return "manual:" + group }
        for source in [Optional(row), row["metadata"], match] {
            for field in ["editionGroupId", "workId", "openLibraryWorkId"] {
                if let value = source?[field]?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
                    return "provider:" + value.lowercased()
                }
            }
        }
        if let folder = row["folderPath"]?.text {
            let url = URL(fileURLWithPath: folder).standardizedFileURL
            let audioFolder = ["audiobook", "audiobooks", "audio books", "audio"].contains(url.lastPathComponent.lowercased())
            let formatFolder = audioFolder || ["ebook", "ebooks", "e books"].contains(url.lastPathComponent.lowercased())
            let bookFolder = formatFolder ? url.deletingLastPathComponent() : url
            let title = row["title"]?.text ?? row["name"]?.text ?? row["metadata"]?["title"]?.text ?? ""
            if audioFolder || (!title.isEmpty && title.caseInsensitiveCompare(bookFolder.lastPathComponent) == .orderedSame) {
                return "folder:" + bookFolder.path
            }
        }
        return "local:" + record
    }
    static func orderedAudio(_ files: [ProfileMediaFile]) -> [ProfileMediaFile] {
        files.filter(\.audio).sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }
    static func merge(_ items: [MediaItem]) -> [MediaItem] {
        var result: [MediaItem] = [], locations: [String: Int] = [:]
        for item in items {
            guard item.category == .books, let key = item.bookWorkID else { result.append(item); continue }
            guard let index = locations[key] else { locations[key] = result.count; result.append(item); continue }
            let prior = result[index]
            let preferred = item.files.contains(where: \.readable) && !prior.files.contains(where: \.readable) ? item : prior
            var seen = Set<String>()
            let files = (prior.files + item.files).filter { seen.insert($0.id).inserted }
                .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            result[index] = MediaItem(id: preferred.id, title: preferred.title, category: .books,
                year: preferred.year, overview: preferred.overview.isEmpty ? (prior.overview + item.overview) : preferred.overview,
                poster: preferred.poster ?? prior.poster ?? item.poster, addedAt: preferred.addedAt,
                fileCount: files.count, files: files, banner: preferred.banner ?? prior.banner ?? item.banner,
                collectionNames: Array(Set(prior.collectionNames + item.collectionNames)).sorted(),
                identities: Array(Set(prior.identities + item.identities)).sorted(), bookWorkID: key, detail: preferred.detail)
        }
        return result
    }
}
