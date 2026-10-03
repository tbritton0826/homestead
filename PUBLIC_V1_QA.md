# Public V1 QA — 2026-10-03

Branch: `codex/public-v1-polish`. Starting commit: `b55ba57`. This is a separate QA/accessibility batch. No merge, push, deployment, dependency upgrade, or native archive modification.

## 1. Issues found

| Observed issue | Root cause | Correction |
| --- | --- | --- |
| Appearance and other dialogs left focus behind or allowed background navigation | Missing shared focus lifecycle; several independent Escape handlers | Small focus utility applied to existing dialogs; live focusable filtering, background inertness, nested Escape and origin restoration |
| Book actions became unreachable inside a trapped detail dialog | Actions portal rendered outside its parent dialog | Portal into the nearest dialog; keyboard menu navigation and launcher restoration |
| Music Fix Match could not restore Actions focus | Conditional return unmounted the underlying detail | Render matching dialog alongside the existing detail, preserving its origin and scroll |
| Recipe edit close lost its origin | Editing cleared the detail selection | Retain detail under editor; restore the edit control |
| Space on viewer controls also changed slideshow state | Window shortcut listener intercepted native controls | Ignore shortcuts originating from buttons, fields, links, and native media controls |
| Profile metadata scroller expanded beyond the phone width | Legacy grids/negative offsets plus intrinsic parent grid sizing | Horizontal flex strip, bounded grid track, keyboard-focusable region |
| TV cards and long detail titles were cropped/squeezed | Intrinsic track expansion and unbroken text; narrow two-column phone hero | Bound TV page track, wrap titles, stack the existing small-screen hero |
| Long pet/collection/category metadata overflowed | Unbroken text and automatic grid minimum sizing | Targeted wrapping and bounded tracks |
| Transparent cards over bright backgrounds lost captions | White text without reliable backing | Opacity-dependent caption backing, preserving selected opacity and blur |
| Cloud network failure left Upload disabled; refresh erased failures | Missing try/finally and unconditional status reset | Per-file outcomes, finally cleanup, retained result summary, refresh generation guard |
| Failed collection banner/photo thumbnail/book artwork showed broken images | Missing/brittle fallback handlers | Existing bounded image fallback utility applied to the affected slots |
| TV detail This Page was disabled | Selected show did not publish appearance context | Stable existing `tv:<show id>` page scope |

## 2. Implementation and files

`src/utils/dialog-focus.js` and `src/hooks/useDialogFocus.js` manage focus for existing markup; they do not render dialogs or introduce modal state. `src/App.jsx` wires appearance, profile appearance/crop, movie/TV matching, book dialogs/reader, recipe dialogs, import, viewer, search, Activity Center, Add and navigation dialogs; it also contains the focused Cloud, Music, recipe and TV-scope fixes.

Component hooks cover ArtworkPicker, PhotoLibraryPicker, ItemFixMatchModal, BookMetadataMatchModal, BookSeriesAppearanceEditor, ProfileToolPortal and adult add/import dialogs. Photo thumbnails and book artwork use bounded fallback. `src/PublicQa.css` holds focused accessibility/overflow/contrast/safe-area rules. `src/App.css` removes conflicting legacy profile metadata grids and negative margins only. Existing render harnesses supply a noop focus hook; actual DOM focus behavior is tested separately.

## 3. Accessibility

Keyboard entry, forward/reverse Tab wrap, disabled/hidden field filtering, empty-dialog fallback, background inertness, nested Escape, focus return and ten repeated opens passed against the actual utility in `scripts/qa-dialog-focus.html`.

Production integration checks covered Home/library appearance, nested photo picker, book detail plus matching, Music matching, TV matching, profile appearance, recipe detail/editor, Add and global search. Busy matching ignores Escape. Shared media menus support arrows, Home/End and Escape. The profile strip has a visible focus ring and native horizontal arrow scrolling. Search typing remains immediate and returns focus to its launcher.

Close, navigation and recipe edit icons were labeled; book metadata provider and URL inputs and Inventory search received meaningful names. Settings preferences and AI page controls were reached and activated with keyboard input. Browser checks are not a complete screen-reader audit and do not certify every legacy niche dialog.

## 4. Edge cases and appearance

Synthetic records include long movie/TV/episode/book/author/artist/creator/profile/pet values, long profile occupation, category and collection names, missing metadata/artwork, failed URLs and a white photo background. Grid headings retain their full accessible text; detail text wraps.

Measured examples in the mobile browser:

- Profile metadata: 346 px viewport within the profile, 1,576 px scrollable strip; ArrowRight moved scrollLeft to 40. Long occupation content stayed within its 128 px text box.
- TV grid: 425 px overflowing intrinsic track before correction; 347 px container and scroll width afterward.
- Movie detail title: 4,022 px unbroken overflow before; 303 px width and scroll width afterward.
- Pet detail: main content expanded to 1,205 px before; 375 px afterward. Title width and scroll width both 297 px.
- Recipe Back/Edit: both 44 px high at y=13, left x=13 and right x=280 on the small-screen layout. Closing the editor restores Edit and leaves the detail open.
- Collection heading wraps within its sidebar; failed decorative banner resolves to the bounded banner fallback.

Tested panel/card opacity 0, blur 0 and 24 px, bright and dark backgrounds, contain/cover, minimum/maximum poster controls and narrow/wide ratios. Transparent TV captions compute white text over rgba(0,0,0,.72). Against pure white underneath, their worst-case contrast is approximately 9.2:1. This backing affects captions; it does not alter saved opacity or blur. Arbitrary user text-color/background combinations across all native/custom surfaces are not certified.

## 5. TV detail scope

The existing model safely supports per-show appearance. TV now publishes selected show ID/title with `tv:<id>`; returning to the list publishes the normal list context. Collections keep their existing collection identity. This Page is enabled for a selected show and remains disabled for the general list. A 160 px detail override survived editor reopen; Reset restored the inherited 300 px value in the exercised fixture. Existing persistence/inheritance/race tests pass.

## 6. Mobile and desktop validation

Production browser checks used a 390×844 configured phone-sized tab (document width varies to 375 px with scrollbars) and a separate 1280×720 desktop tab. Home, Media, Movies, TV, YouTube, Music, Books, Family, Pets, Adult, Inventory, Cloud, AI and Settings were exercised at the small-screen size; desktop navigation, library appearance containment, collections and AI were rechecked. This is focused QA, not every action on every screen at every resolution.

Viewer stays centered with one image mounted; Page Down does not expose another image. Space on Next advances once without starting slideshow; broken image displays unavailable-preview guidance. Viewport containment and 44 px viewer/navigation controls passed. Safe-area-aware CSS is present for viewer/modal and recipe boundaries. Real status bar, home indicator, software keyboard, touch bounce and rotation require an iPhone. See `IOS_V1_QA.md`.

## 7. Upload/provider limitations

`qa-public-ui.mjs` opts into disposable edge fixtures on localhost:7314, backed by an isolated checkout API on 7313. Upload bytes stay in fixture memory; only a 31-byte synthetic text file was used. Upload loading, HTTP 503, dropped connection, same-file retry and successful fixture listing were observed. Unit checks also cover a partial two-file batch, cancel/no data, retained summary and busy cleanup.

Music provider loading, empty results, synthetic timeout and retry were observed. Book empty results and labeled provider control passed; before installing the controlled book fixture, a real Google Books quota error was visibly reported through the isolated API. No real-provider search success, remote upload success, account permission grant or AI generation is claimed. Unconfigured integrations remain visibly unavailable. Media success/playback, native confirmation interaction and every provider configuration flow remain staging/device checks.

## 8. Validation

Passed on the final implementation:

- `npm run test` (appearance, responsiveness, startup, media polish, full public checks, new `test:qa`).
- `npm run build`.
- `node scripts/test-unified-profile-overlay-pass.cjs`.
- `node scripts/test-quick-instruction-edit-poster-pass.cjs`.
- `node scripts/test-family-profile-tree-pass.cjs`.
- Actual-browser `qa-dialog-focus.html` regression.
- `git diff --check`.

Final build: CSS 758.24 kB / gzip 126.75 kB; entry JS 1,746.88 kB / gzip 432.40 kB. Existing deferred Calendar 265.48 kB, EPUB 345.77 kB, barcode 436.28 kB, HLS 509.70 kB and model viewer 967.37 kB remain separate. The existing large-chunk warning remains. This batch intentionally does not repeat startup/performance restructuring.

## 9. Remaining known issues

Native recipe editing and detailed web/native appearance parity remain gaps in v3.3.5 source. Native runtime, session restoration and deployment freshness are unverified here. Real-provider, remote upload, playback, screen-reader, native browser confirmation and complete legacy modal coverage remain outstanding. The profiling development-source instrumentation could not run this QA fixture; production-dist testing worked and was used throughout final verification.

## 10. Deployment decision

**Ready for controlled web staging validation; not fully signed off for live public V1 deployment.** Tests/build and the exercised web corrections pass. Native iOS device validation, current frontend freshness in its WebViews, real-provider/upload/playback checks and the source-confirmed native parity gaps must be resolved or explicitly accepted before live sign-off. No deployment was performed.
