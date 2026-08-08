# YouTube Diagnostics — Paused

YouTube is intentionally paused as a separate reliability track. The stable installer does not depend on an external PO-token service.

## What was tested

The deployment used a recent yt-dlp nightly build with:

- Node.js JavaScript runtime;
- `curl_cffi`;
- a Netscape-format YouTube cookie file copied to a writable temporary location;
- `mweb` player client;
- an experimental `bgutil-ytdlp-pot-provider` HTTP provider (`1.3.1`).

The provider loaded successfully in yt-dlp verbose output.

## Observed failure

The tested public Short returned:

```text
mweb player response playability status: LOGIN_REQUIRED
Sign in to confirm you're not a bot
```

The same player-level anti-bot response occurred with and without the YouTube cookie file.

This happened before a useful GVS download stage, so merely adding the tested PO-token provider did not make that datacenter egress IP reliable.

## Current interpretation

The original server egress IP appears to be a major part of the YouTube reliability problem. A future investigation should test a different trusted egress/proxy before adding more complexity to the core relay.

## Why this is not enabled by default

The other confirmed platforms work without making the entire installation depend on a separate YouTube-specific service. Keeping YouTube experimental prevents an unresolved anti-bot issue from adding unnecessary dependencies or regressions to Instagram, X, Reddit, TikTok, and LinkedIn paths.

## Future direction

Potential next tests:

1. a different non-datacenter/trusted egress specifically for YouTube;
2. current yt-dlp PO-token guidance at the time of retesting;
3. a fresh dedicated YouTube browser session cookie;
4. YouTube-specific proxy configuration instead of routing every platform through the same proxy.

Do not assume a provider or cookie guarantees bypassing platform anti-bot controls.
