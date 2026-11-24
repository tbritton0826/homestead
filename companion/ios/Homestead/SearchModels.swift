import Foundation

struct NativeSearchHit: Identifiable {
    let id: String
    let title: String
    let source: String
    let summary: String
    var recipe: Recipe? = nil
    var requestTarget: MediaRequestTarget? = nil
    var mediaFiles: [ProfileMediaFile] = []
    var isBook = false
    var posterPath: String? = nil
    var bannerPath: String? = nil
    var profileMetadata: [ProfileMetadataItem] = []
    var profileBiography: String = ""
    var allowsIntimateMetadata = false
    var uploadTarget: ProfileUploadTarget? = nil
    var payload: IndexValue = .object([:])
    var year = ""
    var mediaType = ""
    var status = "owned"
}

enum NativeSearchMapping {
    static func text(_ row: IndexValue, keys: [String]) -> String {
        for key in keys { if let value = row[key]?.text { return value } }
        return ""
    }
    static func hit(_ row: IndexValue, source: String, fallbackID: String) -> NativeSearchHit {
        var title = text(row, keys: ["title", "name", "displayName", "artist"])
        if title.isEmpty, let metadata = row["metadata"] { title = text(metadata, keys: ["title", "name"]) }
        if title.isEmpty { title = "Untitled" }
        var summary = text(row, keys: ["overview", "description", "subtitle", "notes"])
        if summary.isEmpty, let metadata = row["metadata"] { summary = text(metadata, keys: ["description", "overview"]) }
        let year = row["metadata"]?["year"]?.text ?? row["year"]?.text ?? ""
        if !year.isEmpty { summary = year + (summary.isEmpty ? "" : " · " + summary) }
        let recordID = text(row, keys: ["id", "providerId", "channelId"])
        let kind = text(row, keys: ["mediaType", "media_type", "type"])
        let identity = recordID.isEmpty ? fallbackID : recordID
        var hit = NativeSearchHit(id: source + ":" + kind + ":" + identity, title: title, source: source, summary: summary,
                              requestTarget: MediaRequestTarget.make(row, source: source))
        hit.payload = row
        hit.posterPath = SearchPresentation.poster(row)
        hit.bannerPath = SearchPresentation.banner(row)
        hit.year = year.isEmpty ? String((row["releaseDate"]?.text ?? row["release_date"]?.text ?? row["firstAirDate"]?.text ?? "").prefix(4)) : year
        hit.mediaType = kind
        hit.status = SearchPresentation.status(row, owned: hit.requestTarget == nil && !["Seerr", "Books & music discovery", "YouTube"].contains(source))
        return hit
    }
    static func matches(_ hit: NativeSearchHit, query: String) -> Bool {
        (hit.title + " " + hit.summary).localizedCaseInsensitiveContains(query)
    }
    static func unique(_ hits: [NativeSearchHit]) -> [NativeSearchHit] {
        var seen = Set<String>()
        return hits.filter { seen.insert($0.id).inserted }
    }
    static func libraryPermission(_ value: String) -> String {
        switch value {
        case "tv", "tvShows", "tvshows": return "tvshows"
        case "audiobooks": return "books"
        case "musicArtists": return "music"
        case "youtubeCreators": return "youtube"
        case "family-home", "family-profiles", "family-tree", "pets": return "family"
        case "personal", "girls", "performers", "celebrities": return "adult"
        default: return value
        }
    }
}
