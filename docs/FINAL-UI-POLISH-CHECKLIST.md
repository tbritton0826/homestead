# Final UI polish checklist

Status: implemented in the final UI polish branch. See [verification and limits](FINAL-UI-POLISH-QA.md) for the checks actually completed. This is a requirements checklist, not a claim of physical-device or production-network validation.

## Collections: right-hand scrolling and clipped content

Reported October 22, 2026 with collection timeline and episode-list screenshots.

- The collection detail's right-hand content pane must scroll through the full displayed timeline/episode list. Scrolling the left sidebar or included-title list must not be the only available scrolling path.
- Fix timeline groups collapsing into thin strips and clipping headings/rows. Groups must keep their intended content height within the scrolling layout.
- Ensure wheel/trackpad, touch and keyboard scrolling work in the right pane, with a visible usable scrollbar when needed.
- Keep pagination/load-more controls reachable. Loading more rows must not leave content trapped inside a clipped container or unexpectedly reset scroll position.
- Validate both mixed movie/TV timelines and large TV collections, plus short content, narrow windows and tablet layouts. Preserve title navigation, collection ordering and independent left-pane access.
- Investigate the actual height/flex/grid/overflow constraints before choosing a fix; screenshots establish the symptoms, not their precise CSS cause.

## Library count diagnostics

Implement the approved [library count diagnostics](LIBRARY-COUNT-DIAGNOSTICS.md): clearly labeled folder/title/supported-video counts, unsupported-disc-image and empty-media statuses, and a Review discrepancies view.

## Collection counts outside the Collections page

- Movies and TV must show the actual numeric collection count in their collection navigation/header control even while browsing All Movies/All Shows. Do not replace the count with “View” outside Collections.
- Use the same library scope and counting rules as the corresponding Collections page; preserve the empty-on-fresh-install behavior and saved custom/edited collections.
- Keep the count current after collection creation, deletion and membership changes. Use a lightweight summary/cache rather than building complete watch-order timelines just to show a badge. Distinguish loading/unavailable from a real zero.
- Preserve the reduced-navigation design; showing the count does not require reinstating a duplicate tab row beneath the header.

## TV season and episode ordering within collections

- When organizing TV in a collection/manual watch order, use seasons as the default ordering units rather than one indivisible whole-series entry. Label rows with the series and season number.
- Let the user switch an individual season to episode-level ordering when needed. This is a per-season choice, so other seasons can remain compact.
- In season mode, move the season as one unit among other seasons, movies, books and other supported collection items; its episodes follow the established internal episode order.
- In episode mode, expose the season's individual episodes as independently positionable entries in the collection sequence, allowing crossovers/interleaving. This must affect the saved/playback sequence, not merely expand a visual list.
- Preserve stable series/season/episode identities, custom ordering and resume state across save/reopen and rescans. Do not duplicate membership or silently discard an existing episode order when returning to season mode; define a clear reconciliation/confirmation flow for interleaved entries.
- Handle specials, missing episodes and newly scanned episodes explicitly. Avoid eagerly building/rendering every episode for a large collection; align this work with the loading-performance and scrolling fixes.
- Keep legacy whole-series collection entries readable and provide an intentional conversion path instead of silently rewriting saved collections. Validate both the organizer and actual collection playback/resume behavior.

## Two-step collection overlay wizard

User-proposed direction: replace the Create Collection page/form with an overlay card consistent with the other Homestead wizards.

### Step 1: Collection details and title selection

- Name and description fields.
- Poster artwork: image URL or browse/upload an image, with a visible preview. Retain selected artwork through wizard navigation and after saving.
- Optional online watch-order URL field. Import through a deliberate action with loading/error feedback; review the extracted order and local matches rather than silently accepting guessed results. Preserve unmatched entries for review and distinguish them from owned/available media. URL import requires functioning retrieval/parsing/matching support; do not present a working import control before that exists.
- One search across permitted TV, Movies and Books; include book title and author matching. Label result types clearly and support adding/removing selections without duplicates. Respect disabled libraries and account permissions.
- Show the selected items and a clear Next action. Use progressive search/results so large catalogs do not delay opening or typing.

### Step 2: Manual order and review

- Order selected items using the existing supported collection controls, with season-level TV units and per-season episode ordering as described above.
- Preserve imported order as the starting point when an online order was imported; allow reviewed manual changes.
- Back returns to details/selection without losing ordering, artwork or form values. Added/removed items reconcile with the existing draft instead of resetting it.
- Save validates and creates the collection once, reports failures accurately, and opens the saved collection on success. Editing an existing collection must preserve its identity and unrelated saved fields.

### Overlay behavior

- Clicking the backdrop must not discard the wizard. Provide explicit Close/Cancel; retain a draft or confirm before discarding unsaved changes. Apply the same rule to Escape and other dismissal paths.
- Manage focus and keyboard navigation, restore focus after closing, and support narrow/tablet layouts with usable internal scrolling. Keep navigation/actions reachable without clipping long selections or order lists.
- Online import uses the server retrieval/parser in preview mode; the draft and its order are committed together only when saved.

## Smart collection suggestions based on owned media

User-approved direction: put suggestions on the Collections page in a separate **Smart Collection — Based on your Media** section, rather than treating generated groups as already saved collections.

- Suggest useful groups from media currently available in the permitted libraries, such as Star Wars movies or related NCIS shows. Show matched titles and counts so the user can review the proposed membership. Do not show zero-match preset names as ordinary collections.
- Provide **Create** and **Remove suggestion** actions. Create opens a prefilled, editable collection draft for review and saving. Only a successfully saved collection belongs in the normal saved-collections list/count and Add to Collection picker; opening or cancelling the draft must not consume the suggestion.
- Remove suggestion dismisses the recommendation, not its media. Persist dismissal so the same suggestion does not return after navigation, restart, rescan or new matching media. Use a stable suggestion identity rather than poster/title text as the dismissal key.
- Reuse the current collection ownership/visibility scope. Dismissals must not unexpectedly hide suggestions for unrelated users; define their scope explicitly alongside the existing shared-collection behavior.
- Suppress suggestions already represented by a saved collection to avoid duplicates, including legacy smart groups deliberately saved/edited by the user. Preserve those saved records and their manual orders/artwork.
- Keep suggested and saved counts distinct. An otherwise fresh installation still has zero saved collections, even if library scanning produces suggestions.
- Evaluate suggestions without eagerly constructing episode timelines or blocking the first render of saved collections. This requires actual matching, persistence and save/dismiss behavior, not only a visual card.

## Unified Edit Collection window

- Replace the collection header's Manage/ellipsis popover with one pencil action labeled **Edit Collection**, including an accessible name and tooltip.
- Open the same collection overlay wizard used for creation, prefilled with the saved collection's name, description, artwork, membership, imported-order information and exact playback order.
- Consolidate the currently separate Add/Remove Movies, TV & Books, Edit Exact Playback Order, and Import Watch Order flows into that editor. Keep details/title selection/import on the first step and manual season/episode ordering on the second; these remain one edit session/window.
- Let users review combined changes before saving. Back/Next must preserve the draft; Cancel must leave the saved collection unchanged. Do not partially persist one subsection while another is still being edited.
- Preserve stable collection identity, custom artwork, membership details and resume state. Validate existing mixed-media collections and legacy edited/smart records; do not silently overwrite or duplicate them.
- Apply the previously recorded backdrop/dismissal protection, internal scrolling and large-library loading requirements to editing as well as creation.

## TV Filter/Sort parity with Movies

- Move TV Genres and Years into the TV Filter/Sort control, following the Movies library's interaction pattern.
- Remove the separate Genres and Years navigation tabs below the header.
- Preserve available genre/year choices, filtering, sorting, selected-state visibility and clear/reset behavior. Ensure selections combine correctly with search and the existing library view.
- Verify the filter overlay and controls with mouse, keyboard and touch at desktop/tablet/narrow widths. Keep collections access and its numeric count available independently of filters.

## Mobile Family navigation

Remove duplicate Family Home navigation cards beneath the header while retaining access through the header's existing Family navigation. This remains a native mobile follow-up, separate from earlier server navigation changes.

## Large-library page loading and posters

User report: library pages take several seconds, with some taking more than 10 seconds to fully load when many media records/posters are present. The grid previously constructed all card elements before slicing the first batch. Construction is now bounded to the visible batch; local previews are sized and cached. Network transport and real-device artwork timing still need production measurements.

- Treat loading performance as part of the polish pass, alongside visual changes. Cover large Movies/TV/Photos/profile libraries and previously reported slow selected-profile artwork.
- Measure cold first visit, warm repeat visit and return navigation separately. Record time until the header/controls respond, first visible items, visible poster completion and all requested work completing; distinguish slow server/index transport, client processing/rendering and artwork retrieval/decoding.
- Show usable navigation and initial visible content promptly. Load large grids progressively or virtualize where appropriate; prioritize visible posters and defer offscreen images and expensive hidden detail/timeline work.
- Inspect index payload size, duplicate requests, unnecessary enrichment and repeated calculations before choosing fixes. Preserve authorization and existing bounded/lazy index behavior.
- Use appropriately sized cached thumbnails and stable artwork revision keys. Verify selected custom artwork remains correct after replacement and cache invalidation; improving speed must not restore the stale-poster bug.
- Preserve scroll position, filters and smooth return navigation. Use placeholders with stable dimensions, clear loading/error states and retry behavior; do not hide failures behind an indefinite spinner.
- Verify representative large libraries at desktop/tablet/narrow sizes, including slower connections. Compare before/after measurements and report remaining limitations without claiming a measured target before testing.

## Incremental settings

The [settings roadmap](SERVER-SETTINGS-ROADMAP.md) is a future backlog. Add settings alongside related functioning features as needed; completing it is not a prerequisite for this polish pass.
