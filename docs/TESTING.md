# Regression Testing

This file records the production behaviors that should be preserved or fixed as the extractor layer evolves.

## Baseline from August 2026 testing

| Scenario | Baseline | Expected after fix |
|---|---|---|
| Direct video download | PASS on multiple non-YouTube platforms | Must remain PASS |
| Telegram video preview | PASS | Must remain PASS |
| `/d/<token>` attachment headers | PASS | Must remain PASS |
| `/m/<token>` inline headers | PASS | Must remain PASS |
| `/p/<token>` preview HTML | PASS | Must remain PASS |
| Keep-permanently action | PASS | Must remain PASS |
| LinkedIn single video | PASS for known working URLs | Must remain PASS |
| LinkedIn single image | WRONG: false ZIP + low-quality/default assets | Direct high-confidence image; no ZIP |
| LinkedIn multi-image | WRONG: LinkedIn default/UI images + empty gallery folder | ZIP only real post images + optional caption.txt |
| Instagram carousel | FAIL for tested multi-image URL | Collect all post media and ZIP |
| Reddit tested URL | FAIL | Classify auth/extractor failure; use gallery-dl refresh token when needed |
| YouTube | FAIL / anti-bot on datacenter IP | Tracked separately; do not regress other platforms |

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

The archive must not contain extractor working directories such as an empty `gallery/` folder.

## LinkedIn image tests

### Single image

Expected:

- `media_count = 1`
- `archive = false`
- artifact MIME is an image
- direct `/d/` link points to the image
- no default LinkedIn UI/logo/profile asset

### Multi image

Expected:

- `media_count >= 2`
- `archive = true`
- one ZIP containing only post images and optional caption text
- no duplicate resolution variants of the same LinkedIn image asset

Useful logs:

```text
linkedin_image_candidates
linkedin_image_rejected
media_collected
download_completed
```

## Instagram carousel tests

Use a post with at least three visually distinct items so incomplete extraction is obvious.

Expected logs should show both the preferred engine and the final media count. If the gallery engine returns zero or one item, yt-dlp is also attempted with bounded post-playlist extraction.

If both engines fail, test again with a valid Instagram Netscape cookie file before treating the failure as an application bug.

## Reddit tests

Always inspect `attempts` in `download_failed`.

If the message indicates account authentication is required, configure `REDDIT_REFRESH_TOKEN` and retest. Do not classify an upstream authentication requirement as a ZIP/queue/Telegram bug.

## Log collection

```bash
docker compose logs --since=10m --tail=250 bot
```

For failed media extraction, preserve:

- source host
- `error_type`
- engine attempts
- downloader stderr

Never paste bot tokens or cookie contents into test reports.
