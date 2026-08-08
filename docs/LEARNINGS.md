# Build Learnings

This document records practical lessons from building and operating the relay rather than only documenting the final architecture.

## 1. Desktop downloaders are not server APIs

The project originally evaluated OmniGet. Its useful reusable layer is its downloader/core behavior, but the application itself is primarily a desktop/Tauri product. For a small server relay it was simpler to keep the orchestration in Node.js and call dedicated CLI extractors directly.

## 2. The first Linux yt-dlp binary choice failed

A standalone PyInstaller build failed to unpack correctly in the container environment. Installing yt-dlp into a Python virtual environment proved more predictable and also made optional Python dependencies such as `curl_cffi` easy to add.

## 3. YouTube and datacenter IPs are a separate reliability problem

A downloader can be technically correct and still fail because YouTube decides the source IP or client needs additional verification. Cookies solved one test temporarily, but anti-bot behavior remained unstable. This is tracked separately from the core media-relay architecture.

## 4. Cookie files are stateful

Some downloaders attempt to write refreshed cookies back to the supplied cookie jar. Mounting the production cookie directory read-only is safer, so each job copies the required cookie file into its private temporary directory and gives the writable copy to the downloader.

## 5. Concurrency changes cookie design

Two simultaneous jobs must never share one writable cookie file. Per-job cookie copies removed that race entirely.

## 6. `process exited 0` is not the success condition

The application always inspects the output directory after an extractor finishes. The real success condition is: one or more valid media artifacts were produced.

## 7. Video-first and gallery-first extraction are different problems

A video extractor can successfully return one video from a mixed post while silently missing the post's images. Carousel-heavy platforms therefore use a gallery-first route. A second engine is tried when the first result is empty or suspiciously incomplete.

## 8. LinkedIn HTML contains many unrelated images

A broad search for `licdn` image URLs downloaded profile/default/UI assets and multiple resolution variants. The safer fallback:

- accepts only LinkedIn media CDN hosts;
- accepts only `/dms/image/` assets;
- rejects known profile/logo/default markers;
- groups URLs by LinkedIn image asset ID;
- keeps the highest-scoring quality variant per asset;
- probes downloaded dimensions and rejects tiny assets.

This is still best-effort because LinkedIn does not expose a stable public post-media extraction API for this use case.

## 9. Single media and multi media should diverge late

Media is collected and filtered first. Only after deduplication does packaging happen:

- exactly one item -> direct media artifact;
- two or more items -> clean ZIP archive.

This prevents false ZIPs caused by duplicate thumbnails or extractor metadata.

## 10. ZIPs should be built from a clean staging directory

Zipping an extractor output directory directly included empty `gallery/` folders and unrelated files. Multi-item archives are now built from a temporary staging directory containing only normalized media files and optional `caption.txt`.

## 11. Telegram preview and download headers need separate URLs

Browsers expect a download link to use `Content-Disposition: attachment`, while Telegram preview needs inline media. The server therefore exposes separate routes:

- `/d/<token>` for attachment downloads;
- `/m/<token>` for inline media;
- `/p/<token>` for Open Graph metadata.

## 12. Preview failure must not turn a successful download into a failed job

The bot first attempts to edit the Telegram message with a large media preview. If Telegram rejects the preview, it retries the same successful completion message with previews disabled.

## 13. Expiry should be logical before it is physical

A token becomes unavailable when its TTL passes even if filesystem cleanup is delayed by a few seconds. The cleanup worker then removes the artifact directory and database record.

## 14. Permanent retention is a database state, not a new URL

Pressing **Keep permanently** sets `persistent=true` on the same record. The URL does not change and cleanup simply skips persistent records.

## 15. Generic shorteners are risky allowlist entries

A shortener can redirect an allowlisted hostname to an arbitrary destination. The default allowlist therefore prefers actual platform hostnames rather than generic redirect domains.

## 16. Small-server constraints are useful design pressure

The original deployment used roughly 1 GB of RAM and two CPU cores. A two-job queue, container memory limits, temporary cleanup, and 24-hour file expiry were chosen deliberately rather than treating the relay as an unlimited download service.
