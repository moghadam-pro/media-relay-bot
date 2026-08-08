# Regression Testing

This file records behaviors that should be preserved as extractor versions evolve.

## Production baseline — 2026-08-09 / v0.6.0

| Scenario | Result | Required behavior |
|---|---|---|
| Direct video download | PASS on tested Instagram, X, Reddit, TikTok | Keep `/d` attachment path |
| Telegram native video preview | PASS | Direct video should use `/m` with Range support |
| Compact direct-video UI | PASS | Caption + TTL + Download-size button + Keep permanently |
| Keep permanently | PASS | Preserve download button where present; replace TTL status |
| Instagram carousel | PASS on authenticated tests | Multi media -> clean ZIP |
| Instagram single Reel | PASS | No false cover+video ZIP |
| Instagram VP9/HE-AAC source | PASS after prepare | Final H.264/yuv420p + AAC-LC MP4 should play on Telegram/mobile |
| X guest extraction | FAIL on tested post | Authentication issue, not ZIP/queue bug |
| X authenticated extraction | PASS | `cookie_enabled=true` and gallery-dl success |
| X single video fallback | PASS | Do not run yt-dlp after successful gallery-dl single item |
| Reddit authenticated tested post | PASS | Cookie route may be sufficient even if another engine fails |
| LinkedIn single image | PASS | Conservative image fallback; direct image |
| LinkedIn multi-image | PAUSED / clean fail | Never loosen filters to return UI/default images |
| YouTube datacenter egress | PAUSED / FAIL | Player-level anti-bot tracked separately |

## Syntax checks

```bash
cd app
npm run check
```

## Compose validation

```bash
docker compose config --quiet
```

## Header regression test

For a known video token:

```bash
TOKEN=<KNOWN_VIDEO_TOKEN>
BASE=https://<DOWNLOAD_SUBDOMAIN>

curl -sSI "${BASE}/d/${TOKEN}" \
  | grep -Ei 'HTTP/|content-type|content-disposition|accept-ranges'

curl -sSI "${BASE}/m/${TOKEN}" \
  | grep -Ei 'HTTP/|content-type|content-disposition|accept-ranges'

curl -sSI "${BASE}/p/${TOKEN}" \
  | grep -Ei 'HTTP/|content-type'
```

Expected:

```text
/d/ -> 200, media content type, attachment, byte ranges
/m/ -> 200, media content type, inline, byte ranges
/p/ -> 200, text/html
```

## Instagram compatibility test

Look for:

```text
instagram_video_prepare_started
instagram_video_prepared
media_collected
download_registered
download_completed
```

For an incompatible tested source, expected final probe characteristics include:

```text
video codec: h264
pixel format: yuv420p
audio codec: aac
audio profile: LC
```

The registered file size must be the final prepared artifact size, not the pre-transcode source size.

## X/Twitter single-video regression

For an authenticated single-video X post, expected log shape:

```text
cookie_enabled=true
media_count=1
archive=false
preview_kind=video
attempts=[gallery-dl only]
```

If yt-dlp appears after gallery-dl already produced one valid X media item, the duplicate-prevention routing has regressed.

## Multi-item ZIP inspection

Production installer path:

```bash
LATEST_ZIP="$(
  find /var/lib/mpro-media-relay/downloads \
    -type f \
    -name '*.zip' \
    -printf '%T@ %p\n' \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
)"

unzip -l "$LATEST_ZIP"
```

Expected archive shape:

```text
01-<media-name>.jpg
02-<media-name>.jpg
03-<media-name>.mp4
caption.txt              # only when text metadata exists
```

No extractor working directories should be included.

## Cookie routing diagnostics

Do not print cookie values. Safe checks include:

```text
file exists
file mode/size
Netscape header present
cookie_enabled boolean in structured job logs
platform authenticated boolean where available
```

## Log collection

```bash
cd /opt/mpro-media-relay
docker compose logs --since=10m --tail=250 bot
```

Preserve:

- source host;
- `error_type`;
- engine attempts;
- downloader stderr;
- preparation events.

Never include bot tokens, OAuth refresh tokens, or cookie contents in reports.
