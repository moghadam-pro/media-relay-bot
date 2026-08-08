# Production Findings — 2026-08-08

This document records real deployment observations from the media relay without including production secrets, Telegram IDs, cookies, server IPs, or private domains.

## Confirmed working

### Direct video delivery

The relay successfully serves direct video artifacts with separate behaviors for download and inline preview:

- `/d/<token>` returns the media as an attachment.
- `/m/<token>` returns the media inline with byte-range support.
- `/p/<token>` returns an Open Graph preview document.
- Telegram video preview works for known-good video sources.

### Reddit with authenticated cookies

A Reddit short-link that previously returned `403 Blocked` from both `gallery-dl` and `yt-dlp` succeeded after a Netscape-format Reddit cookie file was mounted and routed to the job.

Observed result:

- `gallery-dl` succeeded.
- one MP4 artifact was collected.
- `yt-dlp` still received the original 403, but the successful gallery-dl result was sufficient.

Lesson: Reddit authentication can be platform-engine specific. A fallback engine does not need to succeed when the preferred engine already produced a valid artifact.

### LinkedIn single-image fallback

A LinkedIn image post that `yt-dlp` could not treat as video succeeded through the conservative LinkedIn image fallback:

- one high-confidence image candidate was accepted;
- the artifact was returned directly instead of being ZIP-wrapped;
- the old false-positive ZIP behavior was eliminated.

## Still unresolved

### LinkedIn multi-image posts

Authenticated LinkedIn cookies are successfully mounted and injected, but tested multi-image posts still expose only one low-confidence candidate through the current HTML parser. That candidate is correctly rejected as a likely UI/small asset.

This is an improvement over the previous behavior: the relay now fails safely instead of returning ZIP archives containing LinkedIn default/UI assets.

Next direction: authenticated LinkedIn Voyager JSON as a best-effort fallback, extracting `VectorImage` / `artifacts` structures and selecting the largest artifact for each real post image.

### Instagram carousel posts

The tested Instagram carousel still redirected `gallery-dl` to the Instagram login page. The runtime diagnostic showed that the Instagram cookie path was configured but the cookie file was not visible inside the container.

This means the test did not yet validate authenticated Instagram extraction. Fix the cookie file/mount first, then retest the same carousel before changing extractor logic.

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
