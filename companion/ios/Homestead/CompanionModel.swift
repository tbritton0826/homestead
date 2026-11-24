import Foundation
import Observation

@MainActor @Observable
final class CompanionModel {
    enum Screen { case server, connecting, login, recipes }
    var serverAddress: String
    private(set) var screen: Screen
    private let defaults: UserDefaults
    private var restored = false
    private(set) var checkingSession = false
    private var lastSessionCheck = Date.distantPast
    private var recoveryFailures = 0
    private var pendingReadRecovery = false
    private var activeUserID: String?
    private(set) var accountRevision = UUID()
    private(set) var busy = false
    private(set) var error: String?
    private(set) var connectionError: String?
    private(set) var recipes: [Recipe] = []
    private(set) var client: HomesteadClient?
    private(set) var media: [MediaItem] = []
    private(set) var mediaBusy = false
    private(set) var mediaError: String?
    private(set) var mediaLoaded = false
    private(set) var mediaUpdatedAt: Date?
    private var sessionGeneration = UUID()
    let adultPrivacy = AdultPrivacy()
    private var appearanceKey: String?
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let saved = defaults.string(forKey: "homestead.server")
        serverAddress = saved ?? "http://10.0.0.224:7312"
        screen = saved == nil ? .server : .connecting
    }
    func restoreConnection() async {
        guard !restored else { return }
        restored = true
        if screen == .connecting { await connect() }
    }
    // Owned by ContentView's active-scene task: one loop, cancelled in background.
    func maintainConnection() async {
        while !Task.isCancelled {
            await resumeConnection()
            do { try await Task.sleep(for: .seconds(ConnectionRecovery.delay(failures: recoveryFailures))) }
            catch { return }
        }
    }
    func resumeConnection(force: Bool = false) async {
        guard restored, !busy, !checkingSession else { return }
        if screen == .connecting { await connect(); return }
        guard screen == .recipes, let client, !client.isClosed,
              force || Date().timeIntervalSince(lastSessionCheck) >= ConnectionRecovery.delay(failures: recoveryFailures) else { return }
        let generation = sessionGeneration
        checkingSession = true; lastSessionCheck = Date()
        defer { checkingSession = false }
        do {
            let session = try await client.connectionSession()
            guard self.client === client, generation == sessionGeneration, !Task.isCancelled else { return }
            guard session.ok else { throw CompanionError.message("The server could not restore your session.") }
            if session.authEnabled && session.user == nil { sessionExpired(); return }
            if activeUserID != session.user?.id {
                resetMedia(); recipes = []
                await client.discardAccountData()
                guard self.client === client, screen == .recipes, !Task.isCancelled else { return }
                loadAppearance(session)
                await refreshMedia()
            }
            let recovering = connectionError != nil || recoveryFailures > 0 || pendingReadRecovery
            client.rememberSession(); connectionError = nil; recoveryFailures = 0; pendingReadRecovery = false
            if recovering { NotificationCenter.default.post(name: .homesteadConnectionRecovered, object: client) }
            if !mediaLoaded { Task { await self.refreshMedia() } }
        } catch {
            if self.client === client && generation == sessionGeneration && !Task.isCancelled && screen == .recipes {
                guard ConnectionRecovery.failureCategory(error) != "cancelled" else { return }
                recoveryFailures = min(recoveryFailures + 1, 5)
                // Successful API traffic during the failed probe proves the server
                // is still responding. Keep retrying the probe and expose diagnostics.
                if ConnectionRecovery.shouldShowWarning(lastResponse: client.lastSuccessfulResponse, checkStarted: lastSessionCheck, failures: recoveryFailures) {
                    connectionError = message(error)
                } else { connectionError = nil }
            }
        }
    }
    private func sessionExpired() {
        client?.forgetSession(); resetMedia(); recipes = []; activeUserID = nil
        adultPrivacy.reset(); screen = .login
        connectionError = nil
        recoveryFailures = 0
        pendingReadRecovery = false
        error = "Your session ended. Please sign in again."
    }
    var appearance = AppearancePreferences() {
        didSet {
            if let appearanceKey, let data = try? JSONEncoder().encode(appearance) {
                UserDefaults.standard.set(data, forKey: appearanceKey)
            }
        }
    }
    private func loadAppearance(_ session: SessionResponse) {
        activeUserID = session.user?.id
        accountRevision = UUID()
        appearanceKey = nil
        adultPrivacy.reset()
        appearance = AppearancePreferences()
        guard let user = session.user?.id ?? (session.authEnabled ? nil : "local-owner") else { return }
        adultPrivacy.load(server: serverAddress, user: user)
        let key = AppearancePreferences.storageKey(server: serverAddress, user: user)
        if let data = UserDefaults.standard.data(forKey: key),
           let saved = try? JSONDecoder().decode(AppearancePreferences.self, from: data) { appearance = saved }
        appearanceKey = key
    }

    func refreshMedia(force: Bool = false) async {
        guard let client, !mediaBusy, force || !mediaLoaded else { return }
        let generation = sessionGeneration
        mediaBusy = true; mediaError = nil
        defer { if self.client === client, generation == sessionGeneration { mediaBusy = false } }
        do {
            let index = try await client.mediaIndex(force: force)
            guard self.client === client, generation == sessionGeneration, screen == .recipes else { return }
            media = index.items
            mediaLoaded = true
            mediaUpdatedAt = Date()
        } catch {
            guard self.client === client, generation == sessionGeneration, screen == .recipes else { return }
            if Task.isCancelled { return }
            if case CompanionError.unauthorized = error {
                resetMedia()
                media = []; recipes = []; screen = .login
                self.error = "Your session ended. Please sign in again."
                mediaLoaded = false; mediaUpdatedAt = nil
            } else { mediaError = message(error) }
        }
    }
    func requestMediaRefresh() { Task { await refreshMedia(force: true) } }

    func connect() async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let url = try HomesteadClient.serverURL(serverAddress)
            client?.close()
            let connection = HomesteadClient(baseURL: url)
            client = connection
            connection.onUnauthorized = { [weak self, weak connection] in
                guard let self, let connection, self.client === connection else { return }
                self.sessionExpired()
            }
            connection.onReadFailure = { [weak self, weak connection] in
                guard let self, let connection, self.client === connection else { return }
                self.pendingReadRecovery = true
                guard Date().timeIntervalSince(self.lastSessionCheck) > 5 else { return }
                Task { await self.resumeConnection(force: true) }
            }
            connection.onServerResponse = { [weak self, weak connection] in
                guard let self, let connection, self.client === connection else { return }
                // Real API/image traffic clears a stale banner immediately.
                self.connectionError = nil
                self.recoveryFailures = 0
            }
            resetMedia()
            let session: SessionResponse = try await connection.request("api/auth/session", timeout: 12)
            try Task.checkCancellation()
            guard client === connection else { return }
            guard session.ok else { throw CompanionError.message("The server could not start a session.") }
            serverAddress = url.absoluteString
            defaults.set(serverAddress, forKey: "homestead.server")
            connection.rememberSession(); lastSessionCheck = Date()
            connectionError = nil; recoveryFailures = 0; pendingReadRecovery = false
            loadAppearance(session)
            screen = session.authEnabled && session.user == nil ? .login : .recipes
        } catch { if !Task.isCancelled { recoveryFailures = min(recoveryFailures + 1, 5); self.error = message(error) } }
    }

    func signIn(username: String, password: String) async {
        guard let client, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            try await client.signIn(username: username, password: password)
            resetMedia()
            let session: SessionResponse = try await client.request("api/auth/session")
            guard session.ok, !session.authEnabled || session.user != nil else { throw CompanionError.unauthorized }
            loadAppearance(session)
            screen = .recipes
        } catch { self.error = message(error) }
    }

    func refresh() async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        await loadRecipes()
    }

    private func loadRecipes() async {
        guard let client else { return }
        let generation = sessionGeneration
        do {
            let response: RecipesResponse = try await client.request("api/recipes")
            guard self.client === client, generation == sessionGeneration, screen == .recipes else { return }
            guard response.ok, Set(response.recipes.map(\.id)).count == response.recipes.count else {
                throw CompanionError.message("The recipe library returned an invalid response.")
            }
            recipes = response.recipes
        } catch CompanionError.unauthorized {
            guard generation == sessionGeneration else { return }
            resetMedia()
            recipes = []; media = []; mediaLoaded = false; mediaUpdatedAt = nil; screen = .login
            error = "Your session ended. Please sign in again."
        } catch { if generation == sessionGeneration { self.error = message(error) } }
    }

    func signOut() async {
        guard !busy else { return }
        busy = true
        if let client {
            // Local session is discarded even when an offline server cannot revoke it.
            let _: BasicResponse? = try? await client.request("api/auth/logout", method: "POST")
        }
        client?.forgetSession()
        busy = false
        // This action is explicitly labelled "Sign Out and Change Server".
        disconnect()
    }

    func disconnect() {
        guard !busy else { return }
        adultPrivacy.reset()
        appearanceKey = nil; appearance = AppearancePreferences()
        client?.forgetSession(); client?.close(); client = nil
        defaults.removeObject(forKey: "homestead.server")
        activeUserID = nil
        connectionError = nil; recoveryFailures = 0; pendingReadRecovery = false
        recipes = []; error = nil; screen = .server
        resetMedia()
    }

    private func resetMedia() {
        sessionGeneration = UUID()
        media = []; mediaLoaded = false; mediaBusy = false; mediaError = nil; mediaUpdatedAt = nil
    }

    private func message(_ error: Error) -> String {
        if let network = error as? URLError {
            switch network.code {
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
                return "HTTPS could not be verified. For Tailscale, use the server’s configured HTTPS name, or enter http:// with its 100.x address if that port serves HTTP. HTTPS is never changed automatically."
            case .timedOut: return "Homestead took too long to respond. Your server is still saved; retry when it is ready."
            case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost:
                return "Cannot reach Homestead. Check the address, connect to your home network or VPN, and allow Local Network access in Settings."
            default: break
            }
        }
        return error.localizedDescription
    }
}
