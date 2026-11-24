import Foundation

struct SharedMediaCollection: Identifiable, Hashable {
    let id: String
    var title: String
    var summary: String
    var poster: String?
    var banner: String?
    var items: [MediaItem]
    // The custom: prefix namespaces the local grid identity only.
    var serverID: String { id.hasPrefix("custom:") ? String(id.dropFirst(7)) : id }
}

enum SharedCollectionCatalog {
    static func names(_ row: IndexValue) -> [String] {
        var result: [String] = []
        for source in [row, row["metadata"] ?? .object([:])] {
            let values = ["collection", "collectionName", "tmdbCollectionName", "belongs_to_collection", "belongsToCollection"].compactMap { source[$0] }
                + (source["collections"]?.list ?? [])
            for value in values {
                if let name = value.text ?? value["name"]?.text ?? value["title"]?.text { result.append(name) }
            }
        }
        return Array(Set(result)).sorted()
    }
    static func normalized(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .replacingOccurrences(of: "&", with: " and ")
            .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }
    static func resolve(_ reference: IndexValue, media: [MediaItem]) -> MediaItem? {
        guard let library = reference["library"]?.text else { return nil }
        let id = reference["sourceId"]?.text ?? reference["localId"]?.text ?? reference["id"]?.text
        // Never use a saved reference's file paths as playback authorization.
        return media.first { item in
            item.category.rawValue == library && id.map { item.identities.contains($0) || item.id == library + ":" + $0 } == true
        }
    }
    static func build(media: [MediaItem], custom: [IndexValue], seeds: [IndexValue], orders: [IndexValue], appearances: [IndexValue]) -> [SharedMediaCollection] {
        var groups: [String: SharedMediaCollection] = [:]
        let savedGroupIDs = Set((orders + appearances).compactMap { $0["collectionId"]?.text })
        for item in media {
            for name in item.collectionNames {
                let id = normalized(name).replacingOccurrences(of: " ", with: "-")
                guard savedGroupIDs.contains(id) else { continue }
                if groups[id] == nil { groups[id] = SharedMediaCollection(id: id, title: name, summary: "", items: []) }
                if groups[id]?.items.contains(where: { $0.id == item.id }) == false { groups[id]?.items.append(item) }
            }
        }
        for seed in seeds {
            guard let id = seed["id"]?.text, let name = seed["name"]?.text, savedGroupIDs.contains(id) else { continue }
            let items = media.filter { item in
                guard [.movies, .tv, .books].contains(item.category) else { return false }
                let title = normalized(item.title)
                let exact = title.replacingOccurrences(of: "\\s(?:19|20)\\d{2}$", with: "", options: .regularExpression)
                return (seed["terms"]?.list ?? []).contains { term in
                    guard let term = term.text else { return false }
                    return (" " + title + " ").contains(" " + normalized(term) + " ")
                } || (seed["exactTerms"]?.list ?? []).contains { $0.text.map { normalized($0) == exact } == true }
            }
            if !items.isEmpty { groups[id] = SharedMediaCollection(id: id, title: name, summary: seed["description"]?.text ?? "", items: items) }
        }
        for id in Array(groups.keys) { groups[id]?.items.sort { ($0.year, $0.title) < ($1.year, $1.title) } }
        for saved in custom {
            guard let id = saved["id"]?.text else { continue }
            let references = (saved["items"]?.list ?? []).enumerated().sorted {
                (Double($0.element["order"]?.text ?? "") ?? Double($0.offset)) < (Double($1.element["order"]?.text ?? "") ?? Double($1.offset))
            }
            var seen = Set<String>()
            let items = references.compactMap { resolve($0.element, media: media) }.filter { seen.insert($0.id).inserted }
            // Do not disclose collections whose contents are all outside this account's index.
            guard !items.isEmpty else { continue }
            if let generated = saved["generatedCollectionId"]?.text { groups.removeValue(forKey: generated) }
            groups["custom:" + id] = SharedMediaCollection(id: "custom:" + id, title: saved["name"]?.text ?? "Collection", summary: saved["description"]?.text ?? "", poster: saved["poster"]?.text, banner: saved["banner"]?.text, items: items)
        }
        for order in orders {
            guard let id = order["collectionId"]?.text, var group = groups[id] else { continue }
            var seen = Set<String>()
            let ordered = (order["items"]?.list ?? []).compactMap { resolve($0, media: group.items) }.filter { seen.insert($0.id).inserted }
            group.items = ordered + group.items.filter { !seen.contains($0.id) }; groups[id] = group
        }
        for appearance in appearances {
            guard let id = appearance["collectionId"]?.text else { continue }
            let key = groups[id] != nil ? id : "custom:" + id
            guard var group = groups[key] else { continue }
            group.title = appearance["name"]?.text ?? group.title
            group.summary = appearance["description"]?.text ?? group.summary
            group.poster = appearance["poster"]?.text ?? group.poster
            group.banner = appearance["banner"]?.text ?? group.banner
            groups[key] = group
        }
        return groups.values.map { group in
            var result = group
            result.poster = group.poster ?? group.items.compactMap(\.poster).first
            return result
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}
