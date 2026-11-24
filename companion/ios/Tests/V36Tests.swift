import XCTest
@testable import HomesteadModels

final class V36Tests: XCTestCase {
    private func row(_ text: String) throws -> IndexValue { try JSONDecoder().decode(IndexValue.self, from: Data(text.utf8)) }

    func testBookFindsKeyedFilesAndNestedRelativeAudiobookParts() throws {
        let book = try row(#"{"folderPath":"/books/Cassandra Clare/City of Bones","files":{"ebook":{"filePath":"City of Bones.epub"}},"audiobook":{"files":{"10":{"path":"audiobook/City of Bones-Part10.mp3"},"2":{"path":"audiobook/City of Bones-Part02.mp3"},"1":{"path":"audiobook/City of Bones-Part01.mp3"}}}}"#)
        let files = PlaybackCatalog.files(book, includeBooks: true)
        XCTAssertEqual(files.filter(\.readable).map(\.path), ["/books/Cassandra Clare/City of Bones/City of Bones.epub"])
        XCTAssertEqual(BookWorkCatalog.orderedAudio(files).map(\.title), ["City of Bones-Part01.mp3", "City of Bones-Part02.mp3", "City of Bones-Part10.mp3"])
        XCTAssertFalse(PlaybackCatalog.files(book).contains(where: \.readable))
        XCTAssertFalse(PlaybackCatalog.files(book).contains(where: \.audio), "Book-only containers must not change other media semantics")
    }
    func testSiblingAudioAndEbookFoldersMergeWithoutMergingSameTitleElsewhere() throws {
        let root = try row(#"{"books":{"read":{"id":"read","title":"City of Bones","folderPath":"/books/Author/City of Bones","files":[{"path":"/books/Author/City of Bones/book.epub"}]},"other":{"id":"other","title":"City of Bones","folderPath":"/books/Another/City of Bones","files":[{"path":"/books/Another/City of Bones/book.pdf"}]}},"audiobooks":{"listen":{"id":"listen","title":"audiobook","folderPath":"/books/Author/City of Bones/audiobook","files":[{"path":"/books/Author/City of Bones/audiobook/Part01.mp3"}]}}}"#)
        let index = try MediaIndex(root: root)
        XCTAssertEqual(index.items.count, 2)
        let combined = try XCTUnwrap(index.items.first { $0.id == "books:read" })
        XCTAssertEqual(combined.files.filter(\.audio).count, 1)
        XCTAssertEqual(combined.files.filter(\.readable).count, 1)
        XCTAssertTrue(combined.identities.contains("listen"))
    }
    func testEbookSubfolderAndAudiobookSubfolderExposeBothActionsForOneBook() throws {
        let root = try row(#"{"libraries":{"books":{"read":{"id":"read","title":"City of Bones","folderPath":"/books/Author/City of Bones/ebook","files":[{"path":"/books/Author/City of Bones/ebook/Book.epub"}]},"listen":{"id":"listen","title":"audiobook","folderPath":"/books/Author/City of Bones/audiobook","files":[{"path":"/books/Author/City of Bones/audiobook/Part10.mp3"},{"path":"/books/Author/City of Bones/audiobook/Part02.mp3"},{"path":"/books/Author/City of Bones/audiobook/Part01.mp3"}]}}}}"#)
        let index = try MediaIndex(root: root)
        XCTAssertEqual(index.items.count, 1)
        let book = try XCTUnwrap(index.items.first)
        XCTAssertEqual(book.files.filter(\.readable).count, 1)
        XCTAssertEqual(BookWorkCatalog.orderedAudio(book.files).map(\.title), ["Part01.mp3", "Part02.mp3", "Part10.mp3"])
        XCTAssertTrue(book.identities.contains("read"))
        XCTAssertTrue(book.identities.contains("listen"))
    }
    func testSharedAuthorEbookFolderDoesNotCombineDifferentBooks() throws {
        let root = try row(#"{"libraries":{"books":{"one":{"id":"one","title":"First Book","folderPath":"/books/Author/ebooks","files":[{"path":"/books/Author/ebooks/First Book.epub"}]},"two":{"id":"two","title":"Second Book","folderPath":"/books/Author/ebooks","files":[{"path":"/books/Author/ebooks/Second Book.epub"}]}}}}"#)
        XCTAssertEqual(try MediaIndex(root: root).items.count, 2)
    }
    func testExplicitEditionLinksAndProviderIdentitiesKeepPriorityOverFolderHints() throws {
        let book = try row(#"{"id":"one","title":"Title","folderPath":"/books/Author/Title","metadata":{"workId":"provider-work"}}"#)
        XCTAssertEqual(BookWorkCatalog.identity(row: book, match: nil, key: "one", links: .object([:])), "provider:provider-work")
        let manual = try row(#"{"one":"selected-work"}"#)
        XCTAssertEqual(BookWorkCatalog.identity(row: book, match: nil, key: "one", links: manual), "manual:selected-work")
    }
    func testArtworkResolvesConfiguredBannerAliasesVideosAndIndexedBannerFiles() throws {
        for field in ["bannerPath", "bannerVideo", "selectedBanner"] {
            let value = try row("{\"profileDir\":\"/profiles/example\",\"metadata\":{\"\(field)\":\"banner.mov\"}}")
            XCTAssertEqual(ProfilePresentation.artwork(value, key: "banner", profileAliases: true), "/profiles/example/banner.mov")
        }
        let files = try row(#"{"files":{"banner":{"path":"/media/personal/example/banner.mp4"}}}"#)
        XCTAssertEqual(ProfilePresentation.artwork(files, key: "banner", profileAliases: true), "/media/personal/example/banner.mp4")
        let explicit = try row(#"{"banner":"/media/chosen.jpg","files":[{"path":"/media/banner.mp4"}]}"#)
        XCTAssertEqual(ProfilePresentation.artwork(explicit, key: "banner"), "/media/chosen.jpg")
    }
    func testBiographyFallsBackToAvailableRootDataRatherThanEmptyMetadata() throws {
        let profile = try row(#"{"metadata":{},"biography":"Available biography"}"#)
        XCTAssertEqual(ProfilePresentation.biography(profile), "Available biography")
        let cleared = try row(#"{"metadata":{"biography":"","metadataLocks":{"biography":true},"description":"Old alias"},"description":"Old description"}"#)
        XCTAssertEqual(ProfilePresentation.biography(cleared), "")
    }
    func testProfileArtworkAliasesDoNotHijackDiscoveryProviderPaths() throws {
        let discovery = try row(#"{"posterPath":"/provider.jpg","metadataMatch":{"poster":"matched.jpg"}}"#)
        XCTAssertEqual(SearchPresentation.poster(discovery), "https://image.tmdb.org/t/p/w342/provider.jpg")
        let local = try row(#"{"folderPath":"/profiles/example","posterPath":"/profiles/example/poster.jpg"}"#)
        XCTAssertEqual(ProfilePresentation.artwork(local, key: "poster", profileAliases: true), "/profiles/example/poster.jpg")
    }
    func testBiographyPathNeverDisplacesSavedAboutText() throws {
        let metadataAbout = try row(#"{"bio":"/media/personal/example/bio.md","metadata":{"bio":"/media/personal/example/bio.md","description":"Saved About section"}}"#)
        XCTAssertEqual(ProfilePresentation.biography(metadataAbout), "Saved About section")
        XCTAssertNil(ProfilePresentation.biographyFile(metadataAbout))
        let rootAbout = try row(#"{"metadata":{"bio":"bio.md"},"biography":"Canonical biography"}"#)
        XCTAssertEqual(ProfilePresentation.biography(rootAbout), "Canonical biography")
        let legacyText = try row(#"{"bio":"A legacy biography saved as text."}"#)
        XCTAssertEqual(ProfilePresentation.biography(legacyText), "A legacy biography saved as text.")
    }
    func testBiographyFileFallbackResolvesOnlyTextReferencesAndHonorsExplicitClear() throws {
        let fileOnly = try row(#"{"folderPath":"/profiles/example","bio":"bio.md"}"#)
        XCTAssertEqual(ProfilePresentation.biography(fileOnly), "")
        XCTAssertEqual(ProfilePresentation.biographyFile(fileOnly), "/profiles/example/bio.md")
        let cleared = try row(#"{"metadata":{"biography":"","metadataLocks":{"biography":true}},"bio":"/media/example/bio.md"}"#)
        XCTAssertNil(ProfilePresentation.biographyFile(cleared))
        let json = try row(#"{"bio":"/media/example/metadata.json"}"#)
        XCTAssertEqual(ProfilePresentation.biography(json), "")
        XCTAssertNil(ProfilePresentation.biographyFile(json))
        XCTAssertEqual(ProfilePresentation.biographyText("  A short biography.  "), "A short biography.")
        XCTAssertEqual(ProfilePresentation.biographyText("# About\nA longer biography."), "# About\nA longer biography.")
        XCTAssertEqual(ProfilePresentation.biographyText("She wrote a file called notes.md"), "She wrote a file called notes.md")
        XCTAssertEqual(ProfilePresentation.biographyText("<!doctype html><html>Application shell</html>"), "")
        XCTAssertEqual(ProfilePresentation.biographyText(#"C:\profiles\example\bio.md"#), "")
    }
    func testProfileAppearancePersistsAndIsolatesServerAccountLibraryAndProfile() throws {
        let target = ProfileUploadTarget(id: "same", name: "Display name", library: "personal")
        let key = ProfileAppearancePreferences.storageKey(server: "https://one", user: "one", target: target)
        XCTAssertNotEqual(key, ProfileAppearancePreferences.storageKey(server: "https://one", user: "two", target: target))
        XCTAssertNotEqual(key, ProfileAppearancePreferences.storageKey(server: "https://two", user: "one", target: target))
        XCTAssertNotEqual(key, ProfileAppearancePreferences.storageKey(server: "https://one", user: "one", target: .init(id: "same", name: "Name", library: "performers")))
        XCTAssertNotEqual(key, ProfileAppearancePreferences.storageKey(server: "https://one", user: "one", target: .init(id: "other", name: "Name", library: "personal")))
        let value = ProfileAppearancePreferences(posterWidth: 150)
        XCTAssertEqual(try JSONDecoder().decode(ProfileAppearancePreferences.self, from: JSONEncoder().encode(value)), value)
        XCTAssertEqual(ProfileAppearancePreferences(posterWidth: .infinity).validated().posterWidth, 120)
        XCTAssertEqual(ProfileAppearancePreferences(posterWidth: 400).validated().posterWidth, 180)
    }
    func testProfileEditingRequiresAdminAndAvailableAdultSection() throws {
        let config = try row(#"{"enabledLibraries":{"adult":true},"subscription":{"features":{"adult":true}}}"#)
        let target = ProfileUploadTarget(id: "example", name: "Example", library: "personal")
        let owner = try row(#"{"ok":true,"user":{"id":"owner","role":"owner"}}"#)
        XCTAssertTrue(ProfileEditAccess.allowed(session: owner, config: config, target: target))
        for role in ["child", "member", "guest"] {
            let session = try row("{\"ok\":true,\"user\":{\"role\":\"\(role)\",\"fullAdultAccess\":true}}")
            XCTAssertFalse(ProfileEditAccess.allowed(session: session, config: config, target: target))
        }
        XCTAssertFalse(ProfileEditAccess.allowed(session: owner, config: .object([:]), target: target))
    }
    func testEditPayloadIncludesOnlyChangesAndNeverExposesIntimateFields() throws {
        let profile = try row(#"{"name":"Example","metadata":{"biography":"Old bio","nationality":"US","clothingSize":"S","braSize":"private","timeline":[{"id":"history"}]}}"#)
        var draft = ProfileEditDraft(row: profile)
        XCTAssertTrue(try draft.patch(includeBody: true).isEmpty)
        draft.values["biography"] = "New bio"; draft.values["clothingSize"] = "M"; draft.values["braSize"] = "not allowed"
        XCTAssertEqual(try draft.patch(includeBody: false), ["biography": "New bio"])
        XCTAssertEqual(try draft.patch(includeBody: true), ["biography": "New bio", "clothingSize": "M"])
        draft.values["name"] = "  "
        XCTAssertThrowsError(try draft.patch(includeBody: false))
        draft.values["name"] = "Example"; draft.values["birthday"] = "2024-02-31"
        XCTAssertThrowsError(try draft.patch(includeBody: false))
    }
    func testSavedMetadataUpdatesDetailsAndKeepsProfileFilesIdentityAndUneditedFields() throws {
        let index = try row(#"{"personal":{"example":{"id":"example","name":"Old name","folderPath":"/profiles/example","metadata":{"nationality":"US"},"files":[{"path":"/media/personal/example/photo.jpg"}]}}}"#)
        let original = try XCTUnwrap(AdultAccess.records(index: index, section: .personal).first)
        let updated = ProfileDetailRecord.updating(original, profile: try row(#"{"metadata":{"name":"New name","biography":"Saved bio"}}"#))
        XCTAssertEqual(updated.title, "New name")
        XCTAssertEqual(updated.profileBiography, "Saved bio")
        XCTAssertEqual(updated.uploadTarget?.id, "example")
        XCTAssertEqual(updated.mediaFiles, original.mediaFiles)
        XCTAssertEqual(updated.payload["metadata"]?["nationality"]?.text, "US")
        let savedIndex = ProfileDetailRecord.applyingToIndex(index, library: "personal", id: "example", profile: try row(#"{"metadata":{"name":"Saved card name"}}"#))
        XCTAssertEqual(AdultAccess.records(index: savedIndex, section: .personal).first?.title, "Saved card name")
    }
    func testFolderValidationAndMultipartDestinationPreserveOriginalFileBytes() throws {
        for invalid in ["../outside", "/absolute", "C:\\outside", "one//two", "one/../two", ".hidden", "one/ bad", "bad\nname"] {
            XCTAssertThrowsError(try ProfileFolderPath.validate(invalid), invalid)
        }
        XCTAssertEqual(try ProfileFolderPath.child(parent: "Summer", name: "Beach"), "Summer/Beach")
        XCTAssertThrowsError(try ProfileFolderPath.child(parent: "", name: "one/two"))
        let local = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let original = Data([0, 255, 32, 128]); try original.write(to: local)
        defer { try? FileManager.default.removeItem(at: local) }
        let target = ProfileUploadTarget(id: "example", name: "Example", library: "personal")
        let body = try ProfileMultipart.build(file: local, name: "photo.heic", mime: "image/heic", target: target, type: "photo", boundary: "generated-boundary", destinationFolder: "Summer/Beach")
        defer { try? FileManager.default.removeItem(at: body) }
        let bytes = try Data(contentsOf: body), text = String(decoding: bytes, as: UTF8.self)
        XCTAssertNotNil(bytes.range(of: original))
        XCTAssertTrue(text.contains("name=\"destinationFolder\"\r\n\r\nSummer/Beach"))
        XCTAssertTrue(text.contains("name=\"profileFolderVersion\"\r\n\r\n1"))
        XCTAssertTrue(text.contains("Content-Type: image/heic"))
    }
}
