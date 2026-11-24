import SwiftUI
import AVKit
import AVFoundation
import Combine
import ImageIO

struct AdultProfileDetails: View {
    @Environment(\.homesteadAppearance) private var appearance
    let record: NativeSearchHit
    let client: HomesteadClient?
    @State private var updatedRecord: NativeSearchHit?
    @State private var showMediaPicker = false
    @State private var refreshError: String?
    @State private var profileActive = false
    @State private var biographyFilePath: String?
    @State private var biographyFileText = ""
    private var currentRecord: NativeSearchHit {
        var result = updatedRecord ?? record
        if result.profileBiography.isEmpty, let biographyFilePath,
           ProfilePresentation.biographyFile(result.payload) == biographyFilePath {
            result.profileBiography = biographyFileText
        }
        return result
    }
    @Environment(\.adultHidden) private var adultHidden
    @State private var aboutExpanded = false
    @State private var authorizationRevoked = false
    @State private var refreshing = false
    @State private var scanning = false
    @State private var preferences = ProfileAppearancePreferences()
    @State private var preferencesKey: String?
    @State private var tool: ProfileTool?
    @State private var canEdit = false
    @State private var intimateAllowed = false
    private var metadata: [ProfileMetadataItem] { currentRecord.profileMetadata.filter { !$0.opensBiography && (!$0.intimate || (!adultHidden && currentRecord.allowsIntimateMetadata && !authorizationRevoked && intimateAllowed)) } }
    @State private var limit = 60
    @State private var selectedTab: ProfileMediaTab = .photos
    @State private var selectedFolder = MediaFolderCatalog.all
    @State private var viewing: ProfileMediaFile?
    private var tabs: [ProfileMediaTab] { ProfileMediaTab.allCases.filter { tab in currentRecord.mediaFiles.contains { $0.tab == tab } } }
    private var categoryFiles: [ProfileMediaFile] { currentRecord.mediaFiles.filter { $0.tab == selectedTab } }
    private var folderRoot: String { MediaFolderCatalog.root(files: categoryFiles, profileCategory: true) }
    private var visibleFiles: [ProfileMediaFile] { MediaFolderCatalog.filter(categoryFiles, root: folderRoot, selected: selectedFolder) }
    var body: some View {
        if authorizationRevoked { ContentUnavailableView("Profile unavailable", systemImage: "lock") }
        else { profileContent }
    }
    private var profileContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                NativeProfileHeader(record: currentRecord, client: client, posterWidth: preferences.validated().posterWidth,
                                    biographyExpanded: $aboutExpanded, active: profileActive && viewing == nil && !showMediaPicker && tool == nil).id("profile-biography")
                ProfileSocialLinks(row: currentRecord.payload)
                if !metadata.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(metadata) { item in
                                    Label(item.value, systemImage: item.symbol).homesteadLibraryPill()
                                        .accessibilityElement(children: .ignore)
                                        .accessibilityLabel(item.label + ": " + item.value)
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).clipped().accessibilityLabel("Profile metadata")
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(tabs) { tab in
                            Button { selectedTab = tab; limit = 60 } label: {
                                Text(tab.rawValue).homesteadLibraryPill(selected: selectedTab == tab).fixedSize(horizontal: true, vertical: false)
                            }.accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                        }
                    }
                }
                MediaFolderTabs(files: categoryFiles, profileCategory: true, selected: $selectedFolder)
                if canEdit && (currentRecord.payload["sourcePath"]?.text ?? currentRecord.payload["folderPath"]?.text) != nil {
                    Button { Task { await scanFolders() } } label: { Label("Scan folders", systemImage: "arrow.clockwise") }.disabled(scanning || refreshing)
                }
                if let refreshError { Text(refreshError).foregroundStyle(.orange) }
                if currentRecord.mediaFiles.isEmpty { Text("No media files available.").foregroundStyle(.secondary) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 150), spacing: 10)], spacing: 14) {
                    ForEach(Array(visibleFiles.prefix(limit))) { file in
                        Button { viewing = file } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                appearance.color.opacity(0.08).aspectRatio(1, contentMode: .fit).overlay {
                                if file.playable {
                                    Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(appearance.color)
                                } else {
                                    ProfileImage(path: file.path, client: client)
                                }
                                }.clipShape(RoundedRectangle(cornerRadius: 14))
                                    .overlay { RoundedRectangle(cornerRadius: 14).stroke(appearance.color.opacity(0.25), lineWidth: 1) }
                                Text(file.title).font(.caption).lineLimit(2, reservesSpace: true)
                            }.frame(maxWidth: .infinity)
                        }.buttonStyle(.plain)
                    }
                }
                if visibleFiles.count > limit { Button("Show more") { limit += 60 } }
            }.padding().frame(maxWidth: 1000).frame(maxWidth: .infinity)
        }.homesteadCanvas().navigationTitle("").navigationBarTitleDisplayMode(.inline)
            .homesteadLoading(scanning, message: "Scanning profile folders…")
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Appearance", systemImage: "paintpalette") { tool = .appearance }.disabled(preferencesKey == nil)
                        if canEdit { Button("Edit Profile", systemImage: "pencil") { tool = .edit } }
                    } label: { Image(systemName: "pencil").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel("Profile appearance and editing")
                }
            }
            .sheet(item: $tool) { selected in
                switch selected {
                case .appearance: NativeProfileAppearance(preferences: $preferences)
                case .edit:
                    if canEdit, let target = currentRecord.uploadTarget, let client {
                        NativeProfileEditor(target: target, client: client, includeBody: currentRecord.allowsIntimateMetadata && intimateAllowed, onSaved: { saved in
                            updatedRecord = ProfileDetailRecord.updating(currentRecord, profile: saved)
                            NotificationCenter.default.post(name: .homesteadProfileRefreshed, object: client,
                                userInfo: ["profileId": target.id, "library": target.library, "profile": saved])
                        }, draft: ProfileEditDraft(row: currentRecord.payload))
                    }
                }
            }
            .task(id: record.id) { await loadProfileDetails() }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
                if let sender = notification.object as? HomesteadClient, sender === client, refreshError != nil { Task { await reloadProfile() } }
            }
            .onChange(of: selectedTab) { _, _ in selectedFolder = MediaFolderCatalog.all; limit = 60 }
            .onChange(of: preferences) { _, value in
                if let preferencesKey, let data = try? JSONEncoder().encode(value.validated()) { UserDefaults.standard.set(data, forKey: preferencesKey) }
            }
            .preference(key: ProfileAddActionKey.self, value: !profileActive || !canEdit || currentRecord.uploadTarget == nil ? nil : ProfileAddAction(id: record.id, open: { showMediaPicker = true }))
            .sheet(isPresented: $showMediaPicker, onDismiss: { Task { await reloadProfile() } }) {
                if let target = currentRecord.uploadTarget, let client { AddProfileMediaView(target: target, client: client) }
            }
            .refreshable { await reloadProfile() }
            .onAppear { profileActive = true; if !tabs.contains(selectedTab), let first = tabs.first { selectedTab = first } }
            .onDisappear { profileActive = false }
            .fullScreenCover(item: $viewing) { file in
                if let client { NativeMediaViewer(initial: file, files: visibleFiles, client: client) }
            }
    }
    private func scanFolders() async {
        guard !scanning, !refreshing, canEdit, let client, let target = currentRecord.uploadTarget,
              let folder = currentRecord.payload["sourcePath"]?.text ?? currentRecord.payload["folderPath"]?.text else { return }
        scanning = true; refreshError = nil
        defer { scanning = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["libraryId": target.library, "folder": folder, "mode": "folder"])
            let result: IndexValue = try await client.request("api/scan-library", method: "POST", body: body, timeout: 180)
            guard result["ok"]?.flag == true else { throw CompanionError.message("The scan was not confirmed.") }
            await reloadProfile()
        } catch {
            if !Task.isCancelled { refreshError = "The scan was not confirmed and may still be running. Pull down to refresh before starting another scan. " + error.localizedDescription }
        }
    }
    private func loadProfileDetails() async {
        guard let client, let target = record.uploadTarget, let section = AdultSection(rawValue: target.library) else { return }
        canEdit = false; intimateAllowed = false
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            let config: IndexValue = try await client.request("api/setup-config")
            try Task.checkCancellation()
            guard AdultAccess.sections(session: session, config: config).contains(section) else { authorizationRevoked = true; return }
            canEdit = ProfileEditAccess.allowed(session: session, config: config, target: target)
            intimateAllowed = AdultAccess.intimateMetadataAllowed(session: session, config: config, section: section)
            if let user = session["user"]?["id"]?.text {
                let key = ProfileAppearancePreferences.storageKey(server: client.baseURL.absoluteString, user: user, target: target)
                if let data = UserDefaults.standard.data(forKey: key), let value = try? JSONDecoder().decode(ProfileAppearancePreferences.self, from: data) {
                    preferences = value.validated()
                }
                preferencesKey = key
            }
            try await refreshMetadata()
        } catch { if !Task.isCancelled { refreshError = error.localizedDescription } }
    }
    private func refreshMetadata() async throws {
        guard let client, let target = record.uploadTarget else { return }
        let query = [URLQueryItem(name: "profileId", value: target.id), URLQueryItem(name: "libraryType", value: target.library)]
        let response: IndexValue = try await client.request("api/profiles/metadata", query: query)
        try Task.checkCancellation()
        if response["ok"]?.flag == true, let profile = response["profile"] {
            updatedRecord = ProfileDetailRecord.updating(currentRecord, profile: profile)
        }
        if let path = ProfilePresentation.biographyFile(currentRecord.payload) {
            let text = try await client.profileBiography(path)
            try Task.checkCancellation()
            guard ProfilePresentation.biographyFile(currentRecord.payload) == path else { return }
            biographyFilePath = path; biographyFileText = text
        } else {
            biographyFilePath = nil; biographyFileText = ""
        }
    }
    private func reloadProfile() async {
        guard !refreshing, let target = record.uploadTarget, let section = AdultSection(rawValue: target.library), let client else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            let config: IndexValue = try await client.request("api/setup-config")
            guard AdultAccess.sections(session: session, config: config).contains(section) else { authorizationRevoked = true; viewing = nil; return }
            intimateAllowed = AdultAccess.intimateMetadataAllowed(session: session, config: config, section: section)
            canEdit = ProfileEditAccess.allowed(session: session, config: config, target: target)
            let index = try await client.searchIndex(force: true)
            try Task.checkCancellation()
            if let fresh = AdultAccess.records(index: index, section: section, allowIntimateMetadata: AdultAccess.intimateMetadataAllowed(session: session, config: config, section: section)).first(where: { $0.uploadTarget?.id == target.id }) {
                authorizationRevoked = false
                updatedRecord = fresh
                if !tabs.contains(selectedTab), let first = tabs.first { selectedTab = first }
            } else { authorizationRevoked = true; viewing = nil; return }
            try await refreshMetadata()
            refreshError = nil
            NotificationCenter.default.post(name: .homesteadProfileRefreshed, object: client)
        } catch {
            if !Task.isCancelled { refreshError = "The profile could not refresh. Existing uploads will not be resent. Pull down to retry. " + error.localizedDescription }
        }
    }
}

struct ProfileImage: View {
    let path: String
    let client: HomesteadClient?
    @State private var image: UIImage?
    @State private var error: String?
    @State private var attempt = 0
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else if let error {
                VStack(spacing: 6) { Image(systemName: "arrow.clockwise.circle"); Text(error).font(.caption2).lineLimit(3); Text("Tap to retry").font(.caption.bold()) }
                    .contentShape(Rectangle()).highPriorityGesture(TapGesture().onEnded { attempt += 1 })
                    .accessibilityAddTraits(.isButton).accessibilityAction { attempt += 1 }
            }
            else { Image(systemName: "photo").foregroundStyle(.secondary) }
        }.task(id: ImageLoadKey(path: path, attempt: attempt)) {
            image = nil; error = nil
            guard let client else { error = "Server unavailable."; return }
            do {
                let data = try await client.profileImage(path)
                let decoded = await Task.detached(priority: .utility) { NativeImageDecoder.thumbnail(data, maximumPixelSize: 960) }.value
                guard let preview = decoded else { throw CompanionError.message("Image format unavailable.") }
                try Task.checkCancellation()
                image = UIImage(cgImage: preview)
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
            if let sender = notification.object as? HomesteadClient, sender === client, error != nil { attempt += 1 }
        }
        .onReceive(NotificationCenter.default.publisher(for: .homesteadProfileRefreshed)) { notification in
            if let sender = notification.object as? HomesteadClient, sender === client, error != nil { attempt += 1 }
        }
    }
}
