import SwiftUI
import Combine

struct ContinueWatching: View {
    @Environment(\.adultHidden) private var adultHidden
    let client: HomesteadClient
    let media: [MediaItem]
    var hidesEmpty = false
    @State private var entries: [(ProfileMediaFile, PlaybackPosition)] = []
    @State private var error: String?
    @State private var viewing: ProfileMediaFile?
    @State private var reading: [MediaItem] = []
    @State private var readingItem: MediaItem?
    @State private var loading = false
    @State private var loadRevision = UUID()
    @State private var artworkByFile: [String: String] = [:]
    var body: some View {
        Group {
          if !hidesEmpty || !entries.isEmpty || !reading.isEmpty || error != nil {
           VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Continue").font(.title2.bold())
                Spacer()
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Refresh media in progress").disabled(loading)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
            else if entries.isEmpty && reading.isEmpty { Text("No media in progress.").foregroundStyle(.secondary) }
            ScrollView(.horizontal) {
                HStack {
                    ForEach(Array(entries.prefix(24)), id: \.0.id) { file, position in
                        Button { viewing = file } label: {
                            VStack(alignment: .leading) {
                                let item = media.first { $0.files.contains { $0.path == file.path } }
                                PosterTile(title: item?.title ?? file.title, subtitle: "", path: item?.poster ?? artworkByFile[file.path],
                                           symbol: file.audio ? "headphones" : "play.rectangle", client: client)
                                ProgressView(value: position.position, total: max(position.duration, 1))
                                Text(PlaybackPresentation.time(position.position) + " / " + PlaybackPresentation.time(position.duration)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            }.frame(width: 140)
                        }.buttonStyle(.plain)
                    }
                    ForEach(Array(reading.prefix(12))) { item in
                        Button { readingItem = item } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                PosterTile(title: item.title, subtitle: "Continue reading", path: item.poster, symbol: "book", client: client)
                                Label("Read", systemImage: "book").font(.caption2.weight(.semibold))
                            }.frame(width: 140)
                        }.buttonStyle(.plain)
                    }
                }
            }.scrollIndicators(.hidden)
           }
          }
        }.task(id: media) { await load() }
            .onReceive(NotificationCenter.default.publisher(for: .homesteadConnectionRecovered)) { notice in
                if let sender = notice.object as? HomesteadClient, sender === client { Task { await load() } }
            }
            .fullScreenCover(item: $readingItem, onDismiss: { Task { await load() } }) { item in ContinueReadingBook(item: item, client: client) }
            .fullScreenCover(item: $viewing, onDismiss: { Task { await load() } }) { file in
                NativeMediaViewer(initial: file, files: [file], client: client, mediaTitle: media.first { $0.files.contains { $0.path == file.path } }?.title, artwork: artworkByFile[file.path])
            }
    }
    @MainActor private func load() async {
        let revision = UUID(); loadRevision = revision; loading = true
        defer { if loadRevision == revision { loading = false } }
        do {
            let session: SessionResponse = try await client.request("api/auth/session", timeout: 8)
            try Task.checkCancellation()
            guard loadRevision == revision else { return }
            guard session.ok, let account = session.user?.id ?? (session.authEnabled ? nil : "local-owner") else { throw CompanionError.unauthorized }
            reading = media.filter { item in item.category == .books && item.files.contains { file in
                file.readable && UserDefaults.standard.string(forKey: ReadingProgress.key(server: client.baseURL, account: account, file: file))?.hasPrefix("epubcfi(") == true
            } }.map { item in
                var item = item
                item.files.sort { lhs, rhs in
                    func stamp(_ file: ProfileMediaFile) -> Double {
                        let key = ReadingProgress.key(server: client.baseURL, account: account, file: file)
                        return UserDefaults.standard.string(forKey: key)?.hasPrefix("epubcfi(") == true ? max(1, UserDefaults.standard.double(forKey: key + ".updatedAt")) : 0
                    }
                    return stamp(lhs) > stamp(rhs)
                }
                return item
            }.sorted { lhs, rhs in
                func stamp(_ item: MediaItem) -> Double { item.files.map { UserDefaults.standard.double(forKey: ReadingProgress.key(server: client.baseURL, account: account, file: $0) + ".updatedAt") }.max() ?? 0 }
                return stamp(lhs) > stamp(rhs)
            }
            try Task.checkCancellation()

            let history: PlaybackHistory = try await client.request("api/account/playback", timeout: 5)
            guard history.ok else { throw CompanionError.message("History unavailable") }
            let index = try await client.searchIndex()
            try Task.checkCancellation()
            guard !client.isClosed, loadRevision == revision else { return }
            artworkByFile = PlaybackCatalog.artworkByFile(index)
            entries = PlaybackCatalog.authorizedFiles(index, includeAdult: !adultHidden).filter(\.playable).compactMap { file in
                guard let position = history.entries[PlaybackCatalog.key(file)], !position.completed, position.position.isFinite, position.duration.isFinite, position.duration > 0, position.position > 0, position.position < position.duration else { return nil }
                return (file, position)
            }.sorted { $0.1.updatedAt > $1.1.updatedAt }
            error = nil
        } catch {
            if !Task.isCancelled && loadRevision == revision { entries = []; reading = []; artworkByFile = [:]; self.error = "Media in progress could not refresh. Check your server connection and retry." }
        }
    }
}

private struct ContinueReadingBook: View {
    let item: MediaItem
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            BookReadingView(files: item.files.filter(\.readable), client: client)
                .navigationTitle(item.title).navigationBarTitleDisplayMode(.inline).homesteadCanvas()
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}
