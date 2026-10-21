# Standalone Windows release

Build on Windows x64 with Node 24, npm, and Git. End users do not need these tools.

Install the official signed Inno Setup 6.7.3 compiler in portable mode under
`work/windows-runtime-cache/inno` (the compiler executable must be `ISCC.exe`).
Download it from https://jrsoftware.org/isdl.php and verify its Authenticode signature.
The compiler's `/PORTABLE=1 /DIR="<absolute workspace>/work/windows-runtime-cache/inno"`
options keep build tools inside the workspace.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/build-free-preview.ps1`.
The builder downloads Node 24.22.1 from nodejs.org and verifies the official SHA-256,
installs locked production dependencies, and bundles Windows FFmpeg/FFprobe binaries.
Its source inventory is restricted to tracked public repository files; data, media,
.env files, local dependencies, and credentials are excluded.

Output is under `release/<app version>-windows.1`. Completed release directories are
never overwritten; choose a new `-Revision windows.2` for another published release.
Publish the EXE, Windows ZIP, SHA256SUMS.txt, RELEASE_NOTES.txt, and release.json.
**Never publish build-local.json**: it contains developer filesystem paths.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-release.ps1
-SetupExe "<absolute release EXE>"` on Windows before publishing. It uses isolated
workspace folders, a temporary port, no registry/shortcuts, and no external runtime
in PATH. It checks fresh installation, owner setup, generated video scanning and
range playback, bundled ffprobe, paid-feature locks, update byte preservation,
saved port/identity, duplicate launch prevention, and unrelated port safety.

The runtime lives in `versions/<release>-<random suffix>`. The small `runtime.json`
pointer selects it. `data`, `media`, and `logs` remain outside those version folders.
A failed update restores the previous pointer and attempts to restart it. Versions
are retained for recovery. Setup errors are shown and written to the Windows temp
install log. The standalone app runs in the background and opens in a browser.

This preview is unsigned. The website must disclose that accurately. Signing a
future release requires a publisher certificate, which is not included in source.
