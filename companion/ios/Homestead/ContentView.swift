//
//  ContentView.swift
//  Homestead
//
//  Created by Tim on 9/29/26.
//

import SwiftUI
import UIKit

struct ContentView: View {
    @State private var model = CompanionModel()
    @State private var network = ConnectionMonitor()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            switch model.screen {
            case .server: ConnectionView(model: model)
            case .connecting: ReconnectingView(model: model)
            case .login: LoginView(model: model)
            case .recipes: CompanionTabs(model: model).id(model.accountRevision)
            }
        }
        .tint(model.appearance.color)
        .environment(\.homesteadAppearance, model.appearance)
        .environment(\.adultHidden, model.adultPrivacy.hidden)
        .environment(\.hiddenPluginIDs, model.adultPrivacy.hiddenPluginIDs)
        .preferredColorScheme(model.appearance.colorScheme)
        .task { await model.restoreConnection() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await model.maintainConnection()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.resumeConnection() } }
        }
        .onChange(of: network.revision) { _, _ in
            if network.available { model.client?.networkPathChanged(); Task { await model.resumeConnection(force: true) } }
        }
    }
}

private struct ReconnectingView: View {
    @Bindable var model: CompanionModel
    var body: some View {
        VStack(spacing: 16) {
            if model.busy { HomesteadLoadingCard(message: "Connecting to your Homestead…") }
            else {
                Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                Text(model.error ?? "Your server is temporarily unavailable.").multilineTextAlignment(.center)
                Button("Retry connection") { Task { await model.connect() } }.buttonStyle(.borderedProminent)
                Button("Change Server") { model.disconnect() }
            }
        }.padding(24).homesteadPanel(radius: 20).padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity).homesteadCanvas()
    }
}

private struct ConnectionView: View {
    @Bindable var model: CompanionModel
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Your home, connected", systemImage: "house.fill").font(.title2.bold())
                    Text("Connect to your Homestead server to browse your media and household recipes.")
                        .foregroundStyle(.secondary)
                }
                Section {
                    TextField("http://10.0.0.224:7312", text: $model.serverAddress)
                        .keyboardType(.URL).textContentType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .disabled(model.busy)
                } header: { Text("Server address") } footer: {
                    Text("Use your home network or VPN. Local HTTP connections are unencrypted; use HTTPS when available.")
                }
                if let error = model.error { Section { ErrorNotice(text: error) } }
                Section {
                    Button { Task { await model.connect() } } label: {
                        Text(model.busy ? "Connecting…" : "Connect")
                    }
                    .disabled(model.busy || model.serverAddress.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle("Homestead")
            .homesteadCanvas().homesteadLoading(model.busy, message: "Connecting…")
        }
    }
}

private struct LoginView: View {
    @Bindable var model: CompanionModel
    @State private var username = ""
    @State private var password = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("Server") { Text(model.serverAddress).font(.footnote) }
                Section("Your account") {
                    TextField("Username", text: $username).textContentType(.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(.password)
                }.disabled(model.busy)
                if let error = model.error { Section { ErrorNotice(text: error) } }
                Section {
                    Button {
                        let submittedPassword = password
                        password = ""
                        Task { await model.signIn(username: username, password: submittedPassword) }
                    } label: {
                        Text(model.busy ? "Signing in…" : "Sign In")
                    }.disabled(model.busy || username.isEmpty || password.isEmpty)
                } footer: { Text("Your password is not saved by this app.") }
            }
            .navigationTitle("Welcome home")
            .homesteadCanvas().homesteadLoading(model.busy, message: "Signing in…")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Change Server") { model.disconnect() }.disabled(model.busy)
                }
            }
        }
    }
}

struct RecipeLibraryView: View {
    @Environment(\.homesteadAppearance) private var appearance
    @Bindable var model: CompanionModel
    @State private var favoritesOnly = false
    @State private var selectedID: String?
    private var filtered: [Recipe] {
        model.recipes.filter { recipe in
            !favoritesOnly || recipe.favorite == true
        }
    }
    var body: some View {
        NavigationSplitView {
            List(selection: $selectedID) {
                if let error = model.error { ErrorNotice(text: error) }
                Section {
                    ForEach(filtered) { recipe in
                        NavigationLink(value: recipe.id) {
                            HStack(spacing: 12) {
                                Image(systemName: "fork.knife").foregroundStyle(appearance.color)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(recipe.title).font(.headline)
                                    if let category = recipe.category, !category.isEmpty {
                                        Text(category).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                if recipe.favorite == true {
                                    Image(systemName: "heart.fill").foregroundStyle(.pink).accessibilityLabel("Favorite")
                                }
                            }.padding(.vertical, 6)
                        }
                        .listRowBackground(Color.clear.homesteadPanel(radius: 16))
                        .listRowSeparator(.hidden)
                    }
                    if filtered.isEmpty && !model.busy && model.error == nil {
                        ContentUnavailableView(!favoritesOnly ? "No recipes yet" : "No favorite recipes",
                            systemImage: "book.closed",
                            description: Text("Recipes saved on your Homestead server appear here."))
                    }
                } header: { Text("\(filtered.count) recipes") }
            }
            .listStyle(.plain)
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 8) {
                    Toggle("Favorites only", isOn: $favoritesOnly)
                        .padding(.horizontal, 14).padding(.vertical, 8).homesteadPanel(radius: 16)
                }.padding(.horizontal, 12).padding(.bottom, 8)
                    .background { HomesteadBackdrop() }
            }
            .listRowSpacing(8)
            .homesteadCanvas()
            .refreshable { await model.refresh() }
            .task { await model.refresh() }
        } detail: {
            if let selectedID, let recipe = model.recipes.first(where: { $0.id == selectedID }) {
                RecipeDetailView(recipe: recipe, client: model.client, onSaved: { _ in Task { await model.refresh() } })
            } else {
                ContentUnavailableView("Your recipe collection", systemImage: "book",
                    description: Text("Select a recipe to see its ingredients and directions."))
            }
        }
        .homesteadLoading(model.busy, message: "Loading recipes…")
    }
}

struct RecipeDetailView: View {
    let recipe: Recipe
    let client: HomesteadClient?
    var onSaved: ((Recipe) -> Void)? = nil
    @State private var savedRecipe: Recipe?
    @State private var editing = false
    @State private var editAllowed = false
    @State private var artwork: UIImage?
    private var currentRecipe: Recipe { savedRecipe?.id == recipe.id ? savedRecipe! : recipe }
    var body: some View {
        let recipe = currentRecipe
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let artwork {
                    Image(uiImage: artwork).resizable().scaledToFit().frame(maxHeight: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 18)).accessibilityLabel(recipe.title)
                }
                Text(recipe.title).font(.largeTitle.bold())
                if let description = recipe.description, !description.isEmpty { Text(description).foregroundStyle(.secondary) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), alignment: .leading)], alignment: .leading, spacing: 16) {
                    fact("Servings", recipe.servings); fact("Prep", recipe.prepTime)
                    fact("Cook", recipe.cookTime); fact("Total", recipe.totalTime)
                    fact("Appliance", recipe.appliance); fact("Temperature", recipe.temperature)
                }
                lines("Ingredients", recipe.ingredients ?? [], numbered: false)
                lines("Directions", recipe.directions ?? [], numbered: true)
                lines("Quick steps", (recipe.quickSteps ?? []).map {
                    $0.text + (($0.timerSeconds ?? 0) > 0 ? " (\(($0.timerSeconds ?? 0).formatted()) seconds)" : "")
                }, numbered: true)
                if let notes = recipe.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 8) { Text("Notes").font(.title2.bold()); Text(notes) }
                }
                if let source = recipe.sourceURL { Link("View original recipe", destination: source) }
            }
            .frame(maxWidth: 800, alignment: .leading).padding()
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .textSelection(.enabled)
        .homesteadCanvas()
        .navigationTitle("Recipe").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            if editAllowed {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { editing = true } label: { Image(systemName: "pencil").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel("Edit " + recipe.title)
                }
            }
        }
        .onChange(of: recipe.id) { _, _ in savedRecipe = nil; editing = false; editAllowed = false }
        .sheet(isPresented: $editing) {
            if let client {
                NavigationStack {
                    NativeRecipeForm(client: client, recipe: currentRecipe, onSaved: { saved in
                        savedRecipe = saved; onSaved?(saved); editing = false
                    }, draft: NativeRecipeDraft.editing(currentRecipe))
                }
            }
        }
        .task(id: recipe.id) {
            editAllowed = false
            guard let client else { return }
            do {
                let session: IndexValue = try await client.request("api/auth/session")
                let config: IndexValue = try await client.request("api/setup-config")
                try Task.checkCancellation()
                editAllowed = RecipeEditAccess.allowed(recipe: recipe, session: session, config: config)
            } catch { editAllowed = false }
        }
        .task(id: recipe.id + ":" + (recipe.image ?? "")) {
            artwork = nil
            if let client, let path = recipe.image,
               let data = try? await client.artwork(path), !Task.isCancelled { artwork = UIImage(data: data) }
        }
    }
    @ViewBuilder private func fact(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.headline)
            }
        }
    }
    @ViewBuilder private func lines(_ title: String, _ values: [String], numbered: Bool) -> some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(title).font(.title2.bold())
                ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                    HStack(alignment: .top, spacing: 12) {
                        Text(numbered ? "\(index + 1)." : "•").foregroundStyle(.secondary)
                        Text(value).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }
}

private struct ErrorNotice: View {
    let text: String
    var body: some View { Label(text, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
}

#Preview {
    ContentView()
}
