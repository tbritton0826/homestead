import XCTest
@testable import HomesteadModels
final class ProfileMediaTests: XCTestCase {
    func testProfileTabsKeepCategoriesAndArtworkSeparate() {
        let cases: [(String, Bool, ProfileMediaTab)] = [
            ("/media/profile/photos/one.jpg", false, .photos),
            ("/media/profile/nudes/one.jpg", false, .nudes),
            ("/media/profile/videos/one.mp4", true, .videos),
            ("/media/profile/sex/videos/one.mp4", true, .sex),
            ("/media/profile/sex/photos/one.jpg", false, .sex),
            ("/media/profile/banner.mp4", true, .artwork),
            ("/media/profile/artwork/cover.jpg", false, .artwork),
            ("/api/file?path=%2Fmnt%2Fprofile%2Fnudes%2Fone.jpg", false, .nudes),
            ("/media/profile/keepsakes/one.jpg", false, .keepsakes),
            ("/media/profile/ai/one.jpg", false, .ai),
            ("/media/profile/imports/one.jpg", false, .other)
        ]
        for (path, video, expected) in cases {
            XCTAssertEqual(ProfileMediaFile(path: path, title: "File", video: video).tab, expected, path)
        }
    }
    func testProfileHeaderUsesMetadataAndResolvesRelativeArtwork() throws {
        let json = #"{"folderPath":"/mnt/profiles/example","poster":"poster.jpg","banner":"/media/example/banner.jpg","metadata":{"country":"US","height":170}}"#
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        XCTAssertEqual(ProfilePresentation.artwork(row, key: "poster"), "/mnt/profiles/example/poster.jpg")
        XCTAssertEqual(ProfilePresentation.artwork(row, key: "banner"), "/media/example/banner.jpg")
        XCTAssertTrue(ProfilePresentation.metadata(row).contains { $0.label == "Country" && $0.value == "US" })
        XCTAssertNil(ProfilePresentation.artwork(row, key: "missing"))
    }
    func testFileExtractionRetainsMediaAndDeduplicates() throws {
        let json = #"{"files":[{"sourcePath":"/mnt/photos/a.jpg","path":"/media/a.jpg"},{"sourcePath":"/mnt/photos/a.jpg"},{"path":"/media/clip.mp4"},{"path":"/media/info.json"}]}"#
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        let files = ProfileMediaFile.files(row)
        XCTAssertEqual(files.count, 2)
        XCTAssertEqual(files.first?.path, "/mnt/photos/a.jpg")
        XCTAssertEqual(files.last?.video, true)
    }
    func testAuthenticatedURLRoutingAndOriginRestriction() throws {
        let server = try XCTUnwrap(URL(string: "http://10.0.0.224:7312"))
        let file = try XCTUnwrap(ProfileMediaFile.url(path: "/mnt/photos/a & b.jpg", server: server, preview: true))
        let parts = try XCTUnwrap(URLComponents(url: file, resolvingAgainstBaseURL: false))
        XCTAssertEqual(parts.path, "/api/file")
        XCTAssertEqual(parts.queryItems?.first(where: { $0.name == "path" })?.value, "/mnt/photos/a & b.jpg")
        XCTAssertEqual(parts.queryItems?.first(where: { $0.name == "width" })?.value, "640")
        XCTAssertNil(ProfileMediaFile.url(path: "https://other.example/media/a.jpg", server: server, preview: false))
        XCTAssertNil(ProfileMediaFile.url(path: "file:///private/a.jpg", server: server, preview: false))
        XCTAssertNil(ProfileMediaFile.url(path: "/media/../api/admin", server: server, preview: false))
    }
    func testAdultRecordKeepsFileList() throws {
        let json = #"{"libraries":{"personal":{"one":{"name":"Profile","files":[{"path":"/media/a.jpg"}]}}}}"#
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        XCTAssertEqual(AdultAccess.records(index: row, section: .personal).first?.mediaFiles.count, 1)
    }
}
