import XCTest
@testable import HomesteadModels

final class V316Tests: XCTestCase {
    private func value(_ json: String) throws -> IndexValue { try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8)) }
    private func video(_ path: String) -> ProfileMediaFile { ProfileMediaFile(path: path, title: (path as NSString).lastPathComponent, video: true) }

    func testMovieVersionsExcludeSidecarsAndBonusVideos() {
        let files = [video("/media/movies/Film/Film-1080p.mp4"), video("/media/movies/Film/Film-2160p.mkv"),
                     video("/media/movies/Film/trailer.mp4"), video("/media/movies/Film/extras/Interview.mp4"),
                     ProfileMediaFile(path: "/media/movies/Film/poster.jpg", title: "poster.jpg", video: false)]
        XCTAssertEqual(MediaDetailCatalog.movieVersions(files).map(\.title), ["Film-1080p.mp4", "Film-2160p.mkv"])
        XCTAssertEqual(MediaDetailCatalog.movieVersions([video("/media/movies/Trailer Park Boys/Trailer Park Boys.mp4")]).count, 1)
    }

    func testSeasonCountsDeduplicateVersionsAndNeverInventUnknownTotals() throws {
        let files = [video("/media/tv/Show/Season 1/Show.S01E01.1080p.mp4"),
                     video("/media/tv/Show/Season 1/Show.S01E01.2160p.mkv"),
                     video("/media/tv/Show/Season 1/Show.S01E02.mp4"), video("/media/tv/Show/Season 2/Show.S02E01.mp4")]
        let metadata = try value(#"{"seasons":[{"season_number":1,"episode_count":23}]}"#)
        let groups = MediaDetailCatalog.seasons(row: .object([:]), files: files, metadata: metadata)
        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].available, 2)
        XCTAssertEqual(groups[0].countLabel, "2/23")
        XCTAssertEqual(groups[1].countLabel, "1 available")
        XCTAssertNil(groups[1].total)
        XCTAssertEqual(MediaDetailCatalog.episodeIdentities(video("/Show.S01E03-E04.mkv")), ["1:3", "1:4"])
        XCTAssertEqual(MediaDetailCatalog.episodeIdentities(video("/Show.1x01.mp4")), ["1:1"])
        let updated = MediaDetailCatalog.updatingTotals(groups, totals: [2: 10, 3: 8])
        XCTAssertEqual(updated[0].files, groups[0].files)
        XCTAssertEqual(updated[2].countLabel, "0/8")
    }

    func testProviderIdentityIsExplicitAndCastRelatedDeduplicate() throws {
        let row = try value(#"{"id":"999","metadata":{"tmdbId":123,"cast":[{"id":1,"name":"Actor"},{"id":1,"name":"Actor"}],"related":[{"id":5,"title":"Other","mediaType":"movie"},{"id":5,"title":"Other","mediaType":"movie"}]}}"#)
        let detail = MediaDetailCatalog.snapshot(row: row, match: nil, category: .movies, files: [])
        XCTAssertEqual(detail.providerID, "123")
        XCTAssertEqual(detail.cast.count, 1)
        XCTAssertEqual(detail.related.count, 1)
        XCTAssertNil(MediaDetailCatalog.snapshot(row: try value(#"{"id":"999"}"#), match: nil, category: .movies, files: []).providerID)
    }

    func testYouTubeCreatorKeepsExplicitSeriesSeasonsAndPerVideoArtwork() throws {
        let index = try value(#"{"youtube":{"creator":{"id":"creator","name":"Creator","videos":[{"sourcePath":"/media/youtube/A/one.mp4","title":"Episode 1","series":"Series A","season":"Season 2","thumbnail":"/media/youtube/A/one.jpg"},{"sourcePath":"/media/youtube/B/two.mp4","title":"Episode 1","series":"Series B","season":"Season 1"}]}}}"#)
        let catalog = LibraryBrowseCatalog.build(index: index, category: .youtube)
        XCTAssertEqual(catalog.people.count, 1)
        XCTAssertEqual(Set(catalog.people[0].files.map(\.seriesName)), ["Series A", "Series B"])
        XCTAssertEqual(catalog.series.count, 2)
        XCTAssertEqual(catalog.series.first { $0.title == "Series A" }?.files.first?.seasonName, "Season 2")
        XCTAssertEqual(catalog.files.first { $0.seriesName == "Series A" }?.poster, "/media/youtube/A/one.jpg")
    }

    func testPlaybackChoiceTimeAndSeekBounds() {
        XCTAssertFalse(PlaybackPresentation.needsChoice(resume: 0))
        XCTAssertFalse(PlaybackPresentation.needsChoice(resume: .nan))
        XCTAssertTrue(PlaybackPresentation.needsChoice(resume: 11))
        XCTAssertEqual(PlaybackPresentation.boundedSeek(-15, duration: 120), 0)
        XCTAssertEqual(PlaybackPresentation.boundedSeek(180, duration: 120), 120)
        XCTAssertEqual(PlaybackPresentation.boundedSeek(.infinity, duration: 120), 0)
        XCTAssertEqual(PlaybackPresentation.time(3671), "1:01:11")
        XCTAssertEqual(PlaybackPresentation.time(.nan), "0:00")
        XCTAssertEqual(PlaybackPresentation.cleanTitle("City_of_Bones-Part01.mp3"), "City of Bones-Part01")
        XCTAssertEqual(PlaybackPosition(position: 120, duration: 120, completed: true, updatedAt: "").resume, 0)
    }

    func testReadingProgressIsAccountAndServerScoped() throws {
        let server = try XCTUnwrap(URL(string: "http://homestead.local"))
        let file = ProfileMediaFile(path: "/media/books/City.epub", title: "City", video: false)
        XCTAssertNotEqual(ReadingProgress.key(server: server, account: "one", file: file),
                          ReadingProgress.key(server: server, account: "two", file: file))
        XCTAssertFalse(ReadingProgress.key(server: server, account: "one", file: file).contains(file.path))
    }

    func testPosterMetadataUsesExistingPermissionFilteredValues() throws {
        let row = try value(#"{"metadata":{"birthday":"2000-01-01","braSize":"32B","pantySize":"S"}}"#)
        let date = Date(timeIntervalSince1970: 1767225600) // January 1, 2026 UTC
        let privateItems = ProfilePresentation.metadata(row, allowIntimate: true, now: date)
        XCTAssertTrue(privateItems.contains { $0.label == "Age" && $0.value == "26" })
        XCTAssertTrue(privateItems.contains { $0.label == "Bra size" && $0.value == "32B" })
        XCTAssertFalse(ProfilePresentation.metadata(row, allowIntimate: false, now: date).contains { $0.label == "Bra size" || $0.label == "Panty size" })
    }

    func testOwnedSearchRoutingRequiresStableIdentityAndCorrectLibrary() throws {
        let file = video("/media/movies/A/movie.mp4")
        let item = MediaItem(id: "movies:local-a", title: "Same Title", category: .movies, year: "", overview: "", poster: nil,
                             addedAt: nil, fileCount: 1, files: [file], identities: ["local-a"])
        let hit = NativeSearchMapping.hit(try value(#"{"id":"local-a","title":"Same Title"}"#), source: "Movies", fallbackID: "")
        XCTAssertEqual(MediaDetailCatalog.ownedItem(hit, items: [item])?.id, item.id)
        let unrelated = NativeSearchMapping.hit(try value(#"{"id":"different","title":"Same Title"}"#), source: "Movies", fallbackID: "")
        XCTAssertNil(MediaDetailCatalog.ownedItem(unrelated, items: [item]))
    }
}
