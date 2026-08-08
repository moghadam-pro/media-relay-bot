# Platform Notes

Platform extraction is the least stable layer. These notes separate confirmed relay behavior from upstream/platform behavior.

## Instagram

### Confirmed

- Authenticated single-video/Reel extraction works on tested URLs.
- Authenticated carousel extraction works on tested URLs.
- Multi-item carousels become clean ZIP archives.
- `extractor.instagram.previews=false` prevents a single Reel from becoming a false video+cover ZIP.
- Direct `/m/<token>` playback works in Telegram after compatibility preparation when needed.

### Routing

1. `gallery-dl` first.
2. yt-dlp may complement/fallback when gallery output is empty or incomplete.
3. Post/Reel URLs allow bounded playlist extraction.
4. Single videos are FFprobed before registration.
5. VP9/HE-AAC or otherwise incompatible streams are prepared as H.264/yuv420p + AAC-LC MP4 when necessary.

### Authentication

Optional Netscape file:

```env
INSTAGRAM_COOKIE_FILE=/data/cookies/instagram.txt
```

## X / Twitter

### Confirmed

A guest extraction returned:

```text
Requesting guest token
'Unavailable'
```

Routing a valid Netscape X session cookie fixed the tested request.

### Routing

X is gallery-first. After the production duplicate-ZIP issue, its fallback rule is intentionally stricter:

```text
gallery-dl media_count >= 1 -> do not run yt-dlp
media_count == 0            -> yt-dlp fallback
```

This prevents two encodings of one single video from being treated as two separate media items.

Optional cookie:

```env
X_COOKIE_FILE=/data/cookies/x.txt
```

## Reddit

### Confirmed

A tested Reddit short/share URL that returned HTTP 403 anonymously succeeded after a valid Netscape Reddit cookie was routed to the job.

### Authentication options

Cookie:

```env
REDDIT_COOKIE_FILE=/data/cookies/reddit.txt
```

Optional gallery-dl OAuth:

```env
REDDIT_CLIENT_ID=
REDDIT_USER_AGENT=
REDDIT_REFRESH_TOKEN=
```

Do not configure OAuth unless needed.

## TikTok

A tested video produced one MP4 artifact and rendered as a native Telegram preview through `/m/<token>`.

TikTok upstream challenges can still change without an application-code regression.

## LinkedIn

### Single image

Confirmed through the conservative LinkedIn image fallback. A valid single post image is returned directly instead of being ZIP-wrapped.

### Cookies

Optional:

```env
LINKEDIN_COOKIE_FILE=/data/cookies/linkedin.txt
```

The cookie can be used by yt-dlp and by the fallback HTTP request.

### Multi-image

Paused/best effort. Authenticated HTML contains normalized/referenced media structures, but broad extraction is intentionally avoided because LinkedIn pages also contain many UI/profile/default assets.

The correct behavior is to fail cleanly rather than return unrelated images.

## YouTube

### Status

Paused/unresolved on the original datacenter egress.

### Tested

- recent yt-dlp nightly;
- Node.js JavaScript runtime;
- `curl_cffi`;
- writable per-job copy of a Netscape YouTube cookie;
- `mweb` client;
- experimental BgUtils HTTP PO-token provider 1.3.1.

The provider loaded successfully, but the tested player API still returned:

```text
LOGIN_REQUIRED
Sign in to confirm you're not a bot
```

with and without cookies.

The stable installation therefore does not depend on a YouTube-specific PO-token sidecar. See `YOUTUBE-NOTES.md`.

## Telegram delivery

Confirmed route semantics:

```text
/d/<token> -> attachment
/m/<token> -> inline media + Range requests
/p/<token> -> Open Graph HTML
```

For direct video, `/m/<token>` is the preferred Telegram preview URL.
