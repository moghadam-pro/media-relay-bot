# Installation Guide

This guide documents both the interactive installer and a manual deployment.

## Recommended deployment

- Ubuntu/Debian server
- Docker Engine + Docker Compose plugin
- Nginx on the host
- Let's Encrypt / Certbot for HTTPS
- One DNS hostname dedicated to downloads
- Telegram bot restricted to a trusted group and/or explicit private user IDs
- Optional Netscape cookies only for platforms that require them

## DNS first

Create a record such as:

```text
dl.example.com -> SERVER_PUBLIC_IP
```

Ports `80/tcp` and `443/tcp` must be reachable if you want Certbot and public downloads.

## Interactive install

Run from a root shell:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/moghadam-pro/media-relay-bot/master/install.sh)
```

Every state-changing stage can be skipped. `Enter` runs the current stage; `s` skips it; `q` exits.

This behavior is intentional. The same installer is also a reconfiguration utility.

## Installer stages

### 1. Base packages

Installs basic command-line requirements such as `curl`, `jq`, certificates, `git`, `tar`, and `gzip`.

Skip when the machine is already provisioned.

### 2. Docker

Installs Docker Engine and the Compose plugin from Docker's official apt repository when missing.

Skip when `docker compose version` already works or when Docker is managed separately.

### 3. Project files

Downloads the stable repository branch to:

```text
/opt/mpro-media-relay
```

Runtime secrets and cookie files are not part of the repository payload.

### 4. Runtime directories

Creates:

```text
/var/lib/mpro-media-relay/downloads
/var/lib/mpro-media-relay/tmp
/var/lib/mpro-media-relay/data
/var/lib/mpro-media-relay/cookies
```

The runtime is owned by numeric UID/GID `996` because that is the non-root UID used inside the container.

### 5. Telegram

Configures:

```env
BOT_TOKEN=
ALLOWED_CHAT_ID=0
ALLOWED_PRIVATE_USER_IDS=
```

`ALLOWED_CHAT_ID=0` disables group access.

A Telegram token entered in the installer is hidden while typing and validated with `getMe` before it is saved.

### 6. Telegram ID helper

Optional helper for new deployments. Send a message to the bot/group, then the installer displays recent numeric chat/user IDs from `getUpdates`.

### 7. Runtime settings

Optional configuration for:

```env
DOWNLOAD_TTL_HOURS=24
MAX_CONCURRENT_DOWNLOADS=2
MAX_FILE_SIZE_MB=2000
ALLOWED_MEDIA_HOSTS=...
```

### 8. Domain

Configures `PUBLIC_BASE_URL`, usually:

```env
PUBLIC_BASE_URL=https://dl.example.com
```

### 9. DNS check

Compares the configured hostname's IPv4 resolution with the server's current public IPv4. This is a check only; the installer does not modify DNS provider records.

### 10. Cookie files

The entire stage is optional, and every platform within it is optional.

A valid deployment may configure exactly one file:

```text
Instagram -> instagram.txt
X/Twitter -> x.txt
Reddit -> reddit.txt
LinkedIn -> linkedin.txt
YouTube -> youtube.txt (currently experimental/paused)
```

The importer checks for a Netscape cookie header and copies the file with mode `0600`. Values are never printed.

### 11. Reddit OAuth

Optional advanced alternative/addition to Reddit cookies:

```env
REDDIT_CLIENT_ID=
REDDIT_USER_AGENT=
REDDIT_REFRESH_TOKEN=
```

Skip when Reddit cookies already work.

### 12-15. Nginx and HTTPS

Nginx listens publicly and proxies only `/d/`, `/m/`, and `/p/` to the application on localhost port `8080`.

Certbot can then request a certificate and redirect HTTP to HTTPS.

The installer does not change unrelated Nginx sites.

### 16. Build

Runs:

```bash
docker compose config --quiet
docker compose build
```

### 17. Start

Runs:

```bash
docker compose up -d
```

### 18. Verification

Checks:

- Compose container status
- `http://127.0.0.1:8080/health`
- Telegram `getMe` when a token exists

## Reconfigure only one thing

The installer is safe to rerun interactively. For example, to rotate only Instagram cookies:

1. upload the new `.txt` file;
2. rerun `install.sh`;
3. skip stages 1-9;
4. run stage 10;
5. configure only Instagram and skip all other platforms;
6. skip everything else or restart the bot if desired.

## Manual deployment

```bash
git clone https://github.com/moghadam-pro/media-relay-bot.git
cd media-relay-bot
mkdir -p config runtime/{downloads,tmp,data,cookies}
cp .env.example config/.env
chmod 600 config/.env
chmod 700 runtime/cookies
```

Edit `config/.env`, then:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
```

The default Compose file uses local `./runtime` storage. The installer writes a small root `.env` file that changes `MEDIA_RELAY_DATA_ROOT` to `/var/lib/mpro-media-relay` for a production-style deployment.

## Updating

The recommended update is the same installer command. Run:

- **Project files**
- **Build**
- **Start / update container**
- **Verification**

and skip configuration stages you do not want to change.
