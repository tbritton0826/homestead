import Foundation

struct AIModelChoice: Identifiable {
    let id: String
    let label: String
    let mode: String
    let provider: String
    let model: String
    static func choices(_ catalog: IndexValue) -> [Self] {
        let assistant = catalog["assistant"]
        var result = [Self(id: "assistant", label: assistant?["label"]?.text ?? "Homestead Assistant", mode: "assistant", provider: "", model: "")]
        if catalog["chatAllowed"]?.flag == true {
            result += (catalog["models"]?.list ?? []).compactMap { row in
                guard let provider = row["provider"]?.text, let model = row["model"]?.text, !provider.isEmpty, !model.isEmpty else { return nil }
                return Self(id: "chat:" + provider + ":" + model, label: row["label"]?.text ?? model, mode: "chat", provider: provider, model: model)
            }
        }
        return result
    }
}

enum AIContract {
    static let root = "api/plugins/homestead-ai-assistant"
    static func safeID(_ id: String?) -> String? {
        guard let id, id.range(of: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$", options: .regularExpression) != nil else { return nil }
        return id
    }
    static func body(message: String, conversationID: String?, choice: AIModelChoice, attachments: [String]) throws -> Data {
        let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, choice.mode == "assistant" || attachments.isEmpty,
              conversationID == nil || safeID(conversationID) != nil else { throw CocoaError(.coderInvalidValue) }
        var fields: [String: Any] = ["message": message, "mode": choice.mode,
            "model": ["provider": choice.provider, "model": choice.model], "attachmentIds": attachments]
        if let conversationID { fields["conversationId"] = conversationID }
        return try JSONSerialization.data(withJSONObject: fields)
    }
    static func pretty(_ value: IndexValue) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value.jsonObject, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func setting(_ config: IndexValue, path: [String], value: IndexValue) -> IndexValue {
        guard let first = path.first else { return value }
        var fields = config.fields
        fields[first] = setting(fields[first] ?? .object([:]), path: Array(path.dropFirst()), value: value)
        return .object(fields)
    }
}
