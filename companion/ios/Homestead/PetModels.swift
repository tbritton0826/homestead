import Foundation

enum PetCatalog {
    struct Folders: Decodable { let ok: Bool; let folders: [ProfileFolderOption] }
    static let fields = ["name", "species", "breed", "sex", "birthday", "weight", "description"]
    static func records(_ response: IndexValue) -> [FamilyRecord] {
        FamilyCatalog.records(.object(["pets": response["records"] ?? .array([])]), library: "pets")
    }
    static func createBody(_ values: [String: String], requestID: UUID? = nil) throws -> Data {
        var result: [String: String] = [:]
        for key in fields { result[key] = (values[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !(result["name"] ?? "").isEmpty else { throw CompanionError.message("Enter a pet name.") }
        if let requestID { result["requestId"] = requestID.uuidString }
        return try JSONEncoder().encode(result)
    }
}

struct PetPhotoOriginal: Decodable, Identifiable {
    let path: String
    let name: String
    var id: String { path }
}
struct PetPhotoGroup: Decodable, Identifiable {
    let id: String
    let name: String
    let petIds: [String]
    let unresolved: [String]
    let missingPetIds: [String]
    let confirmed: Bool
    let files: [PetPhotoOriginal]
}
struct PetPhotoSourcesResponse: Decodable { let ok: Bool; let files: [PetPhotoOriginal] }
struct PetPhotoGroupsResponse: Decodable { let ok: Bool; let groups: [PetPhotoGroup] }
struct PetPhotoMove: Decodable {
    struct Item: Decodable, Identifiable {
        let from: String
        let to: String
        let done: Bool
        var id: String { from }
    }
    let id: String
    let folder: String
    let items: [Item]
}
struct PetPhotoMoveResponse: Decodable { let ok: Bool; let plan: PetPhotoMove }
