# Regression Testing

This file records production behaviors that must be preserved or fixed as the extractor layer evolves.

## Production baseline — 2026-08-08 / v0.5.0

| Scenario | Result | Current interpretation |
|---|---|---|
| Direct video download | PASS on multiple non-YouTube platforms | Must remain PASS |
| Telegram video preview | PASS | `/d`, `/m`, and `/p` must not regress |
| Keep-permanently action | PASS | Must remain PASS |
| LinkedIn single video | PASS for known working URLs | Keep yt-dlp path |
| LinkedIn single image | PASS | Conservative public HTML fallback returned one direct image |
| LinkedIn multi-image — 3 tested posts | FAIL cleanly | False LinkedIn UI/default assets are now rejected; public HTML exposed only one low-confidence candidate, so authenticated extraction is the next path |
| Instagram carousel | FAIL | gallery-dl was redirected to Instagram login; yt-dlp enumerated image entries but reported no video formats. Treat as authentication-required, not a generic video-format failure |
| Reddit share URL `/r/.../s/...` | FAIL | Both gallery-dl and yt-dlp received HTTP 403 from Reddit on the datacenter IP. Test authenticated REST cookies or gallery-dl OAuth next |
| YouTube | FAIL / anti-bot on datacenter IP | Tracked separately; do not regress other platforms |

## Important artifact note

ZIP files created before the v0.5.0 regression run must not be used to judge the current ZIP implementation. In the 2026-08-08 test, the newest listed ZIP artifacts were timestamped before the v0.5.0 LinkedIn multi-image tests. The current multi-image LinkedIn tests did not generate a ZIP; they failed after rejecting low-confidence assets.

## Header regression test

For a known video token:

```bash
TOKEN=<KNOWN_VIDEO_TOKEN>

curl -sSI "https://<DOWNLOAD_SUBDOMAIN>/d/${TOKEN}" \
  | grep -Ei 'HTTP/|content-type|content-disposition|accept-ranges'

curl -sSI "https://<DOWNLOAD_SUBDOMAIN>/m/${TOKEN}" \
  | grep -Ei 'HTTP/|content-type|content-disposition|accept-ranges'

curl -sSI "https://<DOWNLOAD_SUBDOMAIN>/p/${TOKEN}" \
  | grep -Ei 'HTTP/|content-type'
```

Expected:

```text
/d/ -> 200, media content type, attachment, byte ranges
/m/ -> 200, media content type, inline, byte ranges
/p/ -> 200, text/html
```

## Multi-item ZIP inspection

```bash
LATEST_ZIP="$(
  find runtime/downloads \
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

The archive must not contain extractor working directories such as `gallery/`.

## LinkedIn image tests

### Single image

Expected:

- `media_count = 1`
- `archive = false`
- image MIME type
- direct `/d/` link points to the image
- no default LinkedIn UI/logo/profile asset

### Multi-image

Public unauthenticated HTML is not considered sufficient if it exposes only the Open Graph image. The next regression stage should test a read-only Netscape-format LinkedIn session cookie without logging cookie contents.

Expected after authenticated extraction support:

- `media_count >= 2`
- `archive = true`
- ZIP contains only post images and optional caption text
- no duplicate resolution variants
- no profile/logo/default assets

Useful logs:

```text
linkedin_image_candidates
linkedin_image_rejected
media_collected
download_completed
```

## Instagram carousel tests

If gallery-dl reports a redirect to `/accounts/login/`, configure a valid Netscape-format Instagram cookie file and retest before treating the post as an extractor bug.

Expected after authentication:

- gallery-dl collects all carousel items
- multi-item posts produce a clean ZIP
- Telegram message includes post text when metadata is available

## Reddit tests

A 403 from both engines on `reddit.com/r/.../s/...` should be treated as access/authentication failure.

Preferred next tests:

1. authenticated Reddit Netscape cookies with gallery-dl REST mode;
2. gallery-dl OAuth using client ID, user agent, and refresh token.

Do not classify upstream authentication/access requirements as queue, ZIP, or Telegram bugs.

## Log collection

```bash
docker compose logs --since=10m --tail=250 bot
```

For failed media extraction, preserve:

- source host
- `error_type`
- engine attempts
- downloader stderr

Never paste bot tokens, refresh tokens, or cookie contents into test reports.
