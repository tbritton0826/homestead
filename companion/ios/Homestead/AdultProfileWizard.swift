import SwiftUI

struct AdultProfileWizard: View {
    let client: HomesteadClient
    let initialSection: AdultSection
    @Environment(\.dismiss) private var dismiss
    @State private var step = 0
    @State private var section = AdultSection.personal
    @State private var allowed: [AdultSection] = []
    @State private var name = ""
    @State private var description = ""
    @State private var sourceURLs = ""
    @State private var candidates: [IndexValue] = []
    @State private var candidate: IndexValue?
    @State private var busy = false
    @State private var attempted = false
    @State private var message: String?
    @State private var completed = false
    @State private var media = ProfileMediaQueue()
    @State private var createdTarget: ProfileUploadTarget?
    private var profileType: String { section == .performers ? "performer" : section == .celebrities ? "celebrity" : "personal" }
    var body: some View {
        NavigationStack {
            Form {
                if let message { Text(message) }
                if completed, let createdTarget {
                    ProfileMediaPicker(queue: media)
                    ProfileFolderControl(queue: media, target: createdTarget, client: client)
                    Button("Upload remaining media") { Task { await media.upload(client: client, target: createdTarget) } }
                        .disabled(!media.pending || media.preparing || media.uploading)
                }
                if !allowed.isEmpty && !completed {
                    if step == 0 {
                        Section("Profile") {
                            Picker("Library", selection: $section) { ForEach(allowed) { Text($0.title).tag($0) } }
                                .onChange(of: section) { _, _ in candidate = nil; candidates = [] }
                            TextField("Name", text: $name)
                            TextField("Description", text: $description, axis: .vertical)
                        }
                    } else if step == 1 {
                        ProfileMediaPicker(queue: media)
                        Section("Sources (optional)") {
                            TextField("Source URLs — one per line", text: $sourceURLs, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled()
                            if section != .personal {
                                Button("Find metadata for \(name)") { Task { await lookup() } }.disabled(busy)
                                ForEach(Array(candidates.enumerated()), id: \.offset) { _, row in
                                    Button(NativeSearchMapping.text(row, keys: ["name", "title"])) {
                                        candidate = row
                                        message = "Metadata source selected."
                                    }
                                }
                                if candidate != nil { Button("Use manual details instead") { candidate = nil; message = nil } }
                            }
                        }
                    } else {
                        Section("Review") {
                            LabeledContent("Name", value: name)
                            LabeledContent("Library", value: section.title)
                            Text(description)
                            Text(candidate == nil ? "Manual profile" : "Selected provider metadata will be included.")
                            if !sourceURLs.isEmpty { Text(sourceURLs) }
                            LabeledContent("Device files", value: String(media.items.count))
                        }
                        Button("Create profile") { Task { await create() } }.disabled(busy || attempted || media.preparing)
                    }
                    if step < 2 { Button("Continue") { message = nil; step += 1 }.disabled(busy || media.preparing || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                    if step > 0 { Button("Back") { step -= 1 }.disabled(busy || attempted) }
                }
            }.disabled(busy)
                .navigationTitle("Add Adult profile").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(completed ? "Done" : "Close") { dismiss() }.disabled(busy || media.preparing || media.uploading) } }
                .interactiveDismissDisabled(busy || media.preparing || media.uploading)
                .task {
                    do {
                        let session: IndexValue = try await client.request("api/auth/session")
                        let config: IndexValue = try await client.request("api/setup-config")
                        guard ["owner", "admin"].contains(session["user"]?["role"]?.text ?? "") else {
                            message = "Administrator access is required to create profiles."; return
                        }
                        allowed = AdultAccess.sections(session: session, config: config).filter { [.personal, .performers, .celebrities].contains($0) }
                        section = allowed.contains(initialSection) ? initialSection : (allowed.first ?? .personal)
                        if allowed.isEmpty { message = "No Adult profile libraries are enabled for this account." }
                    } catch { message = error.localizedDescription }
                }
        }
        .homesteadLoading(busy && !media.preparing && !media.uploading, message: "Preparing profile…")
    }
    @MainActor private func lookup() async {
        guard !busy else { return }; busy = true; message = nil
        defer { busy = false }
        do {
            let response: IndexValue = try await client.request("api/metadata/adult/person/search", query: [URLQueryItem(name: "q", value: name), URLQueryItem(name: "profileType", value: profileType)])
            guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Metadata search failed.") }
            candidates = response["results"]?.list ?? response["candidates"]?.list ?? []
            if candidates.isEmpty { message = "No matches. You can continue with manual details." }
        } catch { message = error.localizedDescription }
    }
    @MainActor private func create() async {
        guard !busy, !attempted, allowed.contains(section) else { return }; busy = true; attempted = true
        defer { busy = false }
        do {
            var fields: [String: Any] = ["name": name, "profileType": profileType, "libraryType": section.rawValue,
                "metadata": ["description": description], "sourceUrls": NativeRecipeDraft.lines(sourceURLs), "overwrite": false]
            if let candidate { fields["candidate"] = candidate.jsonObject }
            let body = try JSONSerialization.data(withJSONObject: fields)
            let response: IndexValue = try await client.request("api/adult/profiles/create", method: "POST", body: body)
            guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Profile was not created.") }
            completed = true
            message = "Profile created. It will appear when the server finishes indexing it."
            guard let id = response["profile"]?["id"]?.text, !id.isEmpty else {
                message = "Profile created, but its upload identifier was missing. Open it from the library to add media."; return
            }
            let target = ProfileUploadTarget(id: id, name: name, library: section.rawValue)
            createdTarget = target
            if media.pending { await media.upload(client: client, target: target) }
        } catch { message = error.localizedDescription + " Check the library before submitting again." }
    }
}
