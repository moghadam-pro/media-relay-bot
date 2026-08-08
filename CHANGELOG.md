# Changelog

## 0.6.0 — 2026-08-09

### Added

- Interactive `install.sh` for zero-to-running deployments and later reconfiguration.
- Skip control for every installer stage.
- Cookie-only rerun workflow; each platform cookie is independently optional.
- X/Twitter Netscape cookie routing.
- LinkedIn Netscape cookie routing.
- Reddit Netscape cookie routing plus optional gallery-dl OAuth values.
- Instagram stream probing and compatibility preparation for mobile/Telegram playback.
- Direct `/m/<token>` Telegram video preview path.
- Compact direct-video Telegram result UI with download-size button.
- Detailed installation, cookie, and YouTube diagnostic documentation.

### Changed

- Instagram gallery-dl previews are disabled so a Reel is not incorrectly counted as video + preview image.
- Instagram VP9/HE-AAC single videos are converted only when required to H.264/yuv420p + AAC-LC MP4 with faststart.
- X/Twitter stops after a successful gallery-dl result instead of running yt-dlp on a valid single-media result, preventing duplicate encodings from becoming a two-item ZIP.
- Runtime Compose file supports either local `./runtime` storage or an installer-defined external data root.
- Direct video results use `/m/<token>` for native inline playback and `/d/<token>` for explicit download.
- **Keep permanently** preserves the direct download button and updates the compact status text.

### Confirmed production regressions fixed

- Instagram single-video Telegram/mobile playback.
- Instagram Reel false ZIP caused by preview image collection.
- X/Twitter guest-token failure when authenticated cookies are available.
- X/Twitter false two-item ZIP caused by gallery-dl + yt-dlp duplicate representations.
- Reddit tested 403 path using authenticated cookies.

### Paused / unresolved

- LinkedIn multi-image extraction remains conservative/best effort.
- YouTube remains paused because the original datacenter egress IP receives player-level anti-bot `LOGIN_REQUIRED` responses even after cookie and PO-token-provider experiments.

## 0.5.0 — 2026-08-08

- Initial production baseline for the standalone media relay repository.
- Queue, platform routing, direct/ZIP artifact handling, random expiring tokens, Nginx routes, and permanent-retention callback.
