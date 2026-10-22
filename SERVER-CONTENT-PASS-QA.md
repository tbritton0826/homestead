# Server content pass

This pass condenses the existing web interface before the final visual design pass.

## Behavior

- Home has one activity ribbon, one Continue Watching row for saved video/reading/audio progress, one Recently Added row across enabled public media libraries, and an optional related-owned-titles row based on recent viewing and shared genres.
- Cards identify their library; TV additions include season/episode labels when indexed or filename data supplies them. Existing artwork and detail/playback routes are reused. Private and disabled libraries do not enter these feeds.
- File-level first-added timestamps survive rescans. Newly scanned episodes receive their own import time; legacy files retain their existing parent import time rather than all appearing newly added.
- Fresh collections show “No collections yet. Click + to add custom collections.” The six previously visible presets were generated in the UI, not evidence of account synchronization. Untouched generated presets and metadata collections are no longer presented as saved collections. Saved custom collections and generated collections with saved order/artwork edits remain available.
- Movies uses its existing header action to switch between Movies and Collections, removing the duplicate navigation row.
- Profile media replaces the repeated folder-pill ribbon with a Folder selector. Actual nested folders remain selectable and include their descendants. Main folder is omitted when empty. No selector is shown without subfolders.
- Photos album headings are compact, including albums with background artwork. Existing external Back/count controls remain the single source of navigation/count display.

## Validation

- `npm test` passes, including the new `test:server-content` feed/scanner tests and existing collection-conversion, selected-artwork, wizard dismissal, profile-folder, and mobile compatibility regressions.
- `npm run build` passes. Existing large-bundle advisories remain.
- `node scripts/test-home-performance.cjs` passes.
- Isolated browser fixture mounts the actual HomePage, MoviesPage, PhotosLibraryPage and folder selector with synthetic media. Verified TV/YouTube detail navigation, empty collections, successful custom collection creation, nested filtering, and a 72px album heading with banner artwork. Home has no page-level horizontal overflow at 390px and 1024px viewports; its poster rows scroll independently.
- Browser proof files are local ignored artifacts under `work/server-content-*-proof.png`. They contain synthetic titles and the default Homestead poster, not private library media.

## Release scope

Windows preview revision `0.6.8.64-windows.3` includes this pass and the earlier standalone Windows/Free setup fixes. Its installed-runtime smoke test also checks that custom collections and saved collection overrides are empty on a fresh installation. Existing installations retain their own saved data during updates.

The source change is stacked on the standalone Windows preview branch (PR #20); merge that parent before this pass. Publishing a Windows download does not update an existing Docker server automatically. The native mobile Family Home navigation cards remain a separate mobile change. The final visual polish and desktop application shell are subsequent work.
