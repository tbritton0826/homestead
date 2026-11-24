import XCTest
@testable import HomesteadModels

final class NativeAddTests: XCTestCase {
    func testQuickInstructionUsesServerSchema() throws {
        let draft = NativeRecipeDraft(title: "Oven", directions: "Preheat\n\nBake", quick: true)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.body()) as? [String: Any])
        XCTAssertEqual(body["entryType"] as? String, "quick-instruction")
        let steps = try XCTUnwrap(body["quickSteps"] as? [[String: Any]])
        XCTAssertEqual(steps.count, 2)
        XCTAssertEqual(steps.first?["text"] as? String, "Preheat")
    }
    func testRecipePreviewPopulatesReviewWithoutLosingCategory() throws {
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"title":"Soup","ingredients":["Water","Salt"],"directions":["Boil"]}"#.utf8))
        var draft = NativeRecipeDraft(categoryID: "category-one")
        draft.importPreview(row)
        XCTAssertEqual(draft.title, "Soup")
        XCTAssertEqual(draft.ingredients, "Water\nSalt")
        XCTAssertEqual(draft.categoryID, "category-one")
    }
    func testSavedRequestsExcludeDisallowedLibraries() throws {
        let data = Data(#"{"movies":[{"title":"Movie"}],"tv":[{"title":"Series"}],"books":[{"title":"Book"}]}"#.utf8)
        let row = try JSONDecoder().decode(IndexValue.self, from: data)
        let snapshot = RequestSnapshot.rows(row, allowed: ["tvshows"])
        XCTAssertEqual(snapshot.count, 1)
        XCTAssertEqual(snapshot.first?["library"]?.text, "tv")
    }
    func testJobsAreScopedToAccountAndPermissions() throws {
        let data = Data(#"{"jobs":[{"library":"books","requestedByUserId":"alice"},{"library":"books","requestedByUserId":"bob"},{"library":"books"},{"library":"music","requestedByUserId":"alice"}]}"#.utf8)
        let row = try JSONDecoder().decode(IndexValue.self, from: data)
        XCTAssertEqual(RequestSnapshot.jobs(row, userID: "alice", owner: false, allowed: ["books"]).count, 1)
        XCTAssertEqual(RequestSnapshot.jobs(row, userID: "owner", owner: true, allowed: ["books"]).count, 1)
    }
}
