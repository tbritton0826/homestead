import XCTest
@testable import HomesteadModels

final class ProfileUploadTests: XCTestCase {
    func testMultipartPreservesBinaryAndProfileIdentity() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let bytes = Data([0, 255, 1, 13, 10, 128])
        try bytes.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let target = ProfileUploadTarget(id: "profile-42", name: "Example Profile", library: "personal")
        let payload = try ProfileMultipart.build(file: file, name: "photo\"\r\n.jpg", mime: "image/jpeg", target: target, type: "photo", boundary: "test-boundary")
        defer { try? FileManager.default.removeItem(at: payload) }
        let data = try Data(contentsOf: payload)
        XCTAssertNotNil(data.range(of: bytes))
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("name=\"profileId\"\r\n\r\nprofile-42"))
        XCTAssertTrue(text.contains("name=\"targetLibrary\"\r\n\r\npersonal"))
        XCTAssertFalse(text.contains("name=\"destinationFolder\""), "Default uploads retain the legacy contract")
        XCTAssertTrue(text.contains("filename=\"photo___.jpg\""))
        XCTAssertTrue(text.hasSuffix("\r\n--test-boundary--\r\n"))
    }
    func testGirlsAliasKeepsExistingProfileUploadTarget() throws {
        let index = try JSONDecoder().decode(IndexValue.self, from: Data(#"{"girls":{"stored-key":{"id":"real-profile-id","name":"Example"}}}"#.utf8))
        let target = AdultAccess.records(index: index, section: .personal).first?.uploadTarget
        XCTAssertEqual(target?.id, "real-profile-id")
        XCTAssertEqual(target?.library, "personal")
        XCTAssertEqual(target?.name, "Example")
    }
}
