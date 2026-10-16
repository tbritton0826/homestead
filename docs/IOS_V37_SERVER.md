# iOS v3.7 server support

Development branch: `codex/public-v3-7-server`, continuing the v3.6 server branch. No automatic deployment, main merge, or production writes.

## Books

`GET /api/books/local-files` now keeps persisted audiobook records even when the nested-book scanner cache is warm. It returns related, already-authorized records sharing an explicit work identity or the same identifiable book folder, including its `audiobook` child. Common author folders and matching titles in unrelated folders do not authorize grouping. Configured audiobook roots join the existing ebook/book roots during discovery. No guessed filename or client-supplied folder grants access. Existing Listen and opt-in Read Along behavior is unchanged.

The City of Bones 15-part layout is covered by generated fixtures. The live production record, installed server revision, and iPhone playback remain unverified. A phone-only update cannot activate this server fix. After integration, refresh the book and use Check formats again; verify all 15 parts before treating the production report as resolved.

## Pets

`GET /api/pets` lists fresh pet records and `canEdit`; `POST /api/pets` creates a profile with pet-specific metadata. `GET /api/pets/:id` refreshes one profile. `GET/POST /api/pets/:id/folders` browse/create media subfolders; `POST /api/pets/:id/media` accepts an octet-stream upload with `kind`, `folder`, `name`, and stable `requestId` query parameters. Maximum file size is 64 MB.

Use an existing configured `folderMappings.pets` root (or the established `MEDIA_ROOT`/setup `mediaRoot` plus `pets`). The root must already exist. Creating a profile writes a new UUID folder and scanner-compatible `metadata.json`; it does not rename existing profiles. Photos, videos, documents, poster and banner have separate destinations. Folder browsing never creates missing folders. Selected custom destinations must already exist. Existing artwork/media are retained; artwork selection updates metadata rather than deleting old files. The web Pets page reads the same metadata artwork selections. Debounced existing pet scans publish changes to the ordinary index; the native page can refresh directly without waiting for a full scan.

Session, existing Pets entitlement, Family enabled state, Pets sublibrary setting and Pets/Family account access are checked on every API operation. Only owner/admin accounts can write. Adult fields/categories are not accepted. Folder traversal, hidden/control/separator names, linked subfolders and ambiguous identities are rejected. Stable creation IDs prevent duplicate profiles after interrupted responses; stable upload IDs confirm identical bytes on retry and reject collisions. Confirmed uploads are not replayed by the phone. No production pet was created during testing.

## ComfyUI images

The native Homestead AI screen has separate Chat and Images modes. Images use an authenticated Homestead gateway, never a direct phone connection to the model server. This initial image adapter requires an enabled Homestead AI plugin, existing AI/plugins entitlements and owner/admin access. The server owner alone can change its configuration. Existing chat/tool approvals are retained; image mode does not execute chat tool plans.

In Images → Image settings, the owner supplies:

1. The ComfyUI origin reachable **from the Homestead server/container**, for example `http://comfyui:8188`. Do not use the iPhone's localhost address. Only HTTP/HTTPS origins without credentials/path/query are accepted; redirects are disabled.
2. A trusted workflow exported by ComfyUI in **API format**, pasted as JSON. Browser graph JSON with a `nodes` array is rejected.
3. The ID of its positive prompt node containing a string `inputs.text`. Only that text input is changed per generation; model/checkpoint/sampler/other nodes remain as exported. Review a workflow before enabling it: ComfyUI custom nodes run on that server.

Save and test connection uses `/system_stats`. Generate explicitly posts the configured graph to `/prompt`; bounded, foreground-only phone polling checks `/history/{prompt_id}`. Only outputs for that user's persisted job are exposed through the authenticated image proxy, with relative filename/subfolder validation and bounded downloads. No general ComfyUI file browser, global interrupt, or queue-clear action is exposed.

You may save/test the address first with workflow/node fields empty. Generation remains disabled until a valid workflow is added. The user's supplied `http://10.0.0.224:8188/system_stats` returned HTTP 200 with the expected ComfyUI system response from the development PC on October 15. No generation/history/image request was made. This does not prove reachability from the Homestead container; use Save and test after the eventual server update.

Settings live in `data/mobile-ai/comfy-config.json`; job identities/status live in `data/mobile-ai/comfy-jobs.json`, written atomically with restrictive file permissions. These are server data, not source files or credentials copied to the ZIP. Interrupted submissions remain **uncertain** and are never silently posted again. Check the ComfyUI queue before explicitly clearing an uncertain job. Clearing a Homestead job does not cancel work or delete generated images in ComfyUI. Up to three unresolved jobs per account and 1,000 recorded jobs total are allowed; clear resolved jobs when no longer needed.

Unreadable job storage disables image job operations with a recoverable 503 response and a metadata-free log message; it does not stop the Homestead server starting or overwrite the damaged file. Restore that file from a known backup or repair it offline before restarting the server; do not discard unresolved job identities merely to retry a generation. Unchanged queued status polls do not rewrite the job store.

Generated images remain in ComfyUI; automatic filing into approved Homestead libraries is a separate wishlist item. This adapter does not configure Ollama/OpenAI credentials, add SillyTavern integration, add remote account/server discovery, or change billing/authentication contracts. Existing chat catalog warnings are shown and model/history/config load failures are reported independently. Live provider connectivity/generation remains pending because no server address/workflow was supplied.

ComfyUI contract reference: https://docs.comfy.org/development/comfyui-server/comms_routes

## Verification and integration

Run `npm run lint:ios-v37`, `npm run lint:ios-v36`, `npm run lint:mobile-v12`, `npm run test`, and `npm run build`. Tests use temporary generated fixtures and mock/loopback services; they do not call production ComfyUI or upload real pet media. Production build retains existing large web chunk warnings.

The complete iOS v3.7 ZIP includes a cumulative server patch from Public V1.2 and an incremental patch from the v3.6 server support. Choose exactly one on a separate branch from the currently deployed source. Run `git apply --check` first and resolve newer server changes semantically. Do not force-reset the server checkout. Deployment and live device verification are separate steps.
