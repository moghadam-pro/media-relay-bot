# Platform Notes

Platform extraction is the least stable layer of the project. These notes separate application bugs from upstream/platform behavior observed during testing.

## Instagram

### Observed

- Single-video posts have worked in the deployment.
- At least one multi-image post failed during carousel testing.

### Current routing

1. `gallery-dl` first.
2. `yt-dlp` second when gallery output contains zero or one item.
3. Post-style URLs allow bounded playlist extraction (`--playlist-end 20`).

### Authentication

Instagram extraction can behave differently without a logged-in cookie jar. The project supports an optional Netscape-format `INSTAGRAM_COOKIE_FILE` mounted read-only and copied per job.

### What to inspect when a carousel fails

Look at the structured `attempts` field in `download_failed` logs. It records both gallery-dl and yt-dlp stderr without exposing cookie contents.

## LinkedIn

### Video

LinkedIn video posts have worked for some tested URLs through yt-dlp. Some other post IDs return `Unable to extract video`.

### Images

`gallery-dl` does not currently provide stable released LinkedIn post support. The project therefore uses a conservative public-HTML fallback only after yt-dlp produces no media.

The first fallback implementation was too broad and downloaded LinkedIn UI/default images. The current implementation groups `/dms/image/` CDN variants by asset ID, scores higher-resolution feedshare variants, and rejects small/default/profile/logo assets.

### Single image

A filtered single image is returned directly. It is not zipped.

### Multi image

Two or more high-confidence images are packaged into one ZIP together with `caption.txt` when text is available.

### Limitation

LinkedIn HTML is not a stable API. Multi-image support remains best-effort until a more reliable authenticated or upstream extractor is available.

## Reddit

### Observed

A tested Reddit URL failed even though Reddit is supported by both downloader ecosystems.

### Upstream change

In 2026, yt-dlp reports cases where Reddit requires account authentication for JSON metadata. The project therefore treats Reddit authentication failures as a platform/authentication problem rather than a generic media error.

### Current routing

1. `gallery-dl` with Reddit previews enabled.
2. Optional `REDDIT_REFRESH_TOKEN` passed to gallery-dl.
3. yt-dlp fallback.

If public anonymous extraction fails, configure a Reddit refresh token rather than weakening the relay's network/security boundaries.

## YouTube

### Observed

YouTube is the main remaining reliability issue in the original deployment. Public videos can trigger `Sign in to confirm you're not a bot` from the server IP.

### Current support

- Nightly/pre-release yt-dlp.
- Node JavaScript runtime.
- `curl_cffi` dependency.
- Optional Netscape cookie file.
- Per-job writable cookie copies.

### Remaining work

PO-token-provider support is intentionally kept separate from the core relay because YouTube requirements evolve quickly.

## X / Twitter

Gallery-first routing is used so posts containing several media items are collected as a set instead of accepting the first successful video result.

## TikTok

Video downloads worked in testing, but both yt-dlp and gallery-dl can be affected by TikTok challenge changes. Treat failures as platform-specific and inspect engine attempts before changing application code.

## Telegram previews

The three-route preview architecture was validated with a previously working video:

- `/d/<token>` -> `Content-Disposition: attachment`
- `/m/<token>` -> `Content-Disposition: inline`
- `/p/<token>` -> HTML/Open Graph preview

This part of the system is considered working and should not be changed while debugging platform extractors.
