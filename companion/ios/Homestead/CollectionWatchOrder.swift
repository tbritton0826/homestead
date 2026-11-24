import Foundation

struct CollectionOrderEpisode: Identifiable, Sendable {
    let id: String
    let label: String
    let file: ProfileMediaFile?
}

struct CollectionOrderRow: Identifiable, Sendable {
    let id: String
    let number: Int
    let title: String
    let detail: String
    let date: String
    let item: MediaItem?
    let episodes: [CollectionOrderEpisode]
    var canBrowseTitle: Bool { item != nil && episodes.isEmpty }
}

struct CollectionOrderSection: Identifiable, Sendable {
    let id: String
    let title: String
    let rows: [CollectionOrderRow]
}

struct CollectionWatchOrder: Sendable {
    let title: String
    let sections: [CollectionOrderSection]
    var count: Int { sections.reduce(0) { $0 + $1.rows.count } }

    static func decode(_ value: IndexValue?, media: [MediaItem]) -> Self? {
        guard let value, case .object = value else { return nil }
        // Match only the current account's index. A reference never authorizes
        // a file path, and an explicit missing ID never falls back to a title.
        var byID: [String: [MediaItem]] = [:]
        var byTitle: [String: [MediaItem]] = [:]
        for item in media {
            for identity in Set(item.identities + [item.id]) {
                byID[item.category.rawValue + ":" + identity, default: []].append(item)
            }
            byTitle[item.category.rawValue + ":" + titleKey(item.title), default: []].append(item)
        }
        var number = 0
        var episodeIndexes: [String: [String: ProfileMediaFile]] = [:]
        let sections = (value["sections"]?.list ?? []).enumerated().map { sectionIndex, section in
            let rows = (section["items"]?.list ?? []).enumerated().map { rowIndex, row -> CollectionOrderRow in
                number += 1
                let library = row["library"]?.text ?? (row["type"]?.text == "movie" ? "movies" : row["type"]?.text == "book" ? "books" : "tv")
                let title = row["title"]?.text ?? "Unavailable title"
                let sourceID = row["sourceId"]?.text ?? row["localId"]?.text
                let matches = sourceID.map { byID[library + ":" + $0] ?? [] } ?? byTitle[library + ":" + titleKey(title)] ?? []
                let item = matches.count == 1 && row["unmatched"]?.flag != true ? matches.first : nil
                let season = MediaDetailCatalog.number(row["season"])
                if library == "tv", let item, episodeIndexes[item.id] == nil {
                    episodeIndexes[item.id] = indexEpisodes(item)
                }
                let files = item.flatMap { episodeIndexes[$0.id] } ?? [:]
                let episodes = library == "tv" ? episodeRows(row, files: files, season: season, id: "\(sectionIndex):\(rowIndex)") : []
                let detail = row["detail"]?.text ?? season.map { $0 == 0 ? "Specials" : "Season \($0)" } ?? (library == "tv" ? "TV series" : library == "books" ? "Book" : "Movie")
                return CollectionOrderRow(id: "\(sectionIndex):\(rowIndex)", number: number, title: title, detail: detail, date: row["date"]?.text ?? "", item: item, episodes: episodes)
            }
            return CollectionOrderSection(id: String(sectionIndex), title: section["title"]?.text ?? "Watch Order", rows: rows)
        }
        return Self(title: value["title"]?.text ?? "Watch Order", sections: sections)
    }

    private static func titleKey(_ title: String) -> String {
        let title = title.replacingOccurrences(of: #"\s*\((?:19|20)\d{2}\)\s*$"#, with: "", options: .regularExpression)
        return SharedCollectionCatalog.normalized(title)
    }

    private static func indexEpisodes(_ item: MediaItem) -> [String: ProfileMediaFile] {
        var result: [String: ProfileMediaFile] = [:]
        var seen = Set<String>()
        for file in item.files + item.detail.seasons.flatMap(\.files) where file.video && seen.insert(file.id).inserted {
            for identity in MediaDetailCatalog.episodeIdentities(file) where result[identity] == nil { result[identity] = file }
        }
        return result
    }

    private static func episodeRows(_ row: IndexValue, files: [String: ProfileMediaFile], season: Int?, id: String) -> [CollectionOrderEpisode] {
        guard let season, season >= 0, season <= 999 else { return [] }
        var numbers = (row["episodes"]?.list ?? []).compactMap { MediaDetailCatalog.number($0) }.filter { (0...9999).contains($0) }
        if numbers.isEmpty, let first = MediaDetailCatalog.number(row["episodeStart"] ?? row["startEpisode"] ?? row["episode"]),
           let last = MediaDetailCatalog.number(row["episodeEnd"] ?? row["endEpisode"] ?? row["episode"]),
           first >= 0, last >= first, last <= 9999, last - first < 1000 {
            numbers = Array(first...last)
        }
        if numbers.isEmpty, row["unit"]?.text == "season" {
            numbers = files.keys.compactMap { identity -> Int? in
                let parts = identity.split(separator: ":")
                guard parts.count == 2, Int(parts[0]) == season else { return nil }
                return Int(parts[1])
            }.sorted()
        }
        // The authored episode sequence, including Specials and crossover
        // repetitions, is preserved. A missing episode stays visibly missing.
        return numbers.enumerated().map { offset, episode in
            CollectionOrderEpisode(id: "\(id):\(offset)", label: String(format: "S%02dE%02d", season, episode), file: files["\(season):\(episode)"])
        }
    }
}
