import Foundation
import Security
import CryptoKit
import OSLog

@MainActor
final class SessionCookieStore {
    private static let service = "Homestead.server-session.v1"
    private static let logger = Logger(subsystem: "Homestead", category: "Session")

    init() {
        // A reinstall must not silently reuse Keychain sessions left by an old installation.
        let defaults = UserDefaults.standard
        if defaults.string(forKey: "homestead.installation") == nil {
            SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: Self.service] as CFDictionary)
            defaults.set(UUID().uuidString, forKey: "homestead.installation")
        }
    }
    private func query(_ server: URL) -> [CFString: Any] {
        let account = SHA256.hash(data: Data(server.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
        return [kSecClass: kSecClassGenericPassword, kSecAttrService: Self.service, kSecAttrAccount: account]
    }
    func load(server: URL) -> [HTTPCookie] {
        var query = query(server)
        query[kSecReturnData] = true; query[kSecMatchLimit] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data, data.count <= 32_768,
              let records = try? JSONDecoder().decode([SavedSessionCookie].self, from: data) else { return [] }
        return records.compactMap { $0.cookie(server: server) }
    }
    func save(cookies: [HTTPCookie], server: URL) {
        let records = cookies.compactMap { SavedSessionCookie(cookie: $0, server: server) }
        guard !records.isEmpty else { clear(server: server); return }
        guard let data = try? JSONEncoder().encode(records) else { return }
        let query = query(server)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData] = data
            item[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let result = SecItemAdd(item as CFDictionary, nil)
            if result != errSecSuccess { Self.logger.error("Session persistence failed (status \(result))") }
        } else if status != errSecSuccess { Self.logger.error("Session persistence failed (status \(status))") }
    }
    func clear(server: URL) { SecItemDelete(query(server) as CFDictionary) }
}
