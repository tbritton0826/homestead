import SwiftUI
import PhotosUI

@MainActor
struct NativeTcgQueueWizard: View {
    let client: HomesteadClient
    var wishlistOnly = false
    @Environment(\.dismiss) private var dismiss
    @State private var draft = NativeInventoryDraft()
    @State private var photos: [InventoryPhoto] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var queue: [InventoryQueueEntry] = []
    @State private var editingID = UUID()
    @State private var requestID = UUID()
    @State private var stage = 0
    @State private var name = ""
    @State private var setCode = ""
    @State private var passcode = ""
    @State private var matches: [IndexValue] = []
    @State private var locations: [IndexValue] = []
    @State private var canEdit = false
    @State private var busy = false
    @State private var message: String?
    @State private var showLocation = false
    @State private var recoveryFile: URL?
    @State private var savedBody: Data?
    @State private var status: IndexValue?
    @State private var showCamera = false
    @State private var cameraData: Data?
    var body: some View {
        NavigationStack {
            Form {
                if let message { Text(message).foregroundStyle(.orange).textSelection(.enabled) }
                if savedBody != nil { saveStatus }
                else if canEdit {
                    if stage == 0 { search }
                    else if stage == 1 { printing }
                    else { summary }
                } else if !busy { Text("Install the v3.12 server update and use an Inventory administrator account.") }
            }.disabled(busy).scrollDismissesKeyboard(.interactively).homesteadCanvas()
                .navigationTitle(wishlistOnly ? "Add to Wishlist" : "Add card printings").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(busy) } }
                .interactiveDismissDisabled(busy)
                .task { await prepare() }
                .sheet(isPresented: $showLocation) {
                    InventoryLocationEditor(client: client) { row in
                        locations.append(row); chooseLocation(row)
                    }
                }
                .fullScreenCover(isPresented: $showCamera, onDismiss: {
                    if let data = cameraData { cameraData = nil; Task { await recognize(data) } }
                }) { InventoryCardCamera { data in cameraData = data; showCamera = false } }
                .onChange(of: pickerItems) { _, items in Task { await loadPhotos(items) } }
        }
        .homesteadLoading(busy, message: "Saving printings…")
    }
    private var search: some View {
        Group {
            Section("Find a card once, then choose printings") {
                TextField("Card name", text: $name)
                TextField("Or set code", text: $setCode).textInputAutocapitalization(.characters).autocorrectionDisabled()
                TextField("Or passcode", text: $passcode).keyboardType(.numberPad)
                if draft.card && !draft.title.isEmpty { Button("Continue editing current printing") { stage = 1 } }
                Button("Search cards and printings") { Task { await lookup() } }
                Button { showCamera = true } label: { Label("Recognize card with camera", systemImage: "camera.viewfinder") }
                Button("Enter a card manually") { draft = NativeInventoryDraft(); draft.category = "trading-cards"; draft.title = name; editingID = UUID(); photos = []; stage = 1 }
            }
            if !queue.isEmpty { Section { Button("Review \(queue.count) queued printings") { stage = 2 } } }
            Section("Printings") {
                ForEach(Array(matches.enumerated()), id: \.offset) { _, match in
                    Button {
                        draft = NativeInventoryDraft(); draft.applyCard(match); draft.location = "Loose Cards"
                        photos = []; editingID = UUID(); stage = 1
                    } label: { TcgPrintingMatchRow(match: match, client: client) }.buttonStyle(.plain)
                }
            }
        }
    }
    private var printing: some View {
        Group {
            Section("Card") { TextField("Card name", text: $draft.title) }
            InventoryItemFields(draft: $draft, allowCategory: false)
            InventoryPrintingFields(draft: $draft, binders: [], decks: [], locations: locations, client: client)
            Section("Storage") { Button("Create a deck, binder or location") { showLocation = true } }
            Section("Artwork") {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(Array((draft.selectedPrinting["artworkVariants"]?.list ?? []).enumerated()), id: \.offset) { _, row in
                            Button { draft.artwork = row["image"]?.text ?? ""; draft.artworkID = row["id"]?.text ?? "" } label: {
                                NativeArtwork(path: row["thumbnail"]?.text ?? row["image"]?.text, client: client).frame(width: 70, height: 100)
                                    .overlay { RoundedRectangle(cornerRadius: 6).stroke(draft.artworkID == row["id"]?.text ? Color.accentColor : Color.clear, lineWidth: 3) }
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
            Section("Photos for this printing group") {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: max(1, 4 - photos.count), matching: .images) { Label("Add front, back or condition photos", systemImage: "photo.badge.plus") }.disabled(photos.count >= 4)
                ForEach(photos) { photo in
                    HStack {
                        if let image = UIImage(data: photo.data) { Image(uiImage: image).resizable().scaledToFit().frame(width: 45, height: 60) }
                        Text(photo.name).font(.caption)
                        Spacer(); Button("Remove") { photos.removeAll { $0.id == photo.id } }.buttonStyle(.borderless)
                    }
                }
            }
            Section("Notes") { TextField("Notes", text: $draft.notes, axis: .vertical) }
            Section {
                HStack {
                    Button("Back") { stage = 0 }
                    Spacer()
                    Button(wishlistOnly ? "Add wanted card" : "Add printing to queue") {
                        if wishlistOnly { Task { await saveWish() } } else { enqueue() }
                    }.disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }.buttonStyle(.borderless)
            }
        }
    }
    private var summary: some View {
        Group {
            Section("Review all copies") {
                Text("\(queue.count) printing groups · \(queue.reduce(0) { $0 + $1.draft.quantity }) copies")
                ForEach(queue) { entry in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(entry.draft.title).font(.headline)
                        Text([entry.draft.setCode, entry.draft.rarity, entry.draft.edition, entry.draft.condition].joined(separator: " · ")).font(.caption)
                        Text("\(entry.draft.quantity) copies · \(entry.draft.location.isEmpty ? "Loose Cards" : entry.draft.location) · \(entry.photos.count) photos")
                        HStack {
                            Button("Edit") { draft = entry.draft; photos = entry.photos; editingID = entry.id; stage = 1 }
                            Spacer(); Button("Remove", role: .destructive) { queue.removeAll { $0.id == entry.id } }
                        }.buttonStyle(.borderless)
                    }
                }
            }
            Section {
                HStack {
                    Button("Choose more printings") { stage = 0 }
                    Spacer(); Button("Add all copies") { Task { await saveQueue() } }.disabled(queue.isEmpty)
                }.buttonStyle(.borderless)
            }
        }
    }
    private var saveStatus: some View {
        Section("Queue save status") {
            Text(status?["state"]?.text == "complete" ? "All copies saved to Inventory and its share." : "Some copies may already be saved. Check status before starting another queue.")
            ForEach(Array((status?["entries"]?.list ?? []).enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 4) {
                    Text((row["record"]?["title"]?.text ?? "Printing group") + " · " + (row["state"]?.text ?? "Pending"))
                    if let text = row["message"]?.text, !text.isEmpty { Text(text).font(.caption).foregroundStyle(.secondary) }
                }
            }
            if status?["state"]?.text == "complete" {
                Button("Add more cards") { savedBody = nil; status = nil; queue = []; requestID = UUID(); stage = 0 }
            } else {
                Button("Check save status") { Task { await checkStatus() } }
                if (status?["entries"]?.list ?? []).contains(where: { $0["state"]?.text == "uncertain" && $0["record"] != nil }) {
                    Button("Repair share files for saved entries") { Task { await repairShare() } }
                }
                Button("Retry unsaved groups") { Task { await sendQueue(retry: true) } }
                Text("Saved groups are skipped. An unconfirmed share write is held for review so copies cannot be added twice.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func chooseLocation(_ row: IndexValue) {
        draft.locationID = row["id"]?.text ?? "loose"; draft.locationType = row["kind"]?.text ?? "loose"
        draft.location = row["name"]?.text ?? "Loose Cards"; draft.binderID = draft.locationType == "binder" ? draft.locationID : ""
    }
    private func enqueue() {
        do {
            _ = try draft.fields(); _ = try NativeInventoryDraft.money(draft.marketValue)
            let entry = InventoryQueueEntry(id: editingID, draft: draft, photos: photos)
            if let index = queue.firstIndex(where: { $0.id == editingID }) { queue[index] = entry }
            else { guard queue.count < 30 else { throw CompanionError.message("Save this queue before adding more printings.") }; queue.append(entry) }
            message = nil; stage = 2
        } catch { message = error.localizedDescription }
    }
    private func prepare() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let result: IndexValue = try await client.request("api/inventory/native", timeout: 60)
            try Task.checkCancellation()
            canEdit = result["canEdit"]?.flag == true && result["capabilities"]?["printingQueue"]?.flag == true
            locations = result["locations"]?.list ?? []
            guard let account = result["accountId"]?.text else { canEdit = false; return }
            let scope = AppearancePreferences.storageKey(server: client.baseURL.absoluteString, user: account)
            recoveryFile = try InventoryQueueRecovery.file(scope: scope)
            if !wishlistOnly, let file = recoveryFile, FileManager.default.fileExists(atPath: file.path) {
                let bytes = try Data(contentsOf: file)
                guard bytes.count <= 40 * 1024 * 1024, let row = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                      let value = row["requestId"] as? String, let id = UUID(uuidString: value) else { throw CompanionError.message("The saved queue needs review before adding more copies.") }
                requestID = id; savedBody = bytes
            }
        } catch { message = error.localizedDescription }
        if savedBody != nil { busy = false; await checkStatus() }
    }
    private func lookup() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let query = InventoryCardSearch.queryItems(name: name, setCode: setCode, passcode: passcode)
            let result: IndexValue = try await client.request("api/inventory/native/cards", query: query, timeout: 60)
            guard result["ok"]?.flag == true else { throw CompanionError.message("Card search failed.") }
            matches = result["matches"]?.list ?? []
            message = matches.isEmpty ? "No match found. Try another name or enter the card manually." : nil
        } catch { message = error.localizedDescription }
    }
    private func recognize(_ data: Data) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            guard data.count <= 64 * 1024 * 1024,
                  let image = await Task.detached(priority: .utility, operation: { NativeImageDecoder.thumbnail(data, maximumPixelSize: 2200) }).value,
                  let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.8), jpeg.count <= 2 * 1024 * 1024 else { throw CompanionError.message("Choose a smaller card photo.") }
            let body = try JSONSerialization.data(withJSONObject: ["imageData": "data:image/jpeg;base64," + jpeg.base64EncodedString()])
            let result: IndexValue = try await client.request("api/inventory/native/recognize", method: "POST", body: body, timeout: 75)
            guard result["ok"]?.flag == true else { throw CompanionError.message("Recognition failed. Search by name or set code.") }
            matches = result["matches"]?.list ?? []; message = result["message"]?.text
        } catch { message = error.localizedDescription }
    }
    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        guard !busy, !items.isEmpty else { return }; busy = true; defer { busy = false; pickerItems = [] }
        do {
            for item in items.prefix(max(0, 4 - photos.count)) {
                guard let data = try await item.loadTransferable(type: Data.self), data.count <= 64 * 1024 * 1024,
                      let image = await Task.detached(priority: .utility, operation: { NativeImageDecoder.thumbnail(data, maximumPixelSize: 1800) }).value,
                      let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.75), jpeg.count <= 2 * 1024 * 1024 else { throw CompanionError.message("A photo could not be prepared.") }
                try Task.checkCancellation()
                guard photos.reduce(0, { $0 + $1.data.count }) + jpeg.count <= 6 * 1024 * 1024 else { throw CompanionError.message("Choose fewer or smaller photos for this printing.") }
                photos.append(InventoryPhoto(id: UUID(), name: "card-\(photos.count + 1).jpg", data: jpeg))
            }
        } catch { message = error.localizedDescription }
    }
    private func saveQueue() async {
        do {
            let data = try InventoryQueueEntry.body(queue, requestID: requestID)
            guard let file = recoveryFile else { throw CompanionError.message("The save recovery location is unavailable. Reopen Inventory.") }
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            savedBody = data; await sendQueue(retry: false)
        } catch { message = error.localizedDescription }
    }
    private func sendQueue(retry: Bool) async {
        guard !busy, canEdit, let data = savedBody else { return }; busy = true; defer { busy = false }
        do {
            var row = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            row["retry"] = retry
            let body = try JSONSerialization.data(withJSONObject: row)
            let response: IndexValue = try await client.request("api/inventory/native/batches", method: "POST", body: body, timeout: 180)
            try accept(response)
        } catch { message = error.localizedDescription + " Check queue status before adding copies again." }
    }
    private func checkStatus() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let response: IndexValue = try await client.request("api/inventory/native/batches/" + requestID.uuidString)
            try accept(response)
        } catch { message = error.localizedDescription }
    }
    private func repairShare() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let body = Data("{\"confirmed\":true}".utf8)
            let response: IndexValue = try await client.request("api/inventory/native/batches/" + requestID.uuidString + "/repair", method: "POST", body: body, timeout: 180)
            try accept(response)
        } catch { message = error.localizedDescription }
    }
    private func accept(_ response: IndexValue) throws {
        guard response["ok"]?.flag == true else { throw CompanionError.message("The printing queue could not be confirmed.") }
        status = response; message = nil
        NotificationCenter.default.post(name: .homesteadInventoryChanged, object: client)
        if response["state"]?.text == "complete", let file = recoveryFile, FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    private func saveWish() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let body = try draft.createBody(requestID: UUID(), photos: [])
            let response: IndexValue = try await client.request("api/inventory/native/wishlist", method: "POST", body: body)
            guard response["ok"]?.flag == true else { throw CompanionError.message("Wishlist save failed.") }
            NotificationCenter.default.post(name: .homesteadInventoryChanged, object: client); dismiss()
        } catch { message = error.localizedDescription }
    }
}

@MainActor
private struct TcgPrintingMatchRow: View {
    let match: IndexValue
    let client: HomesteadClient
    var body: some View {
        HStack(spacing: 12) {
            NativeArtwork(path: match["image"]?.text, client: client, symbol: "rectangle.portrait").frame(width: 48, height: 68)
            VStack(alignment: .leading, spacing: 4) {
                Text(match["cardName"]?.text ?? "Card").font(.headline)
                Text([match["setCode"]?.text, match["rarity"]?.text].compactMap { $0 }.joined(separator: " · ")).font(.caption)
                Text(match["priceAvailable"]?.flag == false ? "Printing price unavailable" : "Estimate: " + (match["marketValue"]?.text ?? "—")).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
