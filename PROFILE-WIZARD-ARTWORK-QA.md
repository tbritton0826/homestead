# Profile creation: selected poster and wizard dismissal repair

October 20, 2026. Server/web repair compatible with the existing mobile v3.16 (17) package. No phone source/binary changes or replacement ZIP are needed for this repair.

## Problem and behavior

Creation downloads a provider image into poster.jpg. A later wizard selection can save poster.png or poster.webp while leaving the provider URL in metadata. The scanner previously chose the first filename in a JPG-first list, the live index preferred the stale metadata URL, and cached card candidates could precede the current poster.

New imports now persist the selected slot in both profile and nested metadata, record selection history and disable stale cutout preferences for the replaced slot. Existing provider and gallery files are retained. Live lookup and cold scanning resolve the same selected local slot and include a file revision in its URL. They read legacy wizard import history as well as subsequent explicit artwork history, so a saved old wizard selection can recover without recreating the profile. Later explicit selections take priority. Missing files and references outside the profile are excluded from selection; normal fallbacks remain available.

Cards prefer the current profile poster ahead of cached candidates/headshots. The wizard stays open after a backdrop click or Escape. Escape can close its enlarged photo preview; explicit Close/Cancel still exit, and saving disables them. This is dismissal protection, not persistent draft storage across reloads or explicit cancellation.

## Verification

- Full npm test suite passed, including five new artwork/import regression tests.
- Actual React wizard/card passed an isolated Chromium/Edge fixture: name/media retention after outside click and Escape, nested preview Escape, selection payload, protection while saving and explicit Close/Cancel.
- Tests execute the actual device/URL import functions, import-record persistence, live poster lookup and scanner function against synthetic temporary profiles with conflicting JPG/PNG/WebP slots. Later selection precedence, revision invalidation, path rejection and stale cutout preferences are covered.
- New helper/fixture lint, server/scanner syntax and production build passed. The existing bundle-size advisory remains.
- An extra legacy script, scripts/test-artwork-scope.cjs, fails at its first old assertion expecting a /media movie poster to be rewritten as /api/file. The identical assertion fails using unchanged HEAD App.jsx. This is a pre-existing assertion mismatch outside this repair; that optional script was not changed or counted as passing.
- No production profile, image or share was accessed or modified for these checks. Actual user profile rendering still needs confirmation after deployment.

## Deployment and confirmation

Merge/update the server, rebuild the container and refresh the web app. Reopen the existing profile/library; rescan the affected Adult sublibrary if its stored index is stale. The old wizard selection is recovered when its successful poster-import record and selected file remain present. If that history is missing, use Select Artwork once to establish the desired poster; do not recreate the profile.

Create a synthetic test profile with provider JPG plus a chosen PNG/WebP, check immediate card/detail rendering, refresh and rescan, then select another poster. Verify default and original gallery images remain on disk. Enter a name and queue media in the wizard, click outside, press Escape, and confirm state remains; test explicit Cancel/Close separately.
