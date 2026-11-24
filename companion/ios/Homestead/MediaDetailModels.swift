import Foundation

struct MediaSeason: Identifiable, Hashable, Sendable {
    let number: Int
    var files: [ProfileMediaFile]
    var total: Int?
    var id: Int { number }
    var title: String { number < 0 ? "Other episodes" : number == 0 ? "Specials" : "Season \(number)" }
    var available: Int { Set(files.flatMap { MediaDetailCatalog.episodeIdentities($0) }).count }
    var countLabel: String { total.map { "\(available)/\($0)" } ?? "\(available) available" }
}

struct MediaCredit: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let character: String
    let poster: String?
}

struct MediaRelated: Identifiable, Hashable, Sendable {
    let providerID: String
    let type: String
    let title: String
    let poster: String?
    let year: String
    var id: String { type + ":" + providerID }
    var hit: NativeSearchHit {
        NativeSearchMapping.hit(.object(["id": .string(providerID), "mediaType": .string(type),
            "title": .string(title), "posterPath": .string(poster ?? ""), "year": .string(year)]),
            source: "Seerr", fallbackID: providerID)
    }
}

struct MediaDetailSnapshot: Hashable, Sendable {
    var providerID: String?
    var seasons: [MediaSeason] = []
    var cast: [MediaCredit] = []
    var related: [MediaRelated] = []
}

enum MediaDetailCatalog {
    static func ownedItem(_ hit: NativeSearchHit, items: [MediaItem]) -> MediaItem? {
        let ids = Set(["id", "localId", "sourcePath", "folderPath"].compactMap { hit.payload[$0]?.text })
        let paths = Set(hit.mediaFiles.map(\.path))
        return items.first { item in
            [.movies, .tv].contains(item.category) && hit.source == item.category.title &&
                (!ids.isDisjoint(with: Set(item.identities + [item.id])) || item.files.contains { paths.contains($0.path) })
        }
    }
    static func movieVersions(_ files: [ProfileMediaFile]) -> [ProfileMediaFile] {
        files.filter { file in
            let path = file.path.replacingOccurrences(of: "\\", with: "/")
            let name = ((file.title as NSString).deletingPathExtension).lowercased()
            return file.video && capture(path, #"(?:^|/)(?:extras|trailers|featurettes|samples)(?:/|$)"#, group: 0) == nil &&
                capture(name, #"^(?:trailer|sample)(?:[ ._-]\d+)?$|[ ._-](?:trailer|sample)$"#, group: 0) == nil
        }
    }
    static func updatingTotals(_ seasons: [MediaSeason], totals: [Int: Int]) -> [MediaSeason] {
        var result = seasons
        for (number, count) in totals {
            if let index = result.firstIndex(where: { $0.number == number }) { result[index].total = count }
            else { result.append(MediaSeason(number: number, files: [], total: count)) }
        }
        return result.sorted { $0.number < $1.number }
    }
    static func number(_ value: IndexValue?) -> Int? { value?.text.flatMap(Int.init) }
    static func capture(_ text: String, _ pattern: String, group: Int = 1) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), group < match.numberOfRanges,
              let range = Range(match.range(at: group), in: text) else { return nil }
        return String(text[range])
    }
    static func seasonNumber(_ file: ProfileMediaFile) -> Int? {
        let path = file.path.replacingOccurrences(of: "\\", with: "/")
        return capture(path, #"(?:^|[^a-z0-9])s(\d{1,3})e\d+"#).flatMap(Int.init)
            ?? capture(path, #"(?:^|/)season[ ._-]*(\d{1,3})(?:/|$)"#).flatMap(Int.init)
            ?? capture(path, #"(?:^|[^a-z0-9])(\d{1,2})x\d{1,3}(?:[^0-9]|$)"#).flatMap(Int.init)
    }
    static func episodeIdentities(_ file: ProfileMediaFile) -> [String] {
        let text = file.title + " " + file.path
        let pattern = #"s(\d{1,3})e(\d{1,3})((?:e\d{1,3}|-e?\d{1,3})*)"#
        if let season = capture(text, pattern).flatMap(Int.init),
           let first = capture(text, pattern, group: 2).flatMap(Int.init) {
            let suffix = capture(text, pattern, group: 3) ?? ""
            if suffix.hasPrefix("-"), let last = capture(suffix, #"(\d+)"#).flatMap(Int.init), last >= first, last - first < 100 {
                return (first...last).map { "\(season):\($0)" }
            }
            let regex = try? NSRegularExpression(pattern: #"e(\d{1,3})"#, options: .caseInsensitive)
            let extra = regex?.matches(in: suffix, range: NSRange(suffix.startIndex..., in: suffix)).compactMap { match -> Int? in
                guard let range = Range(match.range(at: 1), in: suffix) else { return nil }; return Int(suffix[range])
            } ?? []
            return ([first] + extra).map { "\(season):\($0)" }
        }
        if let season = capture(text, #"(\d{1,2})x(\d{1,3})"#).flatMap(Int.init),
           let episode = capture(text, #"(\d{1,2})x(\d{1,3})"#, group: 2).flatMap(Int.init) { return ["\(season):\(episode)"] }
        return [file.id]
    }
    static func seasons(row: IndexValue, files: [ProfileMediaFile], metadata: IndexValue? = nil) -> [MediaSeason] {
        var groups: [Int: [ProfileMediaFile]] = [:]
        var totals: [Int: Int] = [:]
        var assigned = Set<String>()
        for (key, season) in LibraryBrowseCatalog.rows(row["seasons"]) {
            let n = number(season["seasonNumber"]) ?? number(season["season_number"])
                ?? capture(key, #"(\d+)"#).flatMap(Int.init)
            guard let n, n >= 0 else { continue }
            let entries = PlaybackCatalog.files(season).filter(\.video)
            groups[n, default: []] += entries; assigned.formUnion(entries.map(\.id))
            if let count = number(season["episodeCount"] ?? season["episode_count"]), count > 0 { totals[n] = count }
        }
        for file in files where file.video && !assigned.contains(file.id) {
            if let n = seasonNumber(file) { groups[n, default: []].append(file) }
            else { groups[-1, default: []].append(file) }
        }
        for (_, season) in LibraryBrowseCatalog.rows(metadata?["seasons"]) {
            if let n = number(season["seasonNumber"] ?? season["season_number"]), n >= 0,
               let count = number(season["episodeCount"] ?? season["episode_count"]), count > 0 { totals[n] = count }
        }
        let numbers = Set(groups.keys).union(totals.keys)
        return numbers.sorted().map { n in
            var seen = Set<String>()
            let entries = (groups[n] ?? []).filter { seen.insert($0.id).inserted }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            return MediaSeason(number: n, files: entries, total: totals[n])
        }
    }
    static func snapshot(row: IndexValue, match: IndexValue?, category: MediaCategory, files: [ProfileMediaFile]) -> MediaDetailSnapshot {
        let metadata = row["metadata"]
        let id = match?["tmdbId"]?.text ?? (match?["provider"]?.text == "tmdb" ? match?["providerId"]?.text : nil)
            ?? row["tmdbId"]?.text ?? metadata?["tmdbId"]?.text
        var result = MediaDetailSnapshot(providerID: id.flatMap { Int($0).flatMap { $0 > 0 ? String($0) : nil } })
        let source = match ?? metadata ?? row
        result.cast = credits(source["cast"] ?? source["credits"]?["cast"] ?? metadata?["cast"] ?? row["cast"])
        result.related = related(source["related"] ?? source["recommendations"] ?? metadata?["related"] ?? row["related"], defaultType: category == .tv ? "tv" : "movie")
        if category == .tv { result.seasons = seasons(row: row, files: files, metadata: source["seasons"] == nil ? metadata ?? row : source) }
        return result
    }
    static func credits(_ value: IndexValue?) -> [MediaCredit] {
        var seen = Set<String>()
        return (value?.list ?? []).prefix(40).compactMap { row in
            guard let name = row["name"]?.text else { return nil }
            let id = row["id"]?.text ?? name
            guard seen.insert(id).inserted else { return nil }
            return MediaCredit(id: id, name: name, character: row["character"]?.text ?? "",
                               poster: SearchPresentation.tmdb(row["profilePath"]?.text ?? row["profile_path"]?.text))
        }
    }
    static func related(_ value: IndexValue?, defaultType: String) -> [MediaRelated] {
        var seen = Set<String>()
        return (value?["results"]?.list ?? value?.list ?? []).prefix(30).compactMap { row in
            guard let id = row["id"]?.text, let int = Int(id), int > 0,
                  let title = row["title"]?.text ?? row["name"]?.text else { return nil }
            let type = row["mediaType"]?.text ?? row["media_type"]?.text ?? defaultType
            guard ["movie", "tv"].contains(type), seen.insert(type + ":" + id).inserted else { return nil }
            return MediaRelated(providerID: id, type: type, title: title,
                                poster: SearchPresentation.tmdb(row["posterPath"]?.text ?? row["poster_path"]?.text),
                                year: String((row["releaseDate"]?.text ?? row["release_date"]?.text ?? row["first_air_date"]?.text ?? "").prefix(4)))
        }
    }
}

enum PlaybackPresentation {
    static func cleanTitle(_ title: String) -> String {
        let ext = (title as NSString).pathExtension.lowercased()
        let known = ["mp3", "m4a", "m4b", "flac", "aac", "ogg", "wav", "epub", "pdf", "mp4", "mkv", "mov", "m4v", "webm"]
        return (known.contains(ext) ? (title as NSString).deletingPathExtension : title)
            .replacingOccurrences(of: "_", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let value = Int(min(seconds, 35999999))
        return value >= 3600 ? String(format: "%d:%02d:%02d", value / 3600, value / 60 % 60, value % 60)
            : String(format: "%d:%02d", value / 60, value % 60)
    }
    static func needsChoice(resume: Double) -> Bool { resume.isFinite && resume > 0 }
    static func boundedSeek(_ seconds: Double, duration: Double) -> Double {
        guard seconds.isFinite, duration.isFinite, duration > 0 else { return 0 }
        return min(max(0, seconds), duration)
    }
}
