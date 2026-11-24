import XCTest
@testable import HomesteadModels

final class SearchMappingTests: XCTestCase {
    private func row(_ json: String) throws -> IndexValue {
        try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
    }

    func testNestedLibraryMetadataIsSearchable() throws {
        let value = try row(#"{"metadata":{"title":"Arrival","description":"First contact"}}"#)
        let hit = NativeSearchMapping.hit(value, source: "Movies", fallbackID: "file-one")
        XCTAssertEqual(hit.title, "Arrival")
        XCTAssertTrue(NativeSearchMapping.matches(hit, query: "CONTACT"))
        XCTAssertFalse(NativeSearchMapping.matches(hit, query: "unrelated"))
    }

    func testSeerrMovieAndTVWithSameIDRemainDistinct() throws {
        let movie = try row(#"{"id":42,"mediaType":"movie","title":"Movie"}"#)
        let tv = try row(#"{"id":42,"mediaType":"tv","name":"Series"}"#)
        let first = NativeSearchMapping.hit(movie, source: "Seerr", fallbackID: "0")
        let second = NativeSearchMapping.hit(tv, source: "Seerr", fallbackID: "1")
        XCTAssertEqual(NativeSearchMapping.unique([first, second, first]).count, 2)
        XCTAssertEqual(second.title, "Series")
    }

    func testYouTubeAndPluginResponseFields() throws {
        let channel = try row(#"{"id":"channel-one","title":"Cooking","subtitle":"YouTube Creator"}"#)
        let plugin = try row(#"{"providerId":"recipe-one","displayName":"Pasta","description":"Dinner"}"#)
        XCTAssertEqual(NativeSearchMapping.hit(channel, source: "YouTube", fallbackID: "0").summary, "YouTube Creator")
        XCTAssertEqual(NativeSearchMapping.hit(plugin, source: "Plugin", fallbackID: "0").title, "Pasta")
    }

    func testConfigBooleansAndPermissionAliases() throws {
        let config = try row(#"{"enabled":true,"disabled":false}"#)
        XCTAssertEqual(config["enabled"]?.flag, true)
        XCTAssertEqual(config["disabled"]?.flag, false)
        XCTAssertEqual(NativeSearchMapping.libraryPermission("tv"), "tvshows")
        XCTAssertEqual(NativeSearchMapping.libraryPermission("musicArtists"), "music")
        XCTAssertEqual(NativeSearchMapping.libraryPermission("youtubeCreators"), "youtube")
    }
}
