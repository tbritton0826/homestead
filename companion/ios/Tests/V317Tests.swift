import XCTest
import Foundation
@testable import HomesteadModels

final class V317Tests: XCTestCase {
    private func files(_ paths: [String]) -> [ProfileMediaFile] {
        paths.map { ProfileMediaFile(path: $0, title: "Fixture", video: $0.hasSuffix(".mp4")) }
    }
    func testFolderNamesNestedFiltersAndRemovedFolderRecovery() {
        let values = files(["/media/photos/Album/main.jpg", "/media/photos/Album/Holiday/one.jpg", "/media/photos/Album/Holiday/Day 2/two.jpg", "/media/photos/Album/Holidays/three.jpg"])
        let root = MediaFolderCatalog.root(files: values, hint: "/media/photos/Album")
        XCTAssertEqual(root, "media/photos/Album")
        XCTAssertEqual(MediaFolderCatalog.folders(files: values, root: root).map(\.id), ["__all__", "", "Holiday", "Holiday/Day 2", "Holidays"])
        XCTAssertEqual(MediaFolderCatalog.filter(values, root: root, selected: "").count, 1)
        XCTAssertEqual(MediaFolderCatalog.filter(values, root: root, selected: "Holiday").count, 2)
        XCTAssertEqual(MediaFolderCatalog.filter(values, root: root, selected: "Holiday/Day 2").count, 1)
        let remaining = [values[0]]
        XCTAssertEqual(MediaFolderCatalog.filter(remaining, root: root, selected: "Holiday"), remaining)
    }
    func testProfileCategoryKeepsTheOnlySubfolderVisible() {
        for ext in ["jpg", "mp4"] {
            let category = ext == "mp4" ? "videos" : "photos"
            let values = files(["/media/celebrities/fixture/\(category)/Selected Set/one.\(ext)"])
            let root = MediaFolderCatalog.root(files: values, profileCategory: true)
            XCTAssertEqual(root, "media/celebrities/fixture/" + category)
            XCTAssertEqual(MediaFolderCatalog.folders(files: values, root: root).last?.title, "Selected Set")
        }
        XCTAssertEqual(MediaFolderCatalog.path("/api/file?path=%2Fmedia%2Fphotos%2FAlbum%2FHoliday%2Fone.jpg&v=2"), "media/photos/Album/Holiday/one.jpg")
    }
    func testSocialFormatsDeduplicateAndRejectExecutableOrCredentialURLs() throws {
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"metadata":{"socialLinks":{"instagram":{"handle":"fixture.name"},"website":"example.com/profile","bad":"javascript:alert(1)"}},"socials":[{"label":"Instagram","url":"https://instagram.com/fixture.name"},{"label":"Invalid","url":"https://user:password@example.com"}]}"#.utf8))
        let links = ProfileSocialLink.links(row)
        XCTAssertEqual(Set(links.map { $0.url.absoluteString }), ["https://instagram.com/fixture.name", "https://example.com/profile"])
        XCTAssertNil(ProfileSocialLink.address("file:///private/test"))
        XCTAssertNil(ProfileSocialLink.address("data:text/html,test"))
        XCTAssertNil(ProfileSocialLink.address("https://example.com/a b"))
        XCTAssertEqual(ProfileSocialLink.address("@fixture", platform: "tiktok")?.absoluteString, "https://tiktok.com/@fixture")
    }
    func testRecoveryIntervalsCapAndDoNotClassifyAuthenticationAsTransportFailure() {
        XCTAssertEqual((0...7).map { ConnectionRecovery.delay(failures: $0) }, [30, 2, 5, 12, 30, 60, 60, 60])
        for code in [URLError.Code.timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost] {
            XCTAssertTrue(ConnectionRecovery.isTransient(URLError(code)))
        }
        XCTAssertFalse(ConnectionRecovery.isTransient(CompanionError.unauthorized))
        XCTAssertFalse(ConnectionRecovery.isTransient(CancellationError()))
        XCTAssertEqual(ConnectionRecovery.failureCategory(CancellationError()), "cancelled")
    }
}
