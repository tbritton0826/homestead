import SwiftUI
import AVFoundation
import VisionKit

@MainActor
struct InventoryBarcodeScanner: View {
    let found: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var authorized = false
    @State private var checking = true
    @State private var message: String?
    @State private var visible = false
    var body: some View {
        NavigationStack {
            Group {
                if checking { HomesteadLoadingCard(message: "Checking camera access…") }
                else if authorized && DataScannerViewController.isSupported && DataScannerViewController.isAvailable && message == nil {
                    InventoryCamera(active: visible && scenePhase == .active, found: found, failure: { message = $0 })
                        .overlay(alignment: .top) { Text("Point the camera at one barcode").padding().background(.regularMaterial, in: Capsule()).padding() }
                } else {
                    ContentUnavailableView("Camera scanning unavailable", systemImage: "barcode.viewfinder", description: Text(message ?? "Enter the barcode manually, or enable camera access in iOS Settings."))
                }
            }.navigationTitle("Scan barcode").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                .task {
                    let status = AVCaptureDevice.authorizationStatus(for: .video)
                    authorized = status == .authorized
                    if status == .notDetermined { authorized = await AVCaptureDevice.requestAccess(for: .video) }
                    guard !Task.isCancelled else { return }
                    checking = false; visible = true
                }.onDisappear { visible = false }
        }
    }
}

@MainActor
private struct InventoryCamera: UIViewControllerRepresentable {
    let active: Bool
    let found: (String) -> Void
    let failure: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(found: found, failure: failure) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode()], qualityLevel: .balanced,
            recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return scanner
    }
    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.active = active
        if active && !context.coordinator.delivered && !scanner.isScanning {
            do { try scanner.startScanning() }
            catch { DispatchQueue.main.async { failure("The camera could not start. Enter the barcode manually or reopen the scanner.") } }
        } else if !active { scanner.stopScanning() }
    }
    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        coordinator.active = false; scanner.stopScanning(); scanner.delegate = nil
    }
    @MainActor final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (String) -> Void
        let failure: (String) -> Void
        var delivered = false
        var active = false
        init(found: @escaping (String) -> Void, failure: @escaping (String) -> Void) { self.found = found; self.failure = failure }
        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) { receive(addedItems, scanner: dataScanner) }
        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) { receive([item], scanner: dataScanner) }
        func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            active = false; dataScanner.stopScanning(); failure("Camera scanning became unavailable. You can enter the barcode manually.")
        }
        private func receive(_ items: [RecognizedItem], scanner: DataScannerViewController) {
            guard active, !delivered else { return }
            for item in items {
                if case .barcode(let barcode) = item, let raw = barcode.payloadStringValue {
                    let code = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !code.isEmpty, code.count <= 200 else { continue }
                    delivered = true; active = false; scanner.stopScanning(); found(code); return
                }
            }
        }
    }
}
