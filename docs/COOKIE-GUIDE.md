# Cookie File Guide

The relay supports optional browser/session cookies for platforms whose public extractor path is insufficient.

## Format

Use the classic **Netscape HTTP Cookie File** text format. A valid export normally starts with a comment similar to:

```text
# Netscape HTTP Cookie File
```

Do not convert cookie values to JSON and do not paste cookie values into the application environment.

## Files

The conventional filenames are:

```text
instagram.txt
x.txt
reddit.txt
linkedin.txt
youtube.txt
```

Inside the container they are referenced as:

```text
/data/cookies/<filename>
```

## You only need the platforms you use

Cookie configuration is not all-or-nothing.

Examples:

```text
Server A: x.txt only
Server B: instagram.txt + reddit.txt
Server C: no cookies
```

All are valid configurations.

## Interactive import

Upload a cookie file to the server first, for example:

```text
/home/ubuntu/x.txt
```

Run the installer and skip every stage except **Cookie files**:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/moghadam-pro/media-relay-bot/master/install.sh)
```

Choose only X/Twitter and provide the source path. The installer:

1. verifies the Netscape header;
2. copies the file into `/var/lib/mpro-media-relay/cookies/x.txt`;
3. sets owner UID/GID `996`;
4. sets mode `0600`;
5. ensures `X_COOKIE_FILE=/data/cookies/x.txt` exists in the application environment;
6. never displays the cookie values.

## Why cookies are copied per job

The host cookie directory is mounted read-only into Docker. Some extractors still try to refresh or rewrite the supplied jar.

The application therefore copies the selected source cookie to the job's temporary directory and invokes the extractor against the writable copy.

This also prevents concurrent jobs from mutating the same cookie jar.

## Security

Cookie files can provide account access. Treat them as secrets:

- do not commit them;
- do not include them in support bundles;
- do not paste them into chat/issues/logs;
- use a dedicated browser/session where practical;
- refresh/revoke them if a server is decommissioned or compromised.

The `.gitignore` excludes cookie `.txt` files under cookie directories.

## Platform notes

### Instagram

Authenticated cookies were required for reliable tested carousel/Reel behavior.

### X / Twitter

Authenticated cookies fixed tested guest-token failures from `gallery-dl`.

### Reddit

A Netscape cookie file fixed a tested 403 path. Optional Reddit OAuth is also supported.

### LinkedIn

Cookies can be used by yt-dlp and the conservative LinkedIn HTML image fallback. Multi-image extraction remains best effort.

### YouTube

Cookie format/session testing alone did not resolve anti-bot responses from the original datacenter egress IP. YouTube support is currently paused and tracked separately.
