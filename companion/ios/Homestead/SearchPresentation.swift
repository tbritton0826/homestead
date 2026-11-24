import Foundation

struct NativeSearchGroup: Identifiable {
    let id: String
    let hits: [NativeSearchHit]
}

enum SearchPresentation {
    static func tmdb(_ value: String?, size: String = "w342") -> String? {
        guard let value, !value.isEmpty else { return nil }
        if value.hasPrefix("/") && !value.hasPrefix("/media/") && !value.hasPrefix("/api/") {
            return "https://image.tmdb.org/t/p/" + size + value
        }
        return value
    }
    static func poster(_ row: IndexValue) -> String? {
        if let value = row["metadataMatch"]?["artworkOverrides"]?["gridPoster"]?.text { return value }
        if let value = ProfilePresentation.artwork(row, key: "poster") { return value }
        if let value = row["cover"]?.text { return value }
        if let value = row["thumbnail"]?.text { return value }
        if let value = row["image"]?.text { return value }
        if let value = row["imageLinks"]?["thumbnail"]?.text { return value }
        let providerPath: String? = row["posterPath"]?.text ?? row["poster_path"]?.text
        if let value = tmdb(providerPath) { return value }
        return row["metadataMatch"]?["poster"]?.text
    }
    static func banner(_ row: IndexValue) -> String? {
        if let value = row["metadataMatch"]?["artworkOverrides"]?["banner"]?.text { return value }
        if let value = row["banner"]?.text { return value }
        let providerPath: String? = row["backdropPath"]?.text ?? row["backdrop_path"]?.text
        if let value = tmdb(providerPath, size: "w1280") { return value }
        if let value = ProfilePresentation.artwork(row, key: "banner") { return value }
        return row["metadataMatch"]?["backdrop"]?.text
    }
    static func status(_ row: IndexValue, owned: Bool = false) -> String {
        if owned { return "owned" }
        for value in [row["lifecycle"]?["status"]?.text, row["homesteadStatus"]?.text, row["status"]?.text] {
            if let value, Double(value) == nil, !value.isEmpty { return value.lowercased() }
        }
        switch row["mediaInfo"]?["status"]?.text {
        case "2": return "requested"; case "3": return "processing"; case "4": return "partial"; case "5": return "owned"
        default: return "discovery"
        }
    }
    static func statusLabel(_ status: String) -> String {
        ["discovery", "missing", "not-owned", "not-requested"].contains(status) ? "Available to Request" :
            status.replacingOccurrences(of: "-", with: " ").capitalized
    }
    static func group(_ hit: NativeSearchHit) -> String {
        switch hit.requestTarget?.kind {
        case "movie": return "Discover Movies"; case "tv": return "Discover TV"
        case "book": return "Discover Books"; case "music-artist", "music-album": return "Discover Music"
        default: return hit.source
        }
    }
    static func groups(_ hits: [NativeSearchHit]) -> [NativeSearchGroup] {
        var order: [String] = [], values: [String: [NativeSearchHit]] = [:]
        for hit in hits {
            let key = group(hit)
            if values[key] == nil { order.append(key) }
            values[key, default: []].append(hit)
        }
        return order.map { NativeSearchGroup(id: $0, hits: values[$0] ?? []) }
    }
    static func requestHit(_ row: IndexValue) -> NativeSearchHit {
        var fields = row.fields
        let library = row["library"]?.text ?? ""
        let seerr = ["movies", "tv", "tvshows"].contains(library.lowercased())
        if seerr { fields["mediaType"] = .string(library == "movies" ? "movie" : "tv") }
        var hit = NativeSearchMapping.hit(.object(fields), source: seerr ? "Seerr" : "Books & music discovery", fallbackID: row["id"]?.text ?? "")
        hit.status = status(row)
        return hit
    }
    static func applyStatuses(_ rows: [IndexValue], to hits: [NativeSearchHit]) -> [NativeSearchHit] {
        hits.map { original in
            guard let target = original.requestTarget else { return original }
            let row = rows.first { value in
                if target.seerr {
                    let library = value["library"]?.text?.lowercased() ?? ""
                    guard ["movies", "tv", "tvshows"].contains(library) else { return false }
                    let type = library == "movies" ? "movie" : "tv"
                    return type == target.kind && value["tmdbId"]?.text == target.providerID
                }
                return value["providerId"]?.text == target.providerID && value["provider"]?.text == target.item["provider"]?.text
            }
            guard let row else { return original }
            var hit = original; hit.status = status(row)
            return hit
        }
    }
}
