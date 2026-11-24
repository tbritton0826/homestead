import XCTest
import Foundation
import CoreGraphics
import ImageIO
@testable import HomesteadModels

final class ConnectionReliabilityTests: XCTestCase {
    func testLoadingOverlayOnlyCoversInitialMediaScreensWithoutConnectionErrors() {
        let cases: [(tab: Int, busy: Bool, loaded: Bool, failed: Bool, visible: Bool)] = [
            (0, true, false, false, true),  // First Home load.
            (1, true, false, false, true),  // First Media load.
            (5, true, false, false, false), // Adult already has its independent data.
            (5, true, false, true, false),  // Reported timeout + unrelated loading card.
            (2, true, false, false, false), // Family loads independently.
            (4, true, false, false, false), // More loads independently.
            (1, true, true, false, false),  // Refresh with usable data.
            (1, true, false, true, false),  // Connection error replaces initial spinner.
            (1, false, false, false, false),// Failed/finished load.
            (0, false, true, false, false)
        ]
        for item in cases {
            XCTAssertEqual(MediaLoadingPresentation.showsOverlay(tab: item.tab, busy: item.busy,
                loaded: item.loaded, connectionFailed: item.failed), item.visible)
        }
    }
    func testReadRetriesNeverReplayWritesOrAuthenticationFailures() {
        for code in [URLError.Code.timedOut, .networkConnectionLost, .cannotConnectToHost] {
            for method in ["GET", "HEAD"] {
                XCTAssertTrue(ReadRetryPolicy.allows(method: method, error: URLError(code), attempt: 0))
                XCTAssertFalse(ReadRetryPolicy.allows(method: method, error: URLError(code), attempt: 1))
            }
            for method in ["POST", "PATCH", "PUT", "DELETE"] {
                XCTAssertFalse(ReadRetryPolicy.allows(method: method, error: URLError(code), attempt: 0))
            }
        }
        let failures: [Error] = [URLError(.cancelled), URLError(.notConnectedToInternet),
                                 CompanionError.unauthorized, CancellationError()]
        for failure in failures {
            XCTAssertFalse(ReadRetryPolicy.allows(method: "GET", error: failure, attempt: 0))
        }
    }

    func testSessionCookieRoundTripExpiresAndStaysOnItsOriginalServer() throws {
        let server = try XCTUnwrap(URL(string: "https://home.example:7312"))
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let cookie = try makeCookie(expires: now.addingTimeInterval(3600))
        let record = try XCTUnwrap(SavedSessionCookie(cookie: cookie, server: server, now: now))
        let decoded = try JSONDecoder().decode(SavedSessionCookie.self, from: JSONEncoder().encode(record))
        let restored = try XCTUnwrap(decoded.cookie(server: server, now: now))
        XCTAssertEqual(restored.name, "homestead_session")
        XCTAssertEqual(restored.value, "generated-test-token")
        XCTAssertEqual(restored.path, "/")
        XCTAssertTrue(restored.isSecure)
        XCTAssertNil(decoded.cookie(server: server, now: now.addingTimeInterval(3601)))
        for other in ["https://other.example:7312", "https://home.example:7313", "http://home.example:7312"] {
            XCTAssertNil(decoded.cookie(server: try XCTUnwrap(URL(string: other)), now: now))
        }
    }

    func testCookieImportRejectsUnrelatedNamesDomainsPathsAndExpiredTokens() throws {
        let server = try XCTUnwrap(URL(string: "https://home.example:7312"))
        let now = Date()
        let rejected = [
            try makeCookie(name: "third_party"), try makeCookie(domain: "other.example"),
            try makeCookie(domain: "example"), try makeCookie(path: "/admin"),
            try makeCookie(expires: now.addingTimeInterval(-10)),
            try makeCookie(value: String(repeating: "x", count: 4097))
        ]
        for cookie in rejected { XCTAssertNil(SavedSessionCookie(cookie: cookie, server: server, now: now)) }
        let insecure = try XCTUnwrap(URL(string: "http://home.example:7312"))
        XCTAssertNil(SavedSessionCookie(cookie: try makeCookie(), server: insecure))
        XCTAssertNotNil(SavedSessionCookie(cookie: try makeCookie(secure: false), server: insecure))
        XCTAssertNotNil(SavedSessionCookie(cookie: try makeCookie(name: "homestead_client_id"), server: server))
    }

    private func makeCookie(name: String = "homestead_session", domain: String = "home.example",
                            path: String = "/", value: String = "generated-test-token",
                            expires: Date? = nil, secure: Bool = true) throws -> HTTPCookie {
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .domain: domain, .path: path, .value: value]
        if secure { properties[.secure] = "TRUE" }
        if let expires { properties[.expires] = expires }
        return try XCTUnwrap(HTTPCookie(properties: properties))
    }
}

private actor TransferProbe {
    private var calls = 0
    private var active = 0
    private var peak = 0
    func transfer(delay: Duration = .milliseconds(80), value: UInt8 = 7) async throws -> Data {
        calls += 1; active += 1; peak = max(peak, active)
        defer { active -= 1 }
        try await Task.sleep(for: delay)
        return Data(repeating: value, count: 4)
    }
    func stats() -> (calls: Int, active: Int, peak: Int) { (calls, active, peak) }
}

final class ImageRequestPoolTests: XCTestCase {
    func testBatchLimitsConcurrentTransfers() async throws {
        let pool = ImageRequestPool(maximumConcurrent: 3)
        let probe = TransferProbe()
        try await withThrowingTaskGroup(of: Data.self) { group in
            for index in 0..<18 {
                group.addTask { try await pool.load("photo-\(index)") { try await probe.transfer() } }
            }
            for try await data in group { XCTAssertEqual(data.count, 4) }
        }
        let stats = await probe.stats()
        XCTAssertEqual(stats.calls, 18)
        XCTAssertLessThanOrEqual(stats.peak, 3)
        XCTAssertEqual(stats.active, 0)
    }

    func testSamePhotoRequestsShareOneTransferAndCacheResult() async throws {
        let pool = ImageRequestPool()
        let probe = TransferProbe()
        try await withThrowingTaskGroup(of: Data.self) { group in
            for _ in 0..<12 {
                group.addTask { try await pool.load("shared") { try await probe.transfer() } }
            }
            for try await data in group { XCTAssertEqual(data, Data(repeating: 7, count: 4)) }
        }
        let cached = try await pool.load("shared") { XCTFail("Cached photo downloaded again"); return Data() }
        let stats = await probe.stats()
        XCTAssertEqual(cached.count, 4)
        XCTAssertEqual(stats.calls, 1)
    }

    func testByteBudgetEvictsLeastRecentlyUsedPhoto() async throws {
        let pool = ImageRequestPool(maximumBytes: 8)
        let probe = TransferProbe()
        for key in ["a", "b", "a", "c", "a", "b"] {
            _ = try await pool.load(key) { try await probe.transfer(delay: .milliseconds(1)) }
        }
        let stats = await probe.stats()
        XCTAssertEqual(stats.calls, 4, "Accessing a must keep it while b is evicted by c")
    }

    func testOversizedResponseDoesNotEnterMemoryCache() async throws {
        let pool = ImageRequestPool(maximumBytes: 3)
        let probe = TransferProbe()
        for _ in 0..<2 { _ = try await pool.load("large") { try await probe.transfer(delay: .milliseconds(1)) } }
        let stats = await probe.stats()
        XCTAssertEqual(stats.calls, 2)
    }

    func testCancellingQueuedPhotoDoesNotConsumeASlot() async throws {
        let pool = ImageRequestPool(maximumConcurrent: 1)
        let probe = TransferProbe()
        let first = Task { try await pool.load("first") { try await probe.transfer(delay: .milliseconds(300)) } }
        try await waitForActive(probe)
        let cancelled = Task { try await pool.load("cancelled") { XCTFail("Cancelled queued photo started"); return Data() } }
        // Give the second caller a chance to enqueue behind the active transfer.
        try await Task.sleep(for: .milliseconds(40))
        cancelled.cancel()
        _ = try await first.value
        do { _ = try await cancelled.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("\(error)") }
        _ = try await pool.load("after") { try await probe.transfer(delay: .milliseconds(1)) }
        let stats = await probe.stats()
        XCTAssertEqual(stats.calls, 2)
        XCTAssertEqual(stats.peak, 1)
    }

    func testOneCancelledConsumerDoesNotCancelAnotherConsumersPhoto() async throws {
        let pool = ImageRequestPool()
        let probe = TransferProbe()
        let first = Task { try await pool.load("same") { try await probe.transfer(delay: .milliseconds(300)) } }
        try await waitForActive(probe)
        let second = Task { try await pool.load("same") { XCTFail("Shared transfer duplicated"); return Data() } }
        try await Task.sleep(for: .milliseconds(40))
        first.cancel()
        let data = try await second.value
        do { _ = try await first.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("\(error)") }
        let stats = await probe.stats()
        XCTAssertEqual(data.count, 4)
        XCTAssertEqual(stats.calls, 1)
    }

    func testSessionClearCancelsOldTransfersAndDiscardsTheirCachedData() async throws {
        let pool = ImageRequestPool(maximumConcurrent: 1)
        let probe = TransferProbe()
        _ = try await pool.load("cached") { try await probe.transfer(delay: .milliseconds(1), value: 1) }
        let old = Task { try await pool.load("old") { try await probe.transfer(delay: .seconds(10)) } }
        try await waitForActive(probe)
        let queued = Task { try await pool.load("queued") { XCTFail("Previous session queue started"); return Data() } }
        try await Task.sleep(for: .milliseconds(40))
        await pool.clear()
        for task in [old, queued] {
            do { _ = try await task.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("\(error)") }
        }
        let fresh = try await pool.load("cached") { try await probe.transfer(delay: .milliseconds(1), value: 2) }
        XCTAssertEqual(fresh, Data(repeating: 2, count: 4))
    }

    func testFailedPhotoCanBeRetriedWithoutCachingItsFailure() async throws {
        let pool = ImageRequestPool()
        do { _ = try await pool.load("retry") { throw URLError(.timedOut) }; XCTFail("Expected timeout") }
        catch { XCTAssertEqual((error as? URLError)?.code, .timedOut) }
        let data = try await pool.load("retry") { Data([9]) }
        XCTAssertEqual(data, Data([9]))
    }

    private func waitForActive(_ probe: TransferProbe) async throws {
        for _ in 0..<100 {
            let stats = await probe.stats()
            if stats.active > 0 { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Transfer did not start within one second")
        throw URLError(.timedOut)
    }
}

final class NativePhotoReliabilityTests: XCTestCase {
    private let server = URL(string: "http://10.0.0.224:7312")!

    func testHEICAndHEIFUseAuthorizedRawEndpointWithoutServerConversion() throws {
        for path in ["/media/profile/Photos/Portrait.HEIC", "/mnt/profile/a & b.heif",
                     "/api/file?path=%2Fmnt%2Fprofile%2Fportrait.heic&width=100&quality=80"] {
            let url = try XCTUnwrap(ArtworkAddress.nativeImageURL(path: path, server: server, preview: true))
            let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
            XCTAssertEqual(parts.host, server.host)
            XCTAssertEqual(parts.path, "/api/file")
            XCTAssertEqual(parts.queryItems?.first(where: { $0.name == "raw" })?.value, "1")
            XCTAssertNil(parts.queryItems?.first(where: { $0.name == "width" }))
            XCTAssertNil(parts.queryItems?.first(where: { $0.name == "quality" }))
        }
        let encoded = try XCTUnwrap(ArtworkAddress.nativeImageURL(path: "/media/profile/a%20%26%20b.heic", server: server, preview: true))
        let query = try XCTUnwrap(URLComponents(url: encoded, resolvingAgainstBaseURL: false)).queryItems
        XCTAssertEqual(query?.first(where: { $0.name == "path" })?.value, "/media/profile/a & b.heic")
    }

    func testJPEGRouteAndRemoteProviderIsolationRemainUnchanged() {
        let path = "/media/profile/photo.jpg"
        XCTAssertEqual(ArtworkAddress.nativeImageURL(path: path, server: server, preview: true),
                       ArtworkAddress.url(path: path, server: server, preview: true))
        let provider = ArtworkAddress.nativeImageURL(path: "https://art.example/photo.heic", server: server, preview: true)
        XCTAssertEqual(provider?.host, server.host)
        XCTAssertEqual(provider?.path, "/api/artwork/cache")
        XCTAssertNil(ArtworkAddress.nativeImageURL(path: "file:///private/photo.heic", server: server, preview: true))
        XCTAssertNil(ArtworkAddress.nativeImageURL(path: "/media/../private/photo.heic", server: server, preview: true))
    }

    func testHEIFRemainsPresentInProfileFileLists() throws {
        let data = Data(#"{"files":[{"path":"/media/profile/photo.heif"},{"path":"/media/profile/photo.heic"}]}"#.utf8)
        let root = try JSONDecoder().decode(IndexValue.self, from: data)
        XCTAssertEqual(ProfileMediaFile.files(root).map(\.fileExtension), ["heif", "heic"])
    }

    func testGeneratedPNGAndJPEGDecodeWithOrientationAndBoundedDimensions() throws {
        try checkGeneratedImage(type: "public.png", rotated: false)
        try checkGeneratedImage(type: "public.jpeg")
        XCTAssertNil(NativeImageDecoder.thumbnail(Data("not an image".utf8), maximumPixelSize: 100))
    }

    func testGeneratedHEICDecodesNativelyWithOrientation() throws {
        let supported = CGImageDestinationCopyTypeIdentifiers() as! [String]
        guard supported.contains("public.heic") else { throw XCTSkip("HEIC encoder unavailable on this Mac; verify on iPhone") }
        try checkGeneratedImage(type: "public.heic")
    }

    private func checkGeneratedImage(type: String, rotated: Bool = true) throws {
        let space = CGColorSpaceCreateDeviceRGB()
        let context = try XCTUnwrap(CGContext(data: nil, width: 400, height: 200, bitsPerComponent: 8,
                                             bytesPerRow: 1600, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 400, height: 200))
        let image = try XCTUnwrap(context.makeImage())
        let encoded = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(encoded as CFMutableData, type as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: rotated ? 6 : 1] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let preview = try XCTUnwrap(NativeImageDecoder.thumbnail(encoded as Data, maximumPixelSize: 100))
        XCTAssertLessThanOrEqual(max(preview.width, preview.height), 100)
        if rotated { XCTAssertGreaterThan(preview.height, preview.width, "Orientation must be applied before display") }
        else { XCTAssertGreaterThan(preview.width, preview.height) }
    }
}
