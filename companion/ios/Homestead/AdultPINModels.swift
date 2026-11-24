import Foundation
import Security
import CryptoKit
import CommonCrypto

enum AdultVisibilityPolicy {
    // Fail closed for unknown/plugin library types while concealed.
    static func safeLibrary(_ library: String) -> Bool {
        ["movies", "tv", "tvshows", "music", "musicartists", "books", "youtube", "youtubecreators", "family", "recipes", "family-home", "family-profiles", "family-tree", "pets", "calendar", "inventory"].contains(library.lowercased())
    }
}

struct AdultPrivacyRecord: Codable {
    var salt: Data
    var digest: Data
    var hidden = true
    var failures = 0
    var lockedUntil = Date.distantPast
    // nil preserves the old hide-all behavior until the owner chooses a list.
    var hiddenPluginIDs: Set<String>? = nil
}

enum PluginVisibility {
    static func concealed(_ id: String, adultHidden: Bool, selected: Set<String>?) -> Bool {
        adultHidden && (selected?.contains(id) ?? true)
    }
}

enum AdultPIN {
    static func valid(_ pin: String) -> Bool {
        pin.utf8.count == 6 && pin.utf8.allSatisfy { (48...57).contains($0) }
    }
    static func derive(_ pin: String, salt: Data) throws -> Data {
        guard valid(pin), salt.count == 32 else { throw AdultPrivacyError.message("Enter a six-digit PIN.") }
        var result = Data(count: 32)
        let status = result.withUnsafeMutableBytes { output in
            salt.withUnsafeBytes { saltBytes in
                pin.withCString { password in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password, pin.utf8.count,
                        saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 210_000,
                        output.bindMemory(to: UInt8.self).baseAddress, 32)
                }
            }
        }
        guard status == kCCSuccess else { throw AdultPrivacyError.message("Could not secure the PIN. Try again.") }
        return result
    }
    static func equal(_ first: Data, _ second: Data) -> Bool {
        guard first.count == second.count else { return false }
        return zip(first, second).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }
}

enum AdultPrivacyError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

