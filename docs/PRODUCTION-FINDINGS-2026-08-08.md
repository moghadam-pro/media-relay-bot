# Production Findings — 2026-08-08

This document records real deployment observations from the media relay without including production secrets, Telegram IDs, cookies, server IPs, or private domains.

## Confirmed working

### Direct video delivery

The relay successfully serves direct video artifacts with separate behaviors for download and inline preview:

- `/d/<token>` returns the media as an attachment.
- `/m/<token>` returns the media inline with byte-range support.
- `/p/<token>` returns an Open Graph preview document.
- Telegram video preview works for known-good video sources.

### Instagram carousel with authenticated cookies

A previously failing Instagram carousel succeeded after a valid Netscape-format Instagram cookie file became visible inside the container.

Observed result:

- the configured cookie file existed and contained the expected Instagram session cookie names;
- the job logged `cookie_enabled: true` and `instagram_authenticated: true`;
- `gallery-dl` completed successfully without a fallback attempt;
- two media items were collected;
- the relay produced a ZIP archive.

Lesson: an environment variable pointing to a cookie file is not enough. Verify the file exists on the host, is mounted into the container, is valid Netscape format, and is actually selected by the platform router.

### Reddit with authenticated cookies

A Reddit short-link that previously returned `403 Blocked` from both `gallery-dl` and `yt-dlp` succeeded after a Netscape-format Reddit cookie file was mounted and routed to the job.

Observed result:

- `gallery-dl` succeeded;
- one MP4 artifact was collected;
- `yt-dlp` still received the original 403, but the successful gallery-dl result was sufficient.

Lesson: Reddit authentication can be platform-engine specific. A fallback engine does not need to succeed when the preferred engine already produced a valid artifact.

### LinkedIn single-image fallback

A LinkedIn image post that `yt-dlp` could not treat as video succeeded through the conservative LinkedIn image fallback:

- one high-confidence image candidate was accepted;
- the artifact was returned directly instead of being ZIP-wrapped;
- the old false-positive ZIP behavior was eliminated.

## Still unresolved

### LinkedIn multi-image posts

Authenticated LinkedIn cookies are successfully mounted and injected. The current conservative public-HTML image parser still finds only one low-confidence candidate for tested multi-image posts, and correctly rejects it instead of returning UI/default assets.

A deeper diagnostic against the authenticated post page established that the useful media structure is present in the HTML payload itself:

- authenticated page request: HTTP 200;
- page size: roughly 1.5 MB in the tested case;
- multiple `/dms/image/` references are present;
- many `vectorImage` markers are present;
- `artifacts` and `rootUrl` structures are present.

A direct request to the tested `/voyager/api/feed/updates/<URN>` endpoint also returned HTTP 200, but its normalized response did not contain `VectorImage`/`artifacts` media data for that activity. Therefore the next implementation should parse the authenticated HTML's embedded JSON/data blocks and scope media extraction to the target activity rather than relying on that Voyager endpoint.

Safety requirement: do not loosen the existing image-quality/UI filters globally. The previous false-positive behavior demonstrated that generic LinkedIn page assets can easily be mistaken for post media.

### YouTube

YouTube remains a separate reliability problem on the datacenter egress IP due to anti-bot/authentication behavior. It is intentionally tracked independently so fixes do not regress other platforms.

## Operational lesson

Always distinguish these states:

1. environment variable configured;
2. cookie file exists on the host;
3. cookie file is visible inside the container;
4. cookie file is valid Netscape format;
5. extractor actually uses the cookie;
6. authenticated request succeeds.

Treating all six as one boolean makes platform debugging unnecessarily difficult.
