import SwiftUI
import QuickLook

struct NativeDocumentView: View {
    let file: ProfileMediaFile
    let client: HomesteadClient
    @Environment(\.dismiss) private var dismiss
    @State private var localURL: URL?
    @State private var error: String?
    @State private var retry = UUID()
    var body: some View {
        NavigationStack {
            Group {
                if let localURL { DocumentPreview(url: localURL) }
                else if let error {
                    VStack { Text(error); Button("Retry") { retry = UUID() } }.padding()
                } else { HomesteadLoadingCard(message: "Opening document…") }
            }
            .navigationTitle(file.title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
            .task(id: retry) {
                error = nil
                do {
                    let url = try await client.documentFile(file)
                    if Task.isCancelled { Self.remove(url); return }
                    guard QLPreviewController.canPreview(url as NSURL) else {
                        Self.remove(url); throw CompanionError.message("This document format cannot be previewed on this device.")
                    }
                    localURL = url
                } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            }
            .onDisappear { if let localURL { Self.remove(localURL) } }
        }
    }
    static func remove(_ url: URL) {
        let directory = url.deletingLastPathComponent()
        guard directory.lastPathComponent.hasPrefix("homestead-document-"),
              directory.deletingLastPathComponent().standardizedFileURL.path == FileManager.default.temporaryDirectory.standardizedFileURL.path else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}

private struct DocumentPreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        if context.coordinator.url != url { context.coordinator.url = url; controller.reloadData() }
    }
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
