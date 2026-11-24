import Foundation

struct NativeRecipeDraft {
    var title = ""
    var description = ""
    var ingredients = ""
    var directions = ""
    var notes = ""
    var sourceURL = ""
    var categoryID = ""
    var servings = ""
    var prepTime = ""
    var cookTime = ""
    var appliance = ""
    var temperature = ""
    var imageURL = ""
    var quick = false
    var totalTime = ""
    var tags: [String] = []
    var favorite = false
    var householdVisible = true
    var originalQuickSteps: [QuickStep] = []
    static func editing(_ recipe: Recipe) -> Self {
        var draft = Self()
        draft.title = recipe.title; draft.description = recipe.description ?? ""
        draft.ingredients = (recipe.ingredients ?? []).joined(separator: "\n")
        draft.quick = recipe.entryType == "quick-instruction"
        draft.originalQuickSteps = recipe.quickSteps ?? []
        draft.directions = (draft.quick ? draft.originalQuickSteps.map(\.text) : recipe.directions ?? []).joined(separator: "\n")
        draft.notes = recipe.notes ?? ""; draft.sourceURL = recipe.sourceUrl ?? ""
        draft.categoryID = recipe.categoryId ?? ""; draft.servings = recipe.servings ?? ""
        draft.prepTime = recipe.prepTime ?? ""; draft.cookTime = recipe.cookTime ?? ""; draft.totalTime = recipe.totalTime ?? ""
        draft.appliance = recipe.appliance ?? ""; draft.temperature = recipe.temperature ?? ""
        draft.tags = recipe.tags ?? []; draft.favorite = recipe.favorite ?? false
        draft.householdVisible = recipe.householdVisible ?? true
        return draft
    }
    static func lines(_ text: String) -> [String] {
        text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    mutating func importPreview(_ row: IndexValue) {
        title = row["title"]?.text ?? title
        description = row["description"]?.text ?? description
        ingredients = row["ingredients"]?.list.compactMap(\.text).joined(separator: "\n") ?? ingredients
        directions = row["directions"]?.list.compactMap(\.text).joined(separator: "\n") ?? directions
        servings = row["servings"]?.text ?? servings
        prepTime = row["prepTime"]?.text ?? prepTime
        cookTime = row["cookTime"]?.text ?? cookTime
        imageURL = row["imageUrl"]?.text ?? ""
    }
    func body() throws -> Data {
        var values: [String: Any] = ["title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "entryType": quick ? "quick-instruction" : "recipe", "description": description,
            "ingredients": Self.lines(ingredients), "directions": Self.lines(directions), "notes": notes,
            "sourceUrl": sourceURL, "categoryId": categoryID, "servings": servings,
            "prepTime": prepTime, "cookTime": cookTime, "appliance": appliance, "temperature": temperature,
            "imageUrl": imageURL, "totalTime": totalTime, "tags": tags, "favorite": favorite, "householdVisible": householdVisible]
        if quick { values["quickSteps"] = Self.lines(directions).enumerated().map { index, text in
            ["text": text, "timerSeconds": index < originalQuickSteps.count ? originalQuickSteps[index].timerSeconds ?? 0 : 0] as [String: Any]
        } }
        return try JSONSerialization.data(withJSONObject: values)
    }
}

enum RequestSnapshot {
    static func jobs(_ response: IndexValue, userID: String, owner: Bool, allowed: Set<String>) -> [IndexValue] {
        (response["jobs"]?.list ?? []).filter { row in
            let library = row["library"]?.text ?? ""
            let requestedBy = row["requestedByUserId"]?.text ?? ""
            return allowed.contains(NativeSearchMapping.libraryPermission(library)) &&
                ((!userID.isEmpty && requestedBy == userID) || (owner && requestedBy.isEmpty))
        }
    }
    static func rows(_ response: IndexValue, allowed: Set<String>) -> [IndexValue] {
        ["movies", "tv", "books", "music", "youtube"].filter { allowed.contains(NativeSearchMapping.libraryPermission($0)) }
            .flatMap { library in
                (response[library]?.list ?? []).map { row in
                    var fields = row.fields
                    fields["library"] = .string(library)
                    return IndexValue.object(fields)
                }
            }
    }
}

// The server remains authoritative; UI checks also honor explicit read-only flags.
enum RecipeEditAccess {
    static func allowed(recipe: Recipe, session: IndexValue, config: IndexValue) -> Bool {
        guard recipe.readOnly != true, recipe.canEdit != false,
              session["ok"]?.flag == true, session["user"]?["readOnly"]?.flag != true,
              config["subscription"]?["features"]?["recipes"]?.flag == true,
              config["enabledLibraries"]?["family"]?.flag == true,
              config["familySublibraries"]?["recipes"]?.flag != false else { return false }
        if session["authEnabled"]?.flag == false { return true }
        guard let user = session["user"] else { return false }
        let allowed = Set(user["allowedLibraries"]?.list.compactMap(\.text) ?? [])
        return user["role"]?.text == "owner" || !allowed.isDisjoint(with: ["*", "family", "recipes"])
    }
}
