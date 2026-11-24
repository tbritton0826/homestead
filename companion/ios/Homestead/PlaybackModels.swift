import Foundation
import CryptoKit

struct PlaybackPosition: Codable, Sendable {
    let position: Double
    let duration: Double
    let completed: Bool
    let updatedAt: String
    var resume: Double { completed || !position.isFinite || position < 0 ? 0 : position }
}
struct PlaybackHistory: Decodable {
    let ok: Bool
    let userId: String
    let entries: [String: PlaybackPosition]
}
enum PlaybackCatalog {
    static func artworkByFile(_ index: IndexValue) -> [String: String] {
        let libraries = index["libraries"] ?? index
        let keys = MediaCategory.allCases.flatMap(\.aliases) + ["personal", "girls", "performers", "celebrities", "adultPhotos", "adultVideos"]
        var result: [String: String] = [:]
        for key in keys {
            guard let library = libraries[key] else { continue }
            let rows = library.list.isEmpty ? Array(library.fields.values) : library.list
            for row in rows {
                guard let poster = ProfilePresentation.artwork(row, key: "poster") ?? ProfilePresentation.artwork(row, key: "headshot") else { continue }
                for file in files(row, includeBooks: key == "books" || key == "audiobooks") { result[file.path] = poster }
            }
        }
        return result
    }

    // The identifier carries no title or filesystem path in account history.
    static func key(_ file: ProfileMediaFile) -> String {
        SHA256.hash(data: Data(file.path.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func files(_ row: IndexValue, depth: Int = 0, includeBooks: Bool = false, baseFolder: String? = nil) -> [ProfileMediaFile] {
        guard depth < 12 else { return [] }
        let folder = row["folderPath"]?.text ?? baseFolder
        var result = ProfileMediaFile.files(row, includeBooks: includeBooks, baseFolder: folder)
        let containers = ["versions", "localVersions", "seasons", "episodes", "albums", "tracks", "musicVideos", "videos", "photos", "items", "children"] +
            (includeBooks ? ["audiobook", "audiobooks", "ebook", "ebooks", "formats", "folders", "directories"] : [])
        for key in containers {
            guard let child = row[key] else { continue }
            let isRecord = child["files"] != nil || child["path"] != nil || child["sourcePath"] != nil
            let rows = isRecord ? [child] : child.list.isEmpty ? Array(child.fields.values) : child.list
            for entry in rows { result += files(entry, depth: depth + 1, includeBooks: includeBooks, baseFolder: folder) }
        }
        var seen = Set<String>()
        return result.filter { seen.insert($0.id).inserted }.sorted {
            let order = $0.title.localizedStandardCompare($1.title)
            return order == .orderedSame ? $0.path.localizedStandardCompare($1.path) == .orderedAscending : order == .orderedAscending
        }
    }
    static func authorizedFiles(_ index: IndexValue, includeAdult: Bool = true) -> [ProfileMediaFile] {
        let libraries = index["libraries"] ?? index
        let keys = MediaCategory.allCases.flatMap(\.aliases) + (includeAdult ? ["personal", "girls", "performers", "celebrities", "adultPhotos", "adultVideos"] : [])
        var result: [ProfileMediaFile] = []
        for key in keys {
            guard let library = libraries[key] else { continue }
            let rows = library.list.isEmpty ? Array(library.fields.values) : library.list
            for row in rows { result += files(row, includeBooks: key == "books" || key == "audiobooks") }
        }
        var seen = Set<String>()
        return result.filter { seen.insert($0.id).inserted }
    }
}

enum ReadingProgress {
    static func key(server: URL, account: String, file: ProfileMediaFile) -> String {
        "homestead.reader." + AppearancePreferences.storageKey(server: server.absoluteString, user: account) + "." + PlaybackCatalog.key(file)
    }
}
