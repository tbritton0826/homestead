import SwiftUI
import Observation

enum FamilySection: String, CaseIterable, Identifiable {
    case home = "family"
    case archive = "family-home"
    case households = "family-profiles"
    case tree = "family-tree"
    case pets, calendar, recipes

    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: return "Family Home"
        case .archive: return "Archive"
        case .households: return "Households"
        case .tree: return "Family Tree"
        case .pets: return "Pets"
        case .calendar: return "Calendar"
        case .recipes: return "Recipes"
        }
    }
}

struct FamilyLibraryView: View {
    @Bindable var model: CompanionModel
    @Binding var section: FamilySection
    @State private var allowed: [FamilySection] = []
    @State private var ready = false
    @State private var error: String?
    @State private var accountID = ""
    var body: some View {
        VStack(spacing: 0) {
            CompactLibraryHeader(title: "Family", symbol: "person.3") {
                Picker("Family library", selection: $section) {
                    ForEach(allowed) { Text($0.title).tag($0) }
                }.pickerStyle(.menu)
            }
            if !ready { HomesteadLoadingCard(message: "Loading Family…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let error {
                VStack { Text(error); Button("Retry") { Task { await authorize() } } }.padding()
            } else if !allowed.contains(section) {
                ContentUnavailableView("Family unavailable", systemImage: "lock", description: Text("No Family libraries are enabled for this account."))
            } else if section == .recipes {
                RecipeLibraryView(model: model)
            } else if section == .pets, let client = model.client {
                NativePetsPage(client: client)
            } else if let client = model.client {
                NativeFamilyPage(section: section, allowed: allowed, client: client, accountID: accountID, navigate: { section = $0 }).id(section)
            }
        }.background { HomesteadBackdrop() }
        .task { await authorize() }
    }
    private func authorize() async {
        ready = false; error = nil; allowed = []
        defer { ready = true }
        guard let client = model.client, !client.isClosed else { return }
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            let config: IndexValue = try await client.request("api/setup-config")
            try Task.checkCancellation()
            allowed = FamilyCatalog.allowed(session: session, config: config).compactMap(FamilySection.init(rawValue:))
            accountID = session["user"]?["id"]?.text ?? "local-owner"
            if !allowed.contains(section), let first = allowed.first { section = first }
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct NativeFamilyPage: View {
    let section: FamilySection
    let allowed: [FamilySection]
    let client: HomesteadClient
    let accountID: String
    let navigate: (FamilySection) -> Void
    @State private var index: IndexValue = .object([:])
    @State private var events: [FamilyCalendarEvent] = []
    @State private var busy = false
    @State private var error: String?
    @State private var tab = "Overview"
    @State private var viewing: ProfileMediaFile?
    @State private var document: ProfileMediaFile?
    @State private var editingEvent: FamilyCalendarEvent?
    @State private var addingEvent = false
    @State private var calendarDate = Date()
    @State private var calendarMode = "Day"
    @State private var showTools = false
    @State private var hiddenSources = Set<String>()
    private var calendarPreferencesKey: String { AppearancePreferences.storageKey(server: client.baseURL.absoluteString, user: accountID) + ".calendar.sources" }
    private var archive: [FamilyRecord] { FamilyCatalog.records(index, library: "family") }
    private var pets: [FamilyRecord] { FamilyCatalog.records(index, library: "pets") }
    private var people: [FamilyRecord] {
        var seen = Set<String>()
        return (FamilyCatalog.records(index, library: "people") + FamilyCatalog.records(index, library: "familyProfiles")).filter { seen.insert($0.id).inserted }
    }
    private var files: [ProfileMediaFile] { archive.flatMap(\.files) }
    private var tabs: [String] {
        switch section {
        case .archive: return ["Overview", "Photos", "Albums", "Videos", "Timeline", "Documents", "Tagged People"]
        case .households: return ["Home", "Connected Households", "Shared Calendar", "Invites", "Shared Libraries"]
        default: return []
        }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if let error { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load() } } }
                    if !tabs.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(tabs, id: \.self) { label in
                                    Button { tab = label } label: { Text(label).homesteadLibraryPill(selected: tab == label) }.buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    switch section {
                    case .home: home
                    case .archive: archiveContent
                    case .pets: records(pets, symbol: "pawprint")
                    case .tree: familyTree
                    case .households: households
                    case .calendar: calendar
                    case .recipes: EmptyView()
                    }
                }.padding().frame(maxWidth: 1000, alignment: .leading).frame(maxWidth: .infinity)
            }.homesteadCanvas().toolbar(.hidden, for: .navigationBar)
                .refreshable { await load(force: true) }.task {
                    if let first = tabs.first { tab = first }
                    hiddenSources = Set(UserDefaults.standard.stringArray(forKey: calendarPreferencesKey) ?? [])
                    await load()
                }
                .onChange(of: hiddenSources) { _, value in UserDefaults.standard.set(value.sorted(), forKey: calendarPreferencesKey) }
                .fullScreenCover(item: $viewing) { NativeMediaViewer(initial: $0, files: files, client: client) }
                .sheet(item: $document) { file in
                    if file.fileExtension == "epub" {
                        NavigationStack { BookReadingView(files: [file], client: client).toolbar { Button("Close") { document = nil } } }
                    } else { NativeDocumentView(file: file, client: client) }
                }
                .sheet(item: $editingEvent) { NativeCalendarEditor(event: $0, client: client) { Task { await load() } } }
                .sheet(isPresented: $addingEvent) { NativeCalendarEditor(event: nil, client: client) { Task { await load() } } }
                .sheet(isPresented: $showTools) { NativeCalendarTools(client: client, hiddenSources: $hiddenSources) { Task { await load() } } }
        }
        .homesteadLoading(busy, message: "Loading Family…")
    }
    private var home: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Family Home").font(.largeTitle.bold())
            Text("Coming Up").font(.title2.bold())
            ForEach(Array(events.filter { $0.date >= Self.today }.prefix(8))) { event in eventRow(event) }
            if events.isEmpty { Text("No upcoming household events.").foregroundStyle(.secondary) }
            Text("Recent Memories").font(.title2.bold())
            gallery(Array(files.filter { !$0.playable }.prefix(12)))
        }
    }
    @ViewBuilder private var archiveContent: some View {
        Text("Family Archive").font(.largeTitle.bold())
        switch tab {
        case "Photos": gallery(files.filter { !$0.playable })
        case "Videos": gallery(files.filter(\.video))
        case "Albums": records(archive, symbol: "photo.on.rectangle")
        case "Timeline": ForEach(events) { eventRow($0) }; if events.isEmpty { empty("No family timeline events", "calendar") }
        case "Documents": documents(archive.flatMap(\.documents))
        case "Tagged People": records(people, symbol: "person")
        default: gallery(Array(files.filter { !$0.playable }.prefix(24)))
        }
    }
    private var households: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Households").font(.largeTitle.bold())
            if tab == "Shared Calendar" { ForEach(events) { eventRow($0) } }
            else if tab == "Shared Libraries" {
                ForEach(allowed.filter { $0 != .households }) { library in Button(library.title) { navigate(library) }.frame(minHeight: 44) }
            } else {
                let rows = FamilyCatalog.records(index, library: "households")
                if rows.isEmpty {
                    Text(tab == "Invites" ? "No household invitations." : "No connected households.").font(.headline)
                    Text("Remote household linking is planned on the server; no connections are invented here.").foregroundStyle(.secondary)
                } else { records(rows, symbol: "house") }
            }
        }
    }
    private var familyTree: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Family Tree").font(.largeTitle.bold())
            if people.isEmpty { empty("No family relationships are available", "tree") }
            ForEach(people) { person in
                VStack(alignment: .leading, spacing: 10) {
                    Text(person.title).font(.title3.bold())
                    let links = person.metadata["relationships"]?.list ?? []
                    ForEach(Array(links.enumerated()), id: \.offset) { _, link in
                        let id = link["profileId"]?.text ?? link["personId"]?.text ?? ""
                        if let related = people.first(where: { $0.id == id }) {
                            Label((link["relationshipType"]?.text ?? link["type"]?.text ?? "Family") + " · " + related.title, systemImage: "arrow.turn.down.right")
                        }
                    }
                }.padding().frame(maxWidth: .infinity, alignment: .leading).homesteadPanel(radius: 16)
            }
        }
    }
    private var calendar: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text("Calendar").font(.largeTitle.bold()); Spacer(); Button { addingEvent = true } label: { Image(systemName: "plus").frame(width: 44, height: 44) }.accessibilityLabel("Add calendar event") }
            Button("Sources & Schedule Import") { showTools = true }.buttonStyle(.bordered)
            Picker("Calendar view", selection: $calendarMode) { Text("Day").tag("Day"); Text("Agenda").tag("Agenda") }.pickerStyle(.segmented)
            if calendarMode == "Day" { DatePicker("Calendar date", selection: $calendarDate, displayedComponents: .date).datePickerStyle(.graphical) }
            let selectedDay = Self.dateString(calendarDate)
            let visibleEvents = events.filter { (calendarMode == "Agenda" || $0.date == selectedDay) && !hiddenSources.contains($0.row["sourceId"]?.text ?? "") }
            ForEach(visibleEvents) { eventRow($0) }
            if visibleEvents.isEmpty && !busy { empty("No calendar events", "calendar") }
        }
    }
    private func eventRow(_ event: FamilyCalendarEvent) -> some View {
        Button { editingEvent = event } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack { Text(event.title).font(.headline); Spacer(); Text(event.kind.capitalized).font(.caption) }
                Text(event.date + " · " + (event.row["startTime"]?.text ?? String(event.start.dropFirst(11).prefix(5)))).font(.subheadline)
                if !event.summary.isEmpty { Text(event.summary).font(.caption).foregroundStyle(.secondary) }
            }.padding().frame(maxWidth: .infinity, alignment: .leading).homesteadPanel(radius: 16)
        }.buttonStyle(.plain)
    }
    private func records(_ values: [FamilyRecord], symbol: String) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140, maximum: 220))], alignment: .leading) {
            ForEach(values) { record in
                NavigationLink { NativeFamilyRecordDetails(record: record, client: client) } label: {
                    PosterTile(title: record.title, subtitle: record.subtitle, path: record.poster, symbol: symbol, client: client)
                }.buttonStyle(.plain)
            }
            if values.isEmpty && !busy { empty("No items in this library", symbol) }
        }
    }
    private func gallery(_ values: [ProfileMediaFile]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 100, maximum: 180))], alignment: .leading) {
            ForEach(values) { file in
                Button { viewing = file } label: {
                    VStack(alignment: .leading) {
                        NativeArtwork(path: file.video ? nil : file.path, client: client, symbol: file.video ? "play.rectangle" : "photo")
                            .frame(height: 140).clipShape(RoundedRectangle(cornerRadius: 12))
                        Text(file.title).font(.caption).lineLimit(2)
                    }
                }.buttonStyle(.plain)
            }
            if values.isEmpty && !busy { empty("No media in this section", "photo") }
        }
    }
    private func documents(_ values: [ProfileMediaFile]) -> some View {
        VStack(alignment: .leading) {
            ForEach(values) { file in Button { document = file } label: { Label(file.title, systemImage: "doc").frame(minHeight: 44) } }
            if values.isEmpty && !busy { empty("No documents", "doc") }
        }
    }
    private func empty(_ title: String, _ symbol: String) -> some View { ContentUnavailableView(title, systemImage: symbol) }
    private func symbol(_ section: FamilySection) -> String {
        switch section {
        case .home: return "house"; case .archive: return "photo.on.rectangle"; case .households: return "house.fill"
        case .tree: return "tree"; case .pets: return "pawprint"; case .calendar: return "calendar"; case .recipes: return "fork.knife"
        }
    }
    private static var today: String {
        dateString(Date())
    }
    private static func dateString(_ date: Date) -> String {
        FamilyCalendarDate.formatter("yyyy-MM-dd").string(from: date)
    }
    private func load(force: Bool = false) async {
        guard !busy, !client.isClosed else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            index = try await client.searchIndex(force: force)
            try Task.checkCancellation()
            if allowed.contains(.archive) || allowed.contains(.tree) {
                if let people: IndexValue = try? await client.request("media/people/people.json", timeout: 8) {
                    var libraries = index["libraries"]?.fields ?? [:]
                    libraries["people"] = people["people"] ?? .array([])
                    var root = index.fields; root["libraries"] = .object(libraries); index = .object(root)
                }
            }
            if allowed.contains(.calendar) && [.home, .calendar, .archive, .households].contains(section) {
                let response: IndexValue = try await client.request("api/calendar", timeout: 30)
                events = FamilyCatalog.events(response)
            }
        } catch {
            if case CompanionError.unauthorized = error { index = .object([:]); events = [] }
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
}

struct NativeFamilyRecordDetails: View {
    let record: FamilyRecord
    let client: HomesteadClient
    @State private var tab = "Overview"
    @State private var viewing: ProfileMediaFile?
    @State private var document: ProfileMediaFile?
    private var tabs: [String] {
        record.library == "pets" ? ["Overview", "Meals", "Health", "Photos", "Videos", "Documents", "Notes"] : ["Overview", "Photos", "Videos", "Documents", "Notes"]
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let banner = record.banner { NativeArtwork(path: banner, client: client).frame(height: 190).clipShape(RoundedRectangle(cornerRadius: 18)) }
                HStack {
                    NativeArtwork(path: record.poster, client: client, symbol: "person").frame(width: 100, height: 145).clipShape(RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading) { Text(record.title).font(.title.bold()); Text(record.subtitle).foregroundStyle(.secondary) }
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(tabs, id: \.self) { value in
                            Button { tab = value } label: { Text(value).homesteadLibraryPill(selected: tab == value) }.buttonStyle(.plain)
                        }
                    }
                }
                if tab == "Photos" || tab == "Videos" {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))]) {
                        ForEach(record.files.filter { tab == "Videos" ? $0.video : !$0.playable }) { file in
                            Button { viewing = file } label: {
                                NativeArtwork(path: file.video ? nil : file.path, client: client, symbol: file.video ? "play.rectangle" : "photo")
                                    .frame(height: 150).clipShape(RoundedRectangle(cornerRadius: 12))
                            }.buttonStyle(.plain)
                        }
                    }
                } else if tab == "Documents" {
                    ForEach(record.documents) { file in Button { document = file } label: { Label(file.title, systemImage: "doc").frame(minHeight: 44) } }
                    if record.documents.isEmpty { Text("No documents.").foregroundStyle(.secondary) }
                } else if tab == "Overview" {
                    ForEach(["description", "bio", "species", "breed", "sex", "age", "weight", "birthday", "role"], id: \.self) { key in
                        if let value = record.metadata[key]?.text, !value.isEmpty {
                            VStack(alignment: .leading) { Text(key.capitalized).font(.caption.bold()); Text(value) }.padding().frame(maxWidth: .infinity, alignment: .leading).homesteadPanel(radius: 14)
                        }
                    }
                } else {
                    let fields = FamilyCatalog.detailFields(record.metadata[tab.lowercased()])
                    ForEach(fields) { field in
                        VStack(alignment: .leading, spacing: 6) {
                            if !field.label.isEmpty { Text(field.label).font(.caption.bold()).foregroundStyle(.secondary) }
                            Text(field.value).textSelection(.enabled)
                        }.padding().frame(maxWidth: .infinity, alignment: .leading).homesteadPanel(radius: 14)
                    }
                    if fields.isEmpty { Text("No \(tab.lowercased()) recorded.").foregroundStyle(.secondary) }
                }
            }.padding()
        }.homesteadCanvas().navigationTitle(record.title).navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
            .fullScreenCover(item: $viewing) { NativeMediaViewer(initial: $0, files: record.files, client: client) }
            .sheet(item: $document) { file in
                if file.fileExtension == "epub" {
                    NavigationStack {
                        BookReadingView(files: [file], client: client)
                            .toolbar { Button("Close") { document = nil } }
                    }
                } else {
                    NativeDocumentView(file: file, client: client)
                }
            }
    }
}
