import SwiftUI

struct MediaRequestControls: View {
    let target: MediaRequestTarget
    let title: String
    let client: HomesteadClient
    var initialSeason: Int? = nil
    @State private var status = ""
    @State private var seasons: [Int] = []
    @State private var selected = Set<Int>()
    @State private var bookFormat = "ebook"
    @State private var busy = false
    @State private var checked = false
    @State private var attempted = false
    @State private var message: String?
    @State private var confirm = false
    @State private var lifecycle: IndexValue = .object([:])

    private var canRequest: Bool {
        checked && !busy && !attempted && (["discovery", "missing", "not-requested", "not-owned"].contains(status) || (target.kind == "tv" && status == "partial"))
            && (target.kind != "tv" || !selected.isEmpty)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(status.isEmpty ? "Checking request status…" : status.replacingOccurrences(of: "-", with: " ").capitalized)
                .font(.headline)
            if let value = lifecycle["progress"]?.text, let progress = Double(value), progress.isFinite {
                ProgressView(value: max(0, min(100, progress)), total: 100)
                Text("\(Int(max(0, min(100, progress))))%").font(.caption)
            }
            if let description = lifecycle["message"]?.text { Text(description).font(.subheadline) }
            if let eta = lifecycle["eta"]?.text { Text("ETA: " + eta).font(.caption).foregroundStyle(.secondary) }
            if busy { HomesteadLoadingCard(message: "Working…") }
            if let message { Text(message).font(.footnote) }
            if target.kind == "tv" && !attempted {
                ForEach(seasons, id: \.self) { season in
                    Toggle("Season \(season)", isOn: Binding(get: { selected.contains(season) }, set: { enabled in
                        if enabled { selected.insert(season) } else { selected.remove(season) }
                    })).disabled(busy)
                }
            }
            if target.kind == "book" {
                Picker("Format", selection: $bookFormat) {
                    Text("Ebook").tag("ebook")
                    Text("Audiobook").tag("audiobook")
                    Text("Both").tag("both")
                }.disabled(busy || attempted)
            }
            Button("Request") { confirm = true }.buttonStyle(.borderedProminent).disabled(!canRequest)
            Button("Refresh status") { Task { await refresh() } }.disabled(busy)
            if attempted { Text("Use Add → Requests to follow progress. Requests are not automatically retried.").font(.footnote).foregroundStyle(.secondary) }
        }
        .task {
            await refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                await refresh()
            }
        }
        .confirmationDialog("Request \(title)?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Send request") { Task { await submit() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(target.kind == "tv" ? "Selected seasons: \(selected.sorted().map(String.init).joined(separator: ", "))" : "Homestead will send this to your configured request service.")
        }
    }
    @MainActor private func refresh() async {
        guard !busy else { return }
        busy = true; checked = false; message = nil
        defer { busy = false }
        do {
            if target.seerr {
                let path = "api/integrations/seerr/media/\(target.kind)/\(target.providerID)/status"
                let response: IndexValue = try await client.request(path)
                guard response["ok"]?.flag == true else { throw CompanionError.message("Unable to check request status.") }
                lifecycle = response["lifecycle"] ?? .object([:])
                status = lifecycle["status"]?.text ?? "unknown"
                let rows = response["seasons"]?.list ?? []
                seasons = rows.compactMap { row in
                    guard ["available", "partial"].contains(row["status"]?.text ?? "") else { return nil }
                    guard let number = row["seasonNumber"]?.text, let value = Int(number), value > 0 else { return nil }
                    return value
                }
                if selected.isEmpty {
                    selected = initialSeason.flatMap { seasons.contains($0) ? Set([$0]) : nil } ?? Set(seasons)
                } else { selected = selected.intersection(seasons) }
            } else {
                let response: IndexValue = try await client.request("api/acquisition/jobs", query: [URLQueryItem(name: "refresh", value: "true")])
                guard response["ok"]?.flag == true else { throw CompanionError.message("Unable to check acquisition status.") }
                let matching = (response["jobs"]?.list ?? []).first {
                    $0["providerId"]?.text == target.providerID && $0["provider"]?.text == target.item["provider"]?.text
                }
                status = matching?["status"]?.text ?? target.item["status"]?.text ?? "discovery"
            }
            checked = true
        } catch { message = error.localizedDescription }
    }
    @MainActor private func submit() async {
        guard canRequest else { return }
        busy = true; attempted = true; message = nil
        defer { busy = false }
        do {
            let body = try target.body(title: title, seasons: selected, bookFormat: bookFormat)
            let response: IndexValue = try await client.request(target.path, method: "POST", body: body)
            guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Request was not accepted.") }
            status = response["job"]?["status"]?.text ?? "requested"
            message = response["warning"]?.text ?? "Request accepted by your server."
        } catch {
            message = error.localizedDescription + " Check Requests before trying again; the provider may have received it."
        }
    }
}

struct RequestQueuePage: View {
    @Environment(\.adultHidden) private var adultHidden
    let client: HomesteadClient
    @State private var rows: [IndexValue] = []
    @State private var warnings: [String] = []
    @State private var busy = false
    @State private var error: String?
    @State private var live = false
    @State private var failures = 0
    var body: some View {
        List {
            if busy { HomesteadLoadingCard(message: rows.isEmpty ? "Loading saved requests…" : "Updating live progress…") }
            if !live && !rows.isEmpty { Text("Saved requests — live progress has not refreshed yet.").font(.footnote).foregroundStyle(.secondary) }
            if let error { Text(error).foregroundStyle(.orange) }
            ForEach(warnings, id: \.self) { Text($0).font(.footnote).foregroundStyle(.orange) }
            ForEach(Array(rows.filter { !adultHidden || AdultVisibilityPolicy.safeLibrary($0["library"]?.text ?? "") }.enumerated()), id: \.offset) { _, row in
                NavigationLink {
                    NativeSearchDetails(hit: SearchPresentation.requestHit(row), client: client)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        NativeSearchResultRow(hit: SearchPresentation.requestHit(row), client: client)
                        if let message = row["message"]?.text { Text(message).font(.footnote) }
                        if let progress = row["progress"]?.text { Text("Progress: \(progress)%").font(.caption) }
                    }
                }
            }
            if rows.isEmpty && !busy && error == nil { Text("No requests for this account yet.") }
        }.navigationTitle("Requests").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Refresh") { Task { await refresh() } }.disabled(busy) }
            .refreshable { await refresh() }
            .task {
                rows = client.requestSnapshot
                await refresh()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(failures > 0 ? 60 : 30)) } catch { return }
                    await refresh()
                }
            }
    }
    @MainActor private func refresh() async {
        guard !busy, !Task.isCancelled else { return }
        busy = true; error = nil
        defer { busy = false }
        if rows.isEmpty {
            do {
                let session: IndexValue = try await client.request("api/auth/session", timeout: 8)
                let config: IndexValue = try await client.request("api/setup-config", timeout: 8)
                let user = session["user"]
                let all = session["authEnabled"]?.flag == false || user?["role"]?.text == "owner"
                let permissions = user?["allowedLibraries"]?.list.compactMap(\.text) ?? []
                let allowed: Set<String> = Set((config["enabledLibraries"]?.fields ?? [:]).compactMap { key, value in
                    value.flag == true && (all || permissions.contains("*") || permissions.contains(key)) ? key : nil
                })
                let saved: IndexValue = try await client.request("api/requests", timeout: 8)
                try Task.checkCancellation()
                rows = RequestSnapshot.rows(saved, allowed: allowed)
                client.requestSnapshot = rows
                do {
                    let jobs: IndexValue = try await client.request("api/acquisition/jobs", timeout: 8)
                    try Task.checkCancellation()
                    rows += RequestSnapshot.jobs(jobs, userID: user?["id"]?.text ?? "", owner: user?["role"]?.text == "owner", allowed: allowed)
                    client.requestSnapshot = rows
                } catch {
                    if Task.isCancelled { return }
                    warnings = ["Saved book/music jobs could not refresh."]
                }
            } catch {
                if Task.isCancelled { return }
                if case CompanionError.unauthorized = error { self.error = error.localizedDescription; return }
                self.error = "Saved requests could not load: " + error.localizedDescription
            }
        }
        do {
            let result: IndexValue = try await client.request("api/requests/status", timeout: 8)
            try Task.checkCancellation()
            guard result["ok"]?.flag == true else { throw CompanionError.message("Request status is unavailable.") }
            rows = result["rows"]?.list ?? []
            client.requestSnapshot = rows
            live = true; failures = 0; error = nil
            warnings = result["warnings"]?.list.compactMap(\.text) ?? []
        } catch {
            if !Task.isCancelled {
                if case CompanionError.unauthorized = error {
                    rows = []; client.requestSnapshot = []; live = false
                    self.error = error.localizedDescription
                    failures += 1
                    return
                }
                live = false; failures += 1
                self.error = "Live status is unavailable. Saved results are retained; retrying in one minute. " + error.localizedDescription
            }
        }
    }
}
