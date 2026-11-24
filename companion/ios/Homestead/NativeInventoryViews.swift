import SwiftUI
import Observation
import Combine

extension Notification.Name {
    static let homesteadInventoryChanged = Notification.Name("homesteadInventoryChanged")
}

@MainActor @Observable
final class NativeInventoryStore {
    let client: HomesteadClient
    var records: [InventoryRecord] = []
    var binders: [IndexValue] = []
    var decks: [IndexValue] = []
    var locations: [IndexValue] = []
    var wishlist: [IndexValue] = []
    var canEdit = false
    var loading = false
    var error: String?
    init(client: HomesteadClient) { self.client = client }
    func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let result: IndexValue = try await client.request("api/inventory/native", timeout: 60)
            try Task.checkCancellation()
            guard result["ok"]?.flag == true, result["version"]?.text == "1" else {
                throw CompanionError.message("Inventory needs the v3.9 server support.")
            }
            records = InventoryCatalog.records(result)
            binders = result["binders"]?.list ?? []; decks = result["decks"]?.list ?? []
            locations = result["locations"]?.list ?? []; wishlist = result["wishlist"]?.list ?? []
            canEdit = result["canEdit"]?.flag == true
        } catch is CancellationError {} catch {
            self.error = error.localizedDescription
            if records.isEmpty { canEdit = false }
        }
    }
    func changed() {
        NotificationCenter.default.post(name: .homesteadInventoryChanged, object: client)
    }
}

@MainActor
struct NativeInventoryPage: View {
    @State private var store: NativeInventoryStore
    @State private var section: InventorySection = .all
    @State private var query = ""
    @State private var showAdd = false
    @State private var tcgTab: TcgLibraryTab = .cards
    init(client: HomesteadClient) { _store = State(initialValue: NativeInventoryStore(client: client)) }
    private var visible: [InventoryRecord] { store.records.filter { $0.matches(section: section, query: query) } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                sectionPicker
                if let error = store.error {
                    Text(error).foregroundStyle(.orange)
                    Button("Retry") { Task { await store.load() } }
                }
                if section == .tcg { NativeTcgLibraryTabs(store: store, tab: $tcgTab, query: query) }
                else if section == .binders || section == .decks { organizations }
                else {
                    Text("\(visible.count) items").font(.caption).foregroundStyle(.secondary)
                    if visible.isEmpty && !store.loading && store.error == nil {
                        ContentUnavailableView("No matching items", systemImage: "shippingbox", description: Text("Add an item or change the category or search."))
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 14)], spacing: 18) {
                        ForEach(visible) { record in
                            NavigationLink { NativeInventoryDetail(record: record, store: store) } label: {
                                if record.category == "trading-cards" {
                                    InventoryPosterCard(record: record, holdings: record.ownedHoldings, client: store.client)
                                } else {
                                    VStack(alignment: .leading, spacing: 7) {
                                        InventoryArtwork(path: record.artwork, client: store.client).aspectRatio(2 / 3, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 14))
                                        Text(record.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(2)
                                        Text(record.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                        InventoryMetricPill(text: record.quantity + " owned")
                                    }
                                }
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }.padding()
        }.homesteadCanvas().navigationTitle("Inventory").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Items, barcodes, card names or set codes")
            .toolbar {
                if store.canEdit { Button { showAdd = true } label: { Image(systemName: "plus").frame(minWidth: 44, minHeight: 44) }.accessibilityLabel("Add Inventory item") }
            }
            .sheet(isPresented: $showAdd) {
                if section == .tcg, let kind = tcgTab.kind {
                    InventoryLocationEditor(client: store.client, initialKind: kind) { _ in Task { await store.load() } }
                } else if section == .tcg { NativeTcgQueueWizard(client: store.client, wishlistOnly: tcgTab == .wishlist) }
                else { NativeInventoryWizard(client: store.client) }
            }
            .task { await store.load() }.refreshable { await store.load() }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadInventoryChanged)) { notification in
                if let sender = notification.object as? HomesteadClient, sender === store.client { Task { await store.load() } }
            }
        .homesteadLoading(store.loading, message: "Loading Inventory…")
    }
    private var sectionPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(InventorySection.allCases) { item in
                    Button(item.title) { section = item }
                        .buttonStyle(.bordered).tint(section == item ? Color.accentColor : Color.secondary)
                        .accessibilityAddTraits(section == item ? .isSelected : [])
                }
            }
        }
    }
    private var organizations: some View {
        let binder = section == .binders
        let rows = (binder ? store.binders : store.decks).filter {
            query.isEmpty || ($0["name"]?.text ?? "").localizedCaseInsensitiveContains(query)
        }
        return VStack(alignment: .leading, spacing: 12) {
            if rows.isEmpty && !store.loading { Text("No \(binder ? "binders" : "decks") yet.").foregroundStyle(.secondary) }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                NavigationLink {
                    InventoryOrganizationDetail(organization: row, binder: binder, store: store)
                } label: {
                    HStack {
                        Image(systemName: binder ? "book.closed" : "rectangle.stack")
                        Text(row["name"]?.text ?? "Untitled")
                        Spacer(); Image(systemName: "chevron.right")
                    }.padding().homesteadPanel(radius: 14)
                }.buttonStyle(.plain)
            }
        }
    }
}

@MainActor
struct InventoryArtwork: View {
    let path: String?
    let client: HomesteadClient
    @State private var image: UIImage?
    var body: some View {
        Group {
            if path?.hasPrefix("data:image/") == true {
                if let image { Image(uiImage: image).resizable().scaledToFit() }
                else { Color.secondary.opacity(0.12).overlay { Image(systemName: "photo") } }
            } else { NativeArtwork(path: path, client: client, symbol: "shippingbox", fit: true) }
        }.accessibilityHidden(true).task(id: path) {
            image = nil
            guard let path, path.utf8.count <= 4 * 1024 * 1024, path.hasPrefix("data:image/"), let comma = path.firstIndex(of: ",") else { return }
            let encoded = String(path[path.index(after: comma)...])
            let decoded = await Task.detached(priority: .utility) {
                guard let bytes = Data(base64Encoded: encoded) else { return Optional<CGImage>.none }
                return NativeImageDecoder.thumbnail(bytes, maximumPixelSize: 1200)
            }.value
            guard !Task.isCancelled, let decoded else { return }
            image = UIImage(cgImage: decoded)
        }
    }
}

@MainActor
private struct InventoryOrganizationDetail: View {
    let organization: IndexValue
    let binder: Bool
    let store: NativeInventoryStore
    var body: some View {
        let records = InventoryCatalog.organizationRecords(organization, records: store.records, binder: binder)
        List {
            if let text = organization["description"]?.text { Text(text) }
            if let location = organization["location"]?.text { Label(location, systemImage: "mappin") }
            ForEach(records) { record in
                NavigationLink(record.title) { NativeInventoryDetail(record: record, store: store) }
            }
            if records.isEmpty { Text("No linked owned cards.").foregroundStyle(.secondary) }
            if !binder {
                ForEach(Array((organization["cards"]?.list ?? []).filter { $0["owned"]?.flag == false }.enumerated()), id: \.offset) { _, card in
                    Text((card["cardName"]?.text ?? "Card") + " · Wanted").foregroundStyle(.secondary)
                }
            }
        }.homesteadCanvas().navigationTitle(organization["name"]?.text ?? "Cards").navigationBarTitleDisplayMode(.inline)
    }
}

private struct InventoryEditTarget: Identifiable {
    let record: InventoryRecord
    var printing: IndexValue? = nil
    var id: String { record.id + ":" + (printing?["id"]?.text ?? "item") }
}

@MainActor
struct NativeInventoryDetail: View {
    let record: InventoryRecord
    let store: NativeInventoryStore
    @State private var editing: InventoryEditTarget?
    @State private var moving: InventoryMoveTarget?
    private var current: InventoryRecord { store.records.first { $0.id == record.id } ?? record }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                InventoryArtwork(path: current.artwork, client: store.client).frame(height: 280).clipShape(RoundedRectangle(cornerRadius: 18))
                Text(current.title).font(.largeTitle.bold())
                metadata
                if let description = current.row["metadata"]?["description"]?.text { Text(description).textSelection(.enabled) }
                if let notes = current.row["notes"]?.text { Text(notes).textSelection(.enabled) }
                if current.tcg != nil {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(current.quantity) owned · \(current.printings.count) holding groups").font(.headline)
                        ForEach(current.locationTotals, id: \.0) { name, count in LabeledContent(name, value: String(count)) }
                    }
                }
                if !current.printings.isEmpty { printings }
                ForEach(Array(current.photos.enumerated()), id: \.offset) { _, photo in
                    InventoryArtwork(path: photo["url"]?.text ?? photo["dataUrl"]?.text, client: store.client).frame(height: 250)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    if let name = photo["name"]?.text { Text(name).font(.caption) }
                }
            }.padding()
        }.homesteadCanvas().navigationTitle(current.title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if store.canEdit { Button { editing = InventoryEditTarget(record: current) } label: { Image(systemName: "pencil").frame(minWidth: 44, minHeight: 44) }.accessibilityLabel("Edit Inventory item") }
            }
            .sheet(item: $editing) { target in
                NativeInventoryEditor(record: target.record, printing: target.printing, store: store)
            }
            .sheet(item: $moving) { target in InventoryMoveForm(record: current, holding: target.row, store: store) }
    }
    private var metadata: some View {
        let fields: [(String, String)] = [("Category", current.category), ("Quantity", current.quantity), ("Condition", current.condition),
            ("Location", current.location), ("Barcode", current.row["code"]?.text ?? ""),
            ("Brand", current.row["brand"]?.text ?? ""), ("Model", current.row["model"]?.text ?? ""),
            ("Serial number", current.row["serialNumber"]?.text ?? ""), ("Purchase price", current.row["purchasePrice"]?.text ?? ""),
            ("Purchased", current.row["purchaseDate"]?.text ?? ""), ("Warranty ends", current.row["warrantyExpiry"]?.text ?? "")]
        return VStack(alignment: .leading, spacing: 10) {
            ForEach(fields.filter { !$0.1.isEmpty }, id: \.0) { label, value in
                LabeledContent(label, value: value).textSelection(.enabled)
            }
        }.padding().homesteadPanel(radius: 16)
    }
    private var printings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Owned printings").font(.headline)
            ForEach(Array(current.printings.enumerated()), id: \.offset) { _, printing in
                VStack(alignment: .leading, spacing: 8) {
                    Text([printing["setCode"]?.text, printing["rarity"]?.text, printing["edition"]?.text].compactMap { $0 }.joined(separator: " · ")).font(.headline)
                    Text([printing["language"]?.text, printing["condition"]?.text, printing["quantity"]?.text.map { $0 + " copies" }, printing["location"]?.text].compactMap { $0 }.joined(separator: " · "))
                    Text(printing["priceAvailable"]?.flag == false ? "Printing price unavailable" : "Estimate: " + (printing["marketValue"]?.text ?? "—")).font(.caption)
                    if let source = printing["priceSource"]?.text { Text(source).font(.caption).foregroundStyle(.secondary) }
                    ForEach(Array((printing["captures"]?.list ?? []).enumerated()), id: \.offset) { _, photo in
                        InventoryArtwork(path: photo["url"]?.text, client: store.client).frame(height: 140)
                    }
                    if store.canEdit, printing["id"]?.text != nil {
                        Button("Edit printing") { editing = InventoryEditTarget(record: current, printing: printing) }
                        Button("Move copies") { moving = InventoryMoveTarget(row: printing) }
                    }
                }.padding().frame(maxWidth: .infinity, alignment: .leading).homesteadPanel(radius: 14)
            }
        }
    }
}

@MainActor
private struct NativeInventoryEditor: View {
    let record: InventoryRecord
    let printing: IndexValue?
    let store: NativeInventoryStore
    @State private var draft: NativeInventoryDraft
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    init(record: InventoryRecord, printing: IndexValue?, store: NativeInventoryStore) {
        self.record = record; self.printing = printing; self.store = store
        _draft = State(initialValue: .editing(record, printing: printing))
    }
    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.orange) }
                if printing == nil { TextField("Title", text: $draft.title); TextField("Notes", text: $draft.notes, axis: .vertical) }
                InventoryItemFields(draft: $draft, cardSummary: draft.card && printing == nil, allowCategory: !draft.card && printing == nil)
                if printing != nil { InventoryPrintingFields(draft: $draft, binders: store.binders, decks: [], locations: store.locations, client: store.client) }
            }.disabled(busy).homesteadCanvas().navigationTitle(printing == nil ? "Edit item" : "Edit printing").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button(busy ? "Saving…" : "Save") { Task { await save() } }.disabled(busy) }
                }.interactiveDismissDisabled(busy)
        }
    }
    private func save() async {
        guard !busy, store.canEdit else { return }; busy = true; error = nil
        defer { busy = false }
        do {
            let recordPart = record.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? ""
            var route = "api/inventory/native/items/" + recordPart
            if let id = printing?["id"]?.text {
                let printingPart = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? ""
                route += "/printings/" + printingPart
            }
            let result: IndexValue = try await store.client.request(route, method: "PATCH", body: draft.editBody(printing: printing != nil))
            guard result["ok"]?.flag == true, result["record"] != nil else { throw CompanionError.message("The updated item could not be confirmed. Refresh before retrying.") }
            if let row = result["record"], let index = store.records.firstIndex(where: { $0.id == record.id }) { store.records[index] = InventoryRecord(row: row) }
            await store.load(); store.changed(); dismiss()
        } catch { if !Task.isCancelled { self.error = error.localizedDescription + " Refresh the item before retrying if the connection failed." } }
    }
}

@MainActor
struct InventoryItemFields: View {
    @Binding var draft: NativeInventoryDraft
    var cardSummary = false
    var allowCategory = true
    var body: some View {
        Section("Item details") {
            if allowCategory {
                Picker("Category", selection: $draft.category) {
                    ForEach(InventorySection.itemCategories.filter { $0 != .tcg }) { Text($0.title).tag($0.category) }
                }
            }
            if !cardSummary && !draft.card { TextField("Location", text: $draft.location) }
            else { Text("Edit an owned printing to change its quantity, condition or storage location.").font(.caption).foregroundStyle(.secondary) }
            if !cardSummary {
                Stepper("Quantity: \(draft.quantity)", value: $draft.quantity, in: 1...100000)
                TextField("Condition", text: $draft.condition)
                TextField("Purchase price", text: $draft.purchasePrice).keyboardType(.decimalPad)
            }
            if !draft.card {
                TextField("Brand", text: $draft.brand); TextField("Model", text: $draft.model)
                TextField("Serial number", text: $draft.serialNumber)
                TextField("Purchase date (YYYY-MM-DD)", text: $draft.purchaseDate)
                TextField("Warranty ends (YYYY-MM-DD)", text: $draft.warrantyExpiry)
            }
        }
    }
}

@MainActor
struct InventoryPrintingFields: View {
    @Binding var draft: NativeInventoryDraft
    let binders: [IndexValue]
    let decks: [IndexValue]
    var locations: [IndexValue] = []
    var client: HomesteadClient? = nil

    var body: some View {
        Section("Yu-Gi-Oh! printing") {
            InventoryPrintingIdentityFields(draft: $draft)
            InventoryPrintingValuationFields(value: $draft.marketValue)
            if let client { InventoryPriceCheck(draft: $draft, client: client) }
            InventoryPrintingLocationFields(draft: $draft, options: locationOptions)
            InventoryPrintingDeckFields(selected: $draft.deckIDs, options: deckOptions)
        }
    }

    private var locationOptions: [InventoryPrintingOption] {
        var result: [InventoryPrintingOption] = []
        for location in locations {
            guard let id = location["id"]?.text else { continue }
            let name = location["name"]?.text ?? "Location"
            let kind = location["kind"]?.text ?? "loose"
            result.append(InventoryPrintingOption(id: id, name: name, kind: kind))
        }
        return result
    }

    private var deckOptions: [InventoryPrintingOption] {
        var result: [InventoryPrintingOption] = []
        for deck in decks {
            guard let id = deck["id"]?.text else { continue }
            let name = deck["name"]?.text ?? "Deck"
            result.append(InventoryPrintingOption(id: id, name: name, kind: "deck"))
        }
        return result
    }
}

@MainActor
private struct InventoryPriceCheck: View {
    @Binding var draft: NativeInventoryDraft
    let client: HomesteadClient
    @State private var message = ""
    private var identity: String { [draft.title, draft.setCode, draft.rarity, draft.edition, draft.condition, draft.language].joined(separator: "|") }
    var body: some View {
        Text(message).font(.caption).foregroundStyle(.secondary).task(id: identity) { await check() }
    }
    private func check() async {
        guard !draft.setCode.isEmpty, !draft.rarity.isEmpty else { return }
        let original = draft.marketValue, key = identity
        let catalog = draft.selectedPrinting["priceAvailable"]?.flag == false ? "" : draft.selectedPrinting["marketValue"]?.text ?? ""
        guard original.isEmpty || (original == catalog && draft.selectedPrinting["priceSourceType"]?.text != "manual-override") else {
            message = "Manual estimate preserved."; return
        }
        message = "Checking optional pricing source…"
        let fields = ["cardName": draft.title, "setCode": draft.setCode, "rarity": draft.rarity, "edition": draft.edition, "condition": draft.condition, "language": draft.language]
        do {
            let result: IndexValue = try await client.request("api/inventory/native/pricing/quote", query: fields.map { URLQueryItem(name: $0.key, value: $0.value) }, timeout: 30)
            try Task.checkCancellation()
            guard key == identity, draft.marketValue == original else { return }
            guard result["ok"]?.flag == true, let quote = result["quote"] else { throw CompanionError.message("Pricing is unavailable.") }
            if quote["priceAvailable"]?.flag == true {
                draft.applyPriceQuote(quote)
                message = quote["priceSource"]?.text ?? "Pricing updated."
            } else { message = quote["pricingStatus"]?.text == "not-configured" ? "Optional pricing can be configured in server Settings → Integrations." : "No exact quote. You can enter a manual estimate." }
        } catch { if !Task.isCancelled { message = "Pricing could not be checked. Existing estimates are unchanged." } }
    }
}

private struct InventoryPrintingOption: Identifiable {
    let id: String
    let name: String
    let kind: String
    var label: String { name + " · " + kind }
}

@MainActor
private struct InventoryPrintingIdentityFields: View {
    @Binding var draft: NativeInventoryDraft

    private var editions: [String] {
        var values = ["Unlimited", "1st Edition", "Limited Edition"]
        if !values.contains(draft.edition) { values.append(draft.edition) }
        return values.sorted()
    }

    var body: some View {
        Group {
            TextField("Set code", text: $draft.setCode)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            TextField("Rarity", text: $draft.rarity)
            Picker("Edition", selection: $draft.edition) {
                ForEach(editions, id: \.self) { edition in
                    Text(edition).tag(edition)
                }
            }
            TextField("Language", text: $draft.language)
        }
    }
}

@MainActor
private struct InventoryPrintingValuationFields: View {
    @Binding var value: String

    var body: some View {
        Group {
            TextField("Estimated value (optional)", text: $value)
                .keyboardType(.decimalPad)
            Text("Prices apply to the printing and condition identified by their source. Missing quotes stay unavailable. You can enter your own estimate.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

@MainActor
private struct InventoryPrintingLocationFields: View {
    @Binding var draft: NativeInventoryDraft
    let options: [InventoryPrintingOption]

    private var visibleOptions: [InventoryPrintingOption] {
        options.filter { $0.id != "loose" }
    }

    var body: some View {
        Group {
            Picker("Physical location", selection: $draft.locationID) {
                Text("Loose Cards").tag("loose")
                ForEach(visibleOptions) { option in
                    Text(option.label).tag(option.id)
                }
            }
            .onChange(of: draft.locationID) { _, id in
                selectLocation(id)
            }
            if draft.locationType == "binder" {
                TextField("Binder page", text: $draft.page).keyboardType(.numberPad)
                TextField("Pocket", text: $draft.pocket).keyboardType(.numberPad)
            }
        }
    }

    private func selectLocation(_ id: String) {
        let option = options.first { $0.id == id }
        draft.location = option?.name ?? "Loose Cards"
        draft.locationType = option?.kind ?? "loose"
        draft.binderID = draft.locationType == "binder" ? id : ""
    }
}

@MainActor
private struct InventoryPrintingDeckFields: View {
    @Binding var selected: Set<String>
    let options: [InventoryPrintingOption]

    var body: some View {
        ForEach(options) { option in
            InventoryPrintingDeckToggle(selected: $selected, option: option)
        }
    }
}

@MainActor
private struct InventoryPrintingDeckToggle: View {
    @Binding var selected: Set<String>
    let option: InventoryPrintingOption

    private var isSelected: Binding<Bool> {
        Binding<Bool>(
            get: { selected.contains(option.id) },
            set: { enabled in
                if enabled { selected.insert(option.id) }
                else { selected.remove(option.id) }
            }
        )
    }

    var body: some View {
        Toggle(option.name, isOn: isSelected)
    }
}
