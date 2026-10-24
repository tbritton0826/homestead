# Windows UI polish preview: revision 5

Published October 23, 2026 at [Download Homestead](https://gethomesteadapp.com/download). Application source commit: `4abf7ff` in [PR #22](https://github.com/tbritton0826/homestead/pull/22), stacked on the server-content pass. The installer includes the final membership/order reconciliation and draft-protection changes.

Validation: production build and default regression suite; seven new functional UI/persistence/diagnostic regressions; isolated desktop/tablet/narrow browser checks; fresh EXE install and update; retained account/configuration/media/port/identity; single-instance and occupied-port handling; Windows Defender found no threats in this package.

Public page, both artifact HEAD/range responses, linked scripts/styles, published checksums and a complete installer download were verified after deployment. The complete public EXE SHA-256 matched the locally installed/tested package. The previous release and website rollback copies remain.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Homestead-Free-0.6.8.64-windows.5-Windows-Setup.exe | 169657240 | `2e7a9cd8e805732df0c29a7cc567959f182e7180fc73dc8e4579685aa5b80289` |
| Homestead-Free-0.6.8.64-windows.5-Windows.zip | 167431832 | `c6dc0a44a920fac91b8525359c058c1e5ae2c49f2a778c948a9f1369ea393d1d` |

This updates the Windows preview download. It does not merge the source PR or update an existing Homestead Docker server. The installer is still unsigned. Physical mobile-device and production NAS/network checks remain separate.

Native companion v3.19 (20) contains the Family Home duplicate-navigation cleanup; its complete source ZIP was copied and hash-verified at the established AppleStorage testing destination. Node checks passed (55, plus one existing skip); Xcode and physical iPhone/iPad validation remain required.
