import XCTest
@testable import HomesteadModels

final class BookActionsTests: XCTestCase {
    private func row(_ json: String) throws -> IndexValue {
        try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
    }
    func testEbookAndAudioAliasesArePreservedOnlyForBookContexts() throws {
        let book = try row(#"{"ebookFiles":[{"path":"/books/title.epub"},{"path":"/books/title.pdf"}],"audiobookFiles":[{"path":"/books/02.m4b"},{"path":"/books/01.mp3"}],"files":[{"path":"/books/title.epub"},{"path":"/books/cover.jpg"}]}"#)
        let files = PlaybackCatalog.files(book, includeBooks: true)
        XCTAssertEqual(files.filter(\.readable).count, 2)
        XCTAssertEqual(files.filter(\.audio).map(\.title), ["01.mp3", "02.m4b"])
        XCTAssertEqual(Set(files.map(\.path)).count, files.count)
        XCTAssertFalse(PlaybackCatalog.files(book).contains(where: \.readable))
    }
    func testBookIndexAndRecursiveAudioRetainOnlyExactIndexedFiles() throws {
        let index = try MediaIndex(root: row(#"{"libraries":{"books":{"a":{"id":"a","title":"Title","ebookFiles":[{"path":"/books/title.epub"}],"audiobookFiles":[{"path":"/books/title.m4b"}],"children":[{"files":[{"path":"/books/title.pdf"}]}]}}}}"#))
        XCTAssertEqual(index.items.count, 1)
        XCTAssertEqual(index.items[0].files.filter(\.readable).count, 2)
        XCTAssertEqual(index.items[0].files.filter(\.audio).count, 1)
    }
    func testReadableAddressesHandleEncodedFilesAndRejectOtherServers() {
        let server = URL(string: "https://homestead.local")!
        let file = ProfileMediaFile(path: "/api/file?path=%2Fbooks%2FMy%20Book.EPUB", title: "Book", video: false)
        XCTAssertTrue(file.readable)
        XCTAssertFalse(file.playable)
        XCTAssertNotNil(ProfileMediaFile.url(path: file.path, server: server, preview: false))
        XCTAssertNil(ProfileMediaFile.url(path: "https://elsewhere.example/book.epub", server: server, preview: false))
        XCTAssertFalse(ProfileMediaFile(path: "/books/title.mobi", title: "MOBI", video: false).readable)
    }
}
