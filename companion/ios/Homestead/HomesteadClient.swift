import Foundation
import ImageIO
import OSLog

// Never forward a login request to a redirect destination.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private final class LimitedDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let limit: Int64
    private let lock = NSLock()
    private var tooLarge = false
    init(limit: Int) { self.limit = Int64(limit) }
    var exceededLimit: Bool { lock.lock(); defer { lock.unlock() }; return tooLarge }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > limit || totalBytesExpectedToWrite > limit {
            lock.lock(); tooLarge = true; lock.unlock(); downloadTask.cancel()
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

private struct ConnectionProbeUnavailable: Error {}

@MainActor
final class HomesteadClient {
    let baseURL: URL
    private var session: URLSession
    private let indexSession: URLSession
    private let imageSession: URLSession
    private var controlSession: URLSession
    private(set) var lastSuccessfulResponse = Date.distantPast
    private(set) var connectionCheckSummary = "Not checked yet"
    private(set) var connectionCheckHistory: [String] = []
    private static let diagnostics = Logger(subsystem: "Homestead", category: "Connection")
    private let imagePool = ImageRequestPool()
    private let cookieStore: SessionCookieStore
    var onUnauthorized: (() -> Void)?
    var onReadFailure: (() -> Void)?
    var onServerResponse: (() -> Void)?
    var requestSnapshot: [IndexValue] = []
    private(set) var isClosed = false
    private var cachedIndex: IndexValue?
    private var indexLoadedAt = Date.distantPast
    private var indexLoad: Task<IndexValue, Error>?
    private var indexGeneration = UUID()
    private var authGeneration = UUID()
    private var connectionProbeSupported = true

    static func serverURL(_ text: String) throws -> URL {
        guard var parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.port == nil || (1...65535).contains(parts.port!) else {
            throw CompanionError.message("Enter a server address such as http://10.0.0.224:7312 without a page path.")
        }
        guard scheme == "https" || ServerAddressPolicy.allowsHTTP(host: host) else {
            throw CompanionError.message("Use HTTPS for a remote server. HTTP supports local networks and Tailscale IPv4 addresses (100.64–100.127).")
        }
        parts.scheme = scheme
        parts.path = ""
        guard let url = parts.url else { throw CompanionError.message("Invalid server address.") }
        return url
    }

    init(baseURL: URL) {
        self.baseURL = baseURL
        cookieStore = SessionCookieStore()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 180
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = true
        configuration.httpMaximumConnectionsPerHost = 4
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        let library = URLSessionConfiguration.ephemeral
        library.httpCookieStorage = configuration.httpCookieStorage
        library.timeoutIntervalForRequest = 120
        library.timeoutIntervalForResource = 180
        library.httpMaximumConnectionsPerHost = 2
        library.urlCache = nil
        indexSession = URLSession(configuration: library, delegate: NoRedirects(), delegateQueue: nil)
        let images = URLSessionConfiguration.ephemeral
        images.httpCookieStorage = configuration.httpCookieStorage
        images.timeoutIntervalForRequest = 60
        images.timeoutIntervalForResource = 90
        images.httpMaximumConnectionsPerHost = 4
        images.urlCache = nil
        imageSession = URLSession(configuration: images, delegate: NoRedirects(), delegateQueue: nil)
        // Session checks must not queue behind index, document or media transfers.
        let control = URLSessionConfiguration.ephemeral
        control.httpCookieStorage = configuration.httpCookieStorage
        control.timeoutIntervalForRequest = 15
        control.timeoutIntervalForResource = 35
        control.httpMaximumConnectionsPerHost = 2
        control.urlCache = nil
        controlSession = URLSession(configuration: control, delegate: NoRedirects(), delegateQueue: nil)
        for cookie in cookieStore.load(server: baseURL) { configuration.httpCookieStorage?.setCookie(cookie) }
    }

    func close() {
        isClosed = true; invalidateIndex(); session.invalidateAndCancel(); indexSession.invalidateAndCancel(); imageSession.invalidateAndCancel(); controlSession.invalidateAndCancel()
        Task { await imagePool.clear() }
    }
    func rememberSession() { cookieStore.save(cookies: familySessionCookies, server: baseURL) }
    func invalidateLibraryIndex() { invalidateIndex() }
    func discardAccountData() async {
        authGeneration = UUID(); requestSnapshot = []; invalidateIndex()
        await imagePool.clear()
    }
    func forgetSession() {
        authGeneration = UUID()
        cookieStore.clear(server: baseURL)
        for cookie in familySessionCookies { session.configuration.httpCookieStorage?.deleteCookie(cookie) }
        requestSnapshot = []; invalidateIndex()
        Task { await imagePool.clear() }
    }

    private func invalidateIndex() {
        indexGeneration = UUID(); indexLoad?.cancel(); indexLoad = nil
        cachedIndex = nil; indexLoadedAt = .distantPast
    }

    func profileImage(_ path: String, preview: Bool = true) async throws -> Data {
        guard !isClosed, let url = ArtworkAddress.nativeImageURL(path: path, server: baseURL, preview: preview) else {
            throw CompanionError.message("Unsupported media address.")
        }
        let transport = imageSession
        let stamp = authGeneration
        // Retain native HEIC decoding on servers whose converters cannot read it.
        let isOriginalPhoto = ["heic", "heif"].contains(ProfileMediaFile(path: path, title: "", video: false).fileExtension)
        let limit = preview && !isOriginalPhoto ? 12_000_000 : 32 * 1024 * 1024
        let fallback = ArtworkAddress.url(path: path, server: baseURL, preview: preview)
        do {
            let data = try await imagePool.load(url.absoluteString) {
                var request = URLRequest(url: url); request.timeoutInterval = 60
                var result = try await Self.readDownload(session: transport, request: request, limit: limit)
                if (result.1 as? HTTPURLResponse)?.statusCode == 404, let fallback, fallback != url {
                    request.url = fallback
                    result = try await Self.readDownload(session: transport, request: request, limit: limit)
                }
                try Self.validateImage(result.0, response: result.1)
                // This runs only for a real fetch, never an image-pool cache hit.
                await MainActor.run {
                    if !self.isClosed, stamp == self.authGeneration { self.recordServerResponse() }
                }
                return result.0
            }
            guard stamp == authGeneration, !isClosed else { throw CancellationError() }
            return data
        } catch CompanionError.unauthorized {
            guard stamp == authGeneration, !isClosed else { throw CancellationError() }
            // A protected/missing image alone is not evidence that the account session ended.
            onReadFailure?(); throw CompanionError.unauthorized
        }
    }

    nonisolated private static func validateImage(_ data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw CompanionError.message("Invalid image response.") }
        if http.statusCode == 401 { throw CompanionError.unauthorized }
        guard (200...299).contains(http.statusCode) else { throw CompanionError.message("Image unavailable (HTTP \(http.statusCode)). Retry when the server is ready.") }
        guard CGImageSourceCreateWithData(data as CFData, nil) != nil else { throw CompanionError.message("The server did not return a decodable photo. Retry or check its image-preview support.") }
    }

    nonisolated private static func readDownload(session: URLSession, request: URLRequest, limit: Int) async throws -> (Data, URLResponse) {
        for attempt in 0...1 {
            let delegate = LimitedDownload(limit: limit)
            do {
                let (file, response) = try await session.download(for: request, delegate: delegate)
                defer { try? FileManager.default.removeItem(at: file) }
                try Task.checkCancellation()
                let data = try await Task.detached(priority: .utility) {
                    let bytes = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard bytes <= limit else { throw CompanionError.message("Download exceeds the preview size limit.") }
                    return try Data(contentsOf: file)
                }.value
                try Task.checkCancellation()
                return (data, response)
            } catch {
                if delegate.exceededLimit { throw CompanionError.message("Download exceeds the preview size limit.") }
                guard ReadRetryPolicy.allows(method: request.httpMethod ?? "GET", error: error, attempt: attempt) else { throw error }
                try await Task.sleep(for: .milliseconds(500))
            }
        }
        throw URLError(.timedOut)
    }

    var familySessionCookies: [HTTPCookie] {
        session.configuration.httpCookieStorage?.cookies(for: baseURL) ?? []
    }


    func profileBiography(_ path: String) async throws -> String {
        let stamp = authGeneration
        guard !isClosed, let url = ProfileMediaFile.url(path: path, server: baseURL, preview: false) else {
            throw CompanionError.message("This biography address is unavailable.")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("text/plain, text/markdown", forHTTPHeaderField: "Accept")
        let (data, response) = try await Self.readDownload(session: session, request: request, limit: 1024 * 1024)
        try Task.checkCancellation()
        guard !isClosed, stamp == authGeneration else { throw CancellationError() }
        try validate(response, data: data)
        let mime = response.mimeType?.lowercased()
        guard mime == nil || ["text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"].contains(mime ?? ""),
              let text = String(data: data, encoding: .utf8) else {
            throw CompanionError.message("The biography file did not contain readable text.")
        }
        return ProfilePresentation.biographyText(text)
    }

    func documentFile(_ file: ProfileMediaFile) async throws -> URL {
        let stamp = authGeneration
        guard !isClosed, let url = ProfileMediaFile.url(path: file.path, server: baseURL, preview: false) else {
            throw CompanionError.message("This document address is unavailable.")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 60
        let (data, response) = try await Self.readDownload(session: session, request: request, limit: 64 * 1024 * 1024)
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        try validate(response, data: Data())
        guard response.mimeType != "text/html", response.mimeType != "application/json" else {
            throw CompanionError.message("The server did not return a readable document. Check your connection and account access.")
        }
        try Task.checkCancellation()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("homestead-document-" + UUID().uuidString)
        let local = directory.appendingPathComponent("Document." + file.fileExtension)
        let write = Task.detached {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            do { try data.write(to: local, options: .atomic); return local }
            catch { try? FileManager.default.removeItem(at: directory); throw error }
        }
        let result = try await write.value
        if Task.isCancelled { try? FileManager.default.removeItem(at: directory); throw CancellationError() }
        return result
    }

    func petProfilesIfAvailable() async throws -> IndexValue? {
        let stamp = authGeneration
        let request = URLRequest(url: baseURL.appendingPathComponent("api/pets"))
        let (data, response) = try await Self.readDownload(session: session, request: request, limit: 32 * 1024 * 1024)
        try Task.checkCancellation()
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        if (response as? HTTPURLResponse)?.statusCode == 404 { return nil }
        try validate(response, data: data)
        return try JSONDecoder().decode(IndexValue.self, from: data)
    }

    func uploadPetMedia(file: URL, name: String, petID: String, kind: String, folder: String, requestID: UUID, petIDs: [String] = []) async throws {
        try ProfileFolderPath.validate(folder)
        try ProfileFolderPath.validate(petID)
        let stamp = authGeneration
        guard !isClosed, !petID.isEmpty, !petID.contains("/") else { throw CompanionError.message("Pet is unavailable.") }
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 64 * 1024 * 1024 else { throw CompanionError.message("Choose pet media up to 64 MB.") }
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/pets/" + petID + "/media"), resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "kind", value: kind), URLQueryItem(name: "folder", value: folder),
                            URLQueryItem(name: "name", value: name), URLQueryItem(name: "requestId", value: requestID.uuidString)]
        if !petIDs.isEmpty {
            let data = try JSONEncoder().encode(petIDs)
            parts?.queryItems?.append(URLQueryItem(name: "petIds", value: String(decoding: data, as: UTF8.self)))
        }
        guard let url = parts?.url else { throw CompanionError.message("Invalid pet destination.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.timeoutInterval = 120
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.upload(for: request, fromFile: file)
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        try validate(response, data: data)
        let receipt = try JSONDecoder().decode(IndexValue.self, from: data)
        guard receipt["ok"]?.flag == true, receipt["requestId"]?.text == requestID.uuidString,
              receipt["folder"]?.text == folder else { throw CompanionError.message("The server did not confirm this pet upload. Check the pet before retrying.") }
        invalidateIndex()
    }

    func uploadPhoto(file: URL, name: String, albumID: String, requestID: UUID) async throws {
        let stamp = authGeneration
        guard !isClosed, albumID.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else { throw CompanionError.message("Select a photo album.") }
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/photos/native/albums/" + albumID + "/media"), resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "requestId", value: requestID.uuidString), URLQueryItem(name: "name", value: name)]
        guard let url = parts?.url else { throw CompanionError.message("Invalid photo destination.") }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 120
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.upload(for: request, fromFile: file)
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        try validate(response, data: data)
        let receipt = try JSONDecoder().decode(IndexValue.self, from: data)
        guard receipt["ok"]?.flag == true, receipt["requestId"]?.text == requestID.uuidString,
              receipt["albumId"]?.text == albumID else { throw CompanionError.message("The server did not confirm this photo. Check the album before retrying.") }
        invalidateIndex()
    }

    func generatedImage(job: String, index: Int) async throws -> Data {
        guard AIContract.safeID(job) != nil, (0..<8).contains(index), !isClosed else { throw CompanionError.message("Image unavailable.") }
        let stamp = authGeneration
        let url = baseURL.appendingPathComponent("api/ai/comfy/jobs/" + job + "/images/" + String(index))
        let (data, response) = try await Self.readDownload(session: session, request: URLRequest(url: url), limit: 16 * 1024 * 1024)
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        try validate(response, data: data)
        try Self.validateImage(data, response: response)
        return data
    }

    func mediaIndex(force: Bool = false) async throws -> MediaIndex {
        async let metadata: IndexValue? = try? self.request("api/metadata/matches", timeout: 30)
        async let editionLinks: IndexValue? = try? self.request("api/books/edition-links", timeout: 20)
        let root = try await searchIndex(force: force)
        let (savedMetadata, savedLinks) = await (metadata, editionLinks)
        return try await Task.detached(priority: .userInitiated) {
            try MediaIndex(root: root, matches: savedMetadata?["matches"] ?? .object([:]), editionLinks: savedLinks?["links"] ?? .object([:]))
        }.value
    }

    func searchIndex(force: Bool = false) async throws -> IndexValue {
        guard !isClosed else { throw CompanionError.unauthorized }
        if !force, let cachedIndex, Date().timeIntervalSince(indexLoadedAt) < 60 { return cachedIndex }
        if let indexLoad {
            let token = indexGeneration
            let result = try await indexLoad.value
            guard token == indexGeneration, !isClosed else { throw CancellationError() }
            try Task.checkCancellation()
            return result
        }
        let token = indexGeneration
        let load = Task { () async throws -> IndexValue in
            var request = URLRequest(url: baseURL.appendingPathComponent("data/media-index.json"))
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.timeoutInterval = 120
            let (data, response) = try await Self.readDownload(session: indexSession, request: request, limit: 256 * 1024 * 1024)
            guard token == indexGeneration, !isClosed else { throw CancellationError() }
            try validate(response, data: data)
            recordServerResponse()
            return try await Task.detached(priority: .userInitiated) {
                try JSONDecoder().decode(IndexValue.self, from: data)
            }.value
        }
        indexLoad = load
        defer { if token == indexGeneration { indexLoad = nil } }
        let result = try await load.value
        guard token == indexGeneration, !isClosed else { throw CancellationError() }
        cachedIndex = result; indexLoadedAt = Date()
        try Task.checkCancellation()
        return result
    }

    func mediaArtwork(_ path: String) async throws -> Data {
        let stamp = authGeneration
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port,
              url.user == nil, url.password == nil,
              url.standardized.path.hasPrefix("/media/") else {
            throw CompanionError.message("No local poster available.")
        }
        let (data, response) = try await session.data(from: url)
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        try validate(response, data: data)
        guard response.mimeType?.hasPrefix("image/") == true, data.count <= 12_000_000 else {
            throw CompanionError.message("Poster is unavailable.")
        }
        return data
    }

    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, query: [URLQueryItem] = [], timeout: TimeInterval = 20) async throws -> T {
        guard !isClosed else { throw CancellationError() }
        let stamp = authGeneration
        var address = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if !query.isEmpty { address?.queryItems = query }
        guard let url = address?.url else { throw CompanionError.message("Invalid request address.") }
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        var payload: (Data, URLResponse)?
        let checkingConnection = ["api/auth/session", "api/auth/connection"].contains(path)
        let started = Date()
        for attempt in 0...1 {
            do { payload = try await (checkingConnection ? controlSession : session).data(for: request); break }
            catch {
                guard ReadRetryPolicy.allows(method: method, error: error, attempt: attempt) else {
                    let category = ConnectionRecovery.failureCategory(error)
                    Self.diagnostics.notice("Request failed: \(category, privacy: .public), seconds: \(Date().timeIntervalSince(started), privacy: .public)")
                    if stamp == authGeneration, !isClosed, !Task.isCancelled, method == "GET", !checkingConnection, ConnectionRecovery.isTransient(error) { onReadFailure?() }
                    throw error
                }
                if checkingConnection { renewControlTransport() }
                else if method == "GET" || method == "HEAD" { renewReadTransport() }
                try await Task.sleep(for: .milliseconds(500))
            }
        }
        try Task.checkCancellation()
        guard !isClosed, stamp == authGeneration, let (data, response) = payload else { throw CancellationError() }
        if checkingConnection { Self.diagnostics.debug("Session response: \((response as? HTTPURLResponse)?.statusCode ?? 0), seconds: \(Date().timeIntervalSince(started))") }
        if path == "api/auth/connection", (response as? HTTPURLResponse)?.statusCode == 404 { throw ConnectionProbeUnavailable() }
        try validate(response, data: data, login: path == "api/auth/login")
        if (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie") != nil { rememberSession() }
        do {
            let value = try JSONDecoder().decode(T.self, from: data)
            if !checkingConnection { recordServerResponse() }
            return value
        }
        catch { throw CompanionError.message("The server returned an unexpected response. Check that this is your Homestead address.") }
    }

    // Recreate only the small control pool after a transport failure. Cookies stay
    // in the same private jar; uploads and playback are never cancelled or replayed.
    private func renewControlTransport() {
        let config = controlSession.configuration
        let previous = controlSession
        controlSession = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
        previous.finishTasksAndInvalidate()
    }

    private func recordServerResponse() {
        lastSuccessfulResponse = Date()
        onServerResponse?()
    }

    private func renewReadTransport() {
        let previous = session
        session = URLSession(configuration: previous.configuration, delegate: NoRedirects(), delegateQueue: nil)
        previous.finishTasksAndInvalidate()
    }

    func networkPathChanged() {
        guard !isClosed else { return }
        // Drain existing transfers; never cancel/replay an upload or purchase.
        renewControlTransport()
        renewReadTransport()
    }

    func connectionSession() async throws -> SessionResponse {
        let started = Date()
        do {
            let response: SessionResponse
            do { response = try await request(connectionProbeSupported ? "api/auth/connection" : "api/auth/session", timeout: 12) }
            catch is ConnectionProbeUnavailable {
                connectionProbeSupported = false
                response = try await request("api/auth/session", timeout: 12)
            }
            connectionCheckSummary = "Connected · " + String(format: "%.1f s", Date().timeIntervalSince(started))
            recordConnectionCheck()
            return response
        } catch {
            connectionCheckSummary = ConnectionRecovery.failureCategory(error) + " · " + String(format: "%.1f s", Date().timeIntervalSince(started))
            recordConnectionCheck()
            throw error
        }
    }

    private func recordConnectionCheck() {
        connectionCheckHistory.append(Date().formatted(date: .omitted, time: .standard) + " · " + connectionCheckSummary)
        connectionCheckHistory = Array(connectionCheckHistory.suffix(30))
    }

    func signIn(username: String, password: String) async throws {
        forgetSession()
        await imagePool.clear()
        let body = try JSONEncoder().encode(["username": username, "password": password])
        let result: BasicResponse = try await request("api/auth/login", method: "POST", body: body)
        guard result.ok else { throw CompanionError.message("Sign-in failed.") }
        rememberSession()
        requestSnapshot = []
    }

    func uploadProfileMedia(file: URL, name: String, mime: String, target: ProfileUploadTarget, type: String, destinationFolder: String = "") async throws {
        guard !isClosed else { throw CompanionError.unauthorized }
        let stamp = authGeneration
        let boundary = "Homestead-" + UUID().uuidString
        let payload = try await Task.detached {
            try ProfileMultipart.build(file: file, name: name, mime: mime, target: target, type: type, boundary: boundary, destinationFolder: destinationFolder)
        }.value
        defer { try? FileManager.default.removeItem(at: payload) }
        try Task.checkCancellation()
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = session.configuration.httpCookieStorage
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 1800
        let uploader = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        defer { uploader.invalidateAndCancel() }
        let endpoint = destinationFolder.isEmpty ? "api/adult/import-upload" : "api/adult/profile-media-upload"
        var request = URLRequest(url: baseURL.appendingPathComponent(endpoint))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await uploader.upload(for: request, fromFile: payload)
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        try validate(response, data: data)
        let result = try JSONDecoder().decode(IndexValue.self, from: data)
        guard result["ok"]?.flag == true, result["imported"]?.list.count == 1 else {
            throw CompanionError.message(result["error"]?.text ?? "The file could not be uploaded.")
        }
        if !destinationFolder.isEmpty, result["destinationFolder"]?.text != destinationFolder {
            throw CompanionError.message("The server did not confirm the selected folder. Check the profile before retrying.")
        }
        invalidateIndex()
    }

    func artwork(_ path: String) async throws -> Data {
        let stamp = authGeneration
        guard path.hasPrefix("/api/recipes/artwork/"),
              let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port,
              url.standardized.path.hasPrefix("/api/recipes/artwork/") else {
            throw CompanionError.message("Unsupported recipe image address.")
        }
        let (data, response) = try await session.data(from: url)
        guard stamp == authGeneration, !isClosed else { throw CancellationError() }
        try validate(response, data: data)
        guard response.mimeType?.hasPrefix("image/") == true, data.count <= 12_000_000 else {
            throw CompanionError.message("Recipe image is unavailable.")
        }
        return data
    }

    private func validate(_ response: URLResponse, data: Data, login: Bool = false) throws {
        guard let response = response as? HTTPURLResponse else { throw CompanionError.message("Invalid server response.") }
        if response.statusCode == 401 {
            if login { throw CompanionError.message("The username or password was not accepted.") }
            forgetSession(); onUnauthorized?()
            throw CompanionError.unauthorized
        }
        if (300...399).contains(response.statusCode) {
            throw CompanionError.message("This address redirects elsewhere. Enter the server's final address instead.")
        }
        guard (200...299).contains(response.statusCode) else {
            let failure = try? JSONDecoder().decode(ServerFailure.self, from: data)
            throw CompanionError.message(failure?.message ?? "The server returned HTTP \(response.statusCode).")
        }
    }
}
