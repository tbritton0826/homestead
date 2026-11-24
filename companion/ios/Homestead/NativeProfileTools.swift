import SwiftUI
import Foundation

enum ProfileTool: String, Identifiable {
    case appearance, edit
    var id: String { rawValue }
}

struct NativeProfileAppearance: View {
    @Binding var preferences: ProfileAppearancePreferences
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Size", value: "\(Int(preferences.posterWidth))")
                    Slider(value: $preferences.posterWidth, in: 100...180, step: 5).accessibilityLabel("Profile poster size")
                    Button("Reset poster size") { preferences = ProfileAppearancePreferences() }
                } header: {
                    Text("Profile poster")
                } footer: {
                    Text("Saved for this profile and account on this device. Theme, accent, and surfaces inherit your app appearance settings.")
                }
            }.homesteadCanvas().navigationTitle("Appearance").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct NativeProfileEditor: View {
    let target: ProfileUploadTarget
    let client: HomesteadClient
    let includeBody: Bool
    let onSaved: (IndexValue) -> Void
    @State var draft: ProfileEditDraft
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var allowed = false
    @State private var bodyAllowed = false
    @State private var message: String?
    @State private var addToTimeline = false
    private var fields: [ProfileEditField] { ProfileEditField.basic + (includeBody && bodyAllowed ? ProfileEditField.body : []) }
    var body: some View {
        NavigationStack {
            Form {
                if let message { Text(message).foregroundStyle(.orange) }
                Section("Profile details") {
                    ForEach(fields) { field in
                        if field.id == "biography" {
                            TextField(field.label, text: value(field.id), axis: .vertical).lineLimit(3...8)
                        } else {
                            TextField(field.label, text: value(field.id))
                                .textInputAutocapitalization(field.id == "birthday" ? .never : .sentences)
                        }
                    }
                }.disabled(!allowed || busy)
                Section {
                    Toggle("Add changes to timeline", isOn: $addToTimeline)
                    Text("Only changed fields are saved. Existing metadata, history, files, and profile folders are preserved.").font(.caption)
                }.disabled(!allowed || busy)
            }.homesteadCanvas().navigationTitle("Edit Profile").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(!allowed || busy) }
                }
                .interactiveDismissDisabled(busy)
                .task { await checkAccess() }
        }
        .homesteadLoading(busy, message: "Saving profile…")
    }
    private func value(_ key: String) -> Binding<String> {
        Binding(get: { draft.values[key] ?? "" }, set: { draft.values[key] = $0 })
    }
    @MainActor private func checkAccess() async {
        allowed = false; bodyAllowed = false
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            let config: IndexValue = try await client.request("api/setup-config")
            try Task.checkCancellation()
            allowed = ProfileEditAccess.allowed(session: session, config: config, target: target)
            if let section = AdultSection(rawValue: target.library) {
                bodyAllowed = AdultAccess.intimateMetadataAllowed(session: session, config: config, section: section)
            }
            if !allowed { message = "This profile is read-only for your account." }
        } catch { if !Task.isCancelled { message = error.localizedDescription } }
    }
    @MainActor private func save() async {
        guard !busy, allowed else { return }
        busy = true; message = nil
        defer { busy = false }
        do {
            await checkAccess()
            guard allowed, !Task.isCancelled else { return }
            let patch = try draft.patch(includeBody: includeBody && bodyAllowed)
            guard !patch.isEmpty else { dismiss(); return }
            let person: [String: String] = ["id": target.id, "name": target.name, "library": target.library]
            let payload: [String: Any] = ["person": person, "patch": patch, "addToTimeline": addToTimeline,
                                           "effectivePrecision": "unknown", "lockFields": true, "sourceType": "manual", "source": "Manual update"]
            let body = try JSONSerialization.data(withJSONObject: payload)
            let response: IndexValue = try await client.request("api/metadata/adult/edit", method: "POST", body: body)
            guard response["ok"]?.flag == true, let metadata = response["metadata"] else {
                throw CompanionError.message(response["message"]?.text ?? "The profile could not be saved.")
            }
            client.invalidateLibraryIndex()
            onSaved(.object(["metadata": metadata])); dismiss()
        } catch { message = error.localizedDescription + " Check the profile before retrying if the connection was interrupted." }
    }
}
