import XCTest
@testable import HomesteadModels

final class AdultAccessTests: XCTestCase {
    private func value(_ text: String) throws -> IndexValue {
        try JSONDecoder().decode(IndexValue.self, from: Data(text.utf8))
    }
    func testOwnerAndDisabledLibrary() throws {
        let session = try value(#"{"user":{"role":"owner"}}"#)
        let enabled = try value(#"{"enabledLibraries":{"adult":true},"subscription":{"features":{"adult":true}}}"#)
        XCTAssertEqual(AdultAccess.sections(session: session, config: enabled).count, 5)
        let disabled = try value(#"{"enabledLibraries":{"adult":false}}"#)
        XCTAssertTrue(AdultAccess.sections(session: session, config: disabled).isEmpty)
    }
    func testChildCannotInheritAdultFlags() throws {
        let session = try value(#"{"user":{"role":"child","fullAdultAccess":true,"adultAccessMode":"full"}}"#)
        let config = try value(#"{"enabledLibraries":{"adult":true},"subscription":{"features":{"adult":true}}}"#)
        XCTAssertTrue(AdultAccess.sections(session: session, config: config).isEmpty)
    }
    func testCustomAndLinkedAccess() throws {
        let config = try value(#"{"enabledLibraries":{"adult":true},"subscription":{"features":{"adult":true}}}"#)
        let custom = try value(#"{"user":{"role":"member","adultAccessMode":"custom","adultSublibraryAccess":{"performers":true}}}"#)
        XCTAssertEqual(AdultAccess.sections(session: custom, config: config), [.performers])
        let linked = try value(#"{"user":{"role":"member","linkedAdultProfileId":"one"}}"#)
        XCTAssertEqual(AdultAccess.sections(session: linked, config: config), [.personal])
    }
    func testLegacyPersonalAliasAndNoCrossLibraryRows() throws {
        let index = try value(#"{"libraries":{"girls":{"one":{"name":"Profile"}},"performers":{"two":{"name":"Other"}}}}"#)
        let rows = AdultAccess.records(index: index, section: .personal)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.title, "Profile")
    }
}
