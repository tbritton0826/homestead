import Foundation

struct SessionResponse: Decodable {
    let ok: Bool
    let authEnabled: Bool
    let user: SessionUser?
}
struct SessionUser: Decodable { let id: String }
struct BasicResponse: Decodable { let ok: Bool }
struct RecipesResponse: Decodable { let ok: Bool; let recipes: [Recipe] }
struct ServerFailure: Decodable { let message: String? }

struct Recipe: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let category: String?
    let servings: String?
    let prepTime: String?
    let cookTime: String?
    let totalTime: String?
    let ingredients: [String]?
    let directions: [String]?
    let quickSteps: [QuickStep]?
    let notes: String?
    let appliance: String?
    let temperature: String?
    let image: String?
    let favorite: Bool?
    let sourceUrl: String?
    let categoryId: String?
    let entryType: String?
    let tags: [String]?
    let householdVisible: Bool?
    let readOnly: Bool?
    let canEdit: Bool?

    var sourceURL: URL? {
        guard let sourceUrl, let url = URL(string: sourceUrl),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil else { return nil }
        return url
    }
}
struct QuickStep: Decodable { let text: String; let timerSeconds: Double? }

struct AppearancePreferences: Codable, Equatable, Sendable {
    enum Theme: String, Codable, CaseIterable { case system = "System", light = "Light", dark = "Dark" }
    enum Accent: String, Codable, CaseIterable { case blue = "Blue", teal = "Teal", green = "Green", purple = "Purple", pink = "Pink", orange = "Orange" }
    enum Surface: String, Codable, CaseIterable { case glass = "Glass", solid = "Solid" }
    var theme: Theme = .system
    var accent: Accent = .blue
    var surface: Surface = .glass
    static func storageKey(server: String, user: String) -> String {
        let identity = Data((server + "\n" + user).utf8).base64EncodedString()
        return "homestead.appearance." + identity
    }
}

struct RecipeMutationResponse: Decodable {
    let ok: Bool
    let recipe: Recipe?
    let message: String?
    let artworkWarning: String?
}
