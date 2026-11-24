import Foundation

enum ArtworkAddress {
    static func nativeImageURL(path: String, server: URL, preview: Bool) -> URL? {
        guard let original = url(path: path, server: server, preview: preview) else { return nil }
        let file = ProfileMediaFile(path: path, title: "", video: false)
        guard ["heic", "heif"].contains(file.fileExtension),
              var parts = URLComponents(url: original, resolvingAgainstBaseURL: false) else { return original }
        if parts.path.hasPrefix("/media/") {
            // Use the authorized raw-file endpoint, bypassing server HEIC conversion.
            let sourcePath = parts.path
            parts.path = "/api/file"
            parts.queryItems = [URLQueryItem(name: "path", value: sourcePath)]
        }
        guard parts.path == "/api/file" else { return original }
        var query = parts.queryItems ?? []
        query.removeAll { ["raw", "width", "quality"].contains($0.name) }
        query.append(URLQueryItem(name: "raw", value: "1"))
        parts.queryItems = query
        return parts.url
    }
    static func url(path: String, server: URL, preview: Bool) -> URL? {
        if let address = URL(string: path, relativeTo: server)?.absoluteURL,
           address.user == nil, address.password == nil {
            let sameServer = address.scheme == server.scheme && address.host == server.host && address.port == server.port
            if sameServer && (address.path == "/api/artwork/cache" || address.path.hasPrefix("/api/books/artwork/") || address.path.hasPrefix("/api/inventory/native/items/") || address.path.hasPrefix("/api/collections/") || address.path.hasPrefix("/api/youtube/channel/")) {
                return address
            }
            if !sameServer && address.scheme == "https" {
                // The server's artwork cache validates providers and fetches the
                // image. The app never forwards account cookies to a provider.
                var proxy = URLComponents(url: server.appendingPathComponent("api/artwork/cache"), resolvingAgainstBaseURL: false)
                proxy?.queryItems = [URLQueryItem(name: "url", value: address.absoluteString)]
                return proxy?.url
            }
        }
        return ProfileMediaFile.url(path: path, server: server, preview: preview)
    }
}

struct ProfileMediaFile: Identifiable, Hashable, Sendable {
    let path: String
    let title: String
    let video: Bool
    var id: String { path }
    var audio: Bool {
        let parts = URLComponents(string: path)
        let raw = parts?.queryItems?.first(where: { $0.name == "path" })?.value ?? parts?.path ?? path
        return ["mp3", "m4a", "m4b", "aac", "flac", "wav", "ogg", "aiff"].contains((raw as NSString).pathExtension.lowercased())
    }
    var readable: Bool { ["epub", "pdf"].contains(fileExtension) }
    var fileExtension: String {
        let parts = URLComponents(string: path)
        let raw = parts?.queryItems?.first(where: { $0.name == "path" })?.value ?? parts?.path ?? path
        return (raw as NSString).pathExtension.lowercased()
    }
    var playable: Bool { video || audio }
    static func files(_ row: IndexValue, includeBooks: Bool = false, baseFolder: String? = nil) -> [Self] {
        func values(_ value: IndexValue?) -> [IndexValue] {
            guard let value else { return [] }
            if case .array = value { return value.list }
            if value.text != nil || value["path"] != nil || value["sourcePath"] != nil || value["filePath"] != nil { return [value] }
            return value.fields.sorted { $0.key < $1.key }.map { $0.value }
        }
        var entries = values(row["files"]) + values(row["photos"]) + values(row["videos"])
        if includeBooks {
            for key in ["ebookFiles", "audiobookFiles", "audioFiles"] {
                entries += values(row[key])
            }
        }
        if entries.isEmpty { entries = [row] }
        var seen = Set<String>()
        return entries.compactMap { entry in
            var path = entry.text ?? NativeSearchMapping.text(entry, keys: ["sourcePath", "filePath", "path", "publicPath", "url"])
            if includeBooks, !path.isEmpty, !path.hasPrefix("/"), URL(string: path)?.scheme == nil,
               let folder = row["folderPath"]?.text ?? baseFolder {
                path = folder.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + path
                if folder.hasPrefix("/") { path = "/" + path }
            }
            let parts = URLComponents(string: path)
            let rawName = parts?.queryItems?.first(where: { $0.name == "path" })?.value ?? parts?.path ?? path
            let ext = (rawName as NSString).pathExtension.lowercased()
            let video = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "ts", "m2ts"].contains(ext)
            guard video || (includeBooks && ["epub", "pdf"].contains(ext)) || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "mp3", "m4a", "m4b", "aac", "flac", "wav", "ogg", "aiff"].contains(ext), seen.insert(path).inserted else { return nil }
            let name = NativeSearchMapping.text(entry, keys: ["title", "name"])
            return Self(path: path, title: name.isEmpty ? (rawName as NSString).lastPathComponent : name, video: video)
        }
    }
    static func url(path: String, server: URL, preview: Bool) -> URL? {
        var address: URLComponents?
        if path.hasPrefix("/media/") || path.hasPrefix("/api/file?") {
            address = URLComponents(url: URL(string: path, relativeTo: server)?.absoluteURL ?? server, resolvingAgainstBaseURL: false)
        } else if path.hasPrefix("/") && !path.hasPrefix("//") {
            address = URLComponents(url: server.appendingPathComponent("api/file"), resolvingAgainstBaseURL: false)
            address?.queryItems = [URLQueryItem(name: "path", value: path)]
        } else if let absolute = URL(string: path), absolute.scheme == server.scheme, absolute.host == server.host, absolute.port == server.port {
            address = URLComponents(url: absolute, resolvingAgainstBaseURL: false)
        } else { return nil }
        guard let current = address, current.user == nil, current.password == nil,
              current.scheme == server.scheme, current.host == server.host, current.port == server.port,
              current.path.hasPrefix("/media/") || current.path == "/api/file" else { return nil }
        if preview && current.path.hasPrefix("/media/") {
            address?.path = "/api/file"
            var query = current.queryItems ?? []
            query.removeAll { $0.name == "path" }
            query.append(URLQueryItem(name: "path", value: current.path))
            address?.queryItems = query
        }
        if preview && address?.path == "/api/file" {
            var items = address?.queryItems ?? []
            items.removeAll { ["width", "quality", "raw"].contains($0.name) }
            items += [URLQueryItem(name: "width", value: "640"), URLQueryItem(name: "quality", value: "80")]
            address?.queryItems = items
        }
        guard let url = address?.url,
              url.standardized.path.hasPrefix("/media/") || url.standardized.path == "/api/file" else { return nil }
        return url
    }
}

enum ProfileMediaTab: String, CaseIterable, Identifiable {
    case photos = "Photos", nudes = "Nudes", videos = "Videos", sex = "Sex", keepsakes = "Keepsakes", ai = "AI", artwork = "Artwork", other = "Other"
    var id: String { rawValue }
}

extension ProfileMediaFile {
    var tab: ProfileMediaTab {
        let parts = URLComponents(string: path)
        let raw = parts?.queryItems?.first(where: { $0.name == "path" })?.value ?? parts?.path ?? path
        let clean = raw.replacingOccurrences(of: "\\", with: "/").lowercased()
        let basename = ((clean as NSString).lastPathComponent as NSString).deletingPathExtension
        if clean.contains("/artwork/") || ["poster", "banner", "headshot", "breasts", "ass", "pussy"].contains(basename) { return .artwork }
        if clean.contains("/sex/") { return .sex }
        if clean.contains("/nude/") || clean.contains("/nudes/") { return .nudes }
        if clean.contains("/keepsakes/") { return .keepsakes }
        if clean.contains("/ai/") { return .ai }
        if video { return .videos }
        if clean.contains("/photos/") { return .photos }
        return .other
    }
}

struct ProfileMetadataItem: Identifiable {
    let label: String
    let value: String
    var symbol = "info.circle"
    var intimate = false
    var opensBiography = false
    var id: String { label }
}

enum ProfilePresentation {
    static func biography(_ row: IndexValue) -> String {
        let sources = [row["metadata"], row["profile"], row].compactMap({ $0 })
        for source in sources {
            if source["biography"] != nil, source["metadataLocks"]?["biography"]?.flag == true {
                return biographyText(source["biography"]?.text ?? "")
            }
        }
        // `bio` is commonly the scanner's bio.md path, not the About text.
        // Prefer canonical text across all sources before trying that legacy field.
        for key in ["biography", "description", "overview", "summary", "about", "bio"] {
            for source in sources {
                let value = biographyText(source[key]?.text ?? "")
                if !value.isEmpty { return value }
            }
        }
        return ""
    }
    static func biographyText(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = value.lowercased()
        guard !lower.hasPrefix("<!doctype html"), !lower.hasPrefix("<html"), !value.contains("<div id=\"root\"") else { return "" }
        if !value.contains("\n") && !value.contains("\r") {
            if value.hasPrefix("/") || value.hasPrefix("\\") || lower.hasPrefix("file:") || lower.hasPrefix("http://") || lower.hasPrefix("https://") { return "" }
            if value.range(of: #"^[A-Za-z]:[\\/]"#, options: .regularExpression) != nil { return "" }
            let suffix = (value as NSString).pathExtension.lowercased()
            if ["md", "markdown", "txt", "json"].contains(suffix),
               !value.contains(where: { $0.isWhitespace }) || value.contains("/") || value.contains("\\") { return "" }
        }
        return value
    }
    static func biographyFile(_ row: IndexValue) -> String? {
        let sources = [row["metadata"], row["profile"], row].compactMap({ $0 })
        guard biography(row).isEmpty else { return nil }
        if sources.contains(where: { $0["biography"] != nil && $0["metadataLocks"]?["biography"]?.flag == true }) { return nil }
        for source in sources {
            for key in ["bio", "biography"] {
                guard let raw = source[key]?.text else { continue }
                let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                let path = URLComponents(string: value)?.queryItems?.first(where: { $0.name == "path" })?.value
                    ?? URLComponents(string: value)?.path ?? value
                guard ["md", "markdown", "txt"].contains((path as NSString).pathExtension.lowercased()),
                      !value.contains("\n"), !value.contains("\r") else { continue }
                var fields = row.fields
                fields["bio"] = .string(value)
                return artwork(.object(fields), key: "bio")
            }
        }
        return nil
    }
    static func metadata(_ row: IndexValue, allowIntimate: Bool = false, now: Date = Date()) -> [ProfileMetadataItem] {
        let metadata = row["metadata"] ?? row
        let body = metadata["bodyDetails"] ?? metadata["body"] ?? .object([:])
        func value(_ keys: [String]) -> String {
            for key in keys {
                for source in [metadata, body, row] {
                    guard let entry = source[key] else { continue }
                    let text = entry.text ?? (entry["unit"]?.text.map { (entry["value"]?.text ?? entry["amount"]?.text ?? "") + " " + $0 } ?? entry.list.compactMap(\.text).joined(separator: ", "))
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }
                }
            }
            return ""
        }
        let birthday = value(["birthday", "birthDate", "birthdate", "dateOfBirth"])
        let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(secondsFromGMT: 0); parser.dateFormat = "yyyy-MM-dd"; parser.isLenient = false
        let birth = parser.date(from: String(birthday.prefix(10)))
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let age = birth.flatMap { calendar.dateComponents([.year], from: $0, to: now).year } ?? Int(value(["age"]))
        let child = [metadata, row].contains { source in ["profileType", "role", "library", "libraryType", "kind"].contains { key in ["child", "children", "minor"].contains(source[key]?.text?.lowercased() ?? "") } } ||
            metadata["isChild"]?.flag == true || row["isChild"]?.flag == true || (age.map { $0 < 18 } ?? false)
        let sensitive = allowIntimate && !child
        var items: [ProfileMetadataItem] = []
        func add(_ label: String, _ text: String, _ symbol: String, intimate: Bool = false) {
            guard !text.isEmpty, !intimate || sensitive else { return }
            items.append(ProfileMetadataItem(label: label, value: text, symbol: symbol, intimate: intimate))
        }
        if !biography(row).isEmpty { items.append(ProfileMetadataItem(label: "Bio", value: "Bio", symbol: "info.circle", opensBiography: true)) }
        add("Clothing size", value(["clothingSize", "dressSize"]), "tshirt")
        add("Panty size", value(["pantySize", "underwearSize"]), "tag", intimate: true)
        add("Bra size", value(["braSize"]), "tag", intimate: true)
        let dimensions = [value(["bust"]), value(["waist"]), value(["hips"])]
        let measurements = value(["measurements", "measurementsRaw", "bodyMeasurements"])
        add("Measurements", measurements.isEmpty && dimensions.allSatisfy({ !$0.isEmpty }) ? dimensions.joined(separator: "-") : measurements, "ruler", intimate: true)
        let formatter = DateFormatter(); formatter.dateStyle = .medium; formatter.timeZone = parser.timeZone
        let formattedBirthday = birth.map { formatter.string(from: $0) } ?? birthday
        add("Birthday", formattedBirthday, "birthday.cake")
        if let age, age >= 0 && age <= 120 { add("Age", String(age), "person") }
        let cut = value(["everydayCut"])
        let seamless = metadata["seamless"]?.flag == true
        add("Everyday cut", [cut, seamless ? "Seamless" : ""].filter { !$0.isEmpty }.joined(separator: " / "), "sparkles", intimate: true)
        add("Period cut", value(["periodCut"]), "drop", intimate: true)
        for (label, keys, symbol) in [("Country", ["country"], "globe"), ("Nationality", ["nationality"], "globe"),
                                      ("Height", ["height"], "ruler"), ("Hair", ["hairColor"], "person.crop.circle"),
                                      ("Eyes", ["eyeColor"], "eye"), ("Occupation", ["occupation", "occupations"], "briefcase")] {
            add(label, value(keys), symbol)
        }
        return items
    }
    static func artwork(_ row: IndexValue, key: String, profileAliases: Bool = false) -> String? {
        let aliases = key == "banner"
            ? ["selectedBanner", "banner", "bannerPath", "bannerUrl", "bannerVideo", "bannerVideoPath", "backdrop", "backgroundImage", "backgroundVideo"]
            : key == "poster" ? ["selectedPoster", "profilePoster", "primaryPoster", "poster", "posterPath", "posterUrl", "headshot", "profileImage", "cover"] : [key]
        let keys = profileAliases ? aliases : [key]
        var candidate: String?
        let sources: [IndexValue] = profileAliases
            ? [Optional(row), row["metadata"], row["artwork"], row["metadata"]?["artwork"]].compactMap { $0 }
            : [Optional(row), row["metadata"]].compactMap { $0 }
        for field in keys {
            for source in sources {
                if let value = source[field]?.text ?? source[field]?["path"]?.text ?? source[field]?["url"]?.text {
                    candidate = value; break
                }
            }
            if candidate != nil { break }
        }
        if profileAliases && candidate == nil {
            candidate = ProfileMediaFile.files(row).first { file in
                let raw = URLComponents(string: file.path)?.queryItems?.first(where: { $0.name == "path" })?.value ?? URLComponents(string: file.path)?.path ?? file.path
                return ((raw as NSString).lastPathComponent as NSString).deletingPathExtension.lowercased() == key
            }?.path
        }
        guard let value = candidate else { return nil }
        if value.hasPrefix("/") || URL(string: value)?.scheme != nil { return value }
        let metadata = row["metadata"]
        let explicitFolder = row["profileDir"]?.text ?? row["folderPath"]?.text
        let folder = explicitFolder ?? row["sourcePath"]?.text ?? metadata?["folderPath"]?.text
        guard let folder else { return nil }
        return folder + "/" + value
    }
}

enum PhotoViewportGeometry {
    static func fittedSize(image: CGSize, viewport: CGSize) -> CGSize {
        guard image.width > 0, image.height > 0, viewport.width > 0, viewport.height > 0 else {
            return CGSize(width: 0, height: 0)
        }
        let scale = min(viewport.width / image.width, viewport.height / image.height)
        return CGSize(width: image.width * scale, height: image.height * scale)
    }
    static func centering(content: CGSize, viewport: CGSize) -> CGSize {
        CGSize(width: max(0, (viewport.width - content.width) / 2), height: max(0, (viewport.height - content.height) / 2))
    }
}
