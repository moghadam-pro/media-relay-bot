# Architecture

## Goals

- Private Telegram access only.
- Explicit source-host allowlist.
- Small bounded download concurrency.
- Best available source quality.
- Video, image, and carousel support.
- Direct delivery for a single media item.
- ZIP delivery for multi-item posts.
- Original post text/metadata when extractable.
- Expiring, unguessable public download URLs.
- Optional permanent retention controlled by trusted Telegram users.
- Public HTTP behind Nginx while the application listens on localhost only.
- Platform-specific authentication without exposing cookie contents.

## Runtime flow

1. Telegram long polling receives a message.
2. The access layer verifies the configured group ID or private-user allowlist.
3. URL extraction ignores hosts outside `ALLOWED_MEDIA_HOSTS`.
4. A job enters the bounded in-memory queue.
5. The platform router chooses a preferred extractor:
   - gallery-first for Instagram, X/Twitter, Reddit, Pinterest, Bluesky, and Threads;
   - video-first for most other hosts;
   - LinkedIn video-first followed by a conservative image fallback.
6. If the source has a configured cookie file, the read-only host cookie is copied into the job's writable temporary directory.
7. The extractor result is verified by inspecting actual output files.
8. Exact duplicates are removed by SHA-256 content hash.
9. X/Twitter stops after a successful gallery-dl result with one or more media items; yt-dlp is used only when gallery-dl produced nothing. This prevents different encodings of one video from becoming a false multi-item bundle.
10. One media item is promoted to the job root and served directly.
11. A single Instagram video is probed with FFprobe. Incompatible VP9/HE-AAC media is prepared as H.264/yuv420p + AAC-LC MP4 with faststart; compatible streams are copied when possible.
12. Multiple media items are copied into a clean staging directory and zipped with optional `caption.txt`.
13. The artifact is registered in the download store with a random token and TTL.
14. Direct videos use `/m/<token>` as Telegram's preview target and `/d/<token>` as the explicit download URL.
15. Trusted private users can convert the record to persistent storage with the inline **Keep permanently** callback.

## HTTP routes

### `/d/<token>`

Attachment download with `Content-Disposition: attachment`.

### `/m/<token>`

Inline media stream with byte-range support. This is the preferred Telegram video-preview target.

### `/p/<token>`

Open Graph preview document used for non-video preview cases.

### `/health`

Local operational health endpoint.

## Storage model

The container stores mutable data outside the application image:

```text
runtime-or-external-data-root/
├── cookies/
├── data/
│   └── downloads.json
├── downloads/
└── tmp/
```

The interactive installer uses `/var/lib/mpro-media-relay` by default. Manual Compose usage falls back to `./runtime` unless `MEDIA_RELAY_DATA_ROOT` is set.

`downloads.json` is a deliberately small persistence layer for this personal/private deployment. A larger multi-instance service should replace it with a transactional database and external queue.

## Cookie model

Source cookie files are optional per platform:

```text
youtube.txt
instagram.txt
linkedin.txt
reddit.txt
x.txt
```

The host cookie directory is mounted read-only. Each job copies only its selected cookie jar into the temporary directory before calling an extractor.

This design prevents:

- downloader attempts to rewrite a read-only shared jar;
- concurrent jobs mutating one cookie file;
- cookie values being stored in application logs.

## Security boundaries

- Telegram token, cookies, OAuth values, private IDs, server IPs, and production domains are runtime configuration/secrets.
- URLs are allowlisted before any downloader receives them.
- Downloader processes are spawned with argument arrays and `shell: false`.
- Download tokens are random and independent of source URLs and filesystem paths.
- Container runtime is non-root with Linux capabilities dropped.
- Application HTTP binds to localhost.
- Nginx is the intended public edge.
- Installer stages are opt-in and individually skippable so reconfiguration can be narrowly scoped.

## Current non-goals

- Public anonymous downloader service.
- Horizontal multi-node queueing.
- Unlimited archival storage.
- Guaranteeing extraction for every URL supported by upstream tools.
- Making unresolved YouTube anti-bot work a dependency of the stable core relay.
