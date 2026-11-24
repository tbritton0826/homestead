import SwiftUI
import UniformTypeIdentifiers

struct NativeAIView: View {
    let plugin: PluginLibrary
    let client: HomesteadClient
    @Environment(\.adultHidden) private var hidden
    @Environment(\.hiddenPluginIDs) private var hiddenPlugins
    @State private var conversations: [IndexValue] = []
    @State private var conversation: IndexValue?
    @State private var catalog: IndexValue = .object([:])
    @State private var config: IndexValue = .object([:])
    @State private var selection = "assistant"
    @State private var draft = ""
    @State private var attachments: [IndexValue] = []
    @State private var pending: IndexValue?
    @State private var busy = false
    @State private var error: String?
    @State private var showHistory = false
    @State private var showSettings = false
    @State private var showFiles = false
    @State private var approve = false
    @State private var rename = false
    @State private var newTitle = ""
    @State private var trash = false
    @State private var mode = "Chat"
    private var concealed: Bool { PluginVisibility.concealed(plugin.id, adultHidden: hidden, selected: hiddenPlugins) }
    private var choices: [AIModelChoice] { AIModelChoice.choices(catalog) }
    private var choice: AIModelChoice { choices.first { $0.id == selection } ?? choices[0] }
    private var messages: [IndexValue] { conversation?["messages"]?.list ?? [] }
    var body: some View {
        pageContent
        .homesteadCanvas().navigationTitle("AI Assistant").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if conversation != nil && !concealed {
                Menu {
                    Button("Rename") { newTitle = conversation?["title"]?.text ?? ""; rename = true }
                    Button("Move to Trash", role: .destructive) { trash = true }
                } label: { Image(systemName: "ellipsis") }.disabled(busy || pending != nil)
            }
        }
        .task { await load() }
        .onChange(of: concealed) { _, value in
            if value {
                conversations = []; conversation = nil; attachments = []; pending = nil; draft = ""
                showHistory = false; showSettings = false; showFiles = false; approve = false; rename = false; trash = false
            }
        }
        .onChange(of: selection) { _, _ in if choice.mode == "chat" { attachments = [] } }
        .sheet(isPresented: $showHistory) { conversationHistory }
        .sheet(isPresented: $showSettings) { NativeAISettings(client: client) }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.data], allowsMultipleSelection: false) { result in
            if case .success(let files) = result, let file = files.first { Task { await attach(file) } }
            else if case .failure(let failure) = result { error = failure.localizedDescription }
        }
        .alert("Rename conversation", isPresented: $rename) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Save") { Task { await renameConversation() } }
        }
        .confirmationDialog("Move this conversation to recoverable trash?", isPresented: $trash, titleVisibility: .visible) {
            Button("Move to Trash", role: .destructive) { Task { await removeConversation() } }
        }
        .confirmationDialog("Execute the reviewed Homestead actions?", isPresented: $approve, titleVisibility: .visible) {
            Button("Approve & execute") { Task { await decide(true) } }
            Button("Cancel", role: .cancel) {}
        }
        .homesteadLoading(busy && !concealed, message: "Working…")
    }
    private var pageContent: some View {
        VStack(spacing: 0) {
            Picker("AI mode", selection: $mode) { Text("Chat").tag("Chat"); Text("Images").tag("Images") }
                .pickerStyle(.segmented).padding(.horizontal).disabled(concealed || busy && pending != nil)
            if concealed { ContentUnavailableView("AI hidden", systemImage: "lock") }
            else if mode == "Images" { NativeComfyView(client: client) }
            else { conversationHeader; conversationContent }
        }
    }
    private var conversationHeader: some View {
        HStack {
            Text(conversation?["title"]?.text ?? "New conversation").font(.headline).lineLimit(1)
            Spacer()
            Button { showHistory = true } label: { Image(systemName: "clock").frame(width: 44, height: 44) }.accessibilityLabel("Conversations")
            Button { conversation = nil; pending = nil; attachments = [] } label: { Image(systemName: "square.and.pencil").frame(width: 44, height: 44) }.accessibilityLabel("New conversation").disabled(busy || pending != nil)
            Button { showSettings = true } label: { Image(systemName: "gearshape").frame(width: 44, height: 44) }.accessibilityLabel("AI settings")
        }.padding(.horizontal).homesteadControl().disabled(concealed)
    }
    @ViewBuilder private var conversationContent: some View {
        Picker("Assistant or chat model", selection: $selection) { ForEach(choices) { Text($0.label).tag($0.id) } }
            .pickerStyle(.menu).padding(.horizontal).disabled(busy || pending != nil || !messages.isEmpty)
        ForEach(Array((catalog["warnings"]?.list ?? []).enumerated()), id: \.offset) { _, warning in
            if let text = warning.text { Text(text).font(.footnote).foregroundStyle(.orange).padding(.horizontal) }
        }
        if let error {
            HStack {
                Text(error).font(.footnote).foregroundStyle(.orange)
                Button("Refresh") { Task { await load() } }
            }.padding().disabled(busy)
        }
        messageHistory
        attachmentStrip
        composer
    }
    private var messageHistory: some View {
        ScrollViewReader { scroll in
            ScrollView { messageList }
                .onChange(of: messages.count) { _, _ in withAnimation { scroll.scrollTo("latest", anchor: .bottom) } }
                .onChange(of: pending?["id"]?.text) { _, _ in withAnimation { scroll.scrollTo("latest", anchor: .bottom) } }
        }
    }
    private var messageList: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            if messages.isEmpty {
                ContentUnavailableView("How can Homestead help?", systemImage: "sparkles",
                    description: Text("Ask about your libraries or start a conversation. Actions that need approval are reviewed below."))
            }
            ForEach(Array(messages.enumerated()), id: \.offset) { _, message in messageView(message) }
            if let pending { confirmationView(pending) }
            Color.clear.frame(height: 1).id("latest")
        }.padding()
    }
    @ViewBuilder private var attachmentStrip: some View {
        if !attachments.isEmpty {
            ScrollView(.horizontal) {
                HStack {
                    ForEach(Array(attachments.enumerated()), id: \.offset) { index, asset in
                        Button { attachments.remove(at: index) } label: {
                            Label(asset["name"]?.text ?? "Attachment", systemImage: "xmark.circle")
                                .font(.caption).padding(8).homesteadPanel(radius: 10)
                        }
                    }
                }.padding(.horizontal)
            }
        }
    }
    private var composer: some View {
        HStack(alignment: .bottom) {
            if choice.mode == "assistant" {
                Button { showFiles = true } label: { Image(systemName: "paperclip").frame(width: 44, height: 44) }
                    .accessibilityLabel("Attach a file").disabled(busy || pending != nil)
            }
            TextField("Message Homestead", text: $draft, axis: .vertical).lineLimit(1...6)
                .padding(12).homesteadPanel(radius: 16).disabled(concealed || pending != nil)
            Button { Task { await send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.title).frame(width: 44, height: 44) }
                .accessibilityLabel("Send message").disabled(busy || pending != nil || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.padding(.horizontal).padding(.vertical, 8).homesteadControl()
    }
    private var conversationHistory: some View {
        NavigationStack {
            List {
                ForEach(Array(conversations.enumerated()), id: \.offset) { _, item in
                    Button { showHistory = false; Task { await open(item) } } label: {
                        VStack(alignment: .leading) {
                            Text(item["title"]?.text ?? "Conversation").font(.headline)
                            Text((item["messageCount"]?.text ?? "0") + " messages").font(.caption).foregroundStyle(.secondary)
                        }
                    }.disabled(busy || pending != nil)
                }
            }.navigationTitle("Conversations").toolbar { Button("Close") { showHistory = false } }
        }
    }
    @ViewBuilder private func messageView(_ message: IndexValue) -> some View {
        let role = message["role"]?.text ?? "assistant"
        if role == "tool" {
            DisclosureGroup(message["name"]?.text ?? "Tool activity") { Text(message["content"]?.text ?? "").font(.caption).textSelection(.enabled) }
                .padding().homesteadPanel(radius: 16)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(role == "user" ? "You" : "Homestead").font(.caption.bold()).foregroundStyle(.secondary)
                Text(message["content"]?.text ?? "").textSelection(.enabled)
                if let calls = message["toolCalls"], !calls.list.isEmpty {
                    DisclosureGroup("Proposed actions") { Text(AIContract.pretty(calls)).font(.caption.monospaced()).textSelection(.enabled) }
                }
                ForEach(Array((message["attachments"]?.list ?? []).enumerated()), id: \.offset) { _, asset in Label(asset["name"]?.text ?? "Attachment", systemImage: "paperclip").font(.caption) }
            }.padding().frame(maxWidth: .infinity, alignment: .leading).homesteadPanel(radius: 18)
        }
    }
    private func confirmationView(_ confirmation: IndexValue) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Review proposed actions", systemImage: "exclamationmark.shield").font(.headline)
            ForEach(Array((confirmation["actions"]?.list ?? []).enumerated()), id: \.offset) { _, action in
                VStack(alignment: .leading, spacing: 6) {
                    Text(action["summary"]?.text ?? "Action").font(.subheadline.bold())
                    Text((action["tool"]?.text ?? "") + " · " + (action["risk"]?.text ?? "")).font(.caption)
                    DisclosureGroup("Arguments") { Text(AIContract.pretty(action["arguments"] ?? .object([:]))).font(.caption.monospaced()).textSelection(.enabled) }
                }
            }
            HStack {
                Button("Reject", role: .cancel) { Task { await decide(false) } }
                Button("Approve & execute") { approve = true }.buttonStyle(.borderedProminent)
            }.disabled(busy)
        }.padding().homesteadPanel(radius: 18)
    }
    private func request(_ suffix: String, method: String = "GET", body: Data? = nil) async throws -> IndexValue {
        try Task.checkCancellation()
        guard !concealed, !client.isClosed else { throw CompanionError.unauthorized }
        let response: IndexValue = try await client.request(AIContract.root + suffix, method: method, body: body, timeout: method == "GET" ? 20 : 120)
        guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "AI request failed.") }
        try Task.checkCancellation()
        guard !concealed, !client.isClosed else { throw CancellationError() }
        return response
    }
    private func load() async {
        guard !busy, !concealed else { return }
        busy = true; error = nil
        defer { busy = false }
        var failures: [String] = []
        do { catalog = try await request("/models") }
        catch { failures.append("Models: " + errorMessage(error)) }
        do { conversations = try await request("/conversations")["conversations"]?.list ?? [] }
        catch { failures.append("History: " + errorMessage(error)) }
        do { config = try await request("/config")["config"] ?? .object([:]) }
        catch { failures.append("Configuration: " + errorMessage(error)) }
        if let current = conversation, let id = AIContract.safeID(current["id"]?.text) {
            do { conversation = try await request("/conversations/" + id)["conversation"] }
            catch { failures.append(errorMessage(error)) }
        }
        if !concealed && !Task.isCancelled { self.error = failures.isEmpty ? nil : failures.joined(separator: "\n") }
    }
    private func open(_ item: IndexValue) async {
        guard let id = AIContract.safeID(item["id"]?.text), !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            conversation = try await request("/conversations/" + id)["conversation"]
            if conversation?["mode"]?.text == "chat" {
                let provider: String = conversation?["model"]?["provider"]?.text ?? ""
                let model: String = conversation?["model"]?["model"]?.text ?? ""
                selection = "chat:" + provider + ":" + model
            } else { selection = "assistant" }
            attachments = []
        } catch { self.error = errorMessage(error) }
    }
    private func send() async {
        guard !busy, pending == nil, !concealed else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let body = try AIContract.body(message: draft, conversationID: conversation?["id"]?.text,
                choice: choice, attachments: attachments.compactMap { $0["id"]?.text })
            let response = try await request("/chat", method: "POST", body: body)
            pending = response["status"]?.text == "confirmation_required" ? response["confirmation"] : nil
            draft = ""; attachments = []
            if let id = AIContract.safeID(response["conversationId"]?.text) { conversation = try await request("/conversations/" + id)["conversation"] }
            conversations = try await request("/conversations")["conversations"]?.list ?? []
        } catch { self.error = errorMessage(error) }
    }
    private func decide(_ approved: Bool) async {
        guard !busy, let id = AIContract.safeID(pending?["id"]?.text) else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["approved": approved])
            let response = try await request("/confirmations/" + id, method: "POST", body: body)
            pending = response["status"]?.text == "confirmation_required" ? response["confirmation"] : nil
            if let conversationID = AIContract.safeID(response["conversationId"]?.text) { conversation = try await request("/conversations/" + conversationID)["conversation"] }
        } catch { self.error = errorMessage(error) }
    }
    private func attach(_ url: URL) async {
        guard !busy, choice.mode == "assistant", pending == nil else { return }
        busy = true; error = nil
        defer { busy = false }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let configuredBytes: Int = Int(config["limitations"]?["maxAttachmentBytes"]?.text ?? "") ?? 10 * 1024 * 1024
            let limit: Int = min(25 * 1024 * 1024, configuredBytes)
            let attachmentLimit: Int = Int(config["limitations"]?["maxAttachmentsPerMessage"]?.text ?? "") ?? 4
            guard attachments.count < attachmentLimit else { throw CompanionError.message("This message has reached its attachment limit.") }
            guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= limit else { throw CompanionError.message("Attachment exceeds the configured size limit.") }
            let data = try Data(contentsOf: url)
            guard data.count <= limit else { throw CompanionError.message("Attachment exceeds the configured size limit.") }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            let body = try JSONSerialization.data(withJSONObject: ["name": url.lastPathComponent, "mimeType": mime, "dataBase64": data.base64EncodedString()])
            let response = try await request("/assets", method: "POST", body: body)
            if let asset = response["asset"] { attachments.append(asset) }
        } catch { self.error = errorMessage(error) }
    }
    private func renameConversation() async {
        guard !busy, let id = AIContract.safeID(conversation?["id"]?.text) else { return }
        busy = true
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["title": newTitle])
            conversation = try await request("/conversations/" + id, method: "PATCH", body: body)["conversation"]
            conversations = try await request("/conversations")["conversations"]?.list ?? []
        } catch { self.error = errorMessage(error) }
    }
    private func removeConversation() async {
        guard !busy, let id = AIContract.safeID(conversation?["id"]?.text) else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await request("/conversations/" + id, method: "DELETE")
            conversation = nil; attachments = []
            conversations = try await request("/conversations")["conversations"]?.list ?? []
        } catch { self.error = errorMessage(error) }
    }
    private func errorMessage(_ error: Error) -> String {
        if error.localizedDescription.lowercased().contains("fetch failed") {
            return "Homestead AI could not reach its configured service or model provider. Check the server-side AI connection. ComfyUI images use Images → Image settings."
        }
        return error.localizedDescription
    }
}

private struct NativeAISettings: View {
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    @State private var response: IndexValue = .object([:])
    @State private var draft = ""
    @State private var busy = false
    @State private var error: String?
    @State private var sharedSecret = ""
    private var admin: Bool { response["principal"]?["role"]?.text == "admin" }
    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.orange) }
                configurationSection
                if admin { serviceSection }
                toolsSection
            }.navigationTitle("AI Settings").toolbar { Button("Close") { dismiss() }.disabled(busy) }
                .task { await loadConfiguration() }
        }.interactiveDismissDisabled(busy)
    }
    private var configurationSection: some View {
        Section("AI configuration") {
            if admin {
                TextField("Assistant name", text: stringField(["behavior", "assistantName"]))
                TextField("Service URL", text: stringField(["service", "url"])).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Provider", text: stringField(["model", "provider"])).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Model", text: stringField(["model", "model"])).textInputAutocapitalization(.never).autocorrectionDisabled()
                DisclosureGroup("Advanced settings") {
                    TextEditor(text: $draft).font(.caption.monospaced()).frame(minHeight: 350).disabled(busy)
                }
                Button("Save configuration") { Task { await save() } }.disabled(busy)
            } else { Text(AIContract.pretty(response["config"] ?? .object([:]))).font(.caption.monospaced()).textSelection(.enabled) }
        }
    }
    private var serviceSection: some View {
        Section("Service connection") {
            SecureField("Shared secret", text: $sharedSecret).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Save shared secret") { Task { await saveSecret() } }.disabled(busy || sharedSecret.isEmpty)
        }
    }
    private var toolsSection: some View {
        Section("Available tools") {
            ForEach(Array((response["tools"]?.list ?? []).enumerated()), id: \.offset) { _, tool in
                VStack(alignment: .leading) {
                    Text(tool["name"]?.text ?? "Tool").font(.headline)
                    Text(tool["description"]?.text ?? "").font(.caption)
                    if admin, let name = tool["name"]?.text {
                        Toggle("Enabled", isOn: boolField(["permissions", "tools", name, "enabled"]))
                        Picker("Approval", selection: stringField(["permissions", "tools", name, "confirmation"])) {
                            Text("Ask every time").tag("always"); Text("Use configured access").tag("never")
                        }
                    }
                }
            }
        }
    }
    private func loadConfiguration() async {
        busy = true
        defer { busy = false }
        do {
            response = try await client.request(AIContract.root + "/config")
            draft = AIContract.pretty(response["config"] ?? .object([:]))
        } catch { self.error = error.localizedDescription }
    }
    private func save() async {
        guard admin, !busy, let data = draft.data(using: .utf8) else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let value = try JSONSerialization.jsonObject(with: data)
            guard value is [String: Any] else { throw CompanionError.message("Configuration must be a JSON object.") }
            let body = try JSONSerialization.data(withJSONObject: ["config": value])
            let saved: IndexValue = try await client.request(AIContract.root + "/config", method: "PUT", body: body)
            guard saved["ok"]?.flag == true else { throw CompanionError.message(saved["message"]?.text ?? "Configuration was not saved.") }
            draft = AIContract.pretty(saved["config"] ?? .object([:]))
            var fields = saved.fields; fields["principal"] = response["principal"]; response = .object(fields)
        } catch { self.error = error.localizedDescription }
    }
    private var configuration: IndexValue { (try? JSONDecoder().decode(IndexValue.self, from: Data(draft.utf8))) ?? .object([:]) }
    private func field(_ path: [String]) -> IndexValue? { path.reduce(Optional(configuration)) { $0?[$1] } }
    private func stringField(_ path: [String]) -> Binding<String> {
        Binding(get: { field(path)?.text ?? "" }, set: { draft = AIContract.pretty(AIContract.setting(configuration, path: path, value: .string($0))) })
    }
    private func boolField(_ path: [String]) -> Binding<Bool> {
        Binding(get: { field(path)?.flag == true }, set: { draft = AIContract.pretty(AIContract.setting(configuration, path: path, value: .bool($0))) })
    }
    private func saveSecret() async {
        guard admin, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["sharedSecret": sharedSecret])
            let saved: BasicResponse = try await client.request(AIContract.root + "/config/shared-secret", method: "POST", body: body)
            guard saved.ok else { throw CompanionError.message("Shared secret was not saved.") }
            sharedSecret = ""
        } catch { self.error = error.localizedDescription }
    }
}
