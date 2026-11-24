import XCTest
@testable import HomesteadModels

final class PluginNavigationTests: XCTestCase {
    func testPluginLandingPageAndRoutesStayWithinPlugin() throws {
        let server = try XCTUnwrap(URL(string: "http://server.test:7312"))
        for path in ["/plugins/panty-archive", "/plugins/panty-archive/", "/plugins/panty-archive/?tab=items", "/plugins/panty-archive/items/12"] {
            let url = try XCTUnwrap(URL(string: path, relativeTo: server)?.absoluteURL)
            XCTAssertTrue(PluginNavigationPolicy.allows(url, server: server, pluginID: "panty-archive"), path)
        }
        for path in ["/", "/plugins/panty-archive-other/", "/plugins/other/", "/plugins/panty-archive/../other/", "/plugins/panty-archive/%2e%2e/other/", "https://server.test:7312/plugins/panty-archive/", "http://elsewhere.test:7312/plugins/panty-archive/"] {
            let url = try XCTUnwrap(URL(string: path, relativeTo: server)?.absoluteURL)
            XCTAssertFalse(PluginNavigationPolicy.allows(url, server: server, pluginID: "panty-archive"), path)
        }
    }
    func testCatalogueRespectsLockAndRejectsDisabledOrExternalClients() throws {
        let json = #"{"plugins":[{"id":"panty-archive","name":"Panty Archive","valid":true,"enabled":true,"type":"full","clientUrl":"/plugins/panty-archive/","hostIntegration":{"sections":[{"id":"archive","label":"Archive"}],"addActions":[{"id":"add-item","label":"Add item","sections":["archive"]}]}},{"id":"disabled","valid":true,"enabled":false,"clientUrl":"/plugins/disabled/"},{"id":"external","valid":true,"enabled":true,"clientUrl":"https://external.test/"},{"id":"../escape","valid":true,"enabled":true,"clientUrl":"/plugins/../escape/"}]}"#
        let response = try JSONDecoder().decode(IndexValue.self, from: Data(json.utf8))
        XCTAssertTrue(PluginLibrary.catalogue(response, hidden: true).isEmpty)
        let plugins = PluginLibrary.catalogue(response, hidden: false)
        XCTAssertEqual(plugins.map(\.id), ["panty-archive"])
        XCTAssertEqual(plugins.first?.actions.first?.id, "add-item")
        XCTAssertEqual(plugins.first?.actions.first?.sections, ["archive"])
        XCTAssertEqual(plugins.first?.sections.first?.title, "Archive")
    }
}
