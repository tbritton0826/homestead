import SwiftUI

@MainActor
struct NativeTcgLibraryTabs: View {
    let store: NativeInventoryStore
    @Binding var tab: TcgLibraryTab
    let query: String
    @State private var creating = false
    @State private var refreshingPrices = false
    @State private var priceMessage: String?
    private var cards: [InventoryRecord] { store.records.filter { $0.matches(section: .tcg, query: query) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(TcgLibraryTab.allCases) { item in
                        Button(item.title) { tab = item }.buttonStyle(.bordered).tint(tab == item ? Color.accentColor : Color.secondary)
                    }
                }
            }
            if tab == .cards {
                if store.canEdit {
                    Button(refreshingPrices ? "Refreshing prices…" : "Refresh printing prices") { Task { await refreshPrices() } }.disabled(refreshingPrices)
                    if let priceMessage { Text(priceMessage).font(.caption).foregroundStyle(.secondary) }
                }
                InventoryCollectionSummary(records: cards)
                InventoryCardGrid(records: cards, store: store)
                if cards.isEmpty { Text("No owned cards match this search.").foregroundStyle(.secondary) }
            } else if tab == .wishlist { wishes }
            else { locations }
        }
    }
    private var locations: some View {
        let rows = store.locations.filter { $0["kind"]?.text == tab.kind && (query.isEmpty || ($0["name"]?.text ?? "").localizedCaseInsensitiveContains(query)) }
        return VStack(alignment: .leading, spacing: 12) {
            if store.canEdit { Button("Create " + (tab.kind ?? "location")) { creating = true } }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                NavigationLink { InventoryLocationDetail(location: row, store: store) } label: {
                    HStack {
                        Label(row["name"]?.text ?? "Location", systemImage: tab == .binders ? "book.closed" : "archivebox")
                        Spacer(); Image(systemName: "chevron.right")
                    }.padding().homesteadPanel(radius: 14)
                }.buttonStyle(.plain)
            }
            if tab == .loose && !rows.contains(where: { $0["id"]?.text == "loose" }) {
                NavigationLink("Loose Cards") { InventoryLocationDetail(location: .object(["id": .string("loose"), "kind": .string("loose"), "name": .string("Loose Cards")]), store: store) }
            }
            if rows.isEmpty && tab != .loose { Text("No \(tab.title.lowercased()) yet.").foregroundStyle(.secondary) }
        }.sheet(isPresented: $creating) { InventoryLocationEditor(client: store.client, initialKind: tab.kind ?? "custom") { _ in Task { await store.load() } } }
    }
    private var wishes: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Wanted cards are separate from owned quantities.").font(.caption).foregroundStyle(.secondary)
            ForEach(Array(store.wishlist.filter { query.isEmpty || ($0["title"]?.text ?? "").localizedCaseInsensitiveContains(query) }.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(row["title"]?.text ?? "Wanted card")
                    Text([row["tcg"]?["setCode"]?.text, row["tcg"]?["rarity"]?.text].compactMap { $0 }.joined(separator: " · ")).font(.caption)
                    Spacer()
                    if store.canEdit { Button("Remove", role: .destructive) { Task { await removeWish(row) } } }
                }.padding().homesteadPanel(radius: 14)
            }
            if store.wishlist.isEmpty { Text("No wanted cards yet. Use + to add one.").foregroundStyle(.secondary) }
        }
    }
    private func refreshPrices() async {
        guard !refreshingPrices else { return }; refreshingPrices = true; defer { refreshingPrices = false }
        do {
            let result: IndexValue = try await store.client.request("api/intake/tcg/yugioh/refresh-prices", method: "POST", body: Data("{}".utf8), timeout: 180)
            guard result["ok"]?.flag == true else { throw CompanionError.message("Price refresh failed.") }
            priceMessage = "Updated \(result["updated"]?.text ?? "0") cards · \(result["failed"]?.text ?? "0") failed · \(result["deferred"]?.text ?? "0") deferred. Refresh again for deferred cards; manual estimates are preserved."
            await store.load()
        } catch { priceMessage = error.localizedDescription }
    }
    private func removeWish(_ row: IndexValue) async {
        guard let id = row["id"]?.text else { return }
        do {
            let response: IndexValue = try await store.client.request("api/inventory/native/wishlist/" + id, method: "DELETE")
            guard response["ok"]?.flag == true else { throw CompanionError.message("Wishlist could not be updated.") }
            await store.load()
        } catch { store.error = error.localizedDescription }
    }
}

private struct InventoryCollectionSummary: View {
    let records: [InventoryRecord]
    private var totals: InventoryValueSummary { InventoryValueSummary(records.flatMap(\.ownedHoldings)) }
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                InventoryMetricPill(text: "\(records.count) cards · \(totals.owned) copies")
                InventoryMetricPill(text: "Known value " + InventoryValueSummary.money(totals.value))
                InventoryMetricPill(text: "Invested " + InventoryValueSummary.money(totals.invested))
                InventoryMetricPill(text: "Known gain " + InventoryValueSummary.money(totals.value - totals.pricedCost))
                if totals.unpriced > 0 { InventoryMetricPill(text: "\(totals.unpriced) unpriced copies") }
            }
        }
    }
}

struct InventoryMetricPill: View {
    let text: String
    var body: some View {
        Text(text).font(.caption.weight(.semibold)).monospacedDigit().padding(.horizontal, 9).padding(.vertical, 6)
            .background(.secondary.opacity(0.12), in: Capsule())
    }
}

@MainActor
private struct InventoryCardGrid: View {
    let records: [InventoryRecord]
    let store: NativeInventoryStore
    var locationID: String? = nil
    private func holdings(_ record: InventoryRecord) -> [IndexValue] {
        guard let locationID else { return record.ownedHoldings }
        return record.ownedHoldings.filter { ($0["locationId"]?.text ?? $0["binderId"]?.text ?? "loose") == locationID }
    }
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 135, maximum: 210), spacing: 12)], alignment: .leading, spacing: 16) {
            ForEach(records) { record in
                NavigationLink { NativeInventoryDetail(record: record, store: store) } label: {
                    InventoryPosterCard(record: record, holdings: holdings(record), client: store.client)
                }.buttonStyle(.plain)
            }
        }
    }
}

@MainActor
struct InventoryPosterCard: View {
    let record: InventoryRecord
    let holdings: [IndexValue]
    let client: HomesteadClient
    private var totals: InventoryValueSummary { InventoryValueSummary(holdings) }
    private var printingCount: Int {
        Set(holdings.map { row in ["setCode", "rarity", "edition", "language"].map { row[$0]?.text ?? "" }.joined(separator: "|") }).count
    }
    private var detail: String {
        if holdings.count == 1 { return [holdings.first?["rarity"]?.text, holdings.first?["setCode"]?.text].compactMap { $0 }.joined(separator: " · ") }
        return "\(printingCount) printings"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            InventoryArtwork(path: record.artwork, client: client).aspectRatio(0.716, contentMode: .fit).clipped()
            VStack(alignment: .leading, spacing: 6) {
                Text(record.title).font(.subheadline.bold()).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                InventoryMetricPill(text: totals.unpriced == totals.owned ? "Price unavailable" : InventoryValueSummary.money(totals.value) + " total")
                    .foregroundStyle(totals.unpriced == totals.owned ? Color.secondary : Color.green)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 5) { InventoryMetricPill(text: "\(totals.owned) owned"); InventoryMetricPill(text: "\(printingCount) prints") }
                    Text("\(totals.owned) owned · \(printingCount) prints").font(.caption2)
                }
                if totals.unpriced > 0 && totals.unpriced < totals.owned { Text("\(totals.unpriced) copies unpriced").font(.caption2).foregroundStyle(.secondary) }
            }.padding(.horizontal, 9).padding(.bottom, 10)
        }.homesteadPanel(radius: 12)
    }
}

@MainActor
struct InventoryLocationEditor: View {
    let client: HomesteadClient
    var current: IndexValue? = nil
    var initialKind = "custom"
    let saved: (IndexValue) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var kind = "custom"
    @State private var description = ""
    @State private var pages = 20
    @State private var rows = 3
    @State private var columns = 3
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.orange) }
                Section("Location") {
                    TextField("Name", text: $name)
                    Picker("Type", selection: $kind) {
                        Text("Deck").tag("deck"); Text("Binder").tag("binder"); Text("Bin / Box").tag("box")
                        Text("Loose Cards").tag("loose"); Text("Custom").tag("custom")
                    }.disabled(current != nil)
                    TextField("Description", text: $description, axis: .vertical)
                }
                if kind == "binder" {
                    Section("Binder layout") {
                        Stepper("Pages: \(pages)", value: $pages, in: 1...500)
                        Stepper("Rows: \(rows)", value: $rows, in: 1...8)
                        Stepper("Columns: \(columns)", value: $columns, in: 1...8)
                    }
                }
            }.disabled(busy).homesteadCanvas().navigationTitle(current == nil ? "Create location" : "Edit location").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }.interactiveDismissDisabled(busy)
                .onAppear {
                    name = current?["name"]?.text ?? ""; kind = current?["kind"]?.text ?? initialKind
                    description = current?["description"]?.text ?? ""
                    pages = Int(current?["pages"]?.text ?? "20") ?? 20
                    rows = Int(current?["rows"]?.text ?? "3") ?? 3; columns = Int(current?["columns"]?.text ?? "3") ?? 3
                }
        }
    }
    private func save() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["name": name, "kind": kind, "description": description, "pages": pages, "rows": rows, "columns": columns])
            let route = "api/inventory/native/locations" + (current?["id"]?.text.map { "/" + $0 } ?? "")
            let result: IndexValue = try await client.request(route, method: current == nil ? "POST" : "PATCH", body: body)
            guard result["ok"]?.flag == true, let row = result["location"] else { throw CompanionError.message("Location save could not be confirmed. Refresh before retrying.") }
            saved(row); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

@MainActor
private struct InventoryLocationDetail: View {
    let location: IndexValue
    let store: NativeInventoryStore
    @State private var editing = false
    private var current: IndexValue { store.locations.first { $0["id"]?.text == location["id"]?.text } ?? location }
    private func holdings(_ record: InventoryRecord) -> [IndexValue] {
        record.printings.filter { ($0["locationId"]?.text ?? $0["binderId"]?.text ?? "loose") == current["id"]?.text }
    }
    var body: some View {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            if let description = current["description"]?.text, !description.isEmpty { Text(description) }
            InventoryCardGrid(records: store.records.filter { !holdings($0).isEmpty }, store: store, locationID: current["id"]?.text)
            if current["kind"]?.text == "deck", !(current["cards"]?.list ?? []).isEmpty {
                Text("Deck build").font(.title2.bold())
                Text("Deck references are separate from owned copies and physical storage.").font(.caption).foregroundStyle(.secondary)
                InventoryDeckPosters(cards: current["cards"]?.list ?? [], store: store)
            }
          }.padding().padding(.bottom, 90)
        }.homesteadCanvas().navigationTitle(current["name"]?.text ?? "Location").navigationBarTitleDisplayMode(.inline)
            .toolbar { if store.canEdit { Button("Edit") { editing = true } } }
            .sheet(isPresented: $editing) { InventoryLocationEditor(client: store.client, current: current) { _ in Task { await store.load() } } }
    }
}

@MainActor
private struct InventoryDeckPosters: View {
    let cards: [IndexValue]
    let store: NativeInventoryStore
    private func record(_ card: IndexValue) -> InventoryRecord? {
        if let id = card["inventoryRecordId"]?.text { return store.records.first { $0.id == id } }
        guard let id = card["providerCardId"]?.text ?? card["cardId"]?.text else { return nil }
        return store.records.first { $0.tcg?["providerCardId"]?.text == id }
    }
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 135, maximum: 210), spacing: 12)], alignment: .leading, spacing: 16) {
            ForEach(Array(cards.enumerated()), id: \.offset) { _, card in
                InventoryDeckPoster(card: card, record: record(card), store: store)
            }
        }
    }
}

@MainActor
private struct InventoryDeckPoster: View {
    let card: IndexValue
    let record: InventoryRecord?
    let store: NativeInventoryStore
    private var matchingHoldings: [IndexValue] {
        guard let record else { return [] }
        return record.ownedHoldings.filter { row in
            if let id = card["printingId"]?.text { return row["id"]?.text == id }
            if let code = card["setCode"]?.text, !code.isEmpty { return row["setCode"]?.text == code && (card["rarity"]?.text == nil || row["rarity"]?.text == card["rarity"]?.text) }
            return record.printingCount == 1
        }
    }
    private var poster: some View {
        VStack(alignment: .leading, spacing: 8) {
            InventoryArtwork(path: record?.artwork ?? card["image"]?.text, client: store.client).aspectRatio(0.716, contentMode: .fit).clipped()
            Text(record?.title ?? card["cardName"]?.text ?? "Card").font(.subheadline.bold()).lineLimit(2)
            InventoryMetricPill(text: "\(card["quantity"]?.text ?? "1") in deck")
            Text(card["section"]?.text ?? "Main").font(.caption).foregroundStyle(.secondary)
            InventoryMetricPill(text: unitPrice).foregroundStyle(.secondary)
        }.padding(9).homesteadPanel(radius: 12)
    }
    private var unitPrice: String {
        let totals = InventoryValueSummary(matchingHoldings)
        guard totals.owned > 0, totals.unpriced == 0 else { return "Select a priced printing" }
        let values = Set(matchingHoldings.compactMap { Double($0["marketValue"]?.text ?? "") })
        guard values.count == 1, let value = values.first else { return "Choose printing / condition" }
        return InventoryValueSummary.money(value) + " each"
    }
    var body: some View {
        if let record { NavigationLink { NativeInventoryDetail(record: record, store: store) } label: { poster }.buttonStyle(.plain) }
        else { poster }
    }
}

struct InventoryMoveTarget: Identifiable { let row: IndexValue; var id: String { row["id"]?.text ?? "" } }

@MainActor
struct InventoryMoveForm: View {
    let record: InventoryRecord
    let holding: IndexValue
    let store: NativeInventoryStore
    @Environment(\.dismiss) private var dismiss
    @State private var requestID = UUID()
    @State private var destination = "loose"
    @State private var quantity = 1
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.orange) }
                Text(record.title)
                Stepper("Move \(quantity) copies", value: $quantity, in: 1...max(1, Int(holding["quantity"]?.text ?? "1") ?? 1))
                Picker("Destination", selection: $destination) {
                    Text("Loose Cards").tag("loose")
                    ForEach(Array(store.locations.filter { $0["id"]?.text != "loose" }.enumerated()), id: \.offset) { _, row in Text(row["name"]?.text ?? "Location").tag(row["id"]?.text ?? "") }
                }
                Text("Moving copies preserves your total quantity, printing details, condition, cost and photos.").font(.caption)
            }.disabled(busy).navigationTitle("Move copies").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Move") { Task { await move() } }.disabled(busy || destination == (holding["locationId"]?.text ?? holding["binderId"]?.text ?? "loose")) }
                }.interactiveDismissDisabled(busy)
        }
    }
    private func move() async {
        guard !busy, let id = holding["id"]?.text else { return }; busy = true; defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["quantity": quantity, "locationId": destination, "requestId": requestID.uuidString])
            let route = "api/inventory/native/items/" + record.id + "/holdings/" + id + "/move"
            let result: IndexValue = try await store.client.request(route, method: "POST", body: body)
            guard result["ok"]?.flag == true else { throw CompanionError.message("The move could not be confirmed. Refresh before retrying.") }
            await store.load(); dismiss()
        } catch { self.error = error.localizedDescription + " Refresh this card before trying the move again." }
    }
}
