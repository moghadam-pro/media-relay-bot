# Production Findings — 2026-08-08 to 2026-08-09

This document records real deployment observations without production secrets, Telegram IDs, cookie values, server IPs, or private domains.

## Confirmed working

### Direct video delivery and Telegram-native playback

The relay serves direct video artifacts with separate download and inline semantics:

- `/d/<token>` returns attachment download;
- `/m/<token>` returns inline media with byte-range support;
- Telegram can consume `/m/<token>` as a native playable video preview without a second `sendVideo` upload.

Tested successful direct-video sources included Instagram, TikTok, Reddit, and X/Twitter.

### Compact direct-video result

Direct video responses were simplified to remove duplicate filename/uploader/original-URL metadata from the success message. The current direct-video response contains post caption when available, a 24-hour link status, a size-labelled Download button, and Keep permanently.

### Instagram authenticated extraction

Observed:

- valid Netscape Instagram cookie visible inside container;
- `cookie_enabled=true` and `instagram_authenticated=true`;
- tested carousel posts downloaded through gallery-dl;
- tested two-item carousel produced a ZIP;
- `extractor.instagram.previews=false` prevented a single Reel from being counted as video + preview image;
- tested single videos returned as one direct artifact.

### Instagram mobile/Telegram compatibility preparation

A failing Reel was inspected with FFprobe. Source characteristics were:

```text
video: VP9 / yuv420p
audio: AAC / HE-AAC
container: MP4
```

The file played in VLC desktop but did not play correctly in Telegram/mobile clients.

A manual compatibility transcode to H.264 Main + AAC-LC MP4 with faststart worked across the tested clients. The same logic was then automated for single Instagram video artifacts.

Production logs confirmed automatic transformation from VP9/HE-AAC to H.264/AAC-LC and registration of the final transformed file size.

### Reddit authenticated cookies

A Reddit short/share URL that returned HTTP 403 anonymously succeeded after a Netscape-format Reddit cookie was mounted and routed to the job.

### X/Twitter authenticated extraction

A tested X post initially failed:

```text
gallery-dl: Requesting guest token -> Unavailable
yt-dlp: No video could be found in this tweet
```

The X cookie file existed in the container, but production code initially had no X branch in the cookie router. After adding `X_COOKIE_FILE` routing, the same tested request succeeded with `cookie_enabled=true`.

### X/Twitter false ZIP regression

Some authenticated single-video X posts became ZIP archives containing two media files because gallery-dl produced a valid video and yt-dlp still ran as a complement/fallback. The two tools produced different encodings, so exact hash deduplication could not identify them as the same logical media.

Fix:

```text
X gallery-dl result >= 1 media -> stop
X gallery-dl result == 0      -> yt-dlp fallback
```

Fresh tests then produced:

```text
media_count=1
archive=false
preview_kind=video
attempts=[gallery-dl]
```

### TikTok video regression

A tested TikTok video produced one MP4 and rendered in Telegram from `/m/<token>`.

### LinkedIn single-image fallback

A LinkedIn image post that yt-dlp could not treat as video succeeded through the conservative image fallback and returned one direct image.

## Paused / unresolved

### LinkedIn multi-image

Authenticated LinkedIn HTML contains many `/dms/image/`, `vectorImage`, `artifacts`, and `rootUrl` structures, but post media and page/UI entities are heavily normalized/referenced. The existing conservative fallback intentionally rejects low-confidence assets rather than returning profile/logo/default images.

This work is paused until a reliable association strategy or upstream extractor becomes available.

### YouTube

YouTube was tested separately so its anti-bot requirements would not regress confirmed platforms.

Tests included:

- recent yt-dlp nightly;
- Node.js JS runtime;
- `curl_cffi`;
- Netscape YouTube cookie copied to writable temp;
- `mweb` client;
- experimental BgUtils PO-token provider 1.3.1.

The provider loaded successfully, but the tested player API still returned `LOGIN_REQUIRED` / `Sign in to confirm you're not a bot` with and without cookies.

Current interpretation: the original datacenter egress IP is a significant part of the failure. YouTube work is paused until a different trusted egress can be tested. The stable installation does not require the experimental provider.

## Operational lessons

Always distinguish:

1. environment variable configured;
2. cookie file exists on host;
3. cookie file is visible in container;
4. cookie file is valid Netscape format;
5. platform router selects it;
6. extractor actually uses it;
7. upstream request succeeds.

The X investigation showed that steps 1-4 can all be correct while step 5 is still missing.

Also distinguish exact duplicate files from logical duplicates. Different encodings of the same video will not share a SHA-256 hash; extractor routing must sometimes prevent the duplicate at source.
