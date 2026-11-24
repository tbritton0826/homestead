import SwiftUI
import UIKit

struct MediaFolderTabs: View {
    let files: [ProfileMediaFile]
    var rootHint: String? = nil
    var profileCategory = false
    @Binding var selected: String
    private var root: String { MediaFolderCatalog.root(files: files, hint: rootHint, profileCategory: profileCategory) }
    private var folders: [MediaFolder] { MediaFolderCatalog.folders(files: files, root: root) }
    var body: some View {
        if !folders.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(folders) { folder in
                        Button { selected = folder.id } label: {
                            Text(folder.title).fixedSize(horizontal: true, vertical: false).homesteadLibraryPill(selected: selected == folder.id)
                        }.accessibilityAddTraits(selected == folder.id ? .isSelected : [])
                    }
                }
            }.accessibilityLabel("Media folders")
                .onChange(of: folders) { _, values in
                    if !values.contains(where: { $0.id == selected }) { selected = MediaFolderCatalog.all }
                }
        }
    }
}

struct ProfileSocialLinks: View {
    let row: IndexValue
    @State private var error: String?
    private var links: [ProfileSocialLink] { ProfileSocialLink.links(row) }
    var body: some View {
        if !links.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(links) { link in
                        Button {
                            // HTTPS universal links allow iOS to choose an installed app or browser.
                            UIApplication.shared.open(link.url, options: [:]) { opened in
                                Task { @MainActor in error = opened ? nil : "This link could not open. Check your device's browser settings and try again." }
                            }
                        } label: { Label(link.title, systemImage: "arrow.up.right.square").fixedSize().homesteadLibraryPill() }
                            .accessibilityHint("Opens an external website or app")
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.orange) }
        }
    }
}

struct PosterMetadataOverlay: View {
    let metadata: [ProfileMetadataItem]
    var body: some View {
        if !metadata.isEmpty {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 3) { pills }
                VStack(alignment: .leading, spacing: 3) { pills }
            }.padding(5).allowsHitTesting(false)
        }
    }
    private var pills: some View {
        ForEach(metadata) { item in
            Text(PosterMetadataValue.short(item))
                .font(.caption2.weight(.semibold)).foregroundStyle(.white).fixedSize()
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background(.black.opacity(0.78), in: Capsule())
                .accessibilityLabel(item.label + ": " + item.value)
        }
    }
}
