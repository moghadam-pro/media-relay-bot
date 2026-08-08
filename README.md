# Media Relay Bot

A private-first Telegram media relay that turns supported social-media post URLs into temporary direct-download links.

The project is designed for a small trusted Telegram group and an explicit allowlist of private Telegram users. It downloads the best media it can obtain, preserves post text/metadata when available, bundles multi-item posts into ZIP files, and automatically expires files after a configurable TTL unless a trusted user marks them as permanent.

> Use this project only for media you are allowed to download and store. Platform terms, authentication requirements, and extractor behavior can change at any time.

## What it does

- Accepts URLs only from an explicit hostname allowlist.
- Processes one configured Telegram group plus explicit private Telegram user IDs.
- Runs a small in-memory queue with configurable download concurrency.
- Uses `gallery-dl` for gallery-first platforms and `yt-dlp` for video-first platforms.
- Uses FFmpeg for media probing/merging through the downloader stack.
- Downloads images as well as video.
- Returns a single media file directly when a post has one downloadable item.
- Creates a ZIP when a post contains multiple media items.
- Adds `caption.txt` to multi-item ZIP archives when a caption/description is available.
- Sends extracted post text in Telegram when metadata is available.
- Creates random, unguessable download tokens.
- Expires downloads after 24 hours by default.
- Allows trusted users to press **Keep permanently** to disable automatic expiry.
- Exposes separate download, inline-media, and Telegram-preview endpoints.
- Supports HTTP Range requests for video seeking and Telegram previews.

## Architecture

```text
Telegram group / trusted private user
                |
                v
        URL host allowlist
                |
                v
             Queue
        (default: 2 jobs)
                |
                v
       Platform routing
        /             \
 gallery-first      video-first
  gallery-dl          yt-dlp
        \             /
         \   fallback/
          v         v
       collected media
              |
      +-------+--------+
      |                |
  1 media item      2+ media items
      |                |
 direct artifact    ZIP + caption.txt
      \                /
       \              /
        v            v
      expiring download store
               |
        random 256-bit token
               |
     +---------+---------+
     |         |         |
 /d/<token> /m/<token> /p/<token>
 download    inline    OG preview
```

## Current platform status

Platform behavior depends on the exact URL, authentication state, source IP, and upstream extractor versions.

| Platform | Video | Single image | Multi-image / carousel | Notes |
|---|---:|---:|---:|---|
| Instagram | Yes | Yes | In progress | Some carousel URLs require authenticated cookies. |
| LinkedIn | Yes | Best effort | In progress | Public-image fallback is intentionally conservative to avoid downloading LinkedIn UI/default images. |
| TikTok | Yes | Depends on extractor | Depends on extractor | Platform changes frequently. |
| X / Twitter | Yes | Yes | Yes / best effort | `gallery-dl` is preferred for media collections. |
| Reddit | Mixed | Mixed | Mixed | Recent Reddit changes can require authentication / refresh tokens for some posts. |
| YouTube | Mixed | N/A | N/A | Datacenter IPs increasingly hit anti-bot / PO-token requirements. |
| Vimeo / others | Extractor dependent | Extractor dependent | Extractor dependent | See upstream project status. |

## External projects used

This repository contains the relay application and deployment glue. It does **not** vendor the source code of the download engines.

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — video/audio extraction and media metadata.
- [gallery-dl](https://gdl-org.github.io/) — image galleries, collections, and social-media media extraction.
- [FFmpeg](https://ffmpeg.org/) — media probing, merging, and format handling.
- [Node.js](https://nodejs.org/) — Telegram bot and download HTTP service.
- [Docker](https://www.docker.com/) — isolated runtime.
- [Nginx](https://nginx.org/) — public TLS reverse proxy.
- [Let's Encrypt / Certbot](https://certbot.eff.org/) — TLS certificates.

All upstream projects retain their own licenses and terms.

## Repository layout

```text
.
├── app/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.mjs
│       ├── media-downloader.mjs
│       ├── download-store.mjs
│       └── linkedin-fallback.mjs
├── docs/
│   ├── ARCHITECTURE.md
│   ├── LEARNINGS.md
│   └── PLATFORM-NOTES.md
├── nginx/
│   └── media-relay.conf.example
├── .env.example
├── .gitignore
├── docker-compose.yml
└── LICENSE
```

## Quick start

### 1. Clone

```bash
git clone https://github.com/moghadam-pro/media-relay-bot.git
cd media-relay-bot
```

### 2. Create runtime directories

```bash
mkdir -p runtime/{downloads,tmp,data,cookies}
chmod 700 runtime/cookies
```

### 3. Configure environment

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env` and replace placeholders such as:

```env
BOT_TOKEN=<TELEGRAM_BOT_TOKEN>
ALLOWED_CHAT_ID=<TELEGRAM_GROUP_ID>
ALLOWED_PRIVATE_USER_IDS=<TELEGRAM_USER_ID_1>,<TELEGRAM_USER_ID_2>
PUBLIC_BASE_URL=https://<DOWNLOAD_SUBDOMAIN>
```

Never commit the real `.env` or cookie files.

### 4. Build and run

```bash
docker compose config --quiet
docker compose build
docker compose up -d
```

Check:

```bash
docker compose ps
docker compose logs --tail=100 bot
curl http://127.0.0.1:8080/health
```

### 5. Nginx

Copy `nginx/media-relay.conf.example`, replace `<DOWNLOAD_SUBDOMAIN>`, and reverse proxy only the required routes to `127.0.0.1:8080`.

Public endpoints:

```text
https://<DOWNLOAD_SUBDOMAIN>/d/<token>  # attachment download
https://<DOWNLOAD_SUBDOMAIN>/m/<token>  # inline media stream
https://<DOWNLOAD_SUBDOMAIN>/p/<token>  # Telegram/Open Graph preview page
```

## Cookies and authentication

Cookies are optional and platform-specific. The container mounts `runtime/cookies` read-only. The application copies a required cookie file into a per-job writable temporary directory before invoking a downloader. This prevents two concurrent downloads from modifying the same source cookie file.

Expected optional files:

```text
runtime/cookies/youtube.txt
runtime/cookies/instagram.txt
```

Use Netscape-format cookie files. Treat them as credentials.

Reddit can additionally use an optional refresh token through `REDDIT_REFRESH_TOKEN` for deployments that need authenticated Reddit API access.

## Telegram access model

The bot accepts messages only when one of these conditions is true:

1. The message comes from `ALLOWED_CHAT_ID`.
2. The message is a private chat and the sender is listed in `ALLOWED_PRIVATE_USER_IDS`.

Even authorized users can submit only URLs whose hostname matches `ALLOWED_MEDIA_HOSTS`.

This is intentionally not a public downloader API.

## Multi-item behavior

A post that resolves to one media item is returned directly.

A post that resolves to two or more media items is normalized into a clean ZIP archive:

```text
01-image.jpg
02-image.jpg
03-video.mp4
caption.txt
```

Temporary extractor directories and metadata files are not included in the archive.

## Expiry and permanent files

Each artifact is registered with a random token and an expiry timestamp.

Default:

```env
DOWNLOAD_TTL_HOURS=24
```

A trusted Telegram user can use the inline **Keep permanently** action. The record is then marked persistent and is skipped by automatic cleanup.

## Security notes

- Never commit bot tokens, cookies, private Telegram IDs, server IPs, or production domain names.
- Keep the application HTTP port bound to localhost.
- Put TLS and public access behind Nginx.
- Use a strict hostname allowlist.
- Do not pass URLs through a shell; downloader processes are spawned with argument arrays.
- Keep the container non-root, read-only where practical, and drop Linux capabilities.
- Use random download tokens rather than predictable file paths.
- Do not whitelist generic URL shorteners unless their redirects are validated before download.

## Known lessons from building this

A few implementation details mattered more than expected:

1. **A successful extractor process is not enough.** Always verify which files were actually created.
2. **Gallery posts need different routing from videos.** A video-first tool may return only one item from a mixed/carousel post.
3. **HTML scraping must be conservative.** Broad regex matching on LinkedIn CDN URLs also captures UI images, logos, and multiple lower-resolution variants.
4. **Single media must stay single.** ZIP packaging should happen only after filtering and deduplicating real post media.
5. **Read-only cookie mounts require per-job copies.** Some downloaders update cookie jars even during otherwise read-only operations.
6. **Telegram preview and download semantics conflict.** Separate `/d/` and `/m/` routes let one force attachment download while the other streams inline.
7. **Platform failures are often environmental.** Cookies, datacenter IP reputation, JavaScript challenges, PO tokens, and upstream site changes can all matter.
8. **Short-lived download storage simplifies quality decisions.** When files expire automatically, keeping best-available source quality is usually reasonable.

More details are in `docs/LEARNINGS.md` and `docs/PLATFORM-NOTES.md`.

## Development

Syntax check:

```bash
cd app
npm run check
```

No GitHub Actions workflow is included by default. Validation is intentionally local so cloning or pushing this project does not create unexpected workflow runs or notification noise.

## License

The relay application code in this repository is released under the MIT License. External tools and services use their own licenses.
