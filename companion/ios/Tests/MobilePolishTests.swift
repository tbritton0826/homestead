import XCTest
@testable import HomesteadModels

final class MobilePolishTests: XCTestCase {
    private func row(_ text: String) throws -> IndexValue { try JSONDecoder().decode(IndexValue.self, from: Data(text.utf8)) }
    func testPortraitAndLandscapeImagesRemainWithinRotatingViewport() {
        for viewport in [CGSize(width: 390, height: 760), CGSize(width: 760, height: 340), CGSize(width: 1024, height: 700)] {
            for image in [CGSize(width: 2000, height: 3000), CGSize(width: 3000, height: 2000), CGSize(width: 1000, height: 1000)] {
                let fit = PhotoViewportGeometry.fittedSize(image: image, viewport: viewport)
                XCTAssertLessThanOrEqual(fit.width, viewport.width + 0.001)
                XCTAssertLessThanOrEqual(fit.height, viewport.height + 0.001)
                XCTAssertEqual(fit.width / fit.height, image.width / image.height, accuracy: 0.001)
                let padding = PhotoViewportGeometry.centering(content: fit, viewport: viewport)
                XCTAssertEqual(fit.width + 2 * padding.width, viewport.width, accuracy: 0.001)
                XCTAssertEqual(fit.height + 2 * padding.height, viewport.height, accuracy: 0.001)
            }
        }
        XCTAssertEqual(PhotoViewportGeometry.fittedSize(image: .zero, viewport: CGSize(width: 390, height: 700)), .zero)
        XCTAssertEqual(PhotoViewportGeometry.centering(content: CGSize(width: 900, height: 900), viewport: CGSize(width: 390, height: 700)), .zero)
    }
    func testProfilePillsUseAliasesBodySchemaIconsAndAvailableValues() throws {
        let profile = try row(#"{"metadata":{"biography":"Example bio","birthday":"1989-04-03","pantySize":"XS/S","everydayCut":"Thong","seamless":true,"periodCut":"Cheeky","bodyDetails":{"braSize":"34B","measurements":"34-24-35","height":{"value":170,"unit":"cm"}}}}"#)
        let pills = ProfilePresentation.metadata(profile, allowIntimate: true)
        XCTAssertEqual(Array(pills.map(\.label).prefix(4)), ["Bio", "Panty size", "Bra size", "Measurements"])
        XCTAssertTrue(pills.allSatisfy { !$0.symbol.isEmpty && !$0.value.isEmpty })
        XCTAssertEqual(pills.first?.opensBiography, true)
        XCTAssertEqual(pills.first { $0.label == "Everyday cut" }?.value, "Thong / Seamless")
        XCTAssertEqual(pills.first { $0.label == "Period cut" }?.value, "Cheeky")
        XCTAssertEqual(pills.first { $0.label == "Height" }?.value, "170 cm")
        XCTAssertFalse(pills.contains { $0.label == "Occupation" })
    }
    func testIntimateMetadataIsOptInAndNeverAppearsForChildren() throws {
        for marker in [#""library":"children""#, #""role":"child""#, #""metadata":{"profileType":"adult","role":"child","braSize":"34B"}"#, #""metadata":{"birthday":"2015-04-03","braSize":"34B"}"#] {
            let profile = try row("{" + marker + ",\"braSize\":\"34B\",\"pantySize\":\"XS\"}")
            XCTAssertFalse(ProfilePresentation.metadata(profile, allowIntimate: true).contains { $0.intimate })
        }
        let profile = try row(#"{"metadata":{"braSize":"34B","pantySize":"XS","clothingSize":"S"}}"#)
        XCTAssertFalse(ProfilePresentation.metadata(profile).contains { $0.intimate })
        XCTAssertEqual(ProfilePresentation.metadata(profile).first?.value, "S")
        XCTAssertTrue(ProfilePresentation.metadata(profile, allowIntimate: true).contains { $0.label == "Bra size" })
    }
    func testRestrictedAccountCannotOptInToBodyPills() throws {
        let config = try row(#"{"enabledLibraries":{"adult":true},"subscription":{"features":{"adult":true}}}"#)
        let owner = try row(#"{"user":{"role":"owner"}}"#)
        let restricted = try row(#"{"user":{"role":"adult","adultAccessMode":"performers-celebrities"}}"#)
        XCTAssertTrue(AdultAccess.intimateMetadataAllowed(session: owner, config: config, section: .performers))
        XCTAssertFalse(AdultAccess.intimateMetadataAllowed(session: restricted, config: config, section: .performers))
        XCTAssertFalse(AdultAccess.intimateMetadataAllowed(session: try row(#"{"user":{"role":"child","fullAdultAccess":true}}"#), config: config, section: .personal))
    }
    func testRecipeEditingRoundTripsFieldsAndQuickStepTimers() throws {
        let recipe = try JSONDecoder().decode(Recipe.self, from: Data(#"{"id":"one","title":"Soup","entryType":"quick-instruction","description":"Family soup","categoryId":"dinner","category":"Dinner","ingredients":["Water","Salt"],"directions":["Boil"],"quickSteps":[{"text":"Boil","timerSeconds":75}],"image":"/api/recipes/artwork/recipe-one.png","favorite":true,"householdVisible":false,"sourceUrl":"https://example.com/soup","totalTime":"10 min","tags":["family"]}"#.utf8))
        var draft = NativeRecipeDraft.editing(recipe); draft.title = "Updated Soup"
        let values = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
        XCTAssertEqual(values["title"] as? String, "Updated Soup")
        XCTAssertEqual(values["categoryId"] as? String, "dinner")
        XCTAssertEqual(values["totalTime"] as? String, "10 min")
        XCTAssertEqual(values["tags"] as? [String], ["family"])
        XCTAssertEqual(values["favorite"] as? Bool, true)
        XCTAssertEqual(values["householdVisible"] as? Bool, false)
        XCTAssertEqual(values["imageUrl"] as? String, "", "Existing authenticated artwork must not be fetched as a new remote image")
        XCTAssertEqual((values["quickSteps"] as? [[String: Any]])?.first?["timerSeconds"] as? Double, 75)
    }
    func testRecipeEditPermissionsFailClosed() throws {
        let recipe = try JSONDecoder().decode(Recipe.self, from: Data(#"{"id":"one","title":"Soup"}"#.utf8))
        let config = try row(#"{"enabledLibraries":{"family":true},"subscription":{"features":{"recipes":true}}}"#)
        XCTAssertTrue(RecipeEditAccess.allowed(recipe: recipe, session: try row(#"{"ok":true,"user":{"role":"owner"}}"#), config: config))
        XCTAssertFalse(RecipeEditAccess.allowed(recipe: recipe, session: try row(#"{"ok":true,"user":{"role":"adult","allowedLibraries":["movies"]}}"#), config: config))
        XCTAssertFalse(RecipeEditAccess.allowed(recipe: recipe, session: try row(#"{"ok":true,"user":{"role":"owner","readOnly":true}}"#), config: config))
        let readOnly = try JSONDecoder().decode(Recipe.self, from: Data(#"{"id":"one","title":"Soup","readOnly":true}"#.utf8))
        XCTAssertFalse(RecipeEditAccess.allowed(recipe: readOnly, session: try row(#"{"ok":true,"user":{"role":"owner"}}"#), config: config))
    }
}
