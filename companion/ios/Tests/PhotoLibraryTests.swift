import XCTest
@testable import HomesteadModels

final class PhotoLibraryTests: XCTestCase {
    private func value(_ json: String) throws -> IndexValue { try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8)) }
    func testNormalPhotosBelongToMediaAndDoNotConsumeAdultAlbums() throws {
        let root = try value(#"{"libraries":{"photos":{"holiday":{"id":"holiday","title":"Holiday","files":[{"path":"/media/photos/Holiday/one.jpg"}]}},"adultPhotos":{"private":{"id":"private","title":"Private"}}}}"#)
        let media = try MediaIndex(root: root)
        XCTAssertEqual(media.items.count, 1)
        XCTAssertEqual(media.items.first?.category, .photos)
        XCTAssertEqual(media.items.first?.title, "Holiday")
        XCTAssertEqual(AdultAccess.records(index: root, section: .adultPhotos).count, 1)
    }
    func testLooseAdultVideoCollectionsFlattenIntoIndividuallyPlayableRows() throws {
        let root = try value(#"{"libraries":{"adultVideos":{"_unsorted":{"title":"Unsorted Videos","poster":"/media/adult/videos/one.mp4","files":[{"path":"/media/adult/videos/one.mp4"},{"path":"/media/adult/videos/two.ts"},{"path":"/media/adult/videos/cover.jpg"}]}}}}"#)
        let rows = AdultAccess.records(index: root, section: .adultVideos)
        XCTAssertEqual(rows.count, 2)
        XCTAssertTrue(rows.allSatisfy { $0.mediaFiles.count == 1 && $0.mediaFiles[0].video })
        XCTAssertTrue(rows.allSatisfy { $0.uploadTarget == nil && $0.posterPath == nil })
        XCTAssertNotEqual(rows[0].id, rows[1].id)
    }
    func testPosterPreviewsRetainRevisionAndFullPhotoURLsRemainOriginal() throws {
        let server = try XCTUnwrap(URL(string: "http://10.0.0.224:7312"))
        let path = "/media/adult/personal/profile/poster.jpg?v=updated"
        let preview = try XCTUnwrap(ProfileMediaFile.url(path: path, server: server, preview: true))
        let parts = try XCTUnwrap(URLComponents(url: preview, resolvingAgainstBaseURL: false))
        XCTAssertEqual(parts.path, "/api/file")
        XCTAssertEqual(parts.queryItems?.first { $0.name == "path" }?.value, "/media/adult/personal/profile/poster.jpg")
        XCTAssertEqual(parts.queryItems?.first { $0.name == "v" }?.value, "updated")
        XCTAssertEqual(parts.queryItems?.first { $0.name == "width" }?.value, "640")
        XCTAssertEqual(ProfileMediaFile.url(path: path, server: server, preview: false)?.path, "/media/adult/personal/profile/poster.jpg")
    }
    func testPhotoImportAlbumsKeepOnlyImagesAndStableServerIdentity() throws {
        let response = try value(#"{"ok":true,"albums":[{"id":"stable","name":"Holiday","files":[{"path":"/media/photos/Holiday/one.heic"},{"path":"/media/photos/Holiday/clip.mp4"},{"path":"/media/photos/Holiday/notes.json"}]}]}"#)
        let albums = PhotoLibraryCatalog.albums(response)
        XCTAssertEqual(albums.first?.id, "stable")
        XCTAssertEqual(albums.first?.files.count, 1)
        XCTAssertEqual(albums.first?.files.first?.fileExtension, "heic")
    }
    func testFolderRefreshReplacesOnlyTheSameFolderAndPreservesUnsortedAndOtherLibraries() throws {
        let original = try value(#"{"libraries":{"photos":{"public":{"title":"Public"}},"adultVideos":{"_unsorted":{"title":"Unsorted Videos","files":[{"path":"/media/adult/videos/one.mp4"}]},"stale":{"sourcePath":"/media/adult/videos/Set","files":[{"path":"/media/adult/videos/Set/old.mp4"}]}}}}"#)
        let folder = try value(#"{"id":"fresh","sourcePath":"/media/adult/videos/Set","files":[{"path":"/media/adult/videos/Set/new.mp4"}]}"#)
        let updated = PhotoLibraryCatalog.mergingFolders(original, library: "adultVideos", folders: [folder])
        let rows = AdultAccess.records(index: updated, section: .adultVideos)
        XCTAssertEqual(rows.count, 2)
        XCTAssertTrue(rows.contains { $0.title == "new.mp4" })
        XCTAssertFalse(rows.contains { $0.title == "old.mp4" })
        XCTAssertNotNil(updated["libraries"]?["photos"]?["public"])
        XCTAssertNotNil(original["libraries"]?["adultVideos"]?["stale"])
    }
}
