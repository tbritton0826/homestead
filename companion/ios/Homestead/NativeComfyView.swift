import SwiftUI
import UIKit

struct NativeComfyView: View {
    let client: HomesteadClient
    @Environment(\.scenePhase) private var scenePhase
    @State private var prompt = ""
    @State private var jobID = ""
    @State private var jobKey: String?
    @State private var state = ""
    @State private var imageCount = 0
    @State private var error: String?
    @State private var busy = false
    @State private var showSettings = false
    @State private var forget = false
    @State private var restoring = false
    @State private var workflowReady = false
    private var pollKey: String { jobID + ":" + state + ":" + String(scenePhase == .active) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("ComfyUI Images").font(.title2.bold()); Spacer()
                    Button { showSettings = true } label: { Image(systemName: "gearshape").frame(width: 44, height: 44) }.accessibilityLabel("Image settings")
                }
                Text("Run your configured ComfyUI workflow through Homestead. Generated images remain in ComfyUI; automatic library filing is planned separately.").font(.footnote).foregroundStyle(.secondary)
                if !workflowReady { Text("Open Image settings to connect ComfyUI and add a workflow before generating.").font(.footnote) }
                TextField("Describe the image", text: $prompt, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
                Button("Generate image") { Task { await generate() } }
                    .buttonStyle(.borderedProminent).disabled(busy || restoring || !workflowReady || jobKey == nil || !jobID.isEmpty || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let error { Text(error).foregroundStyle(.orange); Button("Retry connection") { Task { await restore() } }.disabled(busy || restoring) }
                if !jobID.isEmpty {
                    Text(state == "queued" ? "Queued or generating…" : state.capitalized).font(.headline)
                    if state == "uncertain" { Text("The submission response was interrupted. Check the ComfyUI queue before starting another job; Homestead will not submit it again automatically.").font(.footnote) }
                    Button("Refresh job") { Task { await refresh() } }.disabled(busy)
                    if ["complete", "failed", "uncertain"].contains(state) { Button("Clear this job") { forget = true }.disabled(busy) }
                    ForEach(0..<imageCount, id: \.self) { index in NativeComfyImage(client: client, job: jobID, index: index) }
                }
            }.padding()
        }
        .task { await restore() }
        .task(id: pollKey) { await poll() }
        .sheet(isPresented: $showSettings, onDismiss: { Task { await restore() } }) { NativeComfySettings(client: client) }
        .confirmationDialog("Remove this job from Homestead? This does not cancel or delete anything in ComfyUI. Check its queue before submitting another job.", isPresented: $forget, titleVisibility: .visible) {
            Button("Clear job", role: .destructive) { Task { await clear() } }
        }
        .homesteadLoading(busy, message: "Working…")
    }
    private func request(_ suffix: String, method: String = "GET", body: Data? = nil) async throws -> IndexValue {
        let response: IndexValue = try await client.request("api/ai/comfy" + suffix, method: method, body: body)
        guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Image service unavailable. Install the v3.7 server support.") }
        return response
    }
    private func restore() async {
        guard !restoring else { return }; restoring = true; defer { restoring = false }
        do {
            let response = try await request("/config")
            guard let user = response["userID"]?.text else { return }
            workflowReady = response["workflowReady"]?.flag == true
            let key = AppearancePreferences.storageKey(server: client.baseURL.absoluteString, user: user) + ".comfy.job"
            jobKey = key; jobID = UserDefaults.standard.string(forKey: key) ?? ""
            error = nil
            if !jobID.isEmpty { await refresh() }
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func apply(_ response: IndexValue) {
        state = response["state"]?.text ?? "uncertain"
        imageCount = min(8, Int(response["imageCount"]?.text ?? "0") ?? 0)
    }
    private func generate() async {
        guard !busy, jobID.isEmpty, jobKey != nil else { return }; busy = true; error = nil
        defer { busy = false }
        let id = UUID().uuidString
        jobID = id; state = "uncertain"
        if let jobKey { UserDefaults.standard.set(id, forKey: jobKey) }
        do {
            let body = try JSONEncoder().encode(["requestId": id, "prompt": prompt])
            apply(try await request("/jobs", method: "POST", body: body))
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func refresh() async {
        guard !jobID.isEmpty, !busy else { return }; busy = true; defer { busy = false }
        do { apply(try await request("/jobs/" + jobID)); error = nil }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func poll() async {
        guard scenePhase == .active, !jobID.isEmpty else { return }
        for _ in 0..<600 {
            do { try await Task.sleep(for: .seconds(3)); try Task.checkCancellation() } catch { return }
            if state != "queued" { return }
            await refresh()
            if error != nil { return }
        }
    }
    private func clear() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            _ = try await request("/jobs/" + jobID, method: "DELETE")
            if let jobKey { UserDefaults.standard.removeObject(forKey: jobKey) }
            jobID = ""; state = ""; imageCount = 0; error = nil
        } catch { self.error = error.localizedDescription }
    }
}

private struct NativeComfyImage: View {
    let client: HomesteadClient
    let job: String
    let index: Int
    @State private var image: UIImage?
    @State private var error: String?
    @State private var attempt = 0
    var body: some View {
        VStack {
            if let image { Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("Generated image \(index + 1)") }
            else if let error { Text(error); Button("Retry image") { attempt += 1 } }
            else { HomesteadLoadingCard(message: "Loading image…") }
        }.task(id: job + ":" + String(attempt)) {
            do {
                let data = try await client.generatedImage(job: job, index: index)
                let decoded = await Task.detached { NativeImageDecoder.thumbnail(data, maximumPixelSize: 1600) }.value
                try Task.checkCancellation()
                guard let decoded else { throw CompanionError.message("This image could not be displayed.") }
                image = UIImage(cgImage: decoded); error = nil
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
}

private struct NativeComfySettings: View {
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var promptNode = ""
    @State private var workflow = ""
    @State private var owner = false
    @State private var busy = false
    @State private var message: String?
    var body: some View {
        NavigationStack {
            Form {
                if let message { Text(message).textSelection(.enabled) }
                if owner {
                    Section {
                        TextField("ComfyUI address, e.g. http://comfyui:8188", text: $url).textInputAutocapitalization(.never).autocorrectionDisabled()
                        TextField("Positive prompt node ID", text: $promptNode).textInputAutocapitalization(.never)
                        TextEditor(text: $workflow).font(.caption.monospaced()).frame(minHeight: 200)
                        Button("Save and test connection") { Task { await save() } }.disabled(busy)
                    } header: { Text("ComfyUI connection") } footer: {
                        Text("Use the address reachable from the Homestead server. Export a trusted ComfyUI workflow in API format and paste it here. Set the node ID whose text input should receive your prompt. Model and other workflow settings stay as exported. Chat providers use the separate AI settings.")
                    }
                } else { Text("The server owner configures the ComfyUI address and workflow.") }
            }.homesteadCanvas().navigationTitle("Image settings")
                .toolbar { Button("Done") { dismiss() }.disabled(busy) }
                .task { await load() }
        }.interactiveDismissDisabled(busy)
    }
    private func load() async {
        busy = true; defer { busy = false }
        do {
            let response: IndexValue = try await client.request("api/ai/comfy/config")
            owner = response["canConfigure"]?.flag == true
            url = response["config"]?["url"]?.text ?? ""
            promptNode = response["config"]?["promptNode"]?.text ?? ""
            if let graph = response["config"]?["workflow"] { workflow = AIContract.pretty(graph) }
            else { workflow = "" }
        } catch { message = error.localizedDescription }
    }
    private func save() async {
        guard !busy, owner else { return }; busy = true; defer { busy = false }
        do {
            let graph: Any
            if workflow.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { graph = NSNull() }
            else { graph = try JSONSerialization.jsonObject(with: Data(workflow.utf8)) }
            let body = try JSONSerialization.data(withJSONObject: ["url": url, "promptNode": promptNode, "workflow": graph])
            let saved: IndexValue = try await client.request("api/ai/comfy/config", method: "PUT", body: body)
            guard saved["ok"]?.flag == true else { throw CompanionError.message("Configuration was not saved.") }
            let tested: IndexValue = try await client.request("api/ai/comfy/test", method: "POST")
            message = tested["message"]?.text ?? "Connection tested."
        } catch { message = error.localizedDescription }
    }
}
