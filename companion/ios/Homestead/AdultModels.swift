import Foundation

enum AdultSection: String, CaseIterable, Identifiable {
    case personal, performers, celebrities, adultPhotos, adultVideos
    var id: String { rawValue }
    var title: String {
        switch self {
        case .personal: return "Personal"
        case .performers: return "Performers"
        case .celebrities: return "Celebrities"
        case .adultPhotos: return "Photos"
        case .adultVideos: return "Videos"
        }
    }
    var permission: String { self == .personal ? "personalProfiles" : rawValue }
}

enum AdultAccess {
    static func sections(session: IndexValue, config: IndexValue) -> [AdultSection] {
        guard config["enabledLibraries"]?["adult"]?.flag == true,
              config["subscription"]?["features"]?["adult"]?.flag == true,
              let user = session["user"], user["role"]?.text != "child" else { return [] }
        let role = user["role"]?.text ?? ""
        let mode = user["adultAccessMode"]?.text ?? "none"
        let full = role == "owner" || user["fullAdultAccess"]?.flag == true || mode == "full"
        return AdultSection.allCases.filter { section in
            guard config["adultSublibraries"]?[section.permission]?.flag != false else { return false }
            if full { return true }
            if mode == "performers-celebrities" { return section == .performers || section == .celebrities }
            if mode == "custom" { return user["adultSublibraryAccess"]?[section.permission]?.flag == true }
            return section == .personal && user["linkedAdultProfileId"]?.text != nil
        }
    }
    static func intimateMetadataAllowed(session: IndexValue, config: IndexValue, section: AdultSection) -> Bool {
        guard sections(session: session, config: config).contains(section),
              [.personal, .performers, .celebrities].contains(section),
              config["adultSublibraries"]?["bodyDetails"]?.flag != false,
              let user = session["user"], user["role"]?.text != "child" else { return false }
        return user["role"]?.text == "owner" || user["fullAdultAccess"]?.flag == true || user["adultAccessMode"]?.text == "full" ||
            (user["adultAccessMode"]?.text == "custom" && user["adultSublibraryAccess"]?["bodyDetails"]?.flag == true)
    }
    static func records(index: IndexValue, section: AdultSection, allowIntimateMetadata: Bool = false) -> [NativeSearchHit] {
        let libraries = index["libraries"] ?? index
        var collection = libraries[section.rawValue]
        if section == .personal && (collection == nil || (collection?.fields.isEmpty == true && collection?.list.isEmpty == true)) {
            collection = libraries["girls"]
        }
        guard let collection else { return [] }
        let rows: [(String, IndexValue)] = collection.fields.isEmpty
            ? collection.list.enumerated().map { (String($0.offset), $0.element) }
            : collection.fields.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
        if section == .adultVideos {
            return NativeSearchMapping.unique(rows.flatMap { PhotoLibraryCatalog.videos($0.1, source: section.title, fallbackID: $0.0) })
                .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        }
        return NativeSearchMapping.unique(rows.map { row in
            var hit = NativeSearchMapping.hit(row.1, source: section.title, fallbackID: row.0)
            hit.mediaFiles = PlaybackCatalog.files(row.1)
            hit.posterPath = ProfilePresentation.artwork(row.1, key: "poster", profileAliases: true)
            hit.bannerPath = ProfilePresentation.artwork(row.1, key: "banner", profileAliases: true)
            hit.profileMetadata = ProfilePresentation.metadata(row.1, allowIntimate: allowIntimateMetadata)
            hit.profileBiography = ProfilePresentation.biography(row.1)
            hit.allowsIntimateMetadata = allowIntimateMetadata
            if [.personal, .performers, .celebrities].contains(section) {
                hit.uploadTarget = ProfileUploadTarget(id: row.1["id"]?.text ?? row.0, name: hit.title, library: section.rawValue)
            }
            return hit
        })
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}
