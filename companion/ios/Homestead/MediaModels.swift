import Foundation

enum MediaCategory: String, CaseIterable, Identifiable, Sendable {
    case movies, tv, books, music, youtube, photos
    var id: String { rawValue }
    var title: String {
        switch self {
        case .movies: return "Movies"
        case .tv: return "TV Shows"
        case .books: return "Books"
        case .music: return "Music"
        case .youtube: return "YouTube"
        case .photos: return "Photos"
        }
    }
    var symbol: String {
        switch self {
        case .movies: return "film"
        case .tv: return "tv"
        case .books: return "books.vertical"
        case .music: return "music.note"
        case .youtube: return "play.rectangle"
        case .photos: return "photo.on.rectangle"
        }
    }
    var aliases: [String] {
        switch self {
        case .movies: return ["movies"]
        case .tv: return ["tvShows", "tv", "tvshows"]
        case .books: return ["books", "audiobooks"]
        case .music: return ["musicArtists", "music"]
        case .youtube: return ["youtubeCreators", "youtube"]
        case .photos: return ["photos"]
        }
    }
}

struct MediaItem: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let category: MediaCategory
    let year: String
    let overview: String
    let poster: String?
    let addedAt: Date?
    let fileCount: Int?
    var files: [ProfileMediaFile] = []
    var banner: String? = nil
    var collectionNames: [String] = []
    var identities: [String] = []
    var bookWorkID: String? = nil
    var detail = MediaDetailSnapshot()
    var folderRoot: String? = nil
}

// Index libraries may be keyed objects or arrays. Ignore unknown libraries and
// decode only display fields so the companion never exposes filesystem paths.
struct MediaIndex: Decodable, Sendable {
    let items: [MediaItem]
    init(from decoder: Decoder) throws {
        let root = try IndexValue(from: decoder)
        try self.init(root: root)
    }

    init(root: IndexValue, matches: IndexValue = .object([:]), editionLinks: IndexValue = .object([:])) throws {
        guard case .object = root,
              root["libraries"] != nil || MediaCategory.allCases.contains(where: { category in
                  category.aliases.contains { root[$0] != nil }
              }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Not a media index"))
        }
        var result: [MediaItem] = []
        var seen = Set<String>()
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        for category in MediaCategory.allCases {
            let topLevel: IndexValue? = category.aliases.compactMap { root[$0] }.first
            let libraries: IndexValue? = root["libraries"]
            let nested: IndexValue? = category.aliases.compactMap { libraries?[$0] }.first
            let collection: IndexValue? = topLevel ?? nested
            let rows: [(String, IndexValue)]
            let collections = category == .books ? category.aliases.compactMap { root[$0] ?? libraries?[$0] } : [collection].compactMap { $0 }
            rows = collections.flatMap { value -> [(String, IndexValue)] in
                switch value {
                case .object(let values): return values.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
                case .array(let values): return values.enumerated().map { (String($0.offset), $0.element) }
                default: return []
                }
            }
            for (key, row) in rows {
                guard case .object = row else { continue }
                let metadata: IndexValue? = row["metadata"]
                let match = SavedMediaMetadata.match(matches, category: category, row: row, key: key)
                let titleCandidates: [String?] = [
                    row["title"]?.text,
                    metadata?["title"]?.text,
                    metadata?["name"]?.text,
                    row["name"]?.text,
                    row["artist"]?.text,
                    row["displayName"]?.text
                ]
                let title: String = firstText(titleCandidates, fallback: "Untitled")
                let id = category.rawValue + ":" + (row["id"]?.text ?? key)
                if category != .books && !seen.insert(id).inserted { continue }
                let timestamp: String? = row["addedAt"]?.text ?? row["createdAt"]?.text
                var date: Date?
                if let timestamp {
                    date = precise.date(from: timestamp)
                    if date == nil { date = standard.date(from: timestamp) }
                }
                let year: String = firstText([match?["year"]?.text, metadata?["year"]?.text, row["year"]?.text])
                let overviewCandidates: [String?] = [
                    match?["description"]?.text,
                    match?["overview"]?.text,
                    metadata?["description"]?.text,
                    metadata?["overview"]?.text,
                    row["description"]?.text,
                    row["overview"]?.text
                ]
                let overview: String = firstText(overviewCandidates)
                let override = match?["artworkOverrides"]?["gridPoster"]?.text
                let poster: String? = override ?? ProfilePresentation.artwork(row, key: "poster") ?? match?["poster"]?.text
                let countText: String? = row["counts"]?["total"]?.text
                let fileCount: Int? = countText.flatMap { Int($0) }
                let item = MediaItem(id: id, title: title, category: category,
                    year: year, overview: overview, poster: poster,
                    addedAt: date, fileCount: fileCount, files: PlaybackCatalog.files(row, includeBooks: category == .books),
                    banner: match?["artworkOverrides"]?["banner"]?.text ?? ProfilePresentation.artwork(row, key: "banner") ?? match?["backdrop"]?.text,
                    collectionNames: SharedCollectionCatalog.names(row) + SharedCollectionCatalog.names(match ?? .object([:])),
                    identities: [key] + ["id", "localId", "path", "sourcePath"].compactMap { row[$0]?.text },
                    bookWorkID: category == .books ? BookWorkCatalog.identity(row: row, match: match, key: key, links: editionLinks) : nil,
                    detail: MediaDetailCatalog.snapshot(row: row, match: match, category: category, files: PlaybackCatalog.files(row)))
                result.append(item)
            }
        }
        items = BookWorkCatalog.merge(result).sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}

enum SavedMediaMetadata {
    // Match only rows already present in the account-filtered index. Titles are
    // never identities for TV remakes, books, or music editions.
    static func match(_ matches: IndexValue, category: MediaCategory, row: IndexValue, key: String) -> IndexValue? {
        let stable = ["localId", "id", "path", "sourcePath"]
        let identity = stable.compactMap { row[$0]?.text }
        var values = identity + [key]
        if category == .movies || category == .tv || category == .youtube {
            values += ["libraryKey", "filePath", "folderPath", "folderName"].compactMap { row[$0]?.text }
        }
        if category == .movies || category == .youtube {
            values += ["name", "title", "displayTitle", "fileName", "filename"].compactMap { row[$0]?.text }
            values += [row["metadata"]?["title"]?.text, row["metadata"]?["name"]?.text].compactMap { $0 }
        }
        let exactOnly = category == .books || category == .music
        let aliases = exactOnly ? values : values.flatMap { value -> [String] in
            let path = value.replacingOccurrences(of: "\\", with: "/")
            let normalized = path.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                .replacingOccurrences(of: "\\?.*$", with: "", options: .regularExpression)
                .replacingOccurrences(of: "/(?:metadata\\.json|(?:poster|banner|folder|cover)\\.(?:jpg|jpeg|png|webp|heic|heif))$", with: "", options: .regularExpression)
                .replacingOccurrences(of: "/+", with: "/", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let basename = (path as NSString).lastPathComponent
            let slug = basename.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            return [value, normalized, basename, slug]
        }
        for alias in aliases where !alias.isEmpty {
            var candidate = matches[category.rawValue + ":" + alias]
            var visited = Set<String>()
            while let target = candidate?["aliasOf"]?.text {
                guard visited.insert(target).inserted else { candidate = nil; break }
                candidate = matches[target]
            }
            guard let candidate else { continue }
            if exactOnly && !identity.contains(candidate["localId"]?.text ?? "") { continue }
            if category == .tv {
                let ids = [row["id"]?.text, row["localId"]?.text, row["libraryKey"]?.text, key].compactMap { $0 }
                    .map { $0.hasPrefix("tv:") ? String($0.dropFirst(3)) : $0 }
                let local = candidate["localId"]?.text ?? ""
                guard ids.contains(local.hasPrefix("tv:") ? String(local.dropFirst(3)) : local) else { continue }
            }
            return candidate
        }
        return nil
    }
}

private func firstText(_ candidates: [String?], fallback: String = "") -> String {
    for candidate in candidates {
        if let candidate { return candidate }
    }
    return fallback
}

enum IndexValue: Decodable, Sendable {
    case object([String: IndexValue]), array([IndexValue]), string(String), number(Double), bool(Bool), other
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .other }
        else if let object = try? value.decode([String: IndexValue].self) { self = .object(object) }
        else if let array = try? value.decode([IndexValue].self) { self = .array(array) }
        else if let text = try? value.decode(String.self) { self = .string(text) }
        else if let number = try? value.decode(Double.self) { self = .number(number) }
        else if let flag = try? value.decode(Bool.self) { self = .bool(flag) }
        else { throw DecodingError.dataCorruptedError(in: value, debugDescription: "Invalid index value") }
    }
    subscript(_ key: String) -> IndexValue? {
        if case .object(let fields) = self { return fields[key] }
        return nil
    }
    var text: String? {
        switch self {
        case .string(let text): return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : text
        case .number(let number): return number.formatted(.number.grouping(.never).locale(Locale(identifier: "en_US_POSIX")))
        default: return nil
        }
    }
    var flag: Bool? { if case .bool(let value) = self { return value }; return nil }
    var list: [IndexValue] { if case .array(let values) = self { return values }; return [] }
    var fields: [String: IndexValue] { if case .object(let values) = self { return values }; return [:] }
}
