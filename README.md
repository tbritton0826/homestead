# Homestead Free Preview

Homestead is a self-hosted digital home for local media and personal archives.
This public preview is intended for fresh installations on a trusted network.

Free includes Movies, TV, Music, Books, locally archived YouTube, local search,
playback, watchlists, collections, watch orders, and progress. It supports one
owner and one active stream. Paid-plan areas remain locked and do not require a
placeholder account or trial.

See `INSTALL.md` for Windows, Docker, Linux, and Unraid instructions.

Opt-in commercial customer accounts and Stripe test billing are documented in
[Customer billing V1](docs/CUSTOMER_BILLING_V1.md). This uses separate PostgreSQL
storage and does not change local library accounts or enable live payments.

The standard Docker install pulls `ghcr.io/tbritton0826/homestead:latest`.
Release automation and a separate, submission-ready Unraid Community Apps
metadata repository are included for maintainers.

This is development software. Back up persistent data before updating. Homestead
does not provide media or grant rights to obtain, copy, or distribute content.

Commercial V1.1 test billing, approved prices and lifetime setup: [Customer billing V1.1](docs/CUSTOMER_BILLING_V1_1.md).

Artwork snapshot retention, protection, and offline recovery: [Artwork recovery](docs/artwork-recovery.md).
