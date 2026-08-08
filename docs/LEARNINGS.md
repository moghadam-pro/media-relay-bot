# Build Learnings

This document records practical lessons from building and operating the relay rather than only documenting the final architecture.

## 1. Desktop downloaders are not server APIs

The project originally evaluated desktop-oriented downloader products. For a small server relay, keeping orchestration in Node.js and calling dedicated CLI extractors directly proved simpler and more controllable.

## 2. Installing yt-dlp in a Python virtual environment is predictable

A standalone PyInstaller binary caused container issues. A Python virtual environment made yt-dlp and optional dependencies such as `curl_cffi` easier to maintain.

## 3. YouTube and datacenter IPs are a separate reliability problem

A technically correct extractor can still fail because YouTube challenges the source IP/client. A tested datacenter egress returned player-level `LOGIN_REQUIRED` both with and without cookies. An experimental BgUtils PO-token provider loaded correctly but did not resolve that player-level block. YouTube is therefore paused separately from the stable relay.

## 4. Cookie files are stateful

Some downloaders attempt to write refreshed cookies back to the supplied jar. Mounting production cookies read-only is safer, so each job copies its platform cookie into a private writable temp directory.

## 5. Concurrency changes cookie design

Two simultaneous jobs should never share one writable cookie file. Per-job copies remove that race.

## 6. `process exited 0` is not the success condition

The application inspects output files after each extractor. Real success means one or more valid media artifacts exist.

## 7. Gallery-first and video-first extraction solve different problems

A video extractor may successfully return one video while missing images from a mixed post. Carousel-heavy platforms therefore use gallery-first routing.

## 8. Fallbacks can create duplicates even when both tools are correct

A production X/Twitter bug showed why a fallback should not always run after a single gallery item. `gallery-dl` and `yt-dlp` could save two different encodings of the same video; exact SHA-256 deduplication cannot collapse different encodings. The fix is semantic routing: on X, one successful gallery item is already sufficient, so yt-dlp only runs when gallery-dl produces zero media.

## 9. LinkedIn HTML contains many unrelated images

Broad matching against LinkedIn CDN URLs collected profile/default/UI assets and multiple resolution variants. The conservative fallback accepts only high-confidence media candidates and intentionally prefers a clean failure over returning unrelated assets.

## 10. Single media and multi media should diverge late

Media is collected and filtered first. Only then:

- exactly one item -> direct media artifact;
- two or more items -> clean ZIP archive.

## 11. ZIPs should be built from a clean staging directory

Zipping extractor working directories directly introduces empty folders and unrelated files. Multi-item archives are built from normalized media plus optional `caption.txt` only.

## 12. Instagram source codecs can be browser/Telegram incompatible

A tested Reel arrived as VP9 video + HE-AAC audio. VLC desktop played it, while Telegram/mobile playback showed a frozen first frame or failed. FFprobe made the cause visible.

The production fix prepares only Instagram single videos that need compatibility work:

- H.264 Main
- yuv420p
- `avc1` tag
- AAC-LC at 48 kHz when audio needs conversion
- MP4 faststart

Compatible streams are copied rather than transcoded.

## 13. Telegram preview and download semantics need separate URLs

Browsers expect explicit downloads to use attachment semantics. Telegram preview needs inline media. The relay therefore separates:

- `/d/<token>` attachment download;
- `/m/<token>` inline media with Range support;
- `/p/<token>` Open Graph preview document.

## 14. Direct media works better than a second Telegram upload for this design

Telegram can render the relay-owned `/m/<token>` MP4 as a native playable preview. This keeps one server-side media source and avoids uploading the file again through `sendVideo`.

## 15. Preview failure must not turn a successful download into a failed job

If Telegram rejects a rich preview, the bot retries the completion edit with previews disabled rather than reporting a media download failure.

## 16. Compact success UI matters

For direct video, filenames/uploader/duplicated source URLs created unnecessary noise. The compact path now shows post caption when available, TTL status, a size-labelled Download button, and Keep permanently.

## 17. Expiry should be logical before it is physical

A token becomes unavailable when TTL passes even if filesystem cleanup follows a short time later.

## 18. Permanent retention is record state, not a new URL

**Keep permanently** marks the existing record persistent. The same token remains valid and cleanup skips it.

## 19. Authentication debugging needs several separate checks

Do not collapse authentication into one boolean. Distinguish:

1. environment variable configured;
2. cookie file exists on host;
3. file is visible in container;
4. file is valid Netscape format;
5. platform router selects it;
6. extractor uses it;
7. upstream authenticated request succeeds.

The X/Twitter investigation demonstrated this clearly: the `.env` and mounted file were correct while the production code initially had no X cookie routing branch.

## 20. A re-runnable installer should be skip-first

Installation and maintenance are the same workflow at different times. A user may need only one cookie rotation, one domain change, or one rebuild. An installer that makes every stage independently skippable is safer than an all-or-nothing bootstrap script.
