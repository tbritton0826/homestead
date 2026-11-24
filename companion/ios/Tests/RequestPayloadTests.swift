import XCTest
@testable import HomesteadModels

final class RequestPayloadTests: XCTestCase {
    private func target(_ json: String, source: String) throws -> MediaRequestTarget {
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        return try XCTUnwrap(MediaRequestTarget.make(row, source: source))
    }
    func testTVRequestCarriesSelectedSeasonsAndHistoryFlag() throws {
        let value = try target(#"{"mediaType":"tv","id":123}"#, source: "Seerr")
        let data = try value.body(title: "A show", seasons: [3, 1], bookFormat: "ebook")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(value.path, "api/integrations/seerr/request/tv")
        XCTAssertEqual(body["tmdbId"] as? Int, 123)
        XCTAssertEqual(body["seasons"] as? [Int], [1, 3])
        XCTAssertEqual(body["fromSearch"] as? Bool, true)
        XCTAssertThrowsError(try value.body(title: "A show", seasons: [], bookFormat: "ebook"))
    }
    func testBookKeepsProviderIdentityAndFormat() throws {
        let value = try target(#"{"type":"book","providerId":"book-id","foreignAuthorId":"author-id","raw":{"author":{"name":"Author"}}}"#, source: "Books & music discovery")
        let data = try value.body(title: "Book", seasons: [], bookFormat: "audiobook")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let item = try XCTUnwrap(body["item"] as? [String: Any])
        XCTAssertEqual(value.path, "api/acquisition/request")
        XCTAssertEqual(body["mediaType"] as? String, "audiobook")
        XCTAssertEqual(item["foreignAuthorId"] as? String, "author-id")
        XCTAssertNotNil(item["raw"])
    }
    func testPeopleInvalidIDsAndLocalResultsCannotSubmitRequests() throws {
        for json in [#"{"mediaType":"person","id":1}"#, #"{"mediaType":"movie","id":-1}"#, #"{"mediaType":"movie","id":"bad/path"}"#] {
            let row = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
            XCTAssertNil(MediaRequestTarget.make(row, source: "Seerr"))
        }
        let row = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"mediaType":"movie","id":1}"#.utf8))
        XCTAssertNil(MediaRequestTarget.make(row, source: "Movies"))
    }
}
