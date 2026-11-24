import XCTest
@testable import HomesteadModels

final class LibraryBrowseTests: XCTestCase {
    private func value(_ json: String) throws -> IndexValue { try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8)) }
    func testLibraryTabsAndFolderAlbumsExposePlayableTracksAndVideosSeparately() throws {
        let index = try value(#"{"libraries":{"music":{"artist":{"id":"artist","name":"Artist","files":[{"path":"/media/music/Artist/First/one.mp3","title":"One"},{"path":"/media/music/Artist/First/cover.jpg"},{"path":"/media/music/Artist/Second/two.flac","title":"Two"},{"path":"/media/music/Artist/video.mp4","title":"Video"}]}}}}"#)
        let result = LibraryBrowseCatalog.build(index: index, category: .music)
        XCTAssertEqual(MediaLibraryTab.tabs(.music), [.songs, .artists, .musicVideos, .albums, .playlists])
        XCTAssertEqual(result.files.filter { $0.file.audio }.count, 2)
        XCTAssertEqual(result.files.filter { $0.file.video }.count, 1)
        XCTAssertEqual(result.albums.count, 2)
        XCTAssertEqual(result.files.first { $0.file.title == "One" }?.poster, "/media/music/Artist/First/cover.jpg")
    }
    func testSameSeriesTitleRemainsScopedToCreatorAndCustomGroupsUseAuthorizedPathsOnly() throws {
        let index = try value(#"{"youtube":{"a":{"name":"A","videos":[{"title":"Episode 1","path":"/media/youtube/A/one.mp4","series":"Same game"}]},"b":{"name":"B","videos":[{"title":"Episode 2","path":"/media/youtube/B/two.mp4","series":"Same game"}]}}}"#)
        let result = LibraryBrowseCatalog.build(index: index, category: .youtube)
        XCTAssertEqual(result.series.count, 2)
        XCTAssertEqual(Set(result.series.map(\.id)).count, 2)
        let custom = try value(#"[{"id":"manual","name":"My series","library":"youtube","libraryTab":"series","items":[{"sourceId":"/media/youtube/B/two.mp4"},{"sourceId":"missing","sourcePath":"/media/private/guessed.mp4"},{"sourceId":"/media/youtube/A/one.mp4"}]}]"#)
        let groups = LibraryBrowseCatalog.custom(custom.list, category: .youtube, tab: .series, files: result.files)
        XCTAssertEqual(groups[0].files.map(\.id), ["/media/youtube/B/two.mp4", "/media/youtube/A/one.mp4"])
        XCTAssertEqual(LibraryBrowseCatalog.custom(custom.list, category: .music, tab: .playlists, files: result.files).count, 0)
    }
    func testPrintingQueueKeepsEachGroupIdentityPhotosQuantityAndStorageWithoutSaving() throws {
        var first = NativeInventoryDraft()
        first.applyCard(try value(#"{"cardId":"1234","cardName":"Card","setCode":"SET-EN001","rarity":"Rare","priceAvailable":false,"marketValue":0}"#))
        XCTAssertEqual(first.marketValue, "")
        first.quantity = 2; first.locationID = "binder"; first.locationType = "binder"; first.location = "Binder"
        var second = first; second.rarity = "Common"; second.quantity = 5; second.locationID = "box"; second.locationType = "box"; second.location = "Commons"
        let entries = [InventoryQueueEntry(id: UUID(), draft: first, photos: []), InventoryQueueEntry(id: UUID(), draft: second, photos: [])]
        let request = UUID()
        let payload = try InventoryQueueEntry.body(entries, requestID: request)
        XCTAssertEqual(payload, try InventoryQueueEntry.body(entries, requestID: request))
        let object = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
        let rows = object["entries"] as! [[String: Any]]
        XCTAssertEqual(rows[0]["id"] as? String, entries[0].id.uuidString)
        XCTAssertEqual(rows[1]["quantity"] as? Int, 5)
        XCTAssertEqual((rows[0]["tcg"] as? [String: Any])?["priceAvailable"] as? Bool, false)
        XCTAssertEqual((rows[1]["tcg"] as? [String: Any])?["locationId"] as? String, "box")
        let card = InventoryRecord(row: try value(#"{"id":"card","tcg":{"quantity":7,"printings":[{"location":"Binder","quantity":2},{"location":"Commons","quantity":5}]}}"#))
        XCTAssertEqual(card.locationTotals.map { $0.1 }.reduce(0, +), 7)
    }
    func testEditingUnpricedHoldingDoesNotTurnMissingQuoteIntoZeroManualValue() throws {
        let record = InventoryRecord(row: try value(#"{"id":"card","title":"Card","category":"trading-cards","tcg":{"quantity":1}}"#))
        let holding = try value(#"{"id":"holding","quantity":1,"priceAvailable":false,"marketValue":0}"#)
        var draft = NativeInventoryDraft.editing(record, printing: holding)
        var payload = try JSONSerialization.jsonObject(with: draft.editBody(printing: true)) as! [String: Any]
        XCTAssertNil(payload["marketValue"])
        draft.marketValue = "3.5"
        payload = try JSONSerialization.jsonObject(with: draft.editBody(printing: true)) as! [String: Any]
        XCTAssertEqual(payload["marketValue"] as? Double, 3.5)
    }
}
