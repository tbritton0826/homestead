import XCTest
@testable import HomesteadModels

final class V37Tests: XCTestCase {
    func testPetCreationIncludesOnlyPetFieldsAndStableRetryIdentity() throws {
        let id = UUID()
        let body = try PetCatalog.createBody(["name": " Milo ", "species": "Cat", "braSize": "not allowed", "folder": "not allowed"], requestID: id)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(fields["name"], "Milo")
        XCTAssertEqual(fields["species"], "Cat")
        XCTAssertEqual(fields["requestId"], id.uuidString)
        XCTAssertNil(fields["braSize"]); XCTAssertNil(fields["folder"])
        XCTAssertThrowsError(try PetCatalog.createBody(["name": "  "]))
    }
    func testPetAPIRecordsPreserveArtworkPhotosVideosAndDocuments() throws {
        let data = Data(#"{"ok":true,"records":[{"id":"milo","name":"Milo","folderPath":"/pets/milo","poster":"/pets/milo/poster.jpg","metadata":{"name":"Milo","species":"Cat","breed":"Tabby"},"files":[{"path":"/pets/milo/photos/a.heic"},{"path":"/pets/milo/videos/a.mov"},{"path":"/pets/milo/documents/health.pdf"}]}]}"#.utf8)
        let response = try JSONDecoder().decode(IndexValue.self, from: data)
        let pet = try XCTUnwrap(PetCatalog.records(response).first)
        XCTAssertEqual(pet.library, "pets"); XCTAssertEqual(pet.id, "milo")
        XCTAssertEqual(pet.title, "Milo"); XCTAssertEqual(pet.subtitle, "Tabby")
        XCTAssertEqual(pet.poster, "/pets/milo/poster.jpg")
        XCTAssertEqual(pet.files.count, 2); XCTAssertEqual(pet.documents.first?.fileExtension, "pdf")
    }
    func testPetFolderResponseDoesNotDependOnAdultFolderContract() throws {
        let response = try JSONDecoder().decode(PetCatalog.Folders.self, from: Data(#"{"ok":true,"folders":[{"name":"Summer","path":"Summer"}]}"#.utf8))
        XCTAssertTrue(response.ok); XCTAssertEqual(response.folders.first?.path, "Summer")
    }
}
