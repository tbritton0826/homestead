import Foundation

struct MediaFolder: Identifiable, Equatable {
    let id: String
    let title: String
}

enum MediaFolderCatalog {
    static let all = "__all__"
    static func path(_ address: String) -> String {
        let parts = URLComponents(string: address)
        return (parts?.queryItems?.first(where: { $0.name == "path" })?.value ?? parts?.path ?? address)
            .replacingOccurrences(of: "\\", with: "/").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
    static func root(files: [ProfileMediaFile], hint: String? = nil, profileCategory: Bool = false) -> String {
        let paths = files.map { path($0.path) }
        if let hint, !hint.isEmpty {
            let base = path(hint)
            if paths.allSatisfy({ $0.hasPrefix(base + "/") }) { return base }
        }
        if profileCategory, let first = paths.first {
            let parts = first.split(separator: "/").map(String.init)
            let categories = ["photos", "videos", "nude", "nudes", "sex", "keepsakes", "ai", "artwork", "scenes"]
            if let position = parts.dropLast().lastIndex(where: { categories.contains($0.lowercased()) }) {
                let base = parts.prefix(position + 1).joined(separator: "/")
                if paths.allSatisfy({ $0.hasPrefix(base + "/") }) { return base }
            }
        }
        var common = paths.first?.split(separator: "/").dropLast().map(String.init) ?? []
        for value in paths.dropFirst() {
            let parts = value.split(separator: "/").dropLast().map(String.init)
            common = Array(zip(common, parts).prefix(while: { $0.0 == $0.1 }).map { $0.0 })
        }
        return common.joined(separator: "/")
    }
    static func relative(_ file: ProfileMediaFile, root: String) -> String? {
        let value = path(file.path)
        guard root.isEmpty || value.hasPrefix(root + "/") else { return nil }
        let relative = root.isEmpty ? value : String(value.dropFirst(root.count + 1))
        return relative.split(separator: "/").dropLast().joined(separator: "/")
    }
    static func folders(files: [ProfileMediaFile], root: String) -> [MediaFolder] {
        var folders = Set<String>()
        for file in files {
            guard let directory = relative(file, root: root) else { continue }
            let parts = directory.split(separator: "/")
            for count in 1..<(parts.count + 1) { folders.insert(parts.prefix(count).joined(separator: "/")) }
        }
        guard !folders.isEmpty else { return [] }
        return [MediaFolder(id: all, title: "All"), MediaFolder(id: "", title: "Main folder")] +
            folders.sorted { $0.localizedStandardCompare($1) == .orderedAscending }.map { MediaFolder(id: $0, title: $0.replacingOccurrences(of: "/", with: " › ")) }
    }
    static func filter(_ files: [ProfileMediaFile], root: String, selected: String) -> [ProfileMediaFile] {
        if selected == all || !folders(files: files, root: root).contains(where: { $0.id == selected }) { return files }
        return files.filter {
            guard let folder = relative($0, root: root) else { return false }
            return folder == selected || (!selected.isEmpty && folder.hasPrefix(selected + "/"))
        }
    }
}

struct ProfileSocialLink: Identifiable {
    let title: String
    let url: URL
    var id: String { url.absoluteString }
    static func address(_ raw: String, platform: String = "") -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(where: { $0.isWhitespace }), !text.contains("\\") else { return nil }
        let hosts = ["instagram": "instagram.com", "twitter": "x.com", "x": "x.com", "facebook": "facebook.com", "tiktok": "tiktok.com", "youtube": "youtube.com", "threads": "threads.net", "onlyfans": "onlyfans.com", "fansly": "fansly.com", "patreon": "patreon.com", "twitch": "twitch.tv", "linktree": "linktr.ee"]
        if !text.contains("://") {
            if text.hasPrefix("//") { text = "https:" + text }
            else if text.contains(".") && !text.hasPrefix("@") { text = "https://" + text }
            else if let host = hosts[platform.lowercased()], !text.contains(":"), !text.contains("/") {
                text = "https://" + host + "/" + (host == "tiktok.com" ? "@" : "") + text.trimmingCharacters(in: CharacterSet(charactersIn: "@"))
            } else { return nil }
        }
        guard let url = URL(string: text), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, host.contains("."), url.user == nil, url.password == nil else { return nil }
        return url
    }
    static func links(_ row: IndexValue) -> [Self] {
        var found: [Self] = [], seen = Set<String>()
        func add(_ value: IndexValue, label: String) {
            if !value.list.isEmpty { for entry in value.list { add(entry, label: label) }; return }
            let platform = value["platform"]?.text ?? value["label"]?.text ?? label
            let handle = value["username"]?.text ?? value["handle"]?.text
            let direct = value.text ?? value["url"]?.text ?? value["href"]?.text ?? value["link"]?.text
            let raw = direct ?? handle.map { "@" + $0.trimmingCharacters(in: CharacterSet(charactersIn: "@")) } ?? ""
            guard let url = address(raw, platform: platform), seen.insert(url.absoluteString).inserted else { return }
            found.append(Self(title: platform.isEmpty ? (url.host ?? "Website") : platform, url: url))
        }
        for source in [row["metadata"], row].compactMap({ $0 }) {
            for key in ["socialLinks", "socials", "socialMedia", "referenceLinks"] {
                guard let values = source[key] else { continue }
                if !values.list.isEmpty || values.text != nil { add(values, label: "") }
                else { for (label, value) in values.fields.sorted(by: { $0.key < $1.key }) { add(value, label: label) } }
            }
            for key in ["website", "officialWebsite"] { if let value = source[key] { add(value, label: "Website") } }
        }
        return found
    }
}

enum PosterMetadataValue {
    static func short(_ item: ProfileMetadataItem) -> String {
        let value = item.value.trimmingCharacters(in: .whitespacesAndNewlines)
        if ["Panty size", "Bra size"].contains(item.label) {
            let first = value.components(separatedBy: "/").first?.trimmingCharacters(in: .whitespaces) ?? value
            // Retain uncommon stored sizes rather than guessing a conversion.
            return first
        }
        return value
    }
}
