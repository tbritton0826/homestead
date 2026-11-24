import SwiftUI
import WebKit
import Observation

struct BookDetailActions: View {
    let title: String
    let files: [ProfileMediaFile]
    let client: HomesteadClient?
    var bookID: String? = nil
    var artwork: String? = nil
    @State private var additionalFiles: [ProfileMediaFile] = []
    @State private var checkingFormats = false
    @State private var formatError: String?
    @State private var reading = false
    @State private var listening: ProfileMediaFile?
    @State private var readAlong = false
    private var availableFiles: [ProfileMediaFile] {
        var seen = Set<String>()
        return (files + additionalFiles).filter { seen.insert($0.id).inserted }
    }
    private var ebooks: [ProfileMediaFile] { availableFiles.filter(\.readable) }
    private var audio: [ProfileMediaFile] { BookWorkCatalog.orderedAudio(availableFiles) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], alignment: .leading, spacing: 8) {
                if !ebooks.isEmpty {
                    Button { reading = true } label: { Label("Read", systemImage: "book") }
                        .accessibilityLabel("Read \(title)")
                }
                if let first = audio.first {
                    Button { readAlong = false; listening = first } label: { Label("Listen", systemImage: "headphones") }
                        .accessibilityLabel("Listen to \(title)")
                    if !ebooks.isEmpty {
                        Button { readAlong = true; listening = first } label: { Label("Read Along", systemImage: "book") }
                            .accessibilityLabel("Read \(title) while listening")
                    }
                }
            }.buttonStyle(.bordered).controlSize(.large)
            if audio.count > 1 {
                Menu {
                    ForEach(audio) { file in
                        Button(file.title) { readAlong = false; listening = file }
                    }
                } label: { Label("Choose chapter", systemImage: "list.bullet") }
            }
            if ebooks.isEmpty { Text("No EPUB or PDF is available to read.").font(.caption).foregroundStyle(.secondary) }
            if let formatError {
                Text(formatError).font(.caption).foregroundStyle(.secondary)
            } else if audio.isEmpty && !checkingFormats { Text("No audiobook is available to listen to.").font(.caption).foregroundStyle(.secondary) }
            if bookID != nil && !checkingFormats {
                Button("Check formats again") { Task { await loadFormats() } }
            }
        }
        .homesteadLoading(checkingFormats && availableFiles.isEmpty, message: "Checking available formats…")
        .disabled(client == nil || client?.isClosed == true)
        .task(id: bookID) { await loadFormats() }
        .fullScreenCover(isPresented: $reading) {
            if let client {
                NavigationStack {
                    BookReadingView(files: ebooks, client: client)
                        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { reading = false } } }
                }
            }
        }
        .fullScreenCover(item: $listening) { file in
            if let client {
                NativeMediaViewer(initial: file, files: audio, client: client,
                                  readAlongFiles: ebooks, startReadAlong: readAlong, mediaTitle: title, artwork: artwork)
            }
        }
    }
    @MainActor private func loadFormats() async {
        guard !checkingFormats, let bookID, let client else { return }
        checkingFormats = true; formatError = nil
        defer { checkingFormats = false }
        do {
            let response: IndexValue = try await client.request("api/books/local-files", query: [URLQueryItem(name: "recordId", value: bookID)], timeout: 30)
            try Task.checkCancellation()
            guard response["ok"]?.flag == true else { throw CompanionError.message("Available book formats could not be checked.") }
            additionalFiles = response["records"]?.list.flatMap { PlaybackCatalog.files($0, includeBooks: true) } ?? []
        } catch {
            if !Task.isCancelled { formatError = "Additional formats could not be checked. Indexed files remain available. Check your server connection and try again." }
        }
    }
}

struct BookReadingView: View {
    let files: [ProfileMediaFile]
    let client: HomesteadClient
    @State private var selected: String
    init(files: [ProfileMediaFile], client: HomesteadClient) {
        self.files = files; self.client = client
        _selected = State(initialValue: files.first?.id ?? "")
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Reading", systemImage: "book").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                if files.count > 1 {
                    Menu {
                        ForEach(files) { file in Button(PlaybackPresentation.cleanTitle(file.title)) { selected = file.id } }
                    } label: {
                        Label((files.first { $0.id == selected }?.fileExtension.uppercased() ?? "Book") + " · Edition \(max(1, (files.firstIndex { $0.id == selected } ?? 0) + 1))", systemImage: "chevron.down")
                            .font(.caption.weight(.semibold)).lineLimit(1)
                    }.accessibilityLabel("Choose reading edition")
                } else { Text(files.first?.fileExtension.uppercased() ?? "Book").font(.caption.weight(.semibold)) }
            }.padding(.horizontal, 16).padding(.vertical, 10).homesteadPanel(radius: 14).padding(.horizontal, 10).padding(.vertical, 6)
            if let file = files.first(where: { $0.id == selected }) {
                BookDocumentView(file: file, client: client).id(file.id)
            }
        }
    }
}

private struct BookDocumentView: View {
    @Environment(\.homesteadAppearance) private var appearance
    let file: ProfileMediaFile
    let client: HomesteadClient
    @State private var browser = BookBrowser()
    @State private var reloadID = UUID()
    var body: some View {
        VStack(spacing: 8) {
            if let error = browser.error {
                VStack {
                    Text(error)
                    Button("Retry") { reloadID = UUID() }
                }.padding().accessibilityElement(children: .contain)
            }
            PluginSurface(webView: browser.webView).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .homesteadLoading(browser.loading, message: "Opening book…")
        .task(id: reloadID) { await browser.load(file: file, client: client, accent: appearance.readerAccent) }
        .onDisappear { browser.stop() }
    }
}

@MainActor @Observable
private final class BookBrowser: NSObject, WKNavigationDelegate {
    @ObservationIgnored let webView: WKWebView
    @ObservationIgnored private var server: URL?
    @ObservationIgnored private var positionKey = ""
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var timeout: Task<Void, Never>?
    private var pdf = false
    var loading = false
    var error: String?
    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(BookMessages(owner: self), name: "bookReader")
    }
    func load(file: ProfileMediaFile, client: HomesteadClient, accent: String) async {
        stop(clearPage: false)
        let token = generation
        server = client.baseURL; pdf = file.fileExtension == "pdf"; loading = true
        guard file.readable, !client.isClosed,
              let address = ProfileMediaFile.url(path: file.path, server: client.baseURL, preview: false) else {
            fail("This book address is unavailable."); return
        }
        timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(90)) } catch { return }
            guard let self, self.generation == token, self.loading else { return }
            self.fail("Opening the book timed out. Check your connection and try again.")
        }
        do {
            let session: SessionResponse = try await client.request("api/auth/session", timeout: 8)
            guard session.ok, let account = session.user?.id ?? (session.authEnabled ? nil : "local-owner") else {
                throw CompanionError.unauthorized
            }
            guard token == generation, !Task.isCancelled, !client.isClosed else { return }
            positionKey = ReadingProgress.key(server: client.baseURL, account: account, file: file)
            for cookie in client.familySessionCookies { await webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }
            guard token == generation, !Task.isCancelled, !client.isClosed else { return }
            let controller = webView.configuration.userContentController
            controller.removeAllUserScripts()
            if pdf {
                webView.load(URLRequest(url: address, timeoutInterval: 30))
            } else {
                for name in ["jszip.min", "epub.min"] {
                    guard let url = Bundle.main.url(forResource: name, withExtension: "js") else {
                        throw CompanionError.message("The ebook reader is missing. Reopen the complete updated project.")
                    }
                    controller.addUserScript(WKUserScript(source: try String(contentsOf: url, encoding: .utf8), injectionTime: .atDocumentStart, forMainFrameOnly: true))
                }
                var origin = URLComponents(url: client.baseURL, resolvingAgainstBaseURL: false)
                origin?.path = ""; origin?.query = nil; origin?.fragment = nil
                // Fetch with the authenticated native session. A loadHTMLString
                // document can have an opaque origin in WebKit; its fetch must
                // not be responsible for retrieving a protected book.
                let local = try await client.documentFile(file)
                defer { try? FileManager.default.removeItem(at: local.deletingLastPathComponent()) }
                let bytes = try Data(contentsOf: local, options: .mappedIfSafe)
                guard token == generation, !Task.isCancelled, !client.isClosed else { return }
                let config = ["url": address.absoluteString, "origin": origin?.string ?? "", "data": bytes.base64EncodedString(),
                              "accent": accent, "generation": token.uuidString, "resume": UserDefaults.standard.string(forKey: positionKey) ?? ""]
                let data = try JSONEncoder().encode(config)
                guard let json = String(data: data, encoding: .utf8),
                      let scriptURL = Bundle.main.url(forResource: "BookReader", withExtension: "js") else {
                    throw CompanionError.message("The ebook reader is missing from this build.")
                }
                controller.addUserScript(WKUserScript(source: "window.__homesteadBook = \(json);\n" + (try String(contentsOf: scriptURL, encoding: .utf8)),
                                                     injectionTime: .atDocumentEnd, forMainFrameOnly: true))
                webView.loadHTMLString(Self.html, baseURL: client.baseURL)
            }

        } catch {
            if token == generation && !Task.isCancelled { fail(error.localizedDescription) }
        }
    }
    func stop(clearPage: Bool = true) {
        generation = UUID(); timeout?.cancel(); timeout = nil
        loading = false; error = nil; positionKey = ""
        webView.stopLoading()
        webView.configuration.userContentController.removeAllUserScripts()
        if clearPage {
            webView.evaluateJavaScript("window.__homesteadBookClose?.()", completionHandler: nil)
            webView.loadHTMLString("", baseURL: nil)
        }
    }
    private func fail(_ message: String) {
        generation = UUID(); timeout?.cancel(); timeout = nil; loading = false; error = message
        webView.stopLoading()
    }
    func receive(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, !pdf, !positionKey.isEmpty,
              let body = message.body as? [String: String], body["generation"] == generation.uuidString else { return }
        switch body["kind"] {
        case "ready": timeout?.cancel(); loading = false
        case "error": fail("Unable to open this ebook. Check your connection, account access, and file format.")
        case "position":
            if let value = body["value"], value.hasPrefix("epubcfi("), value.count < 4096 {
                UserDefaults.standard.set(value, forKey: positionKey)
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: positionKey + ".updatedAt")
            }
        default: break
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" || (url.absoluteString == "about:srcdoc" && action.targetFrame?.isMainFrame == false) {
            decisionHandler(.allow); return
        }
        // EPUB.js creates sandboxed subframes from its own blob URLs. An opaque
        // HTML document can produce blob:null URLs, which are not server URLs.
        if !pdf, url.scheme == "blob", action.targetFrame?.isMainFrame == false,
           url.absoluteString.hasPrefix("blob:null/") { decisionHandler(.allow); return }
        guard let server else { decisionHandler(.cancel); return }
        let destination = url.scheme == "blob" ? URL(string: String(url.absoluteString.dropFirst(5))) : url
        let sameServer = destination?.scheme == server.scheme && destination?.host == server.host && destination?.port == server.port
        decisionHandler(sameServer ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse,
           !(200...299).contains(http.statusCode) || (pdf && http.mimeType != "application/pdf") {
            fail("The book is unavailable. Check your account access and file format."); decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if pdf { timeout?.cancel(); loading = false }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { fail("Unable to load the book. Check your connection and retry.") }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { fail("Unable to load the book. Check your connection and retry.") }
    }
    private static let html = """
    <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob:; frame-src 'self' blob:; connect-src 'self'">
    <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fafafa;color:#111}body{display:flex;flex-direction:column}#reader{flex:1;min-height:100px;width:100%;overflow:hidden}nav{flex:none;display:flex;gap:12px;justify-content:space-between;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:#101b2d;color:#fff;border-top:1px solid #263b59;font-family:-apple-system,BlinkMacSystemFont,sans-serif}button{min-height:44px;padding:8px 20px;border-radius:999px;border:1px solid var(--accent,#438ee8);background:#1c2d45;color:#fff;font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;touch-action:manipulation}button:disabled{opacity:.4}button:focus-visible{outline:3px solid var(--accent,#438ee8);outline-offset:2px}</style>
    </head><body><div id="reader"></div><nav aria-label="Reading pages"><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></nav></body></html>
    """
    private final class BookMessages: NSObject, WKScriptMessageHandler {
        weak var owner: BookBrowser?
        init(owner: BookBrowser) { self.owner = owner }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { owner?.receive(message) }
    }
}
