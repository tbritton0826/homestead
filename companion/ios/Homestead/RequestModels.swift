import Foundation

struct MediaRequestTarget {
    let kind: String
    let providerID: String
    let item: IndexValue

    static func make(_ row: IndexValue, source: String) -> MediaRequestTarget? {
        if source == "Seerr" {
            let kind = NativeSearchMapping.text(row, keys: ["mediaType", "media_type"])
            let identity = NativeSearchMapping.text(row, keys: ["tmdbId", "id"])
            guard ["movie", "tv"].contains(kind), let id = Int(identity), id > 0 else { return nil }
            return Self(kind: kind, providerID: String(id), item: row)
        }
        if source == "Books & music discovery" {
            let kind = row["type"]?.text ?? ""
            let identity = NativeSearchMapping.text(row, keys: ["providerId", "foreignBookId", "foreignAlbumId", "foreignArtistId"])
            guard ["book", "music-album", "music-artist"].contains(kind), !identity.isEmpty else { return nil }
            return Self(kind: kind, providerID: identity, item: row)
        }
        return nil
    }
    var seerr: Bool { kind == "movie" || kind == "tv" }
    var path: String { seerr ? "api/integrations/seerr/request/" + kind : "api/acquisition/request" }
    func body(title: String, seasons: Set<Int>, bookFormat: String) throws -> Data {
        var body: [String: Any]
        if seerr {
            guard let id = Int(providerID), id > 0 else { throw CocoaError(.coderInvalidValue) }
            body = ["tmdbId": id, "fromSearch": true, "title": title]
            if kind == "tv" {
                guard !seasons.isEmpty, seasons.allSatisfy({ $0 > 0 }) else { throw CocoaError(.coderInvalidValue) }
                body["seasons"] = seasons.sorted()
            }
        } else {
            body = ["item": item.jsonObject]
            if kind == "book" { body["mediaType"] = bookFormat }
        }
        return try JSONSerialization.data(withJSONObject: body)
    }
}

extension IndexValue {
    var jsonObject: Any {
        switch self {
        case .object(let fields): return fields.mapValues(\.jsonObject)
        case .array(let items): return items.map(\.jsonObject)
        case .string(let value): return value
        case .number(let value): return value
        case .bool(let value): return value
        case .other: return NSNull()
        }
    }
}
