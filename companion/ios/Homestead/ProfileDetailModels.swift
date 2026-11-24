import Foundation

struct ProfileAppearancePreferences: Codable, Equatable {
    var posterWidth: Double = 120
    func validated() -> Self {
        var result = self
        result.posterWidth = posterWidth.isFinite ? min(180, max(100, posterWidth)) : 120
        return result
    }
    static func storageKey(server: String, user: String, target: ProfileUploadTarget) -> String {
        let profile = Data((target.library + "\n" + target.id).utf8).base64EncodedString()
        return AppearancePreferences.storageKey(server: server, user: user) + ".profile." + profile
    }
}

enum ProfileEditAccess {
    static func allowed(session: IndexValue, config: IndexValue, target: ProfileUploadTarget) -> Bool {
        guard session["ok"]?.flag == true, let section = AdultSection(rawValue: target.library),
              [.personal, .performers, .celebrities].contains(section),
              ["owner", "admin"].contains(session["user"]?["role"]?.text ?? "") else { return false }
        return AdultAccess.sections(session: session, config: config).contains(section)
    }
}

struct ProfileEditField: Identifiable {
    let id: String
    let label: String
    static let basic = [Self(id: "name", label: "Name"), Self(id: "biography", label: "Biography"),
                        Self(id: "birthday", label: "Birthday (YYYY-MM-DD)"), Self(id: "nationality", label: "Nationality")]
    static let body = [Self(id: "clothingSize", label: "Clothing size"), Self(id: "height", label: "Height"),
                       Self(id: "hairColor", label: "Hair color"), Self(id: "eyeColor", label: "Eye color")]
}

struct ProfileEditDraft {
    var values: [String: String]
    private let original: [String: String]
    init(row: IndexValue) {
        var fields: [String: String] = [:]
        let metadata = row["metadata"]
        for field in ProfileEditField.basic + ProfileEditField.body {
            let direct: String? = metadata?[field.id]?.text ?? row[field.id]?.text
            let body: String? = metadata?["bodyDetails"]?[field.id]?.text ?? metadata?["body"]?[field.id]?.text
            fields[field.id] = direct ?? body ?? ""
        }
        fields["name"] = fields["name"].flatMap { $0.isEmpty ? nil : $0 } ?? row["title"]?.text ?? ""
        fields["biography"] = ProfilePresentation.biography(row)
        if fields["birthday"]?.isEmpty == true { fields["birthday"] = row["metadata"]?["birthDate"]?.text ?? row["birthDate"]?.text ?? "" }
        values = fields; original = fields
    }
    func patch(includeBody: Bool) throws -> [String: String] {
        let fields = ProfileEditField.basic + (includeBody ? ProfileEditField.body : [])
        var patch: [String: String] = [:]
        for field in fields {
            let value = (values[field.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if value != (original[field.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) { patch[field.id] = value }
        }
        if patch["name"] == "" { throw CompanionError.message("A profile name is required.") }
        if let date = patch["birthday"], !date.isEmpty {
            let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX")
            parser.timeZone = TimeZone(secondsFromGMT: 0); parser.dateFormat = "yyyy-MM-dd"; parser.isLenient = false
            guard let parsed = parser.date(from: date), parser.string(from: parsed) == date else {
                throw CompanionError.message("Enter a valid birthday as YYYY-MM-DD, or leave it empty.")
            }
        }
        return patch
    }
}

enum ProfileDetailRecord {
    static func applyingToIndex(_ index: IndexValue, library: String, id: String, profile: IndexValue) -> IndexValue {
        let nested = index["libraries"] != nil
        var libraries = (nested ? index["libraries"] : index)?.fields ?? [:]
        let key = library == "personal" && (libraries["personal"] == nil || (libraries["personal"]?.fields.isEmpty == true && libraries["personal"]?.list.isEmpty == true)) ? "girls" : library
        guard let collection = libraries[key], let section = AdultSection(rawValue: library) else { return index }
        func updated(_ row: IndexValue, key: String) -> IndexValue {
            guard (row["id"]?.text ?? key) == id else { return row }
            let context = IndexValue.object([library: .object([key: row])])
            guard let record = AdultAccess.records(index: context, section: section).first else { return row }
            return updating(record, profile: profile).payload
        }
        if case .array = collection {
            libraries[key] = .array(collection.list.enumerated().map { updated($0.element, key: String($0.offset)) })
        } else { libraries[key] = .object(Dictionary(uniqueKeysWithValues: collection.fields.map { ($0.key, updated($0.value, key: $0.key)) })) }
        if !nested { return .object(libraries) }
        var root = index.fields; root["libraries"] = .object(libraries); return .object(root)
    }
    static func updating(_ record: NativeSearchHit, profile: IndexValue) -> NativeSearchHit {
        guard let target = record.uploadTarget, let section = AdultSection(rawValue: target.library) else { return record }
        var row = record.payload.fields
        for (key, value) in profile.fields where !["files", "photos", "videos"].contains(key) { row[key] = value }
        var metadata = record.payload["metadata"]?.fields ?? [:]
        let update = profile["metadata"]?.fields ?? profile.fields
        metadata.merge(update) { _, new in new }
        row["metadata"] = .object(metadata)
        if let name = metadata["name"]?.text { row["name"] = .string(name); row["title"] = .string(name) }
        let index = IndexValue.object([section.rawValue: .object([target.id: .object(row)])])
        return AdultAccess.records(index: index, section: section, allowIntimateMetadata: record.allowsIntimateMetadata).first ?? record
    }
}
