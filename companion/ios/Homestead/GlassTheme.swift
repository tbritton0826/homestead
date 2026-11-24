import SwiftUI
import UIKit


private struct HomesteadAppearanceKey: EnvironmentKey {
    static let defaultValue = AppearancePreferences()
}
extension EnvironmentValues {
    var homesteadAppearance: AppearancePreferences {
        get { self[HomesteadAppearanceKey.self] }
        set { self[HomesteadAppearanceKey.self] = newValue }
    }
}
extension AppearancePreferences {
    var readerAccent: String {
        switch accent { case .blue: return "#438ee8"; case .teal: return "#30b9ae"; case .green: return "#45b96c"; case .purple: return "#ac7fea"; case .pink: return "#e875af"; case .orange: return "#ef9d46" }
    }
    var colorScheme: ColorScheme? {
        switch theme { case .system: return nil; case .light: return .light; case .dark: return .dark }
    }
    var color: Color {
        switch accent {
        case .blue: return .blue
        case .teal: return .teal
        case .green: return .green
        case .purple: return .purple
        case .pink: return .pink
        case .orange: return .orange
        }
    }
}

// Canonical library layout: library name left, section picker right, filters below.
struct CompactLibraryHeader<Content: View>: View {
    @Environment(\.openGlobalSearch) private var openSearch
    let title: String
    let symbol: String
    private let content: Content
    init(title: String, symbol: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.symbol = symbol
        self.content = content()
    }
    var body: some View {
        HStack(spacing: 8) {
            Label(title, systemImage: symbol).font(.headline).symbolRenderingMode(.hierarchical).lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 8)
            content.lineLimit(1).minimumScaleFactor(0.75).fixedSize(horizontal: true, vertical: false).layoutPriority(1)
            if title != "Search" {
                Button(action: openSearch) { Image(systemName: "magnifyingglass").frame(width: 36, height: 44) }
                    .accessibilityLabel("Search Homestead")
            }
        }
        .padding(.horizontal, 14).frame(minHeight: 48)
        .homesteadControl().padding(.horizontal, 12).padding(.vertical, 8)
    }
}

struct LibrarySearchField: View {
    @Binding var text: String
    let prompt: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(prompt, text: $text).textInputAutocapitalization(.never)
                .autocorrectionDisabled().submitLabel(.search).accessibilityLabel(prompt)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .accessibilityLabel("Clear search").frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.horizontal, 12).frame(minHeight: 44).homesteadPanel(radius: 16)
    }
}

struct HomesteadBackdrop: View {
    @Environment(\.homesteadAppearance) private var appearance
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        LinearGradient(colors: scheme == .dark
            ? [Color(red: 0.025, green: 0.05, blue: 0.11), appearance.color.opacity(0.20)]
            : [Color(red: 0.97, green: 0.98, blue: 1), appearance.color.opacity(0.12)],
            startPoint: .topLeading, endPoint: .bottomTrailing)
            .background(Color(uiColor: .systemBackground)).ignoresSafeArea()
    }
}

private struct GlassPanel: ViewModifier {
    @Environment(\.homesteadAppearance) private var appearance
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    let radius: CGFloat
    func body(content: Content) -> some View {
        content
            .background {
                if reduceTransparency || appearance.surface == .solid {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                } else {
                    RoundedRectangle(cornerRadius: radius, style: .continuous).fill(.regularMaterial)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(appearance.color.opacity(contrast == .increased ? 0.85 : 0.25), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .shadow(color: .black.opacity(reduceTransparency ? 0 : 0.04), radius: 10, y: 4)
    }
}

private struct GlassControl: ViewModifier {
    @Environment(\.homesteadAppearance) private var appearance
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !reduceTransparency, appearance.surface == .glass {
            // Keep each header's effect local. A container outside TabView retains
            // effects from offscreen navigation roots and overlays their labels.
            GlassEffectContainer {
                content.glassEffect(.regular.tint(appearance.color.opacity(0.07)), in: .rect(cornerRadius: 22))
            }
                .overlay {
                    RoundedRectangle(cornerRadius: 22).strokeBorder(appearance.color.opacity(0.4), lineWidth: 1)
                        .allowsHitTesting(false)
                }
        } else { content.modifier(GlassPanel(radius: 22)) }
    }
}

struct HomesteadAddStyle: ViewModifier {
    @Environment(\.homesteadAppearance) private var appearance
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !reduceTransparency, appearance.surface == .glass {
            content.glassEffect(.regular.tint(appearance.color).interactive(), in: .circle)
        } else { content.background(appearance.color, in: Circle()) }
    }
}

extension View {
    func homesteadLibraryPill(selected: Bool = false) -> some View { modifier(LibraryPillStyle(selected: selected)) }
    func homesteadPanel(radius: CGFloat = 22) -> some View { modifier(GlassPanel(radius: radius)) }
    func homesteadControl() -> some View { modifier(GlassControl()) }
    func homesteadCanvas() -> some View {
        scrollContentBackground(.hidden).background { HomesteadBackdrop() }
    }
}

enum FamilyGlassStyle {
    // Scoped to the embedded companion browser; the deployed website is unchanged.
    static let css = """
    :root { --hs-glass-edge: rgba(68,150,255,.42); --homestead-mobile-bottom-clearance: 16px; }
    /* SwiftUI reserves its tab bar and Add inset; do not render a second web bar. */
    .mobile-bottom-nav, .mobile-menu-button { display: none !important; }
    @media (max-width: 900px) {
      .app-shell .main { padding-bottom: 16px !important; }
      .tv-detail-page, .profile-page { padding-bottom: 16px !important; }
    }
    .panel, .mobile-family-directory {
      border-radius: 22px !important;
      border: 1px solid var(--hs-glass-edge) !important;
    }
    .mobile-directory-card {
      border-radius: 16px !important;
      border: 1px solid var(--hs-glass-edge) !important;
    }
    .mobile-directory-card.active {
      background: #174c81 !important;
      color: #fff !important;
    }
    :focus-visible { outline: 3px solid #65afff !important; outline-offset: 3px; }
    @supports (backdrop-filter: blur(12px)) {
      .mobile-family-directory { backdrop-filter: blur(12px); }
    }
    @media (prefers-reduced-transparency: reduce) {
      .panel, .mobile-family-directory { backdrop-filter: none !important; }
    }
    @media (prefers-contrast: more) { :root { --hs-glass-edge: #438ee8; } }
    """
}

// Shared with the existing library/media tab capsules.
private struct LibraryPillStyle: ViewModifier {
    @Environment(\.homesteadAppearance) private var appearance
    let selected: Bool
    func body(content: Content) -> some View {
        content.font(.subheadline.weight(selected ? .bold : .regular))
            .padding(.horizontal, 14).frame(minHeight: 44)
            .background(selected ? appearance.color.opacity(0.18) : Color.clear, in: Capsule())
            .overlay { Capsule().stroke(appearance.color.opacity(selected ? 0.4 : 0.12), lineWidth: 1) }
    }
}

struct HomesteadLoadingCard: View {
    var message = "Loading…"
    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(message).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
        }.padding(20).homesteadPanel(radius: 18).shadow(radius: 12).padding(24)
            .accessibilityElement(children: .combine).accessibilityLabel(message)
    }
}
extension View {
    func homesteadLoading(_ busy: Bool, message: String = "Loading…") -> some View {
        overlay { if busy { HomesteadLoadingCard(message: message).allowsHitTesting(false) } }
    }
}
