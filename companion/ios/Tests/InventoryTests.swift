import XCTest
@testable import HomesteadModels

final class InventoryTests: XCTestCase {
    private func row(_ json: String) throws -> IndexValue { try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8)) }
    private func object(_ data: Data) throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]) }
    func testValueSummaryDistinguishesMissingPricesAndManualZero() throws {
        let holdings = try row(#"[{"quantity":2,"marketValue":3,"purchasePrice":1,"priceAvailable":true},{"quantity":4,"marketValue":0,"purchasePrice":0.5,"priceAvailable":false},{"quantity":1,"marketValue":0,"purchasePrice":1,"priceSourceType":"manual-override"}]"#).list
        let summary = InventoryValueSummary(holdings)
        XCTAssertEqual(summary.owned, 7); XCTAssertEqual(summary.unpriced, 4)
        XCTAssertEqual(summary.value, 6); XCTAssertEqual(summary.invested, 5)
        XCTAssertEqual(summary.pricedCost, 3)
    }
    func testGridCountsOnePrintingAcrossLocationsAndSkipsBlankArtwork() throws {
        let record = InventoryRecord(row: try row(#"{"id":"card","poster":"","category":"trading-cards","tcg":{"selectedArtwork":"https://example.test/card.jpg","printings":[{"setCode":"SET-EN001","rarity":"Rare","edition":"1st Edition","language":"English","locationId":"deck","quantity":2},{"setCode":"SET-EN001","rarity":"Rare","edition":"1st Edition","language":"English","locationId":"box","quantity":3}]}}"#))
        XCTAssertEqual(record.printingCount, 1); XCTAssertEqual(record.valueSummary.owned, 5)
        XCTAssertEqual(record.artwork, "https://example.test/card.jpg")
    }
    func testRefreshedQuoteSurvivesEditAndTypedEstimateRemainsManual() throws {
        var draft = NativeInventoryDraft(); draft.title = "Card"; draft.category = "trading-cards"
        draft.setCode = "SET-EN001"; draft.rarity = "Rare"
        draft.applyPriceQuote(try row(#"{"marketValue":2.5,"printingPrice":2.5,"priceAvailable":true,"priceSourceType":"exact-printing","priceSource":"TCG Price Lookup / TCGplayer","priceProviderId":"fixture","priceCurrency":"USD","pricedSetCode":"SET-EN001","pricedRarity":"Rare"}"#))
        let quoted = try object(draft.editBody(printing: true))
        XCTAssertEqual(quoted["priceSourceType"] as? String, "exact-printing")
        XCTAssertEqual(quoted["priceProviderId"] as? String, "fixture")
        draft.marketValue = "7"
        let manual = try object(draft.editBody(printing: true))
        XCTAssertEqual(manual["marketValue"] as? Double, 7)
        XCTAssertNil(manual["priceSourceType"], "the server marks a changed numeric estimate as manual")
    }
    func testCardLookupAcceptsOnlySetCodeAndIgnoresAnOldTitle() {
        let query = InventoryCardSearch.queryItems(name: "Wrong or old name", setCode: " cori-en029 ", passcode: "")
        XCTAssertEqual(query, [URLQueryItem(name: "setCode", value: "CORI-EN029")])
        XCTAssertEqual(InventoryCardSearch.queryItems(name: "", setCode: "CORI-EN029", passcode: ""), query)
        XCTAssertEqual(InventoryCardSearch.queryItems(name: "Card", setCode: "", passcode: ""), [URLQueryItem(name: "name", value: "Card")])
        let idQuery = InventoryCardSearch.queryItems(name: "Old name", setCode: "", passcode: " 1234 ")
        XCTAssertEqual(idQuery.first, URLQueryItem(name: "cardId", value: "1234"))
        XCTAssertFalse(idQuery.contains { $0.name == "name" })
    }
    func testInventorySharesServerIdentifiersAndFiltersCategoryLocationBarcodeAndPrintings() throws {
        let response = try row(#"{"records":[{"id":"card","title":"Example card","category":"trading-cards","code":"0123456789012","tcg":{"quantity":3,"location":"Shelf","printings":[{"id":"one","setCode":"TEST-EN001","rarity":"Rare","quantity":3}]},"metadata":{"thumbnail":"https://example.test/card.jpg"}}]}"#)
        let records = InventoryCatalog.records(response)
        XCTAssertEqual(records.count, 1)
        let record = try XCTUnwrap(records.first)
        XCTAssertEqual(record.id, "card"); XCTAssertEqual(record.quantity, "3")
        XCTAssertEqual(record.artwork, "https://example.test/card.jpg")
        XCTAssertTrue(record.matches(section: .tcg, query: "test-en001"))
        XCTAssertTrue(record.matches(section: .locations, query: "Shelf"))
        XCTAssertTrue(record.matches(section: .all, query: "0123456789012"))
        XCTAssertFalse(record.matches(section: .tools, query: ""))
        XCTAssertFalse(record.matches(section: .all, query: "no match"))
    }
    func testInventoryNavigationRequiresFeatureLibraryAndAccountPermission() throws {
        let config = try row(#"{"subscription":{"features":{"inventory":true}},"enabledLibraries":{"inventory":true}}"#)
        let session = try row(#"{"ok":true,"authEnabled":true,"user":{"role":"member","allowedLibraries":["inventory"]}}"#)
        XCTAssertTrue(InventoryCatalog.visible(session: session, config: config))
        let denied = try row(#"{"ok":true,"authEnabled":true,"user":{"role":"member","allowedLibraries":["movies"]}}"#)
        XCTAssertFalse(InventoryCatalog.visible(session: denied, config: config))
        XCTAssertFalse(InventoryCatalog.visible(session: session, config: .object([:])))
        let disabled = try row(#"{"subscription":{"features":{"inventory":true}},"enabledLibraries":{"inventory":false}}"#)
        XCTAssertFalse(InventoryCatalog.visible(session: session, config: disabled))
    }
    func testWizardPayloadKeepsSelectedCardPrintingAndPhysicalCopyFieldsWithoutAutomaticSave() throws {
        var draft = NativeInventoryDraft()
        draft.applyCard(try row(#"{"cardId":"1234","cardName":"Example card","setCode":"SET-EN001","rarity":"Rare","marketValue":4.5,"printingPrice":4.5,"priceSource":"YGOPRODeck","image":"https://example.test/card.jpg","artworkVariants":[{"id":"art","image":"https://example.test/card.jpg"}]}"#))
        draft.quantity = 2; draft.edition = "1st Edition"; draft.language = "English"; draft.location = "Shelf"
        let id = UUID(); let body = try object(draft.createBody(requestID: id, photos: []))
        XCTAssertEqual(body["requestId"] as? String, id.uuidString)
        XCTAssertEqual(body["category"] as? String, "trading-cards")
        XCTAssertEqual(body["quantity"] as? Int, 2)
        let tcg = try XCTUnwrap(body["tcg"] as? [String: Any])
        XCTAssertEqual(tcg["providerCardId"] as? String, "1234")
        XCTAssertEqual(tcg["setCode"] as? String, "SET-EN001")
        XCTAssertEqual(tcg["edition"] as? String, "1st Edition")
        XCTAssertEqual(tcg["printingPrice"] as? Double, 4.5)
        XCTAssertEqual(body["code"] as? String, "", "card passcodes must not become product barcodes")
    }
    func testProductLookupPopulatesEditableFieldsAndLeavesInventoryCategoryUnderUserControl() throws {
        var draft = NativeInventoryDraft(); draft.category = "electronics"
        draft.applyProduct(try row(#"{"libraryId":"books","metadata":{"title":"Found product","brand":"Example","thumbnail":"https://example.test/art.jpg"}}"#))
        XCTAssertEqual(draft.title, "Found product"); XCTAssertEqual(draft.brand, "Example")
        XCTAssertEqual(draft.category, "electronics")
        draft.title = "My edited title"
        XCTAssertEqual(try object(draft.createBody(requestID: UUID(), photos: []))["title"] as? String, "My edited title")
    }
    func testGenericEditsAndPrintingEditsRemainDistinctAndDoNotSendUnrelatedCardState() throws {
        let record = InventoryRecord(row: try row(#"{"id":"card","title":"Card","category":"trading-cards","notes":"Notes","tcg":{"quantity":7,"printings":[{"id":"one","quantity":3},{"id":"two","quantity":4}]}}"#))
        var draft = NativeInventoryDraft.editing(record)
        draft.notes = "Edited notes"
        let item = try object(draft.editBody(printing: false))
        XCTAssertNil(item["quantity"]); XCTAssertNil(item["condition"]); XCTAssertNil(item["tcg"])
        let printing = try row(#"{"id":"one","setCode":"SET-EN001","quantity":3,"edition":"1st Edition","condition":"Near Mint","language":"English"}"#)
        draft = .editing(record, printing: printing); draft.quantity = 5
        let physical = try object(draft.editBody(printing: true))
        XCTAssertEqual(physical["quantity"] as? Int, 5); XCTAssertEqual(physical["edition"] as? String, "1st Edition")
        XCTAssertNil(physical["title"]); XCTAssertNil(physical["printings"])
    }
    func testInvalidPriceOrQuantityDoesNotProduceSavePayload() throws {
        var draft = NativeInventoryDraft(); draft.title = "Item"
        for price in ["-1", "NaN", "Infinity", "oops"] {
            draft.purchasePrice = price
            XCTAssertThrowsError(try draft.createBody(requestID: UUID(), photos: []))
        }
        draft.purchasePrice = "1,25"
        XCTAssertEqual(try object(draft.createBody(requestID: UUID(), photos: []))["purchasePrice"] as? Double, 1.25)
        draft.quantity = 0
        XCTAssertThrowsError(try draft.createBody(requestID: UUID(), photos: []))
    }
    func testPhotoRolesAndBinderDeckLinksUseTheSharedInventoryPayload() throws {
        var draft = NativeInventoryDraft(); draft.title = "Item"
        let photo = InventoryPhoto(id: UUID(), name: "receipt-1.jpg", data: Data([0xff, 0xd8, 0xff]))
        let body = try object(draft.createBody(requestID: UUID(), photos: [photo]))
        let photos = try XCTUnwrap(body["captures"] as? [[String: Any]])
        XCTAssertEqual(photos.first?["name"] as? String, "receipt-1.jpg")
        XCTAssertEqual(photos.first?["id"] as? String, photo.id.uuidString)
        let record = InventoryRecord(row: try row(#"{"id":"card","category":"trading-cards","tcg":{"printings":[{"binderId":"binder"}]}}"#))
        let binder = try row(#"{"id":"binder"}"#)
        XCTAssertEqual(InventoryCatalog.organizationRecords(binder, records: [record], binder: true).map(\.id), ["card"])
        let deck = try row(#"{"id":"deck","cards":[{"inventoryRecordId":"card"}]}"#)
        XCTAssertEqual(InventoryCatalog.organizationRecords(deck, records: [record], binder: false).map(\.id), ["card"])
    }
}
