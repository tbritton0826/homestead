import Foundation
import CryptoKit

enum InventorySection: String, CaseIterable, Identifiable {
    case all, general, media, electronics, tools, collectibles, tcg, outdoor, documents, locations, warranties, binders, decks
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "All Items"
        case .tcg: return "TCG"
        default: return rawValue.capitalized
        }
    }
    var category: String { self == .tcg ? "trading-cards" : rawValue }
    static var itemCategories: [Self] { [.general, .media, .electronics, .tools, .collectibles, .tcg, .outdoor, .documents] }
}

struct InventoryRecord: Identifiable, Sendable {
    let row: IndexValue
    var id: String { row["id"]?.text ?? "" }
    var title: String { row["title"]?.text ?? row["name"]?.text ?? "Inventory item" }
    var category: String { row["category"]?.text ?? row["metadata"]?["category"]?.text ?? "general" }
    var tcg: IndexValue? { row["tcg"] }
    var location: String { tcg?["location"]?.text ?? row["location"]?.text ?? row["metadata"]?["location"]?.text ?? "" }
    var quantity: String { tcg?["quantity"]?.text ?? row["quantity"]?.text ?? "1" }
    var locationTotals: [(String, Int)] {
        let grouped = Dictionary(grouping: printings, by: { $0["location"]?.text ?? $0["binder"]?.text ?? "Loose Cards" })
        return grouped.map { name, rows in (name, rows.reduce(0) { $0 + (Int($1["quantity"]?.text ?? "1") ?? 1) }) }.sorted { $0.0 < $1.0 }
    }
    var condition: String { tcg?["condition"]?.text ?? row["condition"]?.text ?? "" }
    var printings: [IndexValue] { tcg?["printings"]?.list ?? [] }
    var photos: [IndexValue] { row["captures"]?.list ?? [] }
    var artwork: String? {
        let metadata = row["metadata"]
        let sources: [String?] = [row["poster"]?.text, tcg?["selectedArtwork"]?.text,
            metadata?["thumbnail"]?.text, metadata?["image"]?.text, tcg?["selectedPrinting"]?["image"]?.text,
            printings.first?["selectedArtwork"]?.text, photos.first?["url"]?.text, photos.first?["dataUrl"]?.text]
        return sources.compactMap { $0 }.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
    var subtitle: String { [category == "trading-cards" ? "Yu-Gi-Oh!" : category.capitalized, location].filter { !$0.isEmpty }.joined(separator: " · ") }
    func matches(section: InventorySection, query: String) -> Bool {
        if InventorySection.itemCategories.contains(section), category != section.category { return false }
        if section == .locations && location.isEmpty { return false }
        if section == .warranties && row["warrantyExpiry"]?.text == nil && row["metadata"]?["warrantyExpiry"]?.text == nil { return false }
        let fields: [String] = [title, category, location, condition, row["code"]?.text ?? "", row["notes"]?.text ?? "",
            tcg?["setCode"]?.text ?? "", tcg?["cardName"]?.text ?? "", tcg?["providerCardId"]?.text ?? ""]
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return needle.isEmpty || fields.joined(separator: " ").localizedCaseInsensitiveContains(needle) || printings.contains {
            [$0["setCode"]?.text ?? "", $0["rarity"]?.text ?? "", $0["condition"]?.text ?? ""].joined(separator: " ").localizedCaseInsensitiveContains(needle)
        }
    }
}

struct InventoryValueSummary {
    var owned = 0
    var unpriced = 0
    var value = 0.0
    var invested = 0.0
    var pricedCost = 0.0
    init(_ holdings: [IndexValue]) {
        for row in holdings {
            let count = max(0, Int(row["quantity"]?.text ?? "1") ?? 1)
            let cost = Double(row["purchasePrice"]?.text ?? "0") ?? 0
            let estimate = Double(row["marketValue"]?.text ?? "")
            owned += count
            if cost.isFinite && cost >= 0 { invested += cost * Double(count) }
            if row["priceAvailable"]?.flag != false, row["priceSourceType"]?.text != "unavailable", let estimate, estimate.isFinite,
               estimate > 0 || (estimate == 0 && (row["priceAvailable"]?.flag == true || row["priceSourceType"]?.text == "manual-override")) {
                value += estimate * Double(count)
                if cost.isFinite && cost >= 0 { pricedCost += cost * Double(count) }
            } else { unpriced += count }
        }
    }
    static func money(_ amount: Double) -> String { String(format: "$%.2f", amount) }
}

extension InventoryRecord {
    var ownedHoldings: [IndexValue] { !printings.isEmpty ? printings : tcg.map { [$0] } ?? [] }
    var valueSummary: InventoryValueSummary { InventoryValueSummary(ownedHoldings) }
    var printingCount: Int {
        Set(ownedHoldings.map { holding in
            ["setCode", "rarity", "edition", "language"].map { holding[$0]?.text ?? "" }.joined(separator: "|")
        }).count
    }
}

struct InventoryPhoto: Identifiable, Sendable {
    let id: UUID
    let name: String
    let data: Data
    var payload: [String: Any] { ["id": id.uuidString, "name": name, "type": "image/jpeg", "size": data.count, "dataUrl": "data:image/jpeg;base64," + data.base64EncodedString()] }
}

enum InventoryCatalog {
    static func records(_ response: IndexValue) -> [InventoryRecord] {
        (response["records"]?.list ?? []).filter { $0["id"]?.text != nil }.map { InventoryRecord(row: $0) }
    }
    static func visible(session: IndexValue, config: IndexValue) -> Bool {
        guard session["ok"]?.flag == true, config["subscription"]?["features"]?["inventory"]?.flag == true,
              config["enabledLibraries"]?["inventory"]?.flag != false else { return false }
        if session["authEnabled"]?.flag == false { return true }
        let user = session["user"]
        let allowed = user?["allowedLibraries"]?.list.compactMap(\.text) ?? []
        return user?["role"]?.text == "owner" || allowed.contains("*") || allowed.contains("inventory")
    }
    static func organizationRecords(_ organization: IndexValue, records: [InventoryRecord], binder: Bool) -> [InventoryRecord] {
        let id = organization["id"]?.text ?? ""
        if binder { return records.filter { record in record.printings.contains { $0["binderId"]?.text == id } || record.tcg?["binderId"]?.text == id } }
        let ids = Set(organization["cards"]?.list.compactMap { $0["inventoryRecordId"]?.text } ?? [])
        return records.filter { ids.contains($0.id) }
    }
}

enum InventoryCardSearch {
    static func queryItems(name: String, setCode: String, passcode: String) -> [URLQueryItem] {
        let code = setCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let id = passcode.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !id.isEmpty { return [URLQueryItem(name: "cardId", value: id), URLQueryItem(name: "setCode", value: code)] }
        if !code.isEmpty { return [URLQueryItem(name: "setCode", value: code)] }
        return [URLQueryItem(name: "name", value: title)]
    }
}

struct NativeInventoryDraft {
    var title = ""
    var category = "general"
    var code = ""
    var notes = ""
    var location = ""
    var condition = ""
    var quantity = 1
    var brand = ""
    var model = ""
    var serialNumber = ""
    var purchasePrice = ""
    var purchaseDate = ""
    var warrantyExpiry = ""
    var setCode = ""
    var rarity = ""
    var edition = "Unlimited"
    var language = "English"
    var providerCardID = ""
    var artwork = ""
    var artworkID = ""
    var marketValue = ""
    var locationID = "loose"
    var locationType = "loose"
    var binderID = ""
    var page = ""
    var pocket = ""
    var deckIDs: Set<String> = []
    var duplicateAction = "create"
    var metadata: IndexValue = .object([:])
    var selectedPrinting: IndexValue = .object([:])
    var refreshedPrice: IndexValue? = nil
    mutating func applyPriceQuote(_ quote: IndexValue) {
        guard quote["priceAvailable"]?.flag == true, case .object(let fields) = quote else { return }
        var merged: [String: IndexValue] = [:]
        if case .object(let previous) = selectedPrinting { merged = previous }
        merged.merge(fields) { _, new in new }
        selectedPrinting = .object(merged); marketValue = quote["marketValue"]?.text ?? ""; refreshedPrice = quote
    }
    var card: Bool { category == "trading-cards" }
    static func editing(_ record: InventoryRecord, printing: IndexValue? = nil) -> Self {
        var result = Self()
        let row = record.row, tcg = printing ?? record.tcg
        result.title = record.title; result.category = record.category
        result.code = row["code"]?.text ?? ""; result.notes = row["notes"]?.text ?? ""
        result.location = tcg?["location"]?.text ?? record.location
        result.condition = tcg?["condition"]?.text ?? record.condition
        result.quantity = Int(tcg?["quantity"]?.text ?? record.quantity) ?? 1
        result.brand = row["brand"]?.text ?? row["metadata"]?["brand"]?.text ?? ""; result.model = row["model"]?.text ?? row["metadata"]?["model"]?.text ?? ""
        result.serialNumber = row["serialNumber"]?.text ?? ""
        result.purchasePrice = tcg?["purchasePrice"]?.text ?? row["purchasePrice"]?.text ?? ""
        result.purchaseDate = row["purchaseDate"]?.text ?? ""; result.warrantyExpiry = row["warrantyExpiry"]?.text ?? ""
        result.setCode = tcg?["setCode"]?.text ?? ""; result.rarity = tcg?["rarity"]?.text ?? ""
        result.edition = tcg?["edition"]?.text ?? "Unlimited"; result.language = tcg?["language"]?.text ?? "English"
        result.locationID = tcg?["locationId"]?.text ?? tcg?["binderId"]?.text ?? "loose"
        result.locationType = tcg?["locationType"]?.text ?? (result.locationID == "loose" ? "loose" : "binder")
        result.binderID = tcg?["binderId"]?.text ?? ""; result.page = tcg?["page"]?.text ?? ""; result.pocket = tcg?["pocket"]?.text ?? ""
        result.selectedPrinting = tcg ?? .object([:])
        result.marketValue = tcg?["priceAvailable"]?.flag == false ? "" : tcg?["marketValue"]?.text ?? ""
        return result
    }
    mutating func applyProduct(_ result: IndexValue) {
        if card { providerCardID = ""; selectedPrinting = .object([:]); artworkID = "" }
        metadata = result["metadata"] ?? .object([:])
        if let name = metadata["title"]?.text { title = name }
        if let value = metadata["brand"]?.text { brand = value }
        artwork = metadata["thumbnail"]?.text ?? ""
    }
    mutating func applyCard(_ match: IndexValue) {
        refreshedPrice = nil
        category = "trading-cards"; selectedPrinting = match
        metadata = .object(["title": match["cardName"] ?? .string(""), "description": match["description"] ?? .string(""),
                            "thumbnail": match["image"] ?? .string(""), "provider": match["provider"] ?? .string("YGOPRODeck")])
        title = match["cardName"]?.text ?? title; providerCardID = match["cardId"]?.text ?? ""
        setCode = match["setCode"]?.text ?? ""; rarity = match["rarity"]?.text ?? ""
        artwork = match["image"]?.text ?? ""; artworkID = match["artworkVariants"]?.list.first?["id"]?.text ?? ""
        marketValue = match["priceAvailable"]?.flag == false ? "" : match["marketValue"]?.text ?? ""
        if condition.isEmpty { condition = "Near Mint" }
    }
    static func money(_ value: String) throws -> Double {
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return 0 }
        guard let result = Double(value.replacingOccurrences(of: ",", with: ".")), result.isFinite, result >= 0 else {
            throw CompanionError.message("Enter a valid nonnegative price.")
        }
        return result
    }
    func fields() throws -> [String: Any] {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, (1...100000).contains(quantity) else {
            throw CompanionError.message("Enter a title and valid quantity.")
        }
        return ["title": title, "category": category, "notes": notes, "location": location, "condition": condition,
                "quantity": quantity, "brand": brand, "model": model, "serialNumber": serialNumber,
                "purchasePrice": try Self.money(purchasePrice), "purchaseDate": purchaseDate, "warrantyExpiry": warrantyExpiry]
    }
    func createBody(requestID: UUID, photos: [InventoryPhoto]) throws -> Data {
        var result = try fields()
        result["requestId"] = requestID.uuidString; result["code"] = code; result["duplicateAction"] = duplicateAction
        result["captures"] = photos.map(\.payload); result["metadata"] = metadata.inventoryJSON
        if card {
            var tcg: [String: Any] = ["cardName": title, "providerCardId": providerCardID, "setCode": setCode,
                "rarity": rarity, "edition": edition, "language": language, "selectedArtwork": artwork,
                "selectedArtworkId": artworkID, "locationId": locationID, "locationType": locationType, "binderId": locationType == "binder" ? locationID : "", "page": page, "pocket": pocket]
            tcg["marketValue"] = try Self.money(marketValue)
            tcg["selectedPrinting"] = selectedPrinting.inventoryJSON
            tcg["linkedDeckIds"] = deckIDs.sorted()
            tcg["printingPrice"] = Double(selectedPrinting["printingPrice"]?.text ?? "") ?? 0
            tcg["genericPrice"] = Double(selectedPrinting["genericPrice"]?.text ?? "") ?? 0
            let original = selectedPrinting["priceAvailable"]?.flag == false ? "" : selectedPrinting["marketValue"]?.text ?? ""
            let manual = !marketValue.isEmpty && marketValue != original
            tcg["priceAvailable"] = !marketValue.isEmpty
            tcg["priceSource"] = manual ? "Manual estimate" : selectedPrinting["priceSource"]?.text ?? "Manual estimate"
            tcg["priceSourceType"] = manual ? "manual-override" : selectedPrinting["priceSourceType"]?.text ?? "manual-override"
            tcg["priceDifferenceWarning"] = selectedPrinting["priceDifferenceWarning"]?.flag ?? false
            for key in ["priceProviderId", "priceCurrency", "priceCheckedAt", "priceUpdatedAt", "pricedSetCode", "pricedRarity", "pricedEdition", "pricedCondition"] {
                if let value = selectedPrinting[key] { tcg[key] = value.inventoryJSON }
            }
            tcg["artworkVariants"] = (selectedPrinting["artworkVariants"] ?? .array([])).inventoryJSON
            result["tcg"] = tcg
        }
        return try JSONSerialization.data(withJSONObject: result)
    }
    func editBody(printing: Bool) throws -> Data {
        if printing {
            var result: [String: Any] = ["setCode": setCode, "rarity": rarity, "edition": edition, "language": language,
                "condition": condition, "quantity": quantity, "location": location, "purchasePrice": try Self.money(purchasePrice),
                "binderId": locationType == "binder" ? locationID : "", "locationId": locationID, "locationType": locationType, "page": page, "pocket": pocket]
            let original = selectedPrinting["priceAvailable"]?.flag == false ? "" : selectedPrinting["marketValue"]?.text ?? ""
            if marketValue != original {
                result["marketValue"] = try Self.money(marketValue)
                if marketValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result["priceAvailable"] = false; result["priceSourceType"] = "unavailable"; result["priceSource"] = "Printing price unavailable"
                }
            }
            else if let refreshedPrice, case .object(let quote) = refreshedPrice {
                for key in ["marketValue", "priceAvailable", "priceSource", "priceSourceType", "printingPrice", "priceCheckedAt", "priceProviderId", "priceCurrency", "pricedSetCode", "pricedRarity", "pricedEdition", "pricedCondition"] {
                    if let value = quote[key] { result[key] = value.inventoryJSON }
                }
            }
            return try JSONSerialization.data(withJSONObject: result)
        }
        var result = try fields()
        if card { result = ["title": title, "notes": notes] }
        return try JSONSerialization.data(withJSONObject: result)
    }
}

extension IndexValue {
    var inventoryJSON: Any {
        switch self {
        case .object(let fields): return fields.mapValues { $0.inventoryJSON }
        case .array(let values): return values.map { $0.inventoryJSON }
        case .string(let text): return text
        case .number(let number): return number
        case .bool(let flag): return flag
        case .other: return NSNull()
        }
    }
}


enum TcgLibraryTab: String, CaseIterable, Identifiable {
    case cards, decks, binders, boxes, loose, custom, wishlist
    var id: String { rawValue }
    var title: String { self == .boxes ? "Bins / Boxes" : self == .loose ? "Loose Cards" : self == .custom ? "Custom Locations" : rawValue.capitalized }
    var kind: String? {
        switch self {
        case .decks: return "deck"
        case .binders: return "binder"
        case .boxes: return "box"
        case .loose: return "loose"
        case .custom: return "custom"
        default: return nil
        }
    }
}

struct InventoryQueueEntry: Identifiable {
    let id: UUID
    var draft: NativeInventoryDraft
    var photos: [InventoryPhoto]
    var payload: [String: Any] {
        get throws {
            let data = try draft.createBody(requestID: id, photos: photos)
            var row = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            row.removeValue(forKey: "requestId"); row["id"] = id.uuidString
            return row
        }
    }
    static func body(_ entries: [Self], requestID: UUID) throws -> Data {
        guard (1...30).contains(entries.count) else { throw CompanionError.message("Queue between one and 30 printings.") }
        guard entries.flatMap(\.photos).reduce(0, { $0 + $1.data.count }) <= 20 * 1024 * 1024 else {
            throw CompanionError.message("The queue photos exceed 20 MB. Save a smaller batch.")
        }
        return try JSONSerialization.data(withJSONObject: ["requestId": requestID.uuidString, "entries": try entries.map { try $0.payload }], options: [.sortedKeys])
    }
}

enum InventoryQueueRecovery {
    static func file(scope: String) throws -> URL {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("HomesteadInventoryQueues", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let name = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(name + ".json")
    }
}
