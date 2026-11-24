import SwiftUI
import WebKit
import Observation

struct PluginSurface: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

@MainActor @Observable
final class PluginBrowser: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    @ObservationIgnored let webView: WKWebView
    private var baseURL: URL?
    private var pluginID = ""
    @ObservationIgnored private var timeout: Task<Void, Never>?
    var loading = false
    var ready = false
    var error: String?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        super.init()
        webView.navigationDelegate = self
    }

    func load(plugin: PluginLibrary, client: HomesteadClient) async {
        stop()
        baseURL = client.baseURL; pluginID = plugin.id; error = nil; loading = true
        let controller = webView.configuration.userContentController
        controller.add(self, name: "pluginReady")
        for cookie in client.familySessionCookies {
            await webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
        }
        guard !Task.isCancelled, !client.isClosed else { stop(); return }
        guard let scriptURL = Bundle.main.url(forResource: "PluginHost", withExtension: "js"),
              let script = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            error = "Plugin host is missing from this build."; loading = false; return
        }
        controller.removeAllUserScripts()
        let bootstrap = "window.__homesteadNativePlugin = '\(plugin.id)';\n" + script
        controller.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let url = client.baseURL.appendingPathComponent("plugins", isDirectory: true).appendingPathComponent(plugin.id, isDirectory: true)
        webView.load(URLRequest(url: url, timeoutInterval: 30))
        timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(35)) } catch { return }
            guard let self, self.loading else { return }
            self.webView.stopLoading(); self.loading = false
            self.error = "The plugin did not finish loading. Try again."
        }
    }
    func command(_ command: String, section: String) {
        guard ready else { return }
        let payload = ["command": command, "section": section, "pluginId": pluginID]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.sendPluginCommand(\(json))") { _, _ in }
    }

    func stop() {
        timeout?.cancel(); timeout = nil
        ready = false; loading = false
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "pluginReady")
        webView.loadHTMLString("", baseURL: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.body as? String == pluginID else { return }
        timeout?.cancel(); loading = false; ready = true
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loading = false; ready = false; self.error = error.localizedDescription
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { loading = false; self.error = error.localizedDescription }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        guard let baseURL, url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port else {
            decisionHandler(.cancel); return
        }
        let pluginPage = PluginNavigationPolicy.allows(url, server: baseURL, pluginID: pluginID)
        if !pluginPage { loading = false; error = "This link leaves the plugin. Open it from your server in a browser." }
        decisionHandler(pluginPage ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url, let baseURL,
              PluginNavigationPolicy.allows(url, server: baseURL, pluginID: pluginID) else { return }
        timeout?.cancel(); loading = false; ready = true
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
            timeout?.cancel(); loading = false; ready = false
            error = "Plugin returned HTTP \(http.statusCode). Check your server connection and account access."
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
}
