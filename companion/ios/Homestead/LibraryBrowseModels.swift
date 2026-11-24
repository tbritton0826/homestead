import Foundation

enum MediaLibraryTab: String, CaseIterable, Identifiable {
    case songs, artists, musicVideos, albums, playlists, creators, series, collections
    var id: String { rawValue }
    var title: String { self == .musicVideos ? "Music Videos" : rawValue.capitalized }
    static func tabs(_ category: MediaCategory) -> [Self] {
        category == .music ? [.songs, .artists, .musicVideos, .albums, .playlists] : [.creators, .series, .playlists, .collections]
    }
    var manual: Bool { [.playlists, .series, .collections].contains(self) }
}

struct LibraryPlayable: Identifiable, Hashable {
    let file: ProfileMediaFile
    let subtitle: String
    let poster: String?
    var seriesName = ""
    var seasonName = ""
    var id: String { file.id }
}
struct LibraryBrowseGroup: Identifiable {
    let id: String
    let title: String
    let poster: String?
    var files: [LibraryPlayable]
    var saved: IndexValue? = nil
}
struct LibraryBrowseSnapshot {
    var files: [LibraryPlayable] = []
    var people: [LibraryBrowseGroup] = []
    var albums: [LibraryBrowseGroup] = []
    var series: [LibraryBrowseGroup] = []
    var playlists: [LibraryBrowseGroup] = []
}

enum LibraryBrowseCatalog {
    static func rows(_ value: IndexValue?) -> [(String, IndexValue)] {
        guard let value else { return [] }
        if case .array = value { return value.list.enumerated().map { (String($0.offset), $0.element) } }
        return value.fields.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }
    static func directory(_ path: String) -> String {
        let parts = URLComponents(string: path)
        let raw = parts?.queryItems?.first(where: { $0.name == "path" })?.value ?? parts?.path ?? path
        return (raw.removingPercentEncoding ?? raw).replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").dropLast().joined(separator: "/")
    }
    static func build(index: IndexValue, category: MediaCategory) -> LibraryBrowseSnapshot {
        var result = LibraryBrowseSnapshot()
        let root = index["libraries"] ?? index
        let library = category.aliases.compactMap { root[$0] }.first
        for (key, person) in rows(library) {
            let personID = person["id"]?.text ?? key
            let name = person["name"]?.text ?? person["title"]?.text ?? person["artist"]?.text ?? key
            let poster = ProfilePresentation.artwork(person, key: "poster")
            let indexedFiles = PlaybackCatalog.files(person)
            let files = indexedFiles.filter { $0.playable }.map { file -> LibraryPlayable in
                let parent = directory(file.path)
                let artwork = indexedFiles.first { !$0.playable && directory($0.path) == parent && ["cover", "folder", "poster", "album"].contains((($0.title as NSString).deletingPathExtension).lowercased()) }?.path ?? poster
                return LibraryPlayable(file: file, subtitle: name, poster: artwork)
            }
            result.people.append(LibraryBrowseGroup(id: personID, title: name, poster: poster, files: files))
            for (albumKey, album) in rows(person["albums"]) {
                let artwork = ProfilePresentation.artwork(album, key: "poster") ?? poster
                let tracks = PlaybackCatalog.files(album).filter(\.audio).map { LibraryPlayable(file: $0, subtitle: name, poster: artwork) }
                let title = album["title"]?.text ?? album["name"]?.text ?? albumKey
                result.albums.append(LibraryBrowseGroup(id: personID + ":album:" + albumKey, title: title, poster: artwork, files: tracks))
            }
            if category == .music && rows(person["albums"]).isEmpty {
                let grouped = Dictionary(grouping: files.filter { $0.file.audio }, by: { directory($0.file.path) })
                for (directory, tracks) in grouped {
                    let title = (directory as NSString).lastPathComponent
                    result.albums.append(LibraryBrowseGroup(id: personID + ":album:" + directory, title: title, poster: tracks.first?.poster, files: tracks))
                }
            }
            // Series remain scoped to the creator. No grouping by guessed title/game.
            var series: [String: [LibraryPlayable]] = [:]
            var playlists: [String: [LibraryPlayable]] = [:]
            var enriched: [String: LibraryPlayable] = [:]
            for (_, video) in rows(person["videos"]) {
                let metadata = video["metadata"]
                let artwork = video["thumbnail"]?.text ?? video["thumb"]?.text ?? poster
                let seriesName = video["series"]?.text ?? video["seriesName"]?.text ?? metadata?["series"]?.text ?? video["playlistTitle"]?.text ?? ""
                let seasonName = video["season"]?.text ?? video["seasonName"]?.text ?? metadata?["season"]?.text ?? "Unsorted"
                let entries = PlaybackCatalog.files(video).filter(\.video).map { LibraryPlayable(file: $0, subtitle: name, poster: artwork, seriesName: seriesName, seasonName: seasonName) }
                for entry in entries { enriched[entry.id] = entry }
                if !seriesName.isEmpty && !["other-videos", "other videos"].contains(seriesName.lowercased()) { series[seriesName, default: []] += entries }
                let playlistName = video["playlistTitle"]?.text ?? metadata?["playlist_title"]?.text ?? metadata?["playlistTitle"]?.text ?? ""
                if !playlistName.isEmpty { playlists[playlistName, default: []] += entries }
            }
            let personFiles = files.map { enriched[$0.id] ?? $0 }
            result.people[result.people.count - 1].files = personFiles
            result.files += personFiles
            for (name, entries) in series { result.series.append(LibraryBrowseGroup(id: personID + ":series:" + name, title: name, poster: entries.first?.poster, files: entries)) }
            for (name, entries) in playlists { result.playlists.append(LibraryBrowseGroup(id: personID + ":playlist:" + name, title: name, poster: entries.first?.poster, files: entries)) }
        }
        var seen = Set<String>()
        result.files = result.files.filter { seen.insert($0.id).inserted }.sorted { $0.file.title.localizedStandardCompare($1.file.title) == .orderedAscending }
        return result
    }
    static func custom(_ rows: [IndexValue], category: MediaCategory, tab: MediaLibraryTab, files: [LibraryPlayable]) -> [LibraryBrowseGroup] {
        rows.compactMap { row in
            guard row["library"]?.text == category.rawValue, row["libraryTab"]?.text == tab.rawValue, let id = row["id"]?.text else { return nil }
            let references = row["items"]?.list ?? []
            let matched = references.compactMap { reference in files.first { $0.id == reference["sourceId"]?.text } }
            // Playback comes only from the current account's index, never a saved path.
            return LibraryBrowseGroup(id: "custom:" + id, title: row["name"]?.text ?? "Collection", poster: row["poster"]?.text ?? matched.first?.poster, files: matched, saved: row)
        }
    }
}
