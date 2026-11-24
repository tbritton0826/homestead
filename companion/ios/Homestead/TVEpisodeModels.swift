import Foundation

struct TVEpisode: Identifiable, Hashable, Sendable {
    let id: String
    let episodeID: Int?
    let season: Int
    let number: Int
    let title: String
    let artwork: String?
    let status: String
    let file: ProfileMediaFile?
    let canSearch: Bool
    var code: String { String(format: "S%02dE%02d", season, number) }
    var statusLabel: String {
        if file != nil { return "Available" }
        switch status {
        case "missing": return "Missing"
        case "upcoming": return "Upcoming"
        case "requested": return "Requested"
        case "downloading": return "Downloading"
        case "importing": return "Importing"
        case "not-indexed": return "In Sonarr · not available here"
        default: return "Availability unknown"
        }
    }
}

enum TVEpisodeCatalog {
    static func build(_ response: IndexValue?, seasons: [MediaSeason]) -> [TVEpisode] {
        let files = seasons.flatMap(\.files)
        var local: [String: ProfileMediaFile] = [:]
        for file in files {
            for key in MediaDetailCatalog.episodeIdentities(file) where local[key] == nil { local[key] = file }
        }
        var result: [String: TVEpisode] = [:]
        for row in response?["episodes"]?.list ?? [] {
            guard let season = row["season"]?.text.flatMap(Int.init), season >= 0,
                  let number = row["number"]?.text.flatMap(Int.init), number >= 0 else { continue }
            let key = "\(season):\(number)"
            guard result[key] == nil else { continue }
            // A provider path never grants playback. Resolve an exact indexed
            // file that actually contains this episode, or keep it unavailable.
            let requestedPath = row["filePath"]?.text
            let file = files.first { candidate in
                candidate.path == requestedPath && MediaDetailCatalog.episodeIdentities(candidate).contains(key)
            } ?? (response == nil ? local[key] : nil)
            let state = row["status"]?.text ?? "unknown"
            result[key] = TVEpisode(id: key, episodeID: row["episodeId"]?.text.flatMap(Int.init), season: season,
                number: number, title: row["title"]?.text ?? "Episode \(number)", artwork: row["artwork"]?.text,
                status: state == "available" && file == nil ? "not-indexed" : state,
                file: file, canSearch: row["canSearch"]?.flag == true && state == "missing" && file == nil)
        }
        for (key, file) in local where result[key] == nil {
            let pieces = key.split(separator: ":").compactMap { Int($0) }
            let season = pieces.count == 2 ? pieces[0] : -1
            let number = pieces.count == 2 ? pieces[1] : 0
            result[key] = TVEpisode(id: key, episodeID: nil, season: season, number: number,
                title: PlaybackPresentation.cleanTitle(file.title), artwork: nil, status: "available", file: file, canSearch: false)
        }
        return result.values.sorted {
            if $0.season != $1.season { return $0.season < $1.season }
            if $0.number != $1.number { return $0.number < $1.number }
            return $0.id < $1.id
        }
    }
}

struct TVRelease: Identifiable, Sendable {
    let id: String
    let title: String
    let quality: String
    let indexer: String
    let size: Double
    let rejections: [String]
    let canDownload: Bool
    init?(_ row: IndexValue) {
        guard let id = row["id"]?.text, let title = row["title"]?.text else { return nil }
        self.id = id; self.title = title
        quality = row["quality"]?.text ?? "Unknown quality"
        indexer = row["indexer"]?.text ?? ""
        size = max(0, Double(row["size"]?.text ?? "") ?? 0)
        rejections = row["rejections"]?.list.compactMap(\.text) ?? []
        canDownload = row["canDownload"]?.flag == true && rejections.isEmpty
    }
}
