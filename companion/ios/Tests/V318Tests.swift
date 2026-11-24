import XCTest
import Foundation
@testable import HomesteadModels

final class V318Tests: XCTestCase {
    func testFailedProbeRequiresNoNewerSuccessfulServerResponse() {
        let started = Date(timeIntervalSince1970: 200)
        XCTAssertTrue(ConnectionRecovery.shouldShowWarning(lastResponse: started.addingTimeInterval(-1), checkStarted: started))
        XCTAssertFalse(ConnectionRecovery.shouldShowWarning(lastResponse: started, checkStarted: started))
        XCTAssertFalse(ConnectionRecovery.shouldShowWarning(lastResponse: started.addingTimeInterval(1), checkStarted: started))
    }
    func testHTTPAddressPolicyUsesExactTailnetAndPrivateBoundaries() {
        for host in ["100.64.0.0", "100.88.187.82", "100.127.255.255", "10.0.0.224", "192.168.2.1", "172.16.0.1", "172.31.255.255", "127.0.0.1", "homestead.local", "homestead"] {
            XCTAssertTrue(ServerAddressPolicy.allowsHTTP(host: host), host)
        }
        for host in ["100.63.255.255", "100.128.0.0", "100.88.187.256", "100.88.bad.82", "100..88.82", "8.8.8.8", "172.32.0.1", "172.15.255.255", "home.example.com", "homestead.tailnet.ts.net", "12345", "evil:7312"] {
            XCTAssertFalse(ServerAddressPolicy.allowsHTTP(host: host), host)
        }
    }
    func testCompactValuesPreserveAccessibleOriginalsWithoutGuessingSizes() {
        let examples = [("Panty size", "S / US 5", "S"), ("Bra size", "32B", "32B"), ("Age", "25", "25"), ("Panty size", "XXS", "XXS"), ("Bra size", "32B / 70B", "32B")]
        for (label, full, expected) in examples {
            let item = ProfileMetadataItem(label: label, value: full)
            XCTAssertEqual(PosterMetadataValue.short(item), expected)
            XCTAssertEqual(item.value, full)
        }
    }
    func testLightweightConnectionContractUsesStableIdentityAndNoAccountDetails() throws {
        let response = try JSONDecoder().decode(SessionResponse.self, from: Data(#"{"ok":true,"authEnabled":true,"user":{"id":"owner-fixture"}}"#.utf8))
        XCTAssertEqual(response.user?.id, "owner-fixture")
        XCTAssertTrue(response.authEnabled)
    }
    func testSharedFolderDecodeKeepsSingleOriginalAndUnresolvedNames() throws {
        let data = Data(#"{"ok":true,"groups":[{"id":"group","name":"Bella + Cookie","petIds":["bella","cookie"],"unresolved":[],"missingPetIds":[],"confirmed":true,"files":[{"path":"/pets/Shared Photos/Bella + Cookie/2026/one.jpg","name":"one.jpg"}]}]}"#.utf8)
        let response = try JSONDecoder().decode(PetPhotoGroupsResponse.self, from: data)
        XCTAssertEqual(response.groups[0].petIds, ["bella", "cookie"])
        XCTAssertEqual(response.groups[0].files.count, 1)
        XCTAssertEqual(response.groups[0].files[0].id, "/pets/Shared Photos/Bella + Cookie/2026/one.jpg")
    }
}
