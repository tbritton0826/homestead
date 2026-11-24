import XCTest
import Foundation
@testable import HomesteadModels

final class V321Tests: XCTestCase {
    func testConnectionWarningRequiresRepeatedFailuresAndNoRecentTraffic() {
        let check = Date(timeIntervalSince1970: 1000)
        XCTAssertFalse(ConnectionRecovery.shouldShowWarning(lastResponse: .distantPast, checkStarted: check, failures: 1))
        XCTAssertFalse(ConnectionRecovery.shouldShowWarning(lastResponse: check.addingTimeInterval(-30), checkStarted: check, failures: 3))
        XCTAssertFalse(ConnectionRecovery.shouldShowWarning(lastResponse: check.addingTimeInterval(1), checkStarted: check, failures: 5))
        XCTAssertTrue(ConnectionRecovery.shouldShowWarning(lastResponse: check.addingTimeInterval(-45), checkStarted: check, failures: 2))
        XCTAssertTrue(ConnectionRecovery.shouldShowWarning(lastResponse: .distantPast, checkStarted: check, failures: 5))
    }
    func testTenMinutesOfHealthyTrafficDoesNotShowAConnectionWarning() {
        let start = Date(timeIntervalSince1970: 1000)
        for second in stride(from: 0, through: 600, by: 30) {
            let date = start.addingTimeInterval(Double(second))
            XCTAssertFalse(ConnectionRecovery.shouldShowWarning(lastResponse: date.addingTimeInterval(-10), checkStarted: date, failures: 2))
        }
    }
    func testMissingEpisodesKeepMetadataAndLocalPlaybackUsesOnlyExactIndexedFiles() throws {
        let file = ProfileMediaFile(path: "/media/tv/show/S01E01-E02.mkv", title: "Local", video: true)
        let seasons = [MediaSeason(number: 1, files: [file], total: 3)]
        let response = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"episodes":[{"season":1,"number":1,"episodeId":10,"title":"Pilot","status":"available","filePath":"/media/tv/show/S01E01-E02.mkv"},{"season":1,"number":2,"title":"Second","status":"available","filePath":"/media/tv/show/S01E01-E02.mkv"},{"season":1,"number":3,"episodeId":30,"title":"Missing third","status":"missing","canSearch":true,"artwork":"https://example.com/thumb.jpg"}]}"#.utf8))
        let rows = TVEpisodeCatalog.build(response, seasons: seasons)
        XCTAssertEqual(rows.map(\.number), [1, 2, 3])
        XCTAssertEqual(rows.map(\.statusLabel), ["Available", "Available", "Missing"])
        XCTAssertEqual(rows[0].file?.path, file.path)
        XCTAssertEqual(rows[1].file?.path, file.path)
        XCTAssertNil(rows[2].file)
        XCTAssertTrue(rows[2].canSearch)
        XCTAssertEqual(rows[2].title, "Missing third")
    }
    func testProviderCannotGrantPlaybackToAnotherEpisodesFileOrAnUnknownPath() throws {
        let file = ProfileMediaFile(path: "/media/tv/show/S01E01.mkv", title: "Local", video: true)
        let response = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"episodes":[{"season":1,"number":2,"title":"Wrong","status":"available","filePath":"/media/tv/show/S01E01.mkv"},{"season":1,"number":3,"title":"Unknown","status":"available","filePath":"/private/not-indexed.mkv"}]}"#.utf8))
        let rows = TVEpisodeCatalog.build(response, seasons: [MediaSeason(number: 1, files: [file], total: 3)])
        XCTAssertEqual(rows.filter { $0.file != nil }.count, 1)
        XCTAssertEqual(rows.filter { $0.status == "not-indexed" }.count, 2)
        XCTAssertTrue(rows.allSatisfy { !$0.canSearch })
    }
    func testLocalFallbackPreservesSpecialsAndUnnumberedFilesWhenProviderFails() {
        let special = ProfileMediaFile(path: "/tv/show/S00E02.mkv", title: "Special", video: true)
        let unknown = ProfileMediaFile(path: "/tv/show/extra.mkv", title: "Extra", video: true)
        let rows = TVEpisodeCatalog.build(nil, seasons: [MediaSeason(number: 0, files: [special], total: nil), MediaSeason(number: -1, files: [unknown], total: nil)])
        XCTAssertEqual(rows.count, 2)
        XCTAssertTrue(rows.allSatisfy { $0.file != nil && !$0.canSearch })
        XCTAssertEqual(rows.first { $0.season == 0 }?.code, "S00E02")
    }
}
