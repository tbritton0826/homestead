# iOS companion v3.6 server integration

Development branch: `codex/public-v3-6-server`, based on `5f084b5` (completed Public V1.2 mobile polish). This change has not been merged or deployed. It adds no dependencies and does not alter customer billing or authentication contracts.

## Why an accompanying server change is needed

The existing `/api/adult/media-folders` endpoint addresses the loose Adult photo/video libraries. It cannot select or create folders within a particular profile. The existing multipart profile uploader always chooses its built-in destination; sending an unknown folder field to an older server would silently ignore that selection.

Book file schema variants are handled by the native app. The new format lookup additionally uses the existing live book scanner when a book is opened, so the app can check files beyond its previously downloaded snapshot. It returns only records from the account-filtered index and never authorizes a caller-supplied filesystem folder. An active book-scan cache is reused; otherwise the persisted index and book scanner are read without loading every profile's metadata. Files not indexed/discovered under configured book roots cannot be invented by the phone.

## APIs

- `GET /api/books/local-files?recordId=books:<id>`: authenticated, account-filtered local book records and their indexed/discovered files. Missing or inaccessible identities return 404. No filesystem writes or raw client folder lookup.
- `GET /api/adult/profile-folders?library=personal&profileId=<id>&type=photo&parent=<relative>`: immediate child folders, `version: 1`. Only relative category paths are returned; listing does not create missing directories.
- `POST /api/adult/profile-folders`: JSON `{library, profileId, type, parent, name}` creates one named folder beneath the selected parent. Existing names return 409. The new folder path is returned for explicit selection.
- `POST /api/adult/profile-media-upload`: same multipart file contract as `/api/adult/import-upload`, with required `destinationFolder` (nonempty relative path) and `profileFolderVersion=1`. Uploads to existing selected folders are confirmed by the returned `destinationFolder` field. Missing destinations fail before any file is saved.

Folder APIs require administrator edit rights, the existing Adult entitlement, enabled library/section, and access to that specific sublibrary/profile. Linked-profile administrators are limited to their linked profile. Child/member/read-only accounts cannot create folders. The new upload path applies the same profile access check; both upload routes use the existing admin and entitlement middleware.

Supported photo roots reuse the existing category map: Photos, Nudes, Artwork, and References (including existing server aliases). Native mixed photo/video batches use the chosen folder for photos; videos retain their current video destination. Poster/banner/headshot replacement and unrelated import types do not accept custom photo subfolders.

Paths reject absolute locations, traversal, hidden segments, separators in names, and control characters. Existing linked directories are rejected, and the resolved profile must remain within its configured library. Custom-folder writes use exclusive file creation so a timestamp/name collision cannot overwrite a prior file. No existing media is moved, renamed, or deleted by this feature.

## Integrating into a newer server checkout

The complete iOS ZIP contains `Server-Update/server-v3.6.patch`, exported from the separate server commit, including these docs, focused tests, modules, package scripts, and the small server wiring changes.

1. Use a separate server development branch from the current server code. Preserve newer commits.
2. Inspect the patch and run `git apply --check /path/to/server-v3.6.patch`. If clean, apply it with `git apply /path/to/server-v3.6.patch`. If it conflicts, reconcile the small server route/writer changes against the current code; do not replace all of `server.cjs` or force-reset the checkout.
3. Run `npm run lint:ios-v36`, `npm run test:ios-v36`, `npm run test`, and `npm run build` before a separately authorized server deployment.
4. After the eventual update, verify the phone can browse/create a profile folder and see additional book formats. The existing default upload path and already indexed book actions remain usable on older servers. The app clearly reports unavailable folder support; it never silently falls back from a selected custom folder to the default uploader.

No Docker/container restart, server update, production upload, or production cleanup was performed during this development pass. Deployment remains a separate user decision.
