import SwiftUI
import PhotosUI

@MainActor
struct NativeInventoryWizard: View {
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    @State private var draft = NativeInventoryDraft()
    @State private var step = 0
    @State private var busy = false
    @State private var loading = false
    @State private var allowed = false
    @State private var submitted = false
    @State private var requestID = UUID()
    @State private var pendingStorageKey: String?
    @State private var savedRecord: InventoryRecord?
    @State private var confirmResolve = false
    @State private var message: String?
    @State private var lookupMessage: String?
    @State private var cardQuery = ""
    @State private var passcode = ""
    @State private var cardMatches: [IndexValue] = []
    @State private var existing: IndexValue?
    @State private var showTcgQueue = false
    @State private var locations: [IndexValue] = []
    @State private var showScanner = false
    @State private var showCardCamera = false
    @State private var capturedCardData: Data?
    @State private var binders: [IndexValue] = []
    @State private var decks: [IndexValue] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var recognitionPhoto: PhotosPickerItem?
    @State private var photos: [InventoryPhoto] = []
    @State private var photoRole = "main-photo"
    var body: some View {
        NavigationStack {
            Form {
                if let message { Text(message).foregroundStyle(.orange).textSelection(.enabled) }
                if savedRecord != nil { completion }
                else if submitted {
                    Section("Confirming save") {
                        Text("Your item may already be saved. Check its status before starting another item.")
                        Button("Check save status") { Task { await checkStatus() } }.disabled(busy)
                        Button("Resolve after checking Inventory") { confirmResolve = true }.disabled(busy)
                    }
                } else if allowed {
                    Text("Step \(step + 1) of 3 · \(["Identify", "Details and photos", "Review"][step])").font(.caption).foregroundStyle(.secondary)
                    if step == 0 { identify }
                    else if step == 1 { details }
                    else { review }
                    navigation
                } else if !loading {
                    Text("Adding items requires Inventory access and an owner or administrator account. Install the v3.9 server support if Inventory is unavailable.")
                    Button("Retry access check") { Task { await prepare() } }
                }
            }.disabled(busy || loading).scrollDismissesKeyboard(.interactively).homesteadCanvas().navigationTitle("Add Inventory item").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(savedRecord == nil ? "Cancel" : "Done") { dismiss() }.disabled(busy) } }
                .interactiveDismissDisabled(busy || submitted)
                .task { await prepare() }
                .fullScreenCover(isPresented: $showTcgQueue) { NativeTcgQueueWizard(client: client) }
                .sheet(isPresented: $showScanner) {
                    InventoryBarcodeScanner { code in draft.code = code; showScanner = false; Task { await lookupBarcode() } }
                }
                .fullScreenCover(isPresented: $showCardCamera, onDismiss: {
                    if let data = capturedCardData {
                        capturedCardData = nil
                        Task { await recognizeCardData(data) }
                    }
                }) {
                    InventoryCardCamera { data in capturedCardData = data; showCardCamera = false }
                }
                .onChange(of: pickerItems) { _, items in Task { await loadPhotos(items) } }
                .onChange(of: recognitionPhoto) { _, item in if let item { Task { await recognizeCardPhoto(item) } } }
                .confirmationDialog("Have you checked whether this item was already added?", isPresented: $confirmResolve, titleVisibility: .visible) {
                    Button("I checked — review a new save") { Task { await resolveSave() } }
                    Button("Keep checking", role: .cancel) { }
                } message: { Text("Only start another save after checking Inventory. An interrupted response can happen after the item was saved.") }
        }
        .homesteadLoading(loading || busy, message: "Preparing Inventory…")
    }
    @ViewBuilder private var identify: some View {
        Section("Item") {
            Picker("Category", selection: $draft.category) {
                ForEach(InventorySection.itemCategories) { Text($0.title).tag($0.category) }
            }
            TextField("Item title", text: $draft.title).onChange(of: draft.title) { _, value in
                if draft.card && !draft.providerCardID.isEmpty && value != draft.selectedPrinting["cardName"]?.text {
                    draft.providerCardID = ""; draft.selectedPrinting = .object([:]); draft.artwork = ""; draft.artworkID = ""
                }
            }
        }
        if !draft.card { barcodeLookup }
        if draft.card { Section { Button("Add multiple printings with quantities and locations") { showTcgQueue = true } }; cardLookup }
        if let lookupMessage {
            Section("Lookup status") {
                Text(lookupMessage).font(.callout).textSelection(.enabled)
            }
        }
    }
    private var barcodeLookup: some View {
        Section("Barcode lookup") {
            TextField("Barcode / ISBN", text: $draft.code).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button { showScanner = true } label: { Label("Scan with camera", systemImage: "barcode.viewfinder") }
            Button("Look up barcode") { Task { await lookupBarcode() } }.disabled(draft.code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Text("Review lookup details before saving.").font(.caption).foregroundStyle(.secondary)
            if let existing {
                Text("Already linked: " + (existing["record"]?["title"]?.text ?? existing["homesteadId"]?.text ?? "Existing item"))
                Picker("Duplicate action", selection: $draft.duplicateAction) {
                    Text("Keep existing — do not add").tag("create")
                    Text("Add a separate physical copy").tag("copy")
                }
            }
        }
    }
    private var cardLookup: some View {
        Section("Yu-Gi-Oh! card lookup") {
            TextField("Card name (optional)", text: $cardQuery).autocorrectionDisabled()
            TextField("Card passcode (optional)", text: $passcode).keyboardType(.numberPad)
            TextField("Printed set code, e.g. CORI-EN029", text: $draft.setCode).textInputAutocapitalization(.characters).autocorrectionDisabled()
            Text("Use the printed set code, passcode or name — only one is needed. A set code takes priority over the name. Confirm the exact printing before saving.").font(.caption).foregroundStyle(.secondary)
            Button { capturedCardData = nil; showCardCamera = true } label: {
                Label("Scan card with camera", systemImage: "camera.viewfinder")
            }
            PhotosPicker(selection: $recognitionPhoto, matching: .images) {
                Label("Choose a card photo", systemImage: "photo")
            }
            Button("Search cards and printings") { Task { await lookupCard() } }
                .disabled(cardQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && passcode.isEmpty && draft.setCode.isEmpty)
            ForEach(Array(cardMatches.enumerated()), id: \.offset) { _, match in
                Button {
                    draft.applyCard(match); cardMatches = []
                    lookupMessage = "Printing selected. Review the edition, condition and quantity in Details."
                } label: {
                    HStack(spacing: 12) {
                        NativeArtwork(path: match["image"]?.text, client: client, symbol: "rectangle.portrait").frame(width: 48, height: 68).clipShape(RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(match["cardName"]?.text ?? "Card").font(.headline)
                            Text([match["setCode"]?.text, match["rarity"]?.text, match["setName"]?.text].compactMap { $0 }.joined(separator: " · ")).font(.caption)
                        }
                    }
                }.buttonStyle(.plain)
            }
        }
    }
    @ViewBuilder private var details: some View {
        InventoryItemFields(draft: $draft, allowCategory: false)
        if draft.card { InventoryPrintingFields(draft: $draft, binders: binders, decks: decks, locations: locations, client: client) }
        if draft.card && draft.selectedPrinting["artworkVariants"]?.list.isEmpty == false { artworkOptions }
        Section("Notes") { TextField("Notes", text: $draft.notes, axis: .vertical) }
        Section("Photos and documentation") {
            Picker("Photo role", selection: $photoRole) {
                ForEach(draft.card ? ["card-front", "card-back", "condition"] : ["main-photo", "documentation", "receipt"], id: \.self) { Text($0.replacingOccurrences(of: "-", with: " ").capitalized).tag($0) }
            }
            PhotosPicker(selection: $pickerItems, maxSelectionCount: max(1, 4 - photos.count), matching: .images) {
                Label("Add photos", systemImage: "photo.badge.plus")
            }.disabled(photos.count >= 4)
            ForEach(photos) { photo in
                HStack {
                    if let image = UIImage(data: photo.data) { Image(uiImage: image).resizable().scaledToFit().frame(width: 48, height: 64) }
                    Text(photo.name).font(.caption)
                    Spacer()
                    Button("Remove") { photos.removeAll { $0.id == photo.id } }.buttonStyle(.borderless)
                }
            }
            Text("Up to four photos. Images are resized for the existing Inventory intake format; originals in your photo library are unchanged.").font(.caption).foregroundStyle(.secondary)
        }
    }
    private var artworkOptions: some View {
        Section("Card artwork") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(Array((draft.selectedPrinting["artworkVariants"]?.list ?? []).enumerated()), id: \.offset) { _, artwork in
                        Button {
                            draft.artwork = artwork["image"]?.text ?? ""; draft.artworkID = artwork["id"]?.text ?? ""
                        } label: {
                            NativeArtwork(path: artwork["thumbnail"]?.text ?? artwork["image"]?.text, client: client)
                                .frame(width: 75, height: 105).clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay { RoundedRectangle(cornerRadius: 8).stroke(draft.artworkID == artwork["id"]?.text ? Color.accentColor : Color.clear, lineWidth: 3) }
                        }.buttonStyle(.plain).accessibilityLabel("Select card artwork")
                    }
                }
            }
        }
    }
    private var review: some View {
        Section("Review before saving") {
            Text(draft.title).font(.title2.bold())
            if !draft.artwork.isEmpty { NativeArtwork(path: draft.artwork, client: client).frame(height: 180) }
            LabeledContent("Category", value: draft.category)
            LabeledContent("Quantity", value: String(draft.quantity))
            if !draft.code.isEmpty { LabeledContent("Barcode", value: draft.code) }
            if !draft.location.isEmpty { LabeledContent("Location", value: draft.location) }
            if !draft.condition.isEmpty { LabeledContent("Condition", value: draft.condition) }
            if draft.card {
                LabeledContent("Set code", value: draft.setCode)
                LabeledContent("Rarity", value: draft.rarity)
                LabeledContent("Edition", value: draft.edition)
                LabeledContent("Language", value: draft.language)
            }
            Text("\(photos.count) photos · Saved to this server’s Inventory.").font(.caption)
            if !draft.notes.isEmpty { Text(draft.notes) }
        }
    }
    private var navigation: some View {
        Section {
            HStack {
                if step > 0 { Button("Back") { step -= 1 } }
                Spacer()
                if step < 2 { Button("Continue") { advance() }.disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                else { Button("Save item") { Task { await save() } }.disabled(existing != nil && draft.duplicateAction != "copy") }
            }
            // Keep each action independent instead of using Form's automatic row action.
            .buttonStyle(.borderless)
        }
    }
    private var completion: some View {
        Section("Saved to Inventory") {
            Label(savedRecord?.title ?? draft.title, systemImage: "checkmark.circle.fill")
            Text("The item is saved on your Homestead server and available to web and mobile.")
            Button("Add another item") {
                draft = NativeInventoryDraft(); photos = []; pickerItems = []; step = 0; requestID = UUID()
                savedRecord = nil; submitted = false; existing = nil; cardMatches = []; message = nil; lookupMessage = nil; cardQuery = ""; passcode = ""
            }
        }
    }
    private func advance() {
        do { _ = try draft.fields(); message = nil; step = min(2, step + 1) }
        catch { message = error.localizedDescription }
    }
    private func prepare() async {
        guard !loading else { return }; loading = true
        defer { loading = false }
        do {
            let result: IndexValue = try await client.request("api/inventory/native", timeout: 60)
            try Task.checkCancellation()
            allowed = result["ok"]?.flag == true && result["canEdit"]?.flag == true && result["version"]?.text == "1"
            binders = result["binders"]?.list ?? []; decks = result["decks"]?.list ?? []; locations = result["locations"]?.list ?? []
            message = nil
            if let account = result["accountId"]?.text {
                let scope = AppearancePreferences.storageKey(server: client.baseURL.absoluteString, user: account)
                let key = "homestead.inventory.pending." + scope
                pendingStorageKey = key
                if let pending = UserDefaults.standard.string(forKey: key), let id = UUID(uuidString: pending) {
                    requestID = id; submitted = true
                    await checkStatus()
                }
            } else { allowed = false; message = "Inventory could not verify the current account." }
        } catch { if !Task.isCancelled { message = error.localizedDescription; allowed = false } }
    }
    private func lookupBarcode() async {
        guard !busy, !submitted else { return }; busy = true; lookupMessage = nil
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["code": draft.code, "category": draft.category])
            let response: IndexValue = try await client.request("api/inventory/native/lookup", method: "POST", body: body, timeout: 30)
            try Task.checkCancellation()
            guard response["ok"]?.flag == true, let result = response["result"] else { throw CompanionError.message("Barcode lookup failed.") }
            existing = result["existing"]?.flag == true ? result : nil
            draft.duplicateAction = "create"; draft.applyProduct(result)
            lookupMessage = existing != nil ? "Review the existing item before adding a physical copy." : result["metadata"] == nil || result["metadata"]?.fields.isEmpty == true ? "No product match found. You can enter the item manually." : "Product details found. Review and edit them before saving."
        } catch { if !Task.isCancelled { lookupMessage = error.localizedDescription + " Manual entry remains available." } }
    }
    private func lookupCard() async {
        guard !busy, !submitted else { return }; busy = true; cardMatches = []; lookupMessage = "Searching the card catalog…"
        defer { busy = false }
        do {
            let query = InventoryCardSearch.queryItems(name: cardQuery, setCode: draft.setCode, passcode: passcode)
            let response: IndexValue = try await client.request("api/inventory/native/cards", query: query, timeout: 60)
            try Task.checkCancellation()
            guard response["ok"]?.flag == true else { throw CompanionError.message("Card search failed.") }
            cardMatches = response["matches"]?.list ?? []
            lookupMessage = cardMatches.isEmpty ? "No matching printing. Change the search or enter the card manually." : "Select your exact printing below."
        } catch { if !Task.isCancelled { lookupMessage = error.localizedDescription } }
    }
    private func recognizeCardPhoto(_ item: PhotosPickerItem) async {
        guard !busy, !submitted else { recognitionPhoto = nil; return }
        busy = true
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw CompanionError.message("The card photo could not be read.")
            }
            busy = false
            await recognizeCardData(data)
        } catch { busy = false; if !Task.isCancelled { lookupMessage = error.localizedDescription } }
        recognitionPhoto = nil
    }
    private func recognizeCardData(_ data: Data) async {
        guard !busy, !submitted else { return }; busy = true; lookupMessage = "Reading the card photo…"; cardMatches = []
        defer { busy = false }
        do {
            guard data.count <= 64 * 1024 * 1024,
                  let cgImage = await Task.detached(priority: .utility, operation: { NativeImageDecoder.thumbnail(data, maximumPixelSize: 2200) }).value,
                  let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.8), jpeg.count <= 2 * 1024 * 1024 else {
                throw CompanionError.message("The card photo could not be prepared. Choose a smaller image.")
            }
            let body = try JSONSerialization.data(withJSONObject: ["imageData": "data:image/jpeg;base64," + jpeg.base64EncodedString()])
            let response: IndexValue = try await client.request("api/inventory/native/recognize", method: "POST", body: body, timeout: 75)
            try Task.checkCancellation()
            guard response["ok"]?.flag == true else { throw CompanionError.message("Card recognition failed. Search by name or set code.") }
            cardMatches = response["matches"]?.list ?? []
            cardQuery = response["recognition"]?["cardName"]?.text ?? cardQuery
            draft.setCode = response["recognition"]?["setCode"]?.text ?? draft.setCode
            lookupMessage = response["message"]?.text ?? "Review the possible printings before choosing one."
            if photos.count < 4 && photos.reduce(0, { $0 + $1.data.count }) + jpeg.count <= 6 * 1024 * 1024 {
                photos.append(InventoryPhoto(id: UUID(), name: "card-front-\(photos.count + 1).jpg", data: jpeg))
            }
        } catch { if !Task.isCancelled { lookupMessage = error.localizedDescription + " Manual card search remains available." } }
    }
    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        guard !busy, !submitted, !items.isEmpty else { return }; busy = true
        defer { busy = false; pickerItems = [] }
        do {
            for item in items.prefix(max(0, 4 - photos.count)) {
                guard let data = try await item.loadTransferable(type: Data.self), data.count <= 64 * 1024 * 1024,
                      let cgImage = await Task.detached(priority: .utility, operation: { NativeImageDecoder.thumbnail(data, maximumPixelSize: 1800) }).value,
                      let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.75), jpeg.count <= 2 * 1024 * 1024 else {
                    throw CompanionError.message("A photo could not be prepared. Choose a smaller image.")
                }
                try Task.checkCancellation()
                guard photos.reduce(0, { $0 + $1.data.count }) + jpeg.count <= 6 * 1024 * 1024 else { throw CompanionError.message("The photo batch is too large.") }
                photos.append(InventoryPhoto(id: UUID(), name: photoRole + "-\(photos.count + 1).jpg", data: jpeg))
            }
        } catch { if !Task.isCancelled { message = error.localizedDescription } }
    }
    private func save() async {
        guard !busy, !submitted, allowed else { return }
        do {
            let body = try draft.createBody(requestID: requestID, photos: photos)
            busy = true; submitted = true; message = nil
            if let key = pendingStorageKey { UserDefaults.standard.set(requestID.uuidString, forKey: key) }
            defer { busy = false }
            do {
                let response: IndexValue = try await client.request("api/inventory/native/items", method: "POST", body: body, timeout: 90)
                acceptStatus(response)
            } catch {
                if !Task.isCancelled { message = error.localizedDescription + " Use Check save status; do not submit another copy." }
            }
        } catch { message = error.localizedDescription }
    }
    private func checkStatus() async {
        guard !busy else { return }; busy = true
        defer { busy = false }
        do {
            let response: IndexValue = try await client.request("api/inventory/native/requests/" + requestID.uuidString)
            try Task.checkCancellation(); acceptStatus(response)
        } catch { if !Task.isCancelled { message = error.localizedDescription } }
    }
    private func acceptStatus(_ response: IndexValue) {
        guard response["ok"]?.flag == true else { message = "Save could not be confirmed. Check Inventory before trying again."; return }
        if response["state"]?.text == "complete", let row = response["record"], row["id"]?.text != nil {
            clearPendingSave()
            savedRecord = InventoryRecord(row: row); submitted = false; message = nil
            NotificationCenter.default.post(name: .homesteadInventoryChanged, object: client)
        } else if ["failed", "unknown"].contains(response["state"]?.text ?? "") {
            clearPendingSave()
            submitted = false; requestID = UUID()
            message = response["message"]?.text ?? "The save did not start. Review the item and try again."
        } else { message = response["message"]?.text ?? "Save is still unconfirmed. Refresh Inventory and check status before adding another item." }
    }
    private func clearPendingSave() {
        if let key = pendingStorageKey, UserDefaults.standard.string(forKey: key) == requestID.uuidString {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
    private func resolveSave() async {
        guard !busy else { return }; busy = true
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["confirmed": true])
            let response: IndexValue = try await client.request("api/inventory/native/requests/" + requestID.uuidString + "/resolve", method: "POST", body: body)
            try Task.checkCancellation(); acceptStatus(response)
        } catch { if !Task.isCancelled { message = error.localizedDescription } }
    }
}
