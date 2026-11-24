import SwiftUI
import UIKit
import AVFoundation

/// Captures the card face; identification uses the shared server OCR/catalog service.
@MainActor
struct InventoryCardCamera: View {
    let captured: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var checking = true
    @State private var authorized = false
    @State private var message: String?

    var body: some View {
        Group {
            if checking { HomesteadLoadingCard(message: "Checking camera access…") }
            else if authorized && UIImagePickerController.isSourceTypeAvailable(.camera) && message == nil {
                CardFaceCapture(captured: captured, cancelled: { dismiss() }, failed: { message = $0 })
                    .ignoresSafeArea()
            } else {
                NavigationStack {
                    ContentUnavailableView("Card camera unavailable", systemImage: "camera",
                        description: Text(message ?? "Enable camera access in iOS Settings, choose a saved card photo, or enter the printed set code."))
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
                }
            }
        }.task {
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            authorized = status == .authorized
            if status == .notDetermined { authorized = await AVCaptureDevice.requestAccess(for: .video) }
            guard !Task.isCancelled else { return }
            checking = false
        }.onChange(of: scenePhase) { _, phase in
            if phase == .background { dismiss() }
        }
    }
}

@MainActor
private struct CardFaceCapture: UIViewControllerRepresentable {
    let captured: (Data) -> Void
    let cancelled: () -> Void
    let failed: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(captured: captured, cancelled: cancelled, failed: failed) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) { }
    static func dismantleUIViewController(_ controller: UIImagePickerController, coordinator: Coordinator) {
        coordinator.finished = true
        controller.delegate = nil
    }

    @MainActor final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let captured: (Data) -> Void
        let cancelled: () -> Void
        let failed: (String) -> Void
        var finished = false
        init(captured: @escaping (Data) -> Void, cancelled: @escaping () -> Void, failed: @escaping (String) -> Void) {
            self.captured = captured; self.cancelled = cancelled; self.failed = failed
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            guard !finished else { return }; finished = true; cancelled()
        }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard !finished else { return }; finished = true
            guard let image = info[.originalImage] as? UIImage,
                  let data = image.jpegData(compressionQuality: 0.9), data.count <= 64 * 1024 * 1024 else {
                failed("The card photo could not be captured. Close the camera and try again or choose a saved photo."); return
            }
            captured(data)
        }
    }
}
