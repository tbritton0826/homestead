import SwiftUI
import Combine
import UIKit
import ImageIO

struct CompanionTabs: View {
    @Bindable var model: CompanionModel
    @State private var tab = 0
    @State private var category: MediaCategory?
    @State private var showAdd = false
    @State private var showSettings = false
    @State private var showSearch = false
    @State private var searchAfterAdd = false
    @State private var familySection: FamilySection = .home
    @State private var adultSection: AdultSection = .personal
    @State private var adultRevision = 0
    var body: some View {
        TabView(selection: $tab) {
            HomeDashboard(model: model, openSearch: { showSearch = true }) { selected in
                category = selected
                tab = 1
            }
            .modifier(GlobalAddButton { showAdd = true })
            .tabItem { Label("Home", systemImage: "house") }.tag(0)
            MediaLibrary(model: model, category: $category)
                .modifier(GlobalAddButton(visible: false) { showAdd = true })
                .tabItem { Label("Media", systemImage: "play.rectangle") }.tag(1)
            FamilyLibraryView(model: model, section: $familySection)
                .modifier(GlobalAddButton { showAdd = true })
                .tabItem { Label("Family", systemImage: "person.3") }.tag(2)
            if !model.adultPrivacy.hidden { AdultLibraryView(client: model.client, selected: $adultSection, refreshRevision: adultRevision)
                .modifier(GlobalAddButton { showAdd = true })
                .tabItem { Label("Adult", systemImage: "lock.shield") }.tag(5) }
            MoreLibrariesView(model: model, openSettings: { showSettings = true })
                .id(model.adultPrivacy.hidden)
                .tabItem { Label("More", systemImage: "ellipsis") }.tag(4)
        }
        .onChange(of: model.adultPrivacy.hidden) { _, hidden in
            if hidden { tab = 0; showAdd = false; showSearch = false }
        }
        .environment(\.openGlobalSearch, { showSearch = true })
        .sheet(isPresented: $showSearch) {
            NativeSearchPage(client: model.client, onClose: { showSearch = false }, ownedItems: model.media).id(model.adultPrivacy.hidden)
        }
        .task { await model.refreshMedia() }
        .overlay {
            let dedicatedBrowser = tab == 1 && (category == .photos || category == .music || category == .youtube)
            if !dedicatedBrowser && MediaLoadingPresentation.showsOverlay(tab: tab, busy: model.mediaBusy, loaded: model.mediaLoaded,
                                                     connectionFailed: model.connectionError != nil) {
                MediaLoadingCard().allowsHitTesting(false)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let message = model.connectionError {
                HStack {
                    Label(model.checkingSession ? "Checking your Homestead connection…" : message,
                          systemImage: "wifi.exclamationmark").font(.caption)
                    Button("Retry") { Task { await model.resumeConnection(force: true) } }
                        .disabled(model.checkingSession)
                }.padding(12).homesteadPanel(radius: 14).padding(.horizontal, 12)
            }
        }
        .sheet(isPresented: $showAdd, onDismiss: {
            adultRevision += 1
            if searchAfterAdd { searchAfterAdd = false; showSearch = true }
            Task { await model.refresh(); await model.refreshMedia(force: true) }
        }) {
            if let client = model.client {
                if tab == 5 && !model.adultPrivacy.hidden {
                    AdultProfileWizard(client: client, initialSection: adultSection)
                } else if tab == 1 && category == .photos {
                    NativePhotoImport(client: client)
                } else if tab == 2 && familySection == .pets {
                    NativePetWizard(client: client)
                } else {
                    AddHub(client: client, familySection: tab == 2 ? familySection : nil, mediaOnly: tab == 1 || tab == 4) { searchAfterAdd = true }
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            VStack(spacing: 0) {
                HStack { Spacer(); Button("Done") { showSettings = false }.padding() }
                CompanionSettings(model: model)
            }
        }
    }
}

private struct HomeDashboard: View {
    @Environment(\.homesteadAppearance) private var appearance
    @Bindable var model: CompanionModel
    let openSearch: () -> Void
    let openLibrary: (MediaCategory) -> Void
    private var recent: [MediaItem] {
        Array(model.media.filter { $0.addedAt != nil }.sorted {
            ($0.addedAt ?? .distantPast) > ($1.addedAt ?? .distantPast)
        }.prefix(12))
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    MediaLoadStatus(model: model)
                    Text("Your libraries").font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 10)], spacing: 10) {
                        ForEach(MediaCategory.allCases) { category in
                            Button { openLibrary(category) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: category.symbol).font(.system(size: 22)).foregroundStyle(appearance.color)
                                        .frame(width: 28).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 3) {
                                    Text(category.title).font(.subheadline.bold())
                                    Text(model.mediaLoaded ? "\(model.media.filter { $0.category == category }.count)" : "—")
                                        .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(10).homesteadPanel(radius: 16)
                            }.buttonStyle(.plain)
                        }
                    }
                    if let client = model.client { ContinueWatching(client: client, media: model.media, hidesEmpty: true).id(model.adultPrivacy.hidden) }
                    if !recent.isEmpty {
                        Text("Recently added").font(.title2.bold())
                        ScrollView(.horizontal) { LazyHStack(alignment: .top, spacing: 14) {
                            ForEach(recent) { item in
                                NavigationLink(value: item) { MediaPoster(item: item, client: model.client).frame(width: 140) }
                                    .buttonStyle(.plain)
                            }
                        }}.scrollIndicators(.hidden)
                    } else if model.mediaLoaded {
                        Text(model.media.isEmpty ? "No media yet." : "No recent additions.")
                            .foregroundStyle(.secondary)
                    }
                }.padding().padding(.bottom, 90).frame(maxWidth: 1000, alignment: .leading).frame(maxWidth: .infinity)
            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack {
                    Text("Welcome home").font(.headline)
                    Spacer()
                    Button(action: openSearch) { Image(systemName: "magnifyingglass").font(.title2).frame(width: 44, height: 44) }
                        .accessibilityLabel("Search Homestead")
                }.padding(.leading, 16).padding(.trailing, 6).homesteadControl()
                    .padding(.horizontal, 12).padding(.top, 4).background { HomesteadBackdrop() }
            }
            .homesteadCanvas()
            .refreshable {
                model.requestMediaRefresh()
                NotificationCenter.default.post(name: Notification.Name("homesteadPhotosRefresh"), object: model.client)
            }
            .navigationDestination(for: MediaItem.self) { MediaDetails(item: $0, client: model.client) }
        }
    }
}

private struct MediaLibrary: View {
    @Bindable var model: CompanionModel
    @Binding var category: MediaCategory?
    @State private var limit = 100
    private var filtered: [MediaItem] {
        model.media.filter {
            category == nil || $0.category == category
        }
    }
    var body: some View {
        NavigationStack {
            ScrollView { VStack(alignment: .leading, spacing: 16) {
                MediaLoadStatus(model: model)
                if category == .photos, let client = model.client {
                    NativePhotosLibrary(client: client)
                } else if let category, category == .music || category == .youtube, let client = model.client {
                    NativeMediaLibraryTabs(client: client, category: category)
                } else {
                    NavigationLink {
                        SharedCollectionsView(client: model.client)
                    } label: {
                        HStack {
                            Label("Shared Collections", systemImage: "rectangle.stack")
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption)
                        }.padding(14).homesteadPanel(radius: 16)
                    }.buttonStyle(.plain)
                    Text("\(filtered.count) items").font(.subheadline).foregroundStyle(.secondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 150), spacing: 10)], alignment: .leading, spacing: 16) {
                        ForEach(Array(filtered.prefix(limit))) { item in
                            NavigationLink(value: item) { MediaPoster(item: item, client: model.client) }
                                .buttonStyle(.plain)
                        }
                    }
                        if filtered.count > limit {
                            Button("Show more") { limit += 100 }.frame(minHeight: 44)
                        }
                        if filtered.isEmpty && model.mediaLoaded && model.mediaError == nil {
                            ContentUnavailableView("No matching media", systemImage: "magnifyingglass",
                                description: Text("Try another library."))
                        }
                }
            }.padding().frame(maxWidth: 1100).frame(maxWidth: .infinity) }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 8) {
                    CompactLibraryHeader(title: "Media", symbol: "play.rectangle") {
                        Picker("Media section", selection: $category) {
                            Text("All media").tag(nil as MediaCategory?)
                            ForEach(MediaCategory.allCases) { Text($0.title).tag(Optional($0)) }
                        }.pickerStyle(.menu)
                    }
                }.background { HomesteadBackdrop() }
            }
            .listRowSpacing(8)
            .homesteadCanvas()
            .onChange(of: category) { _, _ in limit = 100 }
            .refreshable {
                model.requestMediaRefresh()
                NotificationCenter.default.post(name: Notification.Name("homesteadPhotosRefresh"), object: model.client)
            }
            .navigationDestination(for: MediaItem.self) { MediaDetails(item: $0, client: model.client) }
        }
    }
}

private struct MediaLoadStatus: View {
    @Bindable var model: CompanionModel
    var body: some View {
        if let error = model.mediaError {
            VStack(alignment: .leading, spacing: 10) {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                Button("Retry") { Task { await model.refreshMedia(force: true) } }.disabled(model.mediaBusy)
            }
        }
    }
}

private struct MediaLoadingCard: View {
    var body: some View { HomesteadLoadingCard(message: "Loading your library…") }
}

struct MediaPoster: View {
    let item: MediaItem
    let client: HomesteadClient?
    var body: some View {
        PosterTile(title: item.title, subtitle: item.year.isEmpty ? item.category.title : item.year,
                   path: item.poster, symbol: item.category.symbol, client: client)
    }
}

struct PosterTile: View {
    @Environment(\.homesteadAppearance) private var appearance
    let title: String
    let subtitle: String
    let path: String?
    let symbol: String
    let client: HomesteadClient?
    var overlayMetadata: [ProfileMetadataItem] = []
    @State private var artwork: UIImage?
    @State private var attempt = 0
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            appearance.color.opacity(0.10).aspectRatio(2 / 3, contentMode: .fit)
                .overlay {
                    if let artwork {
                        GeometryReader { geometry in
                            Image(uiImage: artwork).resizable().scaledToFill()
                                .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                        }
                    } else {
                        Image(systemName: symbol).font(.largeTitle).foregroundStyle(appearance.color)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay { RoundedRectangle(cornerRadius: 14).stroke(appearance.color.opacity(0.25), lineWidth: 1) }
                .accessibilityHidden(true)
                .overlay(alignment: .bottomLeading) { PosterMetadataOverlay(metadata: overlayMetadata) }
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(2, reservesSpace: true)
                .foregroundStyle(.primary)
            if !subtitle.isEmpty { Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        }.frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .task(id: ImageLoadKey(path: path, attempt: attempt)) {
                artwork = nil
                guard let client, let path, let data = try? await client.profileImage(path), !Task.isCancelled else { return }
                let decoded = await Task.detached(priority: .utility) { NativeImageDecoder.thumbnail(data, maximumPixelSize: 640) }.value
                guard !Task.isCancelled, let image = decoded else { return }
                artwork = UIImage(cgImage: image)
            }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notification in
                if let sender = notification.object as? HomesteadClient, sender === client, artwork == nil { attempt += 1 }
            }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadProfileRefreshed)) { notification in
                if let sender = notification.object as? HomesteadClient, sender === client, artwork == nil { attempt += 1 }
            }
    }
}

struct MediaDetails: View {
    @Environment(\.homesteadAppearance) private var appearance
    let item: MediaItem
    let client: HomesteadClient?
    @State private var poster: UIImage?
    @State private var banner: UIImage?
    @State private var viewing: ProfileMediaFile?
    private var libraryFiles: [ProfileMediaFile] {
        guard item.category != .movies && item.category != .tv else { return [] }
        return item.files.filter { item.category != .books || (!$0.audio && !$0.readable) }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let banner {
                    GeometryReader { geometry in
                        Image(uiImage: banner).resizable().scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                    }.aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 20)).accessibilityHidden(true)
                }
                HStack(alignment: .bottom, spacing: 18) {
                Group {
                if let poster {
                    Image(uiImage: poster).resizable().scaledToFill()
                        .accessibilityLabel(item.title)
                } else {
                    Image(systemName: item.category.symbol).font(.system(size: 40)).foregroundStyle(appearance.color)
                        .frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityHidden(true)
                }
                }.frame(width: 120, height: 180).background(appearance.color.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(appearance.color.opacity(0.3), lineWidth: 1) }
                VStack(alignment: .leading, spacing: 8) {
                Text(item.title).font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
                Text([item.category.title, item.year].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 8)
                }
                .padding(.top, banner == nil ? 0 : -64)
                ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 10) {
                    if let count = item.fileCount, item.category != .movies && item.category != .tv { Label("\(count) files", systemImage: "folder").padding(10).homesteadPanel(radius: 12) }
                    if let date = item.addedAt { Text("Added " + date.formatted(date: .abbreviated, time: .omitted)).padding(10).homesteadPanel(radius: 12) }
                }.font(.caption) }
                if item.category == .books { BookDetailActions(title: item.title, files: item.files, client: client, bookID: item.id, artwork: item.poster) }
                if item.category == .movies || item.category == .tv { MediaFeatureDetails(item: item, client: client) }
                else if !item.overview.isEmpty { Text(item.overview).font(.body).foregroundStyle(.secondary) }
                if !libraryFiles.isEmpty { Text("Library files").font(.headline) }
                ForEach(libraryFiles) { file in
                    Button { viewing = file } label: {
                        Label(file.title, systemImage: file.playable ? "play.circle.fill" : "photo")
                            .font(.subheadline.weight(.medium)).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(12).homesteadPanel(radius: 16)
                    }.buttonStyle(.plain)
                }
                if item.files.isEmpty && item.category != .books { Text("No playable media or photos are indexed for this item.").foregroundStyle(.secondary) }
            }.padding().frame(maxWidth: 800, alignment: .leading).frame(maxWidth: .infinity)
        }
        .textSelection(.enabled)
        .homesteadCanvas()
        .navigationTitle("Details").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .fullScreenCover(item: $viewing) { file in
            if let client { NativeMediaViewer(initial: file, files: item.files, client: client) }
        }
        .task(id: item.banner) {
            banner = nil
            if let client, let path = item.banner, let data = try? await client.profileImage(path), !Task.isCancelled,
               let source = CGImageSourceCreateWithData(data as CFData, nil),
               let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 1400, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) {
                banner = UIImage(cgImage: image)
            }
        }
        .task(id: item.id) {
            poster = nil
            if let client, let path = item.poster, let data = try? await client.profileImage(path), !Task.isCancelled {
                poster = UIImage(data: data)
            }
        }
    }
}

private struct CompanionSettings: View {
    @AppStorage("homestead.profilePosterMetadata") private var showPosterMetadata = true
    @State private var pinAction: AdultPrivacySettings.PINAction?
    @Bindable var model: CompanionModel
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Theme", selection: $model.appearance.theme) {
                        ForEach(AppearancePreferences.Theme.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    Picker("Accent color", selection: $model.appearance.accent) {
                        ForEach(AppearancePreferences.Accent.allCases, id: \.self) { color in
                            Label { Text(color.rawValue) } icon: {
                                Circle().fill(AppearancePreferences(accent: color).color).frame(width: 16, height: 16)
                            }.tag(color)
                        }
                    }
                    Picker("Surfaces", selection: $model.appearance.surface) {
                        ForEach(AppearancePreferences.Surface.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    HStack {
                        Image(systemName: "play.rectangle.fill").foregroundStyle(model.appearance.color)
                        Text("Your Homestead").font(.headline)
                        Spacer()
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(model.appearance.color)
                    }.padding().homesteadControl().accessibilityLabel("Appearance preview")
                    Button("Reset appearance") { model.appearance = AppearancePreferences() }
                } header: { Text("Appearance") } footer: { Text("Saved for this account on this device.") }
                Section {
                    Toggle("Show poster metadata", isOn: $showPosterMetadata)
                } header: { Text("Profile posters") } footer: { Text("Show compact size and age pills on Adult profile posters. Hidden fields remain private.") }
                AdultPrivacySettings(privacy: model.adultPrivacy) { pinAction = $0 }
                Section("Server") {
                    LabeledContent("Address", value: model.serverAddress)
                    if let client = model.client {
                        LabeledContent("Connection check", value: client.connectionCheckSummary)
                        DisclosureGroup("Recent connection checks") {
                            ForEach(Array(client.connectionCheckHistory.enumerated()), id: \.offset) { _, entry in
                                Text(entry).font(.caption).textSelection(.enabled)
                            }
                        }
                    }
                    Button("Check connection") { Task { await model.resumeConnection(force: true) } }.disabled(model.checkingSession)
                    if let date = model.mediaUpdatedAt {
                        LabeledContent("Library refreshed", value: date.formatted(date: .abbreviated, time: .shortened))
                    }
                    Button("Refresh media library") { Task { await model.refreshMedia(force: true) } }
                        .disabled(model.mediaBusy)
                    if let error = model.mediaError { Text(error).foregroundStyle(.orange) }
                    if !model.adultPrivacy.hidden, let client = model.client { Link("Open web app", destination: client.baseURL) }
                }
                Section("App") {
                    LabeledContent("Version", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "3.7") + " (" + (Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "8") + ")")
                    Text("Native Family · Search · AI · Book swiping").font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Button("Sign Out and Change Server", role: .destructive) { Task { await model.signOut() } }
                        .disabled(model.busy)
                } footer: { Text("Your server and session are remembered between launches. This action removes the saved connection. Your password is not stored.") }
            }.navigationTitle("Settings").homesteadCanvas()
        }
        .sheet(item: $pinAction) { action in
            PINPrompt(privacy: model.adultPrivacy, action: action, client: model.client).interactiveDismissDisabled()
        }
    }
}
