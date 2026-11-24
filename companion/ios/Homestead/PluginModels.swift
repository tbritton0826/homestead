import Foundation

enum PluginNavigationPolicy {
    static func allows(_ url: URL, server: URL, pluginID: String) -> Bool {
        guard url.scheme == server.scheme, url.host == server.host, url.port == server.port,
              url.user == nil, url.password == nil else { return false }
        let path = url.path
        guard !path.contains("\\"), !path.contains("%"),
              !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else { return false }
        let root = "/plugins/\(pluginID)"
        // Foundation's path can omit the directory URL's trailing slash.
        return path == root || path.hasPrefix(root + "/")
    }
}

struct PluginLibrary: Identifiable {
    struct Action: Identifiable {
        let id: String
        let title: String
        let sections: [String]
    }
    let id: String
    let title: String
    let sections: [Action]
    let actions: [Action]
    let clientPath: String
    let fullClient: Bool
    let permission: String

    static func catalogue(_ response: IndexValue, hidden: Bool) -> [PluginLibrary] {
        // Plugins may contain private data without declaring a content classification.
        guard !hidden else { return [] }
        return (response["plugins"]?.list ?? []).compactMap { row in
            let mainAI = row["navigation"]?["section"]?.text == "ai" && row["navigation"]?["slot"]?.text == "main"
            guard let id = row["id"]?.text,
                  id.range(of: "^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$", options: .regularExpression) != nil,
                  row["valid"]?.flag == true, row["enabled"]?.flag == true,
                  mainAI || row["navigation"]?["hideStandalone"]?.flag != true,
                  let path = row["clientUrl"]?.text, path == "/plugins/\(id)/" else { return nil }
            func actions(_ value: IndexValue?) -> [Action] {
                (value?.list ?? []).compactMap { entry in
                    guard let key = entry["id"]?.text, !key.isEmpty else { return nil }
                    return Action(id: key, title: entry["label"]?.text ?? key,
                        sections: entry["sections"]?.list.compactMap(\.text) ?? [])
                }
            }
            return PluginLibrary(id: id, title: row["navigation"]?["label"]?.text ?? row["name"]?.text ?? id,
                sections: actions(row["hostIntegration"]?["sections"]),
                actions: actions(row["hostIntegration"]?["addActions"]), clientPath: path,
                fullClient: row["type"]?.text == "full", permission: mainAI ? "ai" : "plugin:" + id)
        }
    }
}
