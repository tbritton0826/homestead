import XCTest
@testable import HomesteadModels

final class MediaIndexTests: XCTestCase {
    func testSavedMetadataEnrichesOnlyIndexedMoviesAndResolvesAliases() throws {
        let root = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"movies":{"one":{"id":"one","title":"Film"}}}"#.utf8))
        let matches = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"movies:one":{"aliasOf":"movies:canonical"},"movies:canonical":{"description":"Saved synopsis","poster":"https://image.tmdb.org/t/p/w500/test.jpg","year":2025},"movies:inaccessible":{"description":"Not in this account"}}"#.utf8))
        let items = try MediaIndex(root: root, matches: matches).items
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].overview, "Saved synopsis")
        XCTAssertEqual(items[0].year, "2025")
        XCTAssertEqual(items[0].poster, "https://image.tmdb.org/t/p/w500/test.jpg")
    }

    func testMetadataAliasCyclesAndTVIdentityMismatchAreIgnored() throws {
        let root = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"movies":{"one":{"id":"one","description":"Local"}},"tv":{"new":{"id":"new","title":"Same title"}}}"#.utf8))
        let matches = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"movies:one":{"aliasOf":"movies:loop"},"movies:loop":{"aliasOf":"movies:one"},"tv:new":{"localId":"old","description":"Wrong remake"}}"#.utf8))
        let items = try MediaIndex(root: root, matches: matches).items
        XCTAssertEqual(items.first { $0.category == .movies }?.overview, "Local")
        XCTAssertEqual(items.first { $0.category == .tv }?.overview, "")
    }

    func testRemoteArtworkStaysOnServerAndPreservesProviderQuery() throws {
        let server = try XCTUnwrap(URL(string: "http://10.0.0.224:7312"))
        let path = "https://covers.openlibrary.org/b/id/42-L.jpg?default=false"
        let url = try XCTUnwrap(ArtworkAddress.url(path: path, server: server, preview: true))
        XCTAssertEqual(url.host, server.host)
        XCTAssertEqual(url.path, "/api/artwork/cache")
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, path)
        XCTAssertNil(ArtworkAddress.url(path: "https://user:password@example.com/image.jpg", server: server, preview: true))
    }

    func testContinueArtworkUsesOnlySuppliedAccountIndex() throws {
        let root = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"libraries":{"personal":{"p":{"poster":"/media/p/poster.jpg","files":[{"path":"/media/p/video.mp4"}]}}}}"#.utf8))
        let artwork = PlaybackCatalog.artworkByFile(root)
        XCTAssertEqual(artwork["/media/p/video.mp4"], "/media/p/poster.jpg")
        XCTAssertNil(artwork["/media/other/video.mp4"])
    }

    private func decode(_ json: String) throws -> MediaIndex {
        try JSONDecoder().decode(MediaIndex.self, from: Data(json.utf8))
    }

    func testKeyedLibrariesAndNestedMetadata() throws {
        let index = try decode(#"{"libraries":{"movies":{"m1":{"id":"one","name":"Fallback","metadata":{"title":"Arrival","year":2016,"description":"First contact"},"counts":{"total":3},"addedAt":"2026-09-29T12:00:00.123Z"}},"tv":{"s1":{"id":"one","title":"A series"}},"personal":{"secret":{"title":"Private item"}}}}"#)
        XCTAssertEqual(index.items.count, 2)
        XCTAssertEqual(Set(index.items.map(\.id)).count, 2)
        let movie = try XCTUnwrap(index.items.first { $0.category == .movies })
        XCTAssertEqual(movie.title, "Arrival")
        XCTAssertEqual(movie.year, "2016")
        XCTAssertEqual(movie.fileCount, 3)
        XCTAssertEqual(movie.overview, "First contact")
        XCTAssertNotNil(movie.addedAt)
    }

    func testLegacyArraysDeduplicationAndMissingMetadata() throws {
        let index = try decode(#"{"movies":[{"id":"x","title":"Film"},{"id":"x","title":"Duplicate"},null],"musicArtists":[{"id":12,"name":"Artist","metadata":null}],"tvShows":[{"title":"Series","addedAt":"2026-09-29T12:00:00Z"}]}"#)
        XCTAssertEqual(index.items.count, 3)
        XCTAssertEqual(index.items.first { $0.category == .music }?.id, "music:12")
        XCTAssertNotNil(index.items.first { $0.category == .tv }?.addedAt)
        XCTAssertNil(index.items.first { $0.category == .movies }?.addedAt)
    }

    func testEmptyAccountAndUnexpectedResponses() throws {
        XCTAssertTrue(try decode(#"{"libraries":{}}"#).items.isEmpty)
        XCTAssertThrowsError(try decode(#"{"ok":false,"message":"Denied"}"#))
        XCTAssertThrowsError(try decode("[]"))
        XCTAssertThrowsError(try decode("not json"))
    }

    func testDisplayFieldFallbackOrder() throws {
        let index = try decode(#"{"movies":[{"id":"a","title":"Preferred","name":"Fallback","year":1999,"metadata":{"title":"Metadata title","year":2000,"description":"Preferred description"},"description":"Fallback description"},{"id":"b","title":" ","metadata":{"name":"Metadata name","overview":"Overview"}},{"id":"c"}]}"#)
        let preferred = try XCTUnwrap(index.items.first { $0.id == "movies:a" })
        XCTAssertEqual(preferred.title, "Preferred")
        XCTAssertEqual(preferred.year, "2000")
        XCTAssertEqual(preferred.overview, "Preferred description")
        let fallback = try XCTUnwrap(index.items.first { $0.id == "movies:b" })
        XCTAssertEqual(fallback.title, "Metadata name")
        XCTAssertEqual(fallback.overview, "Overview")
        XCTAssertEqual(index.items.first { $0.id == "movies:c" }?.title, "Untitled")
    }
}
