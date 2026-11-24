import XCTest
@testable import HomesteadModels

final class AdultPrivacyTests: XCTestCase {
    func testPluginConcealmentSelectionAndLegacyMigration() throws {
        XCTAssertTrue(PluginVisibility.concealed("ai", adultHidden: true, selected: nil))
        XCTAssertFalse(PluginVisibility.concealed("ai", adultHidden: true, selected: ["panty-archive"]))
        XCTAssertTrue(PluginVisibility.concealed("panty-archive", adultHidden: true, selected: ["panty-archive"]))
        XCTAssertFalse(PluginVisibility.concealed("panty-archive", adultHidden: false, selected: ["panty-archive"]))
        XCTAssertFalse(PluginVisibility.concealed("ai", adultHidden: true, selected: []))
        var record = AdultPrivacyRecord(salt: Data(repeating: 1, count: 32), digest: Data(repeating: 2, count: 32))
        record.hiddenPluginIDs = ["panty-archive", "dominion"]
        let data = try JSONEncoder().encode(record)
        XCTAssertEqual(try JSONDecoder().decode(AdultPrivacyRecord.self, from: data).hiddenPluginIDs, record.hiddenPluginIDs)
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        legacy.removeValue(forKey: "hiddenPluginIDs")
        let decoded = try JSONDecoder().decode(AdultPrivacyRecord.self, from: JSONSerialization.data(withJSONObject: legacy))
        XCTAssertNil(decoded.hiddenPluginIDs)
    }
    func testPINRequiresSixASCIIDigits() {
        XCTAssertTrue(AdultPIN.valid("012345"))
        for invalid in ["12345", "1234567", "12345a", "１２３４５６", " 12345"] { XCTAssertFalse(AdultPIN.valid(invalid)) }
    }
    func testSaltedPINDerivationAndVerification() throws {
        let salt = Data(repeating: 1, count: 32)
        let hash = try AdultPIN.derive("123456", salt: salt)
        XCTAssertEqual(hash.count, 32)
        XCTAssertTrue(AdultPIN.equal(hash, try AdultPIN.derive("123456", salt: salt)))
        XCTAssertFalse(AdultPIN.equal(hash, try AdultPIN.derive("123457", salt: salt)))
        XCTAssertFalse(AdultPIN.equal(hash, try AdultPIN.derive("123456", salt: Data(repeating: 2, count: 32))))
        XCTAssertThrowsError(try AdultPIN.derive("123456", salt: Data()))
        let record = AdultPrivacyRecord(salt: salt, digest: hash)
        let encoded = try JSONEncoder().encode(record)
        let decoded = try JSONDecoder().decode(AdultPrivacyRecord.self, from: encoded)
        XCTAssertTrue(decoded.hidden)
        XCTAssertEqual(decoded.digest, hash)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("123456"))
    }
    func testConcealedHistoryExcludesAllAdultAliases() throws {
        let json = #"{"libraries":{"movies":{"m":{"files":[{"path":"/media/m.mp4"}]}},"personal":{"p":{"files":[{"path":"/media/private.mp4"}]}},"adultVideos":[{"path":"/media/private2.mp4"}],"girls":[{"path":"/media/private3.mp4"}]}}"#
        let index = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        XCTAssertEqual(PlaybackCatalog.authorizedFiles(index, includeAdult: false).map(\.path), ["/media/m.mp4"])
        XCTAssertEqual(PlaybackCatalog.authorizedFiles(index, includeAdult: true).count, 4)
    }
    func testConcealedSearchAndRequestsRejectUnknownAndAdultLibraries() {
        for library in ["adult", "personal", "girls", "performers", "celebrities", "adultPhotos", "adultVideos", "plugin", ""] {
            XCTAssertFalse(AdultVisibilityPolicy.safeLibrary(library))
        }
        for library in ["movies", "tvShows", "books", "recipes", "musicArtists", "youtubeCreators"] {
            XCTAssertTrue(AdultVisibilityPolicy.safeLibrary(library))
        }
    }
}
