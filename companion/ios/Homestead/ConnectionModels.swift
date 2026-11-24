import Foundation

enum CompanionError: LocalizedError {
    case message(String)
    case unauthorized
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        case .unauthorized: return "Please sign in to your Homestead server."
        }
    }
}

enum ReadRetryPolicy {
    static func allows(method: String, error: Error, attempt: Int) -> Bool {
        guard method == "GET" || method == "HEAD", attempt == 0,
              let error = error as? URLError else { return false }
        return [.timedOut, .networkConnectionLost, .cannotConnectToHost].contains(error.code)
    }
}

enum ConnectionRecovery {
    static func shouldShowWarning(lastResponse: Date, checkStarted: Date, failures: Int) -> Bool {
        // One failed health check or endpoint does not establish disconnection.
        failures >= 2 && checkStarted.timeIntervalSince(lastResponse) >= 45
    }
    static func shouldShowWarning(lastResponse: Date, checkStarted: Date) -> Bool {
        lastResponse < checkStarted
    }
    static func delay(failures: Int) -> TimeInterval {
        let delays: [TimeInterval] = [30, 2, 5, 12, 30, 60]
        return delays[min(max(0, failures), delays.count - 1)]
    }
    static func isTransient(_ error: Error) -> Bool {
        guard let network = error as? URLError else { return false }
        return [.timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed].contains(network.code)
    }
    static func failureCategory(_ error: Error) -> String {
        if error is CancellationError || (error as? URLError)?.code == .cancelled { return "cancelled" }
        if let network = error as? URLError { return "network-" + String(network.code.rawValue) }
        if case CompanionError.unauthorized = error { return "authentication" }
        return "server-response"
    }
}

enum MediaLoadingPresentation {
    static func showsOverlay(tab: Int, busy: Bool, loaded: Bool, connectionFailed: Bool) -> Bool {
        // Family, Adult, and More load their own data. Background refreshes must
        // not cover usable libraries or compete with the connection error card.
        (tab == 0 || tab == 1) && busy && !loaded && !connectionFailed
    }
}

struct SavedSessionCookie: Codable {
    let name: String
    let value: String
    let expires: Date?
    let secure: Bool
    let serverOrigin: String

    init?(cookie: HTTPCookie, server: URL, now: Date = Date()) {
        guard ["homestead_session", "homestead_client_id"].contains(cookie.name),
              cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased() == server.host?.lowercased(),
              cookie.path == "/", cookie.value.utf8.count <= 4096,
              !cookie.isSecure || server.scheme == "https",
              cookie.expiresDate.map({ $0 > now }) ?? true else { return nil }
        name = cookie.name; value = cookie.value; expires = cookie.expiresDate; secure = cookie.isSecure
        serverOrigin = server.absoluteString
    }
    func cookie(server: URL, now: Date = Date()) -> HTTPCookie? {
        guard serverOrigin == server.absoluteString, let host = server.host,
              ["homestead_session", "homestead_client_id"].contains(name),
              value.utf8.count <= 4096, !secure || server.scheme == "https",
              expires.map({ $0 > now }) ?? true else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: host, .path: "/"]
        if secure { properties[.secure] = "TRUE" }
        if let expires { properties[.expires] = expires }
        if name == "homestead_session" { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        return HTTPCookie(properties: properties)
    }
}

extension Notification.Name {
    static let homesteadPetChanged = Notification.Name("Homestead.petChanged")
    static let homesteadConnectionRecovered = Notification.Name("Homestead.connectionRecovered")
    static let homesteadProfileRefreshed = Notification.Name("Homestead.profileRefreshed")
}

// Keep direct HTTP scoped to private LANs and the Tailscale CGNAT range.
// HTTPS always retains platform certificate validation.
enum ServerAddressPolicy {
    static func allowsHTTP(host: String) -> Bool {
        let host = host.lowercased()
        let pieces = host.split(separator: ".", omittingEmptySubsequences: false)
        let octets = pieces.compactMap { part -> Int? in
            guard !part.isEmpty, part.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            return Int(part)
        }
        if pieces.count == 4, octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) {
            return octets[0] == 10 || octets[0] == 127 ||
                (octets[0] == 192 && octets[1] == 168) ||
                (octets[0] == 172 && (16...31).contains(octets[1])) ||
                (octets[0] == 100 && (64...127).contains(octets[1]))
        }
        let validName = host.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == ".") }
        return validName && (host == "localhost" || host.hasSuffix(".local") || !host.contains(".")) && !host.allSatisfy({ $0.isNumber })
    }
}
