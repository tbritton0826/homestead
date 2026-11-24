import Foundation

struct ProfileUploadTarget: Equatable, Sendable {
    let id: String
    let name: String
    let library: String
}

enum ProfileMultipart {
    static func build(file: URL, name: String, mime: String, target: ProfileUploadTarget, type: String, boundary: String, destinationFolder: String = "") throws -> URL {
        try ProfileFolderPath.validate(destinationFolder)
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".multipart")
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        do {
            let output = try FileHandle(forWritingTo: destination)
            defer { try? output.close() }
            func write(_ text: String) throws { try output.write(contentsOf: Data(text.utf8)) }
            var fields = [("targetLibrary", target.library), ("profileId", target.id), ("profileName", target.name), ("importType", type), ("sourceName", "device-upload")]
            if !destinationFolder.isEmpty { fields += [("destinationFolder", destinationFolder), ("profileFolderVersion", "1")] }
            for (key, value) in fields {
                try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n")
            }
            let safeName = name.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "_").replacingOccurrences(of: "\n", with: "_")
            try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"\(safeName)\"\r\nContent-Type: \(mime)\r\n\r\n")
            let input = try FileHandle(forReadingFrom: file)
            defer { try? input.close() }
            while let data = try input.read(upToCount: 1024 * 1024), !data.isEmpty { try output.write(contentsOf: data) }
            try write("\r\n--\(boundary)--\r\n")
            return destination
        } catch { try? FileManager.default.removeItem(at: destination); throw error }
    }
}

enum ProfileFolderPath {
    static func validate(_ path: String) throws {
        if path.isEmpty { return }
        let segments = path.components(separatedBy: "/")
        let forbidden = CharacterSet(charactersIn: "\\:").union(.controlCharacters)
        guard path.count <= 1024, segments.count <= 12, segments.allSatisfy({ segment in
            !segment.isEmpty && !segment.hasPrefix(".") && segment.count <= 120 &&
                segment == segment.trimmingCharacters(in: .whitespacesAndNewlines) && segment.rangeOfCharacter(from: forbidden) == nil
        }) else { throw CompanionError.message("Choose a folder within this profile without hidden names, separators, or control characters.") }
    }
    static func child(parent: String, name: String) throws -> String {
        guard !name.contains("/"), !name.isEmpty else { throw CompanionError.message("Enter one folder name.") }
        let path = parent.isEmpty ? name : parent + "/" + name
        try validate(path)
        return path
    }
    static func title(for type: String) -> String {
        switch type { case "nude": return "Nudes"; case "artwork": return "Artwork"; case "reference": return "References"; default: return "Photos" }
    }
}

struct ProfileFolderOption: Decodable, Identifiable {
    let name: String
    let path: String
    var id: String { path }
}
struct ProfileFolderListing: Decodable {
    let ok: Bool
    let version: Int
    let parent: String
    let folders: [ProfileFolderOption]
}
