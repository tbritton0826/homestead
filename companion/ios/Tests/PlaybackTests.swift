import XCTest
@testable import HomesteadModels

final class PlaybackTests: XCTestCase {
    func testNestedEpisodesAndAudioArePlayableAndDeduplicated() throws {
        let json = #"{"files":[{"path":"/media/one.mp4"}],"seasons":[{"episodes":[{"files":[{"path":"/media/two.mp4"},{"path":"/media/one.mp4"}]}]}],"albums":{"one":{"tracks":[{"path":"/media/track.m4a"}]}}}"#
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        let files = PlaybackCatalog.files(row)
        XCTAssertEqual(files.count, 3)
        XCTAssertTrue(files.allSatisfy(\.playable))
        XCTAssertEqual(files.filter(\.audio).count, 1)
    }
    func testHistoryIsMatchedOnlyToCurrentIndexFiles() throws {
        let json = #"{"libraries":{"movies":{"one":{"files":[{"sourcePath":"/mnt/one.mp4"}]}}}}"#
        let index = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        let files = PlaybackCatalog.authorizedFiles(index)
        XCTAssertEqual(files.count, 1)
        XCTAssertFalse(files.contains { $0.path == "/mnt/private.mp4" })
        XCTAssertEqual(PlaybackCatalog.key(files[0]).count, 64)
        XCTAssertEqual(PlaybackCatalog.key(files[0]), PlaybackCatalog.key(files[0]))
        XCTAssertNotEqual(PlaybackCatalog.key(files[0]), PlaybackCatalog.key(ProfileMediaFile(path: "/mnt/private.mp4", title: "Other", video: true)))
    }
    func testCompletionAndInvalidPositionDoNotResume() {
        XCTAssertEqual(PlaybackPosition(position: 95, duration: 100, completed: true, updatedAt: "").resume, 0)
        XCTAssertEqual(PlaybackPosition(position: 20, duration: 100, completed: false, updatedAt: "").resume, 20)
        XCTAssertEqual(PlaybackPosition(position: .infinity, duration: 100, completed: false, updatedAt: "").resume, 0)
    }
    func testAudioAPIURLAndExternalURLRestriction() throws {
        let audio = ProfileMediaFile(path: "/api/file?path=%2Fmnt%2Fbook.m4b", title: "Book", video: false)
        XCTAssertTrue(audio.audio)
        let server = try XCTUnwrap(URL(string: "http://10.0.0.224:7312"))
        XCTAssertNil(ProfileMediaFile.url(path: "https://example.com/video.mp4", server: server, preview: false))
    }
}
