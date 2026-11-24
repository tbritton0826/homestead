import SwiftUI

struct NativeRecipeForm: View {
    let client: HomesteadClient
    var recipe: Recipe? = nil
    var onSaved: ((Recipe) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var editAllowed = false
    @State var draft = NativeRecipeDraft()
    @State private var categories: [IndexValue] = []
    @State private var busy = false
    @State private var message: String?
    @State private var submitted = false
    @State private var confirm = false
    var body: some View {
        Form {
            Section("Import from a link") {
                TextField("Recipe URL (optional)", text: $draft.sourceURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                Button("Read recipe for review") { Task { await preview() } }.disabled(busy || submitted || draft.sourceURL.isEmpty)
            }
            Section("Recipe") {
                TextField("Title", text: $draft.title)
                TextField("Description", text: $draft.description, axis: .vertical)
                Picker("Category", selection: $draft.categoryID) {
                    Text("Uncategorized").tag("")
                    if !draft.categoryID.isEmpty && !categories.contains(where: { $0["id"]?.text == draft.categoryID }) {
                        Text(recipe?.category ?? "Current category").tag(draft.categoryID)
                    }
                    ForEach(Array(categories.enumerated()), id: \.offset) { _, category in
                        Text(category["name"]?.text ?? "Category").tag(category["id"]?.text ?? "")
                    }
                }
                if !draft.quick { TextField("Ingredients — one per line", text: $draft.ingredients, axis: .vertical).lineLimit(3...12) }
                TextField(draft.quick ? "Quick steps — one per line" : "Directions — one per line", text: $draft.directions, axis: .vertical).lineLimit(3...16)
                TextField("Notes", text: $draft.notes, axis: .vertical)
            }.disabled(busy || submitted)
            Section("Details") {
                TextField("Servings", text: $draft.servings)
                TextField("Prep time", text: $draft.prepTime)
                TextField("Cook time", text: $draft.cookTime)
                TextField("Appliance", text: $draft.appliance)
                TextField("Temperature", text: $draft.temperature)
            }.disabled(busy || submitted)
            if let message { Section { Text(message) } }
            Section {
                Button("Save to Homestead") { confirm = true }
                    .disabled(busy || submitted || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.disabled(recipe != nil && !editAllowed)
            .navigationTitle(recipe != nil ? "Edit recipe" : draft.quick ? "Quick instruction" : "Add recipe").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
            .interactiveDismissDisabled(busy)
            .confirmationDialog("Save this entry to your server?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Save") { Task { await save() } }
            }
            .task {
                do {
                    if let recipe {
                        let session: IndexValue = try await client.request("api/auth/session")
                        let config: IndexValue = try await client.request("api/setup-config")
                        editAllowed = RecipeEditAccess.allowed(recipe: recipe, session: session, config: config)
                        guard editAllowed else { message = "This recipe is read-only for this account."; return }
                    }
                    let result: IndexValue = try await client.request("api/recipes/categories")
                    categories = result["categories"]?.list ?? []
                } catch { message = "Categories unavailable: " + error.localizedDescription }
            }
        .homesteadLoading(busy, message: "Preparing recipe…")
    }
    @MainActor private func preview() async {
        guard !busy else { return }; busy = true; message = nil
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["url": draft.sourceURL])
            let result: IndexValue = try await client.request("api/recipes/import-preview", method: "POST", body: body)
            guard result["ok"]?.flag == true, let recipe = result["recipe"] else { throw CompanionError.message("No recipe preview was returned.") }
            draft.importPreview(recipe)
            message = "Review the imported fields, then tap Save. Nothing has been saved yet."
        } catch { message = error.localizedDescription }
    }
    @MainActor private func save() async {
        guard !busy, !submitted, recipe == nil || editAllowed else { return }; busy = true; submitted = true
        defer { busy = false }
        do {
            let endpoint = recipe.map { "api/recipes/" + $0.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/\\?#%")))! } ?? "api/recipes"
            let result: RecipeMutationResponse = try await client.request(endpoint, method: recipe == nil ? "POST" : "PATCH", body: draft.body())
            guard result.ok else { throw CompanionError.message(result.message ?? "Save failed.") }
            if recipe != nil {
                guard let saved = result.recipe else { throw CompanionError.message("The server did not return the updated recipe. Refresh before retrying.") }
                onSaved?(saved); dismiss()
            } else { message = result.artworkWarning ?? "Saved to Homestead. Return to Family to see your entry." }
        } catch {
            if recipe != nil { submitted = false }
            message = error.localizedDescription + " Check your recipe library before submitting again."
        }
    }
}

struct NativeCategoryForm: View {
    let client: HomesteadClient
    @State private var name = ""
    @State private var busy = false
    @State private var attempted = false
    @State private var message: String?
    var body: some View {
        Form {
            TextField("Category name", text: $name).disabled(busy || attempted)
            if let message { Text(message) }
            Button("Create category") { Task { await save() } }.disabled(busy || attempted || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.navigationTitle("Create category").navigationBarTitleDisplayMode(.inline)
        .homesteadLoading(busy, message: "Saving category…")
    }
    @MainActor private func save() async {
        guard !busy, !attempted else { return }; busy = true; attempted = true
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["name": name])
            let result: IndexValue = try await client.request("api/recipes/categories", method: "POST", body: body)
            guard result["ok"]?.flag == true else { throw CompanionError.message("Category was not created.") }
            message = "Category created."
        } catch { message = error.localizedDescription + " Check existing categories before trying again." }
    }
}

struct NativeIntakeForm: View {
    let client: HomesteadClient
    @State private var library = "books"
    @State private var title = ""
    @State private var code = ""
    @State private var notes = ""
    @State private var busy = false
    @State private var attempted = false
    @State private var message: String?
    @State private var confirm = false
    var body: some View {
        Form {
            Section {
                Picker("Library", selection: $library) {
                    Text("Books").tag("books")
                    Text("Movies").tag("movies")
                    Text("Music").tag("music")
                    Text("Inventory").tag("inventory")
                }
                TextField("Title", text: $title)
                TextField("Barcode / ISBN (optional)", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Notes", text: $notes, axis: .vertical)
            }.disabled(busy || attempted)
            Section { Text("Create a manual record using Homestead's intake service. This does not upload a media file or request a download.").font(.footnote) }
            if let message { Text(message) }
            Button("Add record") { confirm = true }.disabled(busy || attempted || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.navigationTitle("Manual entry").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("Add this record to Homestead?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Add") { Task { await save() } }
            }
        .homesteadLoading(busy, message: "Saving entry…")
    }
    @MainActor private func save() async {
        guard !busy, !attempted else { return }; busy = true; attempted = true
        defer { busy = false }
        do {
            let fields: [String: Any] = ["libraryId": library, "title": title, "code": code, "notes": notes, "duplicateAction": "create"]
            let body = try JSONSerialization.data(withJSONObject: fields)
            let result: IndexValue = try await client.request("api/intake/sessions/new/complete", method: "POST", body: body)
            guard result["ok"]?.flag == true else { throw CompanionError.message(result["message"]?.text ?? "Intake failed.") }
            message = result["message"]?.text ?? "Entry saved."
        } catch { message = error.localizedDescription + " Check your library before submitting again." }
    }
}
