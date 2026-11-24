import Foundation
import Observation
import Security
import CryptoKit

@MainActor @Observable
final class AdultPrivacy {
    private(set) var hidden = true
    private(set) var hasPIN = false
    private(set) var storageError: String?
    var hiddenPluginIDs: Set<String>? { record?.hiddenPluginIDs }
    private var account: String?
    private var record: AdultPrivacyRecord?
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "Homestead.AdultVisibility.v1",
         kSecAttrAccount as String: account ?? ""]
    }
    func reset() { account = nil; record = nil; hidden = true; hasPIN = false; storageError = nil }
    func load(server: String, user: String) {
        reset()
        account = SHA256.hash(data: Data((server + "\n" + user).utf8)).map { String(format: "%02x", $0) }.joined()
        var lookup = query
        lookup[kSecReturnData as String] = true
        var value: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &value)
        if status == errSecItemNotFound { hidden = false; return }
        guard status == errSecSuccess, let data = value as? Data,
              let saved = try? JSONDecoder().decode(AdultPrivacyRecord.self, from: data),
              saved.salt.count == 32, saved.digest.count == 32 else {
            storageError = "The visibility lock could not be read. Adult content stays hidden. Reconnect to try again."
            return
        }
        record = saved; hasPIN = true; hidden = saved.hidden
    }
    private func save(_ updated: AdultPrivacyRecord) throws {
        guard account != nil, storageError == nil else { throw AdultPrivacyError.message("Reconnect before changing visibility.") }
        let data = try JSONEncoder().encode(updated)
        let status: OSStatus
        if record != nil {
            status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        } else {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw AdultPrivacyError.message("Could not save the visibility lock. Nothing was changed.") }
        record = updated; hidden = updated.hidden; hasPIN = true
    }
    func setPINAndHide(_ pin: String, plugins: Set<String>? = nil) throws {
        guard !hasPIN else { throw AdultPrivacyError.message("Verify your current PIN before changing it.") }
        var updated = try newRecord(pin, hidden: true)
        updated.hiddenPluginIDs = plugins
        try save(updated)
    }
    private func newRecord(_ pin: String, hidden: Bool) throws -> AdultPrivacyRecord {
        var salt = Data(count: 32)
        let status = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard status == errSecSuccess else { throw AdultPrivacyError.message("Could not create a PIN. Try again.") }
        return AdultPrivacyRecord(salt: salt, digest: try AdultPIN.derive(pin, salt: salt), hidden: hidden)
    }
    func hide(plugins: Set<String>? = nil) throws {
        guard var saved = record else { throw AdultPrivacyError.message("Set a PIN first.") }
        saved.hidden = true
        saved.hiddenPluginIDs = plugins
        try save(saved)
    }
    private func verified(_ pin: String) throws -> AdultPrivacyRecord {
        guard var saved = record else { throw AdultPrivacyError.message("No PIN is configured.") }
        guard Date() >= saved.lockedUntil else { throw AdultPrivacyError.message("Too many attempts. Try again in \(Int(ceil(saved.lockedUntil.timeIntervalSinceNow))) seconds.") }
        let candidate = try AdultPIN.derive(pin, salt: saved.salt)
        guard AdultPIN.equal(candidate, saved.digest) else {
            saved.failures += 1
            if saved.failures >= 5 { saved.lockedUntil = Date().addingTimeInterval(60) }
            try save(saved)
            throw AdultPrivacyError.message(saved.failures >= 5 ? "Too many attempts. Wait one minute before trying again." : "Incorrect PIN.")
        }
        saved.failures = 0; saved.lockedUntil = .distantPast
        return saved
    }
    func unlock(_ pin: String) throws {
        var saved = try verified(pin)
        saved.hidden = false
        try save(saved)
    }
    func changePIN(current: String, new: String) throws {
        let saved = try verified(current)
        var updated = try newRecord(new, hidden: saved.hidden)
        updated.hiddenPluginIDs = saved.hiddenPluginIDs
        try save(updated)
    }
}
