# Media Relay Bot

A private-first Telegram media relay that turns supported social-media post URLs into temporary direct-download links and native Telegram video previews.

The project is intended for a small trusted Telegram group and/or an explicit allowlist of private Telegram users. It downloads the best media it can obtain, keeps single-media posts direct, packages multi-item posts into clean ZIP archives, and automatically expires files unless a trusted user marks them as permanent.

> Use this project only for media you are allowed to download and store. Platform terms, authentication requirements, anti-bot systems, and extractor behavior can change at any time.

## Highlights

- Private Telegram access: one optional group plus optional private-user allowlist.
- Explicit source-host allowlist before extractor execution.
- Small bounded download queue.
- `gallery-dl` for gallery-first platforms and `yt-dlp` for video-first platforms.
- Optional Netscape `.txt` cookie files per platform.
- Read-only source cookie mount with a writable per-job copy.
- Single media returned directly.
- Multi-item posts packaged as ZIP + optional `caption.txt`.
- Exact duplicate removal by SHA-256.
- Direct `/m/<token>` video playback with HTTP Range support.
- Compact Telegram UI for direct video results.
- Temporary random download URLs with a configurable TTL.
- **Keep permanently** action for trusted users.
- Nginx + Let's Encrypt deployment path.
- Interactive one-line installer where **every stage can be skipped**.

## Quick install

### Before you start

Prepare only what your deployment actually needs:

1. A Linux server. The automatic prerequisite installer currently targets Ubuntu/Debian.
2. Root shell access (`sudo -i` is fine).
3. A Telegram bot token from [@BotFather](https://t.me/BotFather).
4. A download domain/subdomain such as `dl.example.com`, with DNS pointing to the server, if you want public download links and HTTPS.
5. Optional Netscape-format cookie `.txt` files only for the platforms that need authenticated extraction.

You do **not** need cookie files for every platform. A server can use only one cookie file—for example only `x.txt`—and skip every other cookie step.

### One-line installer

The stable installer is published on the `master` branch:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/moghadam-pro/media-relay-bot/master/install.sh)
```

For security-sensitive environments, inspect it before running:

```bash
curl -Ls https://raw.githubusercontent.com/moghadam-pro/media-relay-bot/master/install.sh | less
```

### Skip-first installer behavior

The installer asks before every state-changing stage:

```text
[Enter=run / s=skip / q=quit]
```

Stages include:

1. Base packages
2. Docker + Docker Compose
3. Download/update project files
4. Runtime directories
5. Telegram token and access IDs
6. Telegram ID helper
7. Runtime limits / host allowlist
8. Public download domain
9. DNS verification
10. Optional cookie files
11. Optional Reddit OAuth
12. Nginx package
13. Nginx site
14. Certbot package
15. HTTPS certificate
16. Docker build
17. Start/recreate container
18. Health and Telegram verification

Skipping all stages performs no installation/configuration changes. You can rerun the installer later and execute only one stage.

### Example: update only one cookie file

If the bot is already installed and you only need a new X/Twitter cookie:

1. Upload your Netscape-format `.txt` file somewhere readable by root, for example `/home/ubuntu/x.txt`.
2. Run the one-line installer again.
3. Press `s` for every stage except **Cookie files**.
4. Inside the cookie stage, skip Instagram, Reddit, LinkedIn, and YouTube.
5. Choose X/Twitter and enter `/home/ubuntu/x.txt`.
6. Optionally run only **Start / update container** if your existing process needs a restart.

Existing cookies and config values are left untouched when their steps are skipped.

## What the installer creates

Default paths:

```text
/opt/mpro-media-relay/                  application files
/opt/mpro-media-relay/config/.env       application secrets/settings
/opt/mpro-media-relay/.env              Docker Compose deployment variables
/var/lib/mpro-media-relay/downloads/    generated artifacts
/var/lib/mpro-media-relay/tmp/          per-job temporary files
/var/lib/mpro-media-relay/data/         download database
/var/lib/mpro-media-relay/cookies/      optional source cookie files
```

The application container runs as UID/GID `996`, with read-only application filesystem, dropped Linux capabilities, and a read-only cookie mount.

## Telegram setup

### Create a bot

Create a Telegram bot with [@BotFather](https://t.me/BotFather) and keep the token private.

The installer can validate the token with Telegram `getMe` before saving it.

### Group access

Set `ALLOWED_CHAT_ID` to the numeric group/chat ID. Use:

```env
ALLOWED_CHAT_ID=0
```

to disable group access and rely only on private user IDs.

### Private users

`ALLOWED_PRIVATE_USER_IDS` is a comma-separated list:

```env
ALLOWED_PRIVATE_USER_IDS=123456789,987654321
```

The installer includes an optional **Telegram ID helper** that displays recent chat/user IDs from `getUpdates`. It does not print the bot token.

## Domain and DNS

For public download URLs, create a DNS record before requesting TLS:

```text
Type: A
Name: dl
Value: <SERVER_PUBLIC_IPV4>
```

Example:

```text
dl.example.com -> 203.0.113.10
```

Then configure:

```env
PUBLIC_BASE_URL=https://dl.example.com
```

The installer can check whether the configured hostname currently resolves to the server public IPv4.

Nginx exposes only the relay media routes and returns `404` for the site root.

## Public HTTP routes

```text
/d/<token>  attachment download
/m/<token>  inline media stream with Range support
/p/<token>  Open Graph preview document
```

The application itself binds to `127.0.0.1:8080`; Nginx is the intended public edge.

## Cookie files

Cookie authentication is optional and platform-specific.

Supported paths inside the container:

```text
/data/cookies/instagram.txt
/data/cookies/x.txt
/data/cookies/reddit.txt
/data/cookies/linkedin.txt
/data/cookies/youtube.txt
```

Corresponding environment variables:

```env
INSTAGRAM_COOKIE_FILE=/data/cookies/instagram.txt
X_COOKIE_FILE=/data/cookies/x.txt
REDDIT_COOKIE_FILE=/data/cookies/reddit.txt
LINKEDIN_COOKIE_FILE=/data/cookies/linkedin.txt
YOUTUBE_COOKIE_FILE=/data/cookies/youtube.txt
```

### Cookie format

Export cookies in **Netscape HTTP Cookie File** format. The installer verifies the header before importing a file and never displays cookie values.

Treat cookie files as account credentials:

- never commit them;
- never paste their values into issue reports;
- use a dedicated browser/session when practical;
- revoke/refresh them when access should end.

The host cookie directory is mounted read-only into the container. Before calling a downloader, the application copies the selected cookie into that job's writable temporary directory because some extractors update cookie jars during execution.

See [`docs/COOKIE-GUIDE.md`](docs/COOKIE-GUIDE.md).

## Current platform status

Platform behavior depends on the exact URL, authentication state, source IP, and upstream extractor version.

| Platform | Current state | Notes |
|---|---|---|
| Instagram | ✅ Confirmed | Authenticated single video/Reel and carousel extraction tested. Incompatible VP9/HE-AAC video is prepared as H.264/AAC-LC MP4 for Telegram/mobile playback. |
| X / Twitter | ✅ Confirmed | Authenticated `gallery-dl` tested. A successful single gallery item stops the yt-dlp fallback to avoid duplicate-media ZIPs. |
| Reddit | ✅ Confirmed on tested authenticated posts | Netscape cookies supported; optional gallery-dl OAuth is also available. |
| TikTok | ✅ Confirmed on tested videos | Direct MP4 + Telegram native preview tested. |
| LinkedIn single image | ✅ Confirmed | Conservative authenticated/public image fallback. |
| LinkedIn multi-image | ⏸ Paused / best effort | Existing conservative filter intentionally rejects low-confidence LinkedIn UI/default assets. |
| YouTube | ⏸ Paused / unresolved | Datacenter egress IP received `LOGIN_REQUIRED` / anti-bot responses even after cookie and PO-token-provider experiments. Not required by the stable installer. |
| Other allowlisted hosts | Extractor dependent | Behavior follows current yt-dlp/gallery-dl upstream support. |

## Instagram compatibility preparation

Some Instagram videos were downloaded as VP9 video + HE-AAC audio. They played in VLC but produced a frozen/first-frame preview in Telegram and some mobile players.

For a single Instagram video the relay now probes streams with FFprobe and, only when needed, prepares a mobile-compatible MP4:

```text
video: H.264 Main / yuv420p / avc1
audio: AAC-LC / 48 kHz
container: MP4 + faststart
```

Compatible streams are copied instead of transcoded where possible.

## X/Twitter duplicate prevention

For gallery-first hosts the application may use yt-dlp as a fallback. X/Twitter has a special rule:

```text
gallery-dl produced >= 1 media item -> stop
0 media items                    -> try yt-dlp
```

This avoids creating a ZIP from two different encodings of the same single X video.

## Direct video Telegram UI

A direct video result uses the inline `/m/<token>` URL as Telegram's preview target and keeps the message compact:

```text
📝 Caption:
<post text>

⚠️ Link 24hr Available

[⬇️ Download · 5.5 MB]
[♾️ Keep permanently]
```

The download button uses `/d/<token>` while the native preview uses `/m/<token>`.

## Multi-item behavior

After filtering and exact deduplication:

```text
1 media item  -> direct file
2+ items      -> ZIP archive
```

Example ZIP:

```text
01-image.jpg
02-image.jpg
03-video.mp4
caption.txt
```

Extractor work directories and metadata files are not included.

## Expiry and permanent files

Default TTL:

```env
DOWNLOAD_TTL_HOURS=24
```

A trusted private Telegram user can press **Keep permanently**. The same random URL remains valid and the cleanup worker skips that record.

## Security model

- Telegram token, OAuth values, private IDs, cookie files, server IP, and private domain values are runtime secrets/configuration—not repository content.
- URLs are checked against `ALLOWED_MEDIA_HOSTS` before extractor execution.
- Extractor commands use argument arrays with `shell: false`.
- Cookie source files are mounted read-only.
- Each job receives its own writable cookie copy.
- Public download tokens are random and independent from filenames/source URLs.
- Container runs non-root with dropped capabilities.
- Application HTTP is bound to localhost.
- Nginx is the only intended public-facing service.

This project is not designed as an anonymous public downloader API.

## Architecture

```text
Telegram group / trusted private user
                |
                v
        access + host allowlist
                |
                v
              queue
                |
                v
       platform-specific routing
       /                     \
 gallery-dl                  yt-dlp
       \                     /
        \------ fallback ----/
                |
       filter + deduplicate
                |
        +-------+-------+
        |               |
     1 item          2+ items
        |               |
   direct media     clean ZIP
        \               /
         v             v
        expiring download store
                |
          random 256-bit token
                |
      /d/       /m/       /p/
```

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Manual installation

If you do not want the interactive installer:

```bash
git clone https://github.com/moghadam-pro/media-relay-bot.git
cd media-relay-bot
mkdir -p config runtime/{downloads,tmp,data,cookies}
cp .env.example config/.env
chmod 600 config/.env
chmod 700 runtime/cookies
docker compose config --quiet
docker compose build
docker compose up -d
```

Edit `config/.env` before starting the container.

For production, put Nginx/TLS in front of the localhost service. See [`docs/INSTALLATION.md`](docs/INSTALLATION.md).

## Updating or reconfiguring

Rerun the stable installer:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/moghadam-pro/media-relay-bot/master/install.sh)
```

Run only the stages you need. For example:

- project files + build + start for an application update;
- only cookie files for a cookie rotation;
- only domain + Nginx + HTTPS for a hostname change;
- only Telegram for access changes.

## Operations

```bash
cd /opt/mpro-media-relay

docker compose ps
docker compose logs -f --tail=100 bot
docker compose restart bot
curl http://127.0.0.1:8080/health
```

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
│   ├── INSTALLATION.md
│   ├── COOKIE-GUIDE.md
│   ├── LEARNINGS.md
│   ├── PLATFORM-NOTES.md
│   ├── PRODUCTION-FINDINGS-2026-08-08.md
│   ├── TESTING.md
│   └── YOUTUBE-NOTES.md
├── nginx/
│   └── media-relay.conf.example
├── install.sh
├── docker-compose.yml
├── .env.example
├── .gitignore
├── CHANGELOG.md
└── LICENSE
```

## External projects used

This repository contains the relay application and deployment glue. It does not vendor the source of the downloader engines.

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — video/audio extraction and metadata.
- [gallery-dl](https://github.com/mikf/gallery-dl) — gallery/social-media extraction.
- [FFmpeg](https://ffmpeg.org/) — probing, remuxing, transcoding, and media preparation.
- [Node.js](https://nodejs.org/) — Telegram bot and relay HTTP service.
- [Docker](https://www.docker.com/) — isolated runtime.
- [Nginx](https://nginx.org/) — reverse proxy.
- [Let's Encrypt / Certbot](https://certbot.eff.org/) — TLS.

Experimental YouTube diagnostics also evaluated [`bgutil-ytdlp-pot-provider`](https://github.com/Brainicism/bgutil-ytdlp-pot-provider), but it is not required by the stable installation while YouTube support is paused.

All upstream projects retain their own licenses and terms.

## Development

```bash
cd app
npm run check
```

No GitHub Actions workflow is included by default. Validation is intentionally local.

## Version

Current application version: **v0.6.0**.

See [`CHANGELOG.md`](CHANGELOG.md).

## License

The relay application code is released under the MIT License. External tools and services use their own licenses.
