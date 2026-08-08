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

## Runtime flow

1. Telegram long polling receives a message.
2. The access layer verifies the group ID or private-user allowlist.
3. URL extraction ignores hosts outside `ALLOWED_MEDIA_HOSTS`.
4. A job enters the bounded in-memory queue.
5. Platform routing chooses a preferred extractor:
   - gallery-first for Instagram, X/Twitter, Reddit, Pinterest, Bluesky, and Threads;
   - video-first for most other supported hosts;
   - LinkedIn video-first followed by a conservative public-image fallback.
6. The application verifies which media files were actually produced.
7. Exact duplicate files are removed by SHA-256 content hash.
8. One media item is promoted to the job root and served directly.
9. Multiple media items are copied into a clean staging directory and zipped with optional `caption.txt`.
10. The artifact is registered in the download store with a random token and TTL.
11. Telegram receives the original post text/metadata plus a direct-download link.
12. Trusted users can convert the record to persistent storage with an inline callback button.

## HTTP routes

### `/d/<token>`

Attachment download. The response includes `Content-Disposition: attachment`.

### `/m/<token>`

Inline media stream for Telegram/Open Graph clients. Range requests are supported.

### `/p/<token>`

Small Open Graph document that points Telegram to `/m/<token>` for image/video previews.

### `/health`

Local health endpoint for operations and deployment checks.

## Storage model

Runtime data is intentionally outside the application image:

```text
runtime/
├── cookies/
├── data/
│   └── downloads.json
├── downloads/
└── tmp/
```

`downloads.json` is a deliberately small persistence layer for this personal deployment. It stores token, artifact path, expiry, preview type, and persistence state. A larger multi-instance deployment should replace this with a real transactional database and an external queue.

## Security boundaries

- Telegram token and authentication cookies are environment/runtime secrets.
- Cookie source files are mounted read-only.
- A per-job writable cookie copy is created only when a downloader needs it.
- The application never builds shell command strings from user input.
- Source hosts are allowlisted before any downloader receives the URL.
- Download tokens are random and independent of source URLs and filesystem paths.
- The container drops Linux capabilities and runs as a non-root UID.
- Nginx is the only public-facing service.

## Current non-goals

- Public anonymous downloader service.
- Horizontal multi-node queueing.
- Unlimited archival storage.
- Circumventing source-platform access controls.
- Guaranteeing support for every URL accepted by upstream download engines.
