import XCTest
@testable import HomesteadModels

final class NativeParityTests: XCTestCase {
    private func decode(_ value: String) throws -> IndexValue { try JSONDecoder().decode(IndexValue.self, from: Data(value.utf8)) }
    func testArtworkFallbacksPreservePriorityAndHandleMissingSources() throws {
        let posterCases: [(String, String)] = [
            (#"{"metadataMatch":{"artworkOverrides":{"gridPoster":"/media/override.jpg"}},"poster":"/media/local.jpg","cover":"cover.jpg"}"#, "/media/override.jpg"),
            (#"{"poster":"/media/local.jpg","cover":"cover.jpg"}"#, "/media/local.jpg"),
            (#"{"cover":"cover.jpg","thumbnail":"thumbnail.jpg"}"#, "cover.jpg"),
            (#"{"thumbnail":"thumbnail.jpg","image":"image.jpg"}"#, "thumbnail.jpg"),
            (#"{"image":"image.jpg","imageLinks":{"thumbnail":"linked.jpg"}}"#, "image.jpg"),
            (#"{"imageLinks":{"thumbnail":"linked.jpg"},"posterPath":"/provider.jpg"}"#, "linked.jpg"),
            (#"{"posterPath":"/provider.jpg","metadataMatch":{"poster":"matched.jpg"}}"#, "https://image.tmdb.org/t/p/w342/provider.jpg"),
            (#"{"poster_path":"/alternate.jpg"}"#, "https://image.tmdb.org/t/p/w342/alternate.jpg"),
            (#"{"metadataMatch":{"poster":"matched.jpg"}}"#, "matched.jpg")
        ]
        for (json, expected) in posterCases {
            XCTAssertEqual(SearchPresentation.poster(try decode(json)), expected, json)
        }
        let bannerCases: [(String, String)] = [
            (#"{"metadataMatch":{"artworkOverrides":{"banner":"/media/override.jpg"}},"banner":"/media/local.jpg"}"#, "/media/override.jpg"),
            (#"{"banner":"/media/local.jpg","backdropPath":"/provider.jpg"}"#, "/media/local.jpg"),
            (#"{"backdropPath":"/provider.jpg","metadata":{"banner":"/media/metadata.jpg"}}"#, "https://image.tmdb.org/t/p/w1280/provider.jpg"),
            (#"{"backdrop_path":"/alternate.jpg"}"#, "https://image.tmdb.org/t/p/w1280/alternate.jpg"),
            (#"{"metadata":{"banner":"/media/metadata.jpg"},"metadataMatch":{"backdrop":"matched.jpg"}}"#, "/media/metadata.jpg"),
            (#"{"metadataMatch":{"backdrop":"matched.jpg"}}"#, "matched.jpg")
        ]
        for (json, expected) in bannerCases {
            XCTAssertEqual(SearchPresentation.banner(try decode(json)), expected, json)
        }
        XCTAssertNil(SearchPresentation.poster(.object([:])))
        XCTAssertNil(SearchPresentation.banner(.object([:])))
    }
    func testBookManualLinksCombineAudioWithReadingWithoutTitleBasedMerging() throws {
        let root = try decode(#"{"libraries":{"books":{"ebook":{"id":"ebook","title":"Same title","files":[{"path":"/books/read.epub"}]},"other":{"id":"other","title":"Same title","files":[{"path":"/books/other.pdf"}]}},"audiobooks":{"audio":{"id":"audio","title":"Same title","files":[{"path":"/books/audio.mp3"}]}}}}"#)
        let separate = try MediaIndex(root: root)
        XCTAssertEqual(separate.items.count, 3)
        let linked = try MediaIndex(root: root, editionLinks: decode(#"{"ebook":"work-1","audio":"work-1"}"#))
        XCTAssertEqual(linked.items.count, 2)
        let work = try XCTUnwrap(linked.items.first { $0.bookWorkID == "manual:work-1" })
        XCTAssertTrue(work.files.contains(where: \.readable))
        XCTAssertTrue(work.files.contains(where: \.audio))
    }
    func testFamilyNavigationRequiresSessionPermissionsAndEnabledSublibraries() throws {
        let session = try decode(#"{"ok":true,"authEnabled":true,"user":{"role":"child","allowedLibraries":["recipes"]}}"#)
        let config = try decode(#"{"enabledLibraries":{"family":true},"familySublibraries":{"familyTree":false}}"#)
        XCTAssertEqual(FamilyCatalog.allowed(session: session, config: config), ["recipes"])
        let owner = try decode(#"{"ok":true,"authEnabled":true,"user":{"role":"owner"}}"#)
        XCTAssertFalse(FamilyCatalog.allowed(session: owner, config: config).contains("family-tree"))
        XCTAssertTrue(FamilyCatalog.allowed(session: owner, config: config).contains("pets"))
        XCTAssertTrue(FamilyCatalog.allowed(session: try decode(#"{"ok":true,"authEnabled":true}"#), config: config).isEmpty)
    }
    func testNativeFamilyDataKeepsDocumentsSeparateAndCalendarAudienceIntact() throws {
        let root = try decode(#"{"libraries":{"family":{"one":{"id":"one","name":"Album","files":[{"path":"/family/photo.jpg"},{"path":"/family/record.pdf"},{"path":"/family/clip.mp4"}]}}}}"#)
        let records = FamilyCatalog.records(root, library: "family")
        XCTAssertEqual(records[0].files.count, 2)
        XCTAssertEqual(records[0].documents.count, 1)
        let response = try decode(#"{"events":[{"id":"b","date":"2026-10-15","title":"Later","ownerUserId":"user-1","visibility":"self"},{"id":"a","date":"2026-10-14","title":"Today"},{"id":"a","date":"2026-10-14","title":"Duplicate"}]}"#)
        let events = FamilyCatalog.events(response)
        XCTAssertEqual(events.map(\.id), ["a", "b"])
        XCTAssertEqual(events[1].row["visibility"]?.text, "self")
    }
    func testDiscoveryArtworkStatusAndGroupsRetainProviderIdentity() throws {
        let row = try decode(#"{"id":123,"mediaType":"movie","title":"Movie","posterPath":"/poster.jpg","backdropPath":"/banner.jpg","releaseDate":"2014-01-01","lifecycle":{"status":"downloading"}}"#)
        let hit = NativeSearchMapping.hit(row, source: "Seerr", fallbackID: "fallback")
        XCTAssertEqual(hit.requestTarget?.providerID, "123")
        XCTAssertEqual(hit.posterPath, "https://image.tmdb.org/t/p/w342/poster.jpg")
        XCTAssertEqual(hit.status, "downloading")
        XCTAssertEqual(hit.year, "2014")
        XCTAssertEqual(SearchPresentation.groups([hit]).first?.id, "Discover Movies")
    }
    func testRequestStatusesDoNotCrossLibrariesWithTheSameNumericIdentifier() throws {
        let hit = NativeSearchMapping.hit(try decode(#"{"id":123,"mediaType":"tv","title":"Show"}"#), source: "Seerr", fallbackID: "fallback")
        let unrelated = try decode(#"[{"library":"music","tmdbId":123,"status":"downloading"},{"library":"movies","tmdbId":123,"status":"owned"}]"#)
        XCTAssertEqual(SearchPresentation.applyStatuses(unrelated.list, to: [hit])[0].status, "discovery")
        let matching = try decode(#"[{"library":"tvShows","tmdbId":123,"status":"downloading"}]"#)
        XCTAssertEqual(SearchPresentation.applyStatuses(matching.list, to: [hit])[0].status, "downloading")
        XCTAssertEqual(SearchPresentation.requestHit(matching.list[0]).requestTarget?.kind, "tv")
    }
    func testStructuredFamilyMetadataDoesNotDisappearWhenStoredAsArraysOrObjects() throws {
        let fields = FamilyCatalog.detailFields(try decode(#"{"vaccines":[{"name":"Annual","current":true}],"notes":"Follow up"}"#))
        XCTAssertEqual(fields.count, 3)
        XCTAssertEqual(fields.first { $0.label == "Vaccines · 1 · Name" }?.value, "Annual")
        XCTAssertEqual(fields.first { $0.label == "Vaccines · 1 · Current" }?.value, "Yes")
        XCTAssertTrue(FamilyCatalog.detailFields(.array([])).isEmpty)
    }
    func testScheduleReviewRejectsInvalidDatesTimesAndMismatchedHours() throws {
        let overnight = try decode(#"[{"date":"2026-10-14","dayType":"work","startTime":"22:00","endTime":"06:00"},{"date":"2026-10-15","dayType":"off"}]"#).list
        XCTAssertEqual(CalendarScheduleReview.hours(overnight), 8)
        XCTAssertTrue(CalendarScheduleReview.valid(overnight, printedHours: 8))
        XCTAssertFalse(CalendarScheduleReview.valid(overnight, printedHours: 7))
        XCTAssertFalse(CalendarScheduleReview.valid(overnight, printedHours: .infinity))
        XCTAssertNil(CalendarScheduleReview.hours(try decode(#"[{"date":"2026-02-30","startTime":"09:00","endTime":"17:00"}]"#).list))
        XCTAssertNil(CalendarScheduleReview.hours(try decode(#"[{"date":"2026-10-14","startTime":"24:00","endTime":"17:00"}]"#).list))
        XCTAssertEqual(FamilyCalendarDate.formatter("yyyy-MM-dd").calendar.identifier, .gregorian)
    }
    func testAIContractsPreserveToolModeAndDoNotForwardAttachmentsToChatOnlyModels() throws {
        let choices = AIModelChoice.choices(try decode(#"{"chatAllowed":true,"models":[{"provider":"ollama","model":"model-1"}]}"#))
        XCTAssertEqual(choices.count, 2)
        let body = try AIContract.body(message: "Hello", conversationID: "conversation-1", choice: choices[0], attachments: ["asset-1"])
        let value = try JSONDecoder().decode(IndexValue.self, from: body)
        XCTAssertEqual(value["mode"]?.text, "assistant")
        XCTAssertEqual(value["attachmentIds"]?.list.first?.text, "asset-1")
        XCTAssertThrowsError(try AIContract.body(message: "Hello", conversationID: nil, choice: choices[1], attachments: ["asset-1"]))
        XCTAssertNil(AIContract.safeID("../conversation"))
        let config = try decode(#"{"permissions":{"tools":{"lore.create":{"enabled":true,"confirmation":"always"}}},"unknown":{"preserve":true}}"#)
        let changed = AIContract.setting(config, path: ["permissions","tools","lore.create","enabled"], value: .bool(false))
        XCTAssertEqual(changed["permissions"]?["tools"]?["lore.create"]?["confirmation"]?.text, "always")
        XCTAssertEqual(changed["unknown"]?["preserve"]?.flag, true)
    }
}
