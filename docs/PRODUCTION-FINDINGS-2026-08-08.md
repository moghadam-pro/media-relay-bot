# Production Findings — 2026-08-08

This document records real deployment observations from the media relay without including production secrets, Telegram IDs, cookies, server IPs, or private domains.

## Confirmed working

### Direct video delivery and Telegram-native playback

The relay successfully serves direct video artifacts with separate behaviors for download and inline playback:

- `/d/<token>` returns the media as an attachment.
- `/m/<token>` returns the media inline with byte-range support.
- Telegram can consume the direct `/m/<token>` URL as a native playable video link without the bot uploading the file through `sendVideo`.
- tested Instagram, TikTok, and Reddit single-video posts all rendered as playable video inside Telegram using the direct `/m/<token>` URL.
- no `telegram_preview_failed` event was observed in the successful regression run.

This is now the preferred video-delivery path because it avoids a second bot upload and keeps the original server-side file as the single media source. The `/d/<token>` URL remains available as the explicit download endpoint.

### Instagram authenticated extraction

Instagram extraction is broadly successful after a valid Netscape-format Instagram cookie file became visible inside the container.

Observed results:

- the configured cookie file exists and contains the expected Instagram session cookie names;
- jobs log `cookie_enabled: true` and `instagram_authenticated: true`;
- `gallery-dl` successfully downloads tested carousel posts;
- a tested two-item carousel produced a ZIP archive;
- disabling `extractor.instagram.previews` prevents a single video or Reel from being incorrectly counted as video + preview image and ZIP-wrapped;
- tested single Instagram videos return as one direct MP4 artifact;
- tested Instagram video links render natively inside Telegram when the bot uses the direct `/m/<token>` URL as the link preview target.

Lesson: an environment variable pointing to a cookie file is not enough. Verify the file exists on the host, is mounted into the container, is valid Netscape format, and is actually selected by the platform router.

### Reddit with authenticated cookies

A Reddit short-link that previously returned `403 Blocked` from both `gallery-dl` and `yt-dlp` succeeded after a Netscape-format Reddit cookie file was mounted and routed to the job.

Observed result:

- `gallery-dl` succeeded;
- one MP4 artifact was collected;
- `yt-dlp` still received the original 403, but the successful gallery-dl result was sufficient;
- the direct `/m/<token>` URL also rendered as playable video inside Telegram.

Lesson: Reddit authentication can be platform-engine specific. A fallback engine does not need to succeed when the preferred engine already produced a valid artifact.

### TikTok video regression

A tested TikTok video produced one MP4 artifact and rendered inside Telegram from the direct `/m/<token>` URL.

### LinkedIn single-image fallback

A LinkedIn image post that `yt-dlp` could not treat as video succeeded through the conservative LinkedIn image fallback:

- one high-confidence image candidate was accepted;
- the artifact was returned directly instead of being ZIP-wrapped;
- the old false-positive ZIP behavior was eliminated.

## Still unresolved

### LinkedIn multi-image posts

Authenticated LinkedIn cookies are successfully mounted and injected. The current conservative public-HTML image parser still finds only one low-confidence candidate for tested multi-image posts, and correctly rejects it instead of returning UI/default assets.

A deeper diagnostic against the authenticated post page established that useful media structures are present somewhere in the HTML payload:

- authenticated page request: HTTP 200;
- page size: roughly 1.5 MB in the tested case;
- multiple `/dms/image/` references are present;
- many `vectorImage` markers are present;
- `artifacts` and `rootUrl` structures are present.

However, recursively scanning only the embedded JSON object that directly contains the target activity ID returned zero vector images. A second activity-related wrapper block also returned zero vectors. This indicates that LinkedIn's normalized page data stores the target activity and its media entities in separate referenced blocks or nested serialized response bodies.

A direct request to the tested `/voyager/api/feed/updates/<URN>` endpoint returned HTTP 200 but its normalized response did not contain `VectorImage`/`artifacts` media data for that activity.

Next direction: resolve references across embedded normalized-data blocks (including nested serialized `body` payloads), then extract only media entities associated with the target activity. Do not fall back to globally accepting every LinkedIn image URL on the page.

Safety requirement: do not loosen the existing image-quality/UI filters globally. The previous false-positive behavior demonstrated that generic LinkedIn page assets can easily be mistaken for post media.

### YouTube

YouTube remains a separate reliability problem on the datacenter egress IP due to anti-bot/authentication behavior. It is intentionally tracked independently so fixes do not regress other platforms.

Current upstream direction from yt-dlp should be evaluated before further implementation: use a PO Token Provider with the `mweb` client rather than relying on manually extracted PO tokens.

## Operational lesson

Always distinguish these states:

1. environment variable configured;
2. cookie file exists on the host;
3. cookie file is visible inside the container;
4. cookie file is valid Netscape format;
5. extractor actually uses the cookie;
6. authenticated request succeeds.

Treating all six as one boolean makes platform debugging unnecessarily difficult.
