import XCTest
@testable import HomesteadModels

final class AppearanceCollectionsTests: XCTestCase {
    private func value(_ json: String) throws -> IndexValue {
        try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
    }
    func testAppearanceRoundTripAndAccountIsolation() throws {
        let preferences = AppearancePreferences(theme: .dark, accent: .purple, surface: .solid)
        XCTAssertEqual(try JSONDecoder().decode(AppearancePreferences.self, from: JSONEncoder().encode(preferences)), preferences)
        XCTAssertNotEqual(AppearancePreferences.storageKey(server: "http://server", user: "one"), AppearancePreferences.storageKey(server: "http://server", user: "two"))
        XCTAssertNotEqual(AppearancePreferences.storageKey(server: "http://server", user: "one"), AppearancePreferences.storageKey(server: "http://other", user: "one"))
        XCTAssertEqual(AppearancePreferences().theme, .system)
    }
    func testBannerUsesSavedOverrideAndMetadataCollection() throws {
        let root = try value(#"{"movies":{"m":{"id":"m","title":"Film","banner":"/media/local.jpg"}}}"#)
        let matches = try value(#"{"movies:m":{"artworkOverrides":{"banner":"https://image.tmdb.org/banner.jpg"},"collectionName":"Film Collection"}}"#)
        let item = try XCTUnwrap(MediaIndex(root: root, matches: matches).items.first)
        XCTAssertEqual(item.banner, "https://image.tmdb.org/banner.jpg")
        XCTAssertEqual(item.collectionNames, ["Film Collection"])
    }
    func testCustomOrderAndUnavailableReferencesCannotAuthorizeFiles() throws {
        let media = try MediaIndex(root: value(#"{"movies":{"a":{"id":"a","title":"One"},"b":{"id":"b","title":"Two"}}}"#)).items
        let custom = try value(#"[{"id":"saved","name":"Ordered","items":[{"library":"movies","sourceId":"a","order":2},{"library":"movies","sourceId":"b","order":1},{"library":"movies","sourceId":"private","sourcePath":"/secret.mp4","order":0}]},{"id":"denied","name":"Hidden","items":[{"library":"movies","sourceId":"private"}]}]"#).list
        let groups = SharedCollectionCatalog.build(media: media, custom: custom, seeds: [], orders: [], appearances: [])
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].items.map(\.id), ["movies:b", "movies:a"])
        XCTAssertTrue(groups[0].items.allSatisfy { $0.files.isEmpty })
    }
    func testSmartExactMatchAndAppearanceOverride() throws {
        let media = try MediaIndex(root: value(#"{"tv":{"a":{"id":"a","title":"Arrow (2012)"},"b":{"id":"b","title":"Broken Arrow"}}}"#)).items
        let seeds = try value(#"[{"id":"arrowverse","name":"Arrowverse","exactTerms":["Arrow"]}]"#).list
        let appearances = try value(#"[{"collectionId":"arrowverse","name":"My Universe","poster":"/media/universe.jpg"}]"#).list
        let groups = SharedCollectionCatalog.build(media: media, custom: [], seeds: seeds, orders: [], appearances: appearances)
        XCTAssertEqual(groups.first?.items.map(\.id), ["tv:a"])
        XCTAssertEqual(groups.first?.title, "My Universe")
        XCTAssertEqual(groups.first?.poster, "/media/universe.jpg")
    }
}
