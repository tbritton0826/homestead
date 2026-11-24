import Foundation

struct FamilyRecord: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let poster: String?
    let banner: String?
    let metadata: IndexValue
    let files: [ProfileMediaFile]
    let documents: [ProfileMediaFile]
    let library: String
}

struct FamilyDetailField: Identifiable {
    let label: String
    let value: String
    var id: String { label }
}

struct FamilyCalendarEvent: Identifiable {
    let row: IndexValue
    var id: String { row["id"]?.text ?? ((row["title"]?.text ?? "") + start) }
    var title: String { row["title"]?.text ?? "Event" }
    var start: String { row["start"]?.text ?? ((row["date"]?.text ?? "") + "T" + (row["startTime"]?.text ?? "00:00")) }
    var date: String { row["date"]?.text ?? String(start.prefix(10)) }
    var kind: String { row["kind"]?.text ?? "appointment" }
    var imported: Bool { !["manual", "schedule-import", ""].contains(row["source"]?.text ?? "") }
    var summary: String { [row["personName"]?.text, row["location"]?.text, row["assignedDriver"]?.text].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
}

enum FamilyCatalog {
    static func allowed(session: IndexValue, config: IndexValue) -> [String] {
        guard session["ok"]?.flag == true, config["enabledLibraries"]?["family"]?.flag == true,
              session["authEnabled"]?.flag == false || session["user"] != nil else { return [] }
        let permissions = Set(session["user"]?["allowedLibraries"]?.list.compactMap(\.text) ?? [])
        let all = session["authEnabled"]?.flag == false || session["user"]?["role"]?.text == "owner" || permissions.contains("*")
        let entries = [("family", ""), ("family-home", "familyArchive"), ("family-profiles", "familyProfiles"),
                       ("family-tree", "familyTree"), ("pets", "pets"), ("calendar", "calendar"), ("recipes", "recipes")]
        return entries.compactMap { id, flag in
            guard flag.isEmpty || config["familySublibraries"]?[flag]?.flag != false,
                  all || permissions.contains("family") || permissions.contains(id) else { return nil }
            return id
        }
    }
    static func rows(_ value: IndexValue?) -> [(String, IndexValue)] {
        guard let value else { return [] }
        if !value.fields.isEmpty { return value.fields.sorted { $0.key < $1.key }.map { ($0.key, $0.value) } }
        return value.list.enumerated().map { (String($0.offset), $0.element) }
    }
    static func records(_ index: IndexValue, library: String) -> [FamilyRecord] {
        let collection = index["libraries"]?[library] ?? index[library]
        return rows(collection).map { key, row in
            let metadata = row["metadata"] ?? row
            let title = NativeSearchMapping.text(metadata, keys: ["name", "title"])
            let fallback = NativeSearchMapping.text(row, keys: ["name", "title"])
            return FamilyRecord(id: row["id"]?.text ?? key, title: title.isEmpty ? (fallback.isEmpty ? key : fallback) : title,
                subtitle: NativeSearchMapping.text(metadata, keys: library == "pets" ? ["breed", "species"] : ["role", "description"]),
                poster: ProfilePresentation.artwork(row, key: "poster") ?? row["photo"]?.text,
                banner: ProfilePresentation.artwork(row, key: "banner"), metadata: metadata,
                files: PlaybackCatalog.files(row), documents: documents(row), library: library)
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    static func documents(_ row: IndexValue) -> [ProfileMediaFile] {
        var seen = Set<String>()
        return (row["files"]?.list ?? []).compactMap { file in
            let address = file.text ?? NativeSearchMapping.text(file, keys: ["sourcePath", "path", "publicPath", "url"])
            let value = ProfileMediaFile(path: address, title: NativeSearchMapping.text(file, keys: ["name", "title"]), video: false)
            guard ["pdf", "epub", "txt", "md", "doc", "docx", "rtf", "csv", "xls", "xlsx", "ppt", "pptx"].contains(value.fileExtension),
                  seen.insert(address).inserted else { return nil }
            return value
        }
    }
    static func events(_ response: IndexValue) -> [FamilyCalendarEvent] {
        var seen = Set<String>()
        return (response["events"]?.list ?? []).map { FamilyCalendarEvent(row: $0) }
            .filter { seen.insert($0.id).inserted }.sorted { $0.start < $1.start }
    }
    static func detailFields(_ value: IndexValue?) -> [FamilyDetailField] {
        var result: [FamilyDetailField] = []
        func visit(_ value: IndexValue, label: String, depth: Int) {
            guard depth < 6, result.count < 100 else { return }
            if let text = value.text {
                result.append(FamilyDetailField(label: label, value: text))
            } else if let flag = value.flag {
                result.append(FamilyDetailField(label: label, value: flag ? "Yes" : "No"))
            } else if !value.list.isEmpty {
                for (index, item) in value.list.prefix(100).enumerated() {
                    visit(item, label: label.isEmpty ? "\(index + 1)" : label + " · \(index + 1)", depth: depth + 1)
                }
            } else {
                for key in value.fields.keys.sorted() {
                    if let item = value[key] {
                        visit(item, label: label.isEmpty ? key.capitalized : label + " · " + key.capitalized, depth: depth + 1)
                    }
                }
            }
        }
        if let value { visit(value, label: "", depth: 0) }
        return result
    }
}

enum FamilyCalendarDate {
    static func formatter(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = pattern
        formatter.isLenient = false
        return formatter
    }
}

enum CalendarScheduleReview {
    static func hours(_ shifts: [IndexValue]) -> Double? {
        guard !shifts.isEmpty, shifts.count <= 62 else { return nil }
        let date = FamilyCalendarDate.formatter("yyyy-MM-dd")
        var total = 0.0
        for shift in shifts {
            guard let value = shift["date"]?.text, let parsed = date.date(from: value), date.string(from: parsed) == value else { return nil }
            if shift["dayType"]?.text == "off" { continue }
            func minutes(_ value: String?) -> Int? {
                guard let value, value.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil else { return nil }
                let parts = value.split(separator: ":").compactMap { Int($0) }
                return parts[0] * 60 + parts[1]
            }
            guard let start = minutes(shift["startTime"]?.text), let end = minutes(shift["endTime"]?.text), start != end else { return nil }
            total += Double(end > start ? end - start : end + 1440 - start) / 60
        }
        return (total * 100).rounded() / 100
    }
    static func valid(_ shifts: [IndexValue], printedHours: Double?) -> Bool {
        guard let hours = hours(shifts) else { return false }
        return printedHours.map { $0.isFinite && abs($0 - hours) <= 0.25 } ?? true
    }
}
