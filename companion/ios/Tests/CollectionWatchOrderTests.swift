import XCTest
@testable import HomesteadModels

final class CollectionWatchOrderTests: XCTestCase {
    private func json(_ text: String) throws -> IndexValue {
        try JSONDecoder().decode(IndexValue.self, from: Data(text.utf8))
    }
    private func show(_ identity: String = "ncis") -> MediaItem {
        let files = [1, 2].map { number in
            ProfileMediaFile(path: "/media/tv/\(identity)/S00E0\(number).mkv", title: "Special S00E0\(number)", video: true)
        }
        return MediaItem(id: "tv:" + identity, title: "NCIS (2003)", category: .tv, year: "2003", overview: "", poster: nil, addedAt: nil, fileCount: 2, files: files, identities: [identity])
    }

    func testSavedSeasonOrderKeepsSpecialsAndMissingEpisodesInPlace() throws {
        let value = try json(#"{"title":"NCIS Watch Order","sections":[{"title":"Crossovers","items":[{"library":"tv","sourceId":"ncis","title":"NCIS","unit":"season","season":0,"episodes":[2,99,1]}]},{"title":"Revisit","items":[{"library":"tv","sourceId":"ncis","title":"NCIS","unit":"episode","season":0,"episodes":[2]}]}]}"#)
        let order = try XCTUnwrap(CollectionWatchOrder.decode(value, media: [show()]))
        XCTAssertEqual(order.sections.map(\.title), ["Crossovers", "Revisit"])
        XCTAssertEqual(order.sections.flatMap(\.rows).map(\.number), [1, 2])
        XCTAssertEqual(order.sections[0].rows[0].episodes.map(\.label), ["S00E02", "S00E99", "S00E01"])
        XCTAssertNil(order.sections[0].rows[0].episodes[1].file)
        XCTAssertTrue(order.sections[0].rows[0].episodes[0].file?.path.hasSuffix("S00E02.mkv") == true)
        XCTAssertEqual(order.sections[1].rows[0].episodes.first?.label, "S00E02")
    }

    func testExplicitMissingIdentityAndAmbiguousTitlesNeverSubstituteAnotherShow() throws {
        let value = try json(#"{"sections":[{"items":[{"library":"tv","sourceId":"missing","title":"NCIS","path":"/secret/episode.mkv","season":0,"episodes":[1]},{"type":"tv","title":"NCIS","season":0,"episodes":[1]},{"library":"tv","sourceId":"ncis","unmatched":true,"title":"NCIS","season":0,"episodes":[1]}]}]}"#)
        let order = try XCTUnwrap(CollectionWatchOrder.decode(value, media: [show(), show("remake")]))
        XCTAssertTrue(order.sections[0].rows.allSatisfy { $0.item == nil })
        XCTAssertTrue(order.sections[0].rows.flatMap(\.episodes).allSatisfy { $0.file == nil })
    }

    func testLegacyRangesExactTitleAndMixedLibraryRows() throws {
        let book = MediaItem(id: "books:b", title: "Companion Book", category: .books, year: "", overview: "", poster: nil, addedAt: nil, fileCount: nil, identities: ["b"])
        let value = try json(#"{"sections":[{"items":[{"type":"tv","title":"NCIS","season":0,"episodeStart":1,"episodeEnd":2},{"library":"books","sourceId":"b","title":"Companion Book"},{"library":"tv","sourceId":"ncis","title":"NCIS","unit":"episode","season":0,"episodes":[2,1]}]}]}"#)
        let order = try XCTUnwrap(CollectionWatchOrder.decode(value, media: [show(), book]))
        XCTAssertEqual(order.count, 3)
        XCTAssertEqual(order.sections[0].rows[0].episodes.map(\.label), ["S00E01", "S00E02"])
        XCTAssertEqual(order.sections[0].rows[1].item?.id, "books:b")
        XCTAssertTrue(order.sections[0].rows[1].canBrowseTitle)
        XCTAssertEqual(order.sections[0].rows[2].episodes.map(\.label), ["S00E02", "S00E01"])
        XCTAssertNil(CollectionWatchOrder.decode(.other, media: [show()]))
        XCTAssertEqual(CollectionWatchOrder.decode(try json(#"{"sections":[]}"#), media: [])?.count, 0)
    }

    func testOnlySavedCollectionsAppearAndUseTheRealServerIdentity() throws {
        let media = [show()]
        let seeds = try json(#"[{"id":"ncis-universe","name":"NCIS Universe","terms":["NCIS"]}]"#).list
        XCTAssertTrue(SharedCollectionCatalog.build(media: media, custom: [], seeds: seeds, orders: [], appearances: []).isEmpty)
        let saved = try json(#"[{"id":"saved-ncis","generatedCollectionId":"ncis-universe","name":"My NCIS","items":[{"library":"tv","sourceId":"ncis"}]}]"#).list
        let groups = SharedCollectionCatalog.build(media: media, custom: saved, seeds: seeds, orders: [], appearances: [])
        XCTAssertEqual(groups.map(\.id), ["custom:saved-ncis"])
        XCTAssertEqual(groups.first?.serverID, "saved-ncis")
        let appearance = try json(#"[{"collectionId":"ncis-universe","name":"Legacy NCIS"}]"#).list
        let legacy = SharedCollectionCatalog.build(media: media, custom: [], seeds: seeds, orders: [], appearances: appearance)
        XCTAssertEqual(legacy.first?.serverID, "ncis-universe")
    }
}
