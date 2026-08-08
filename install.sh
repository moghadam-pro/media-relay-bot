#!/usr/bin/env bash
set -Eeuo pipefail

REPO="moghadam-pro/media-relay-bot"
REPO_REF="${MEDIA_RELAY_REF:-master}"
INSTALL_DIR="${MEDIA_RELAY_INSTALL_DIR:-/opt/mpro-media-relay}"
DATA_ROOT="${MEDIA_RELAY_DATA_ROOT:-/var/lib/mpro-media-relay}"
APP_ENV="${INSTALL_DIR}/config/.env"
COMPOSE_ENV="${INSTALL_DIR}/.env"
NGINX_SITE="/etc/nginx/sites-available/mpro-media-relay.conf"
NGINX_LINK="/etc/nginx/sites-enabled/mpro-media-relay.conf"
COOKIE_UID="${MEDIA_RELAY_RUNTIME_UID:-996}"
COOKIE_GID="${MEDIA_RELAY_RUNTIME_GID:-996}"

C_RESET='\033[0m'
C_BOLD='\033[1m'
C_GREEN='\033[32m'
C_YELLOW='\033[33m'
C_RED='\033[31m'
C_CYAN='\033[36m'

say() { printf '%b\n' "$*"; }
info() { say "${C_CYAN}ℹ${C_RESET} $*"; }
ok() { say "${C_GREEN}✔${C_RESET} $*"; }
warn() { say "${C_YELLOW}⚠${C_RESET} $*"; }
die() { say "${C_RED}✖${C_RESET} $*" >&2; exit 1; }

section() {
  printf '\n%b\n' "${C_BOLD}────────────────────────────────────────────────────────${C_RESET}"
  say "${C_BOLD}$1${C_RESET}"
  printf '%b\n' "${C_BOLD}────────────────────────────────────────────────────────${C_RESET}"
}

ask_run() {
  local label="$1"
  local answer
  while true; do
    read -r -p "$label [Enter=run / s=skip / q=quit]: " answer || true
    case "${answer,,}" in
      ""|y|yes|run|r) return 0 ;;
      s|skip|n|no) return 1 ;;
      q|quit|exit) exit 0 ;;
      *) warn "Enter, s, or q." ;;
    esac
  done
}

ask_yes_no() {
  local label="$1"
  local default="${2:-N}"
  local suffix='[y/N]'
  [[ "$default" == "Y" ]] && suffix='[Y/n]'
  local answer
  while true; do
    read -r -p "$label $suffix: " answer || true
    if [[ -z "$answer" ]]; then
      [[ "$default" == "Y" ]] && return 0 || return 1
    fi
    case "${answer,,}" in
      y|yes) return 0 ;;
      n|no|s|skip) return 1 ;;
      *) warn "Answer y or n." ;;
    esac
  done
}

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    die "Run this installer from a root shell (for example: sudo -i), then run the one-line install command again."
  fi
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

get_env() {
  local key="$1"
  [[ -f "$APP_ENV" ]] || return 0
  sed -n "s/^${key}=//p" "$APP_ENV" | tail -n1
}

set_env() {
  local key="$1"
  local value="$2"
  mkdir -p "$(dirname "$APP_ENV")"
  touch "$APP_ENV"
  chmod 600 "$APP_ENV"

  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { found=0 }
    index($0, k "=")==1 {
      if (!found) print k "=" v
      found=1
      next
    }
    { print }
    END { if (!found) print k "=" v }
  ' "$APP_ENV" > "$tmp"
  cat "$tmp" > "$APP_ENV"
  rm -f "$tmp"
  chmod 600 "$APP_ENV"
}

ensure_base_app_env() {
  mkdir -p "$(dirname "$APP_ENV")"
  if [[ -s "$APP_ENV" ]]; then
    chmod 600 "$APP_ENV"
    return
  fi

  cat > "$APP_ENV" <<'ENVEOF'
BOT_TOKEN=
ALLOWED_CHAT_ID=0
ALLOWED_PRIVATE_USER_IDS=
POLL_TIMEOUT_SECONDS=30
ALLOWED_MEDIA_HOSTS=youtube.com,youtu.be,instagram.com,instagr.am,linkedin.com,tiktok.com,x.com,twitter.com,reddit.com,redd.it,vimeo.com,twitch.tv,pinterest.com,pin.it,threads.net,threads.com,bsky.app,facebook.com,fb.watch,dailymotion.com,dai.ly
DOWNLOAD_DIR=/data/downloads
TEMP_DIR=/data/tmp
DATA_DIR=/data/data
MAX_CONCURRENT_DOWNLOADS=2
MAX_FILE_SIZE_MB=2000
DOWNLOAD_TTL_HOURS=24
DOWNLOAD_HTTP_PORT=8080
PUBLIC_BASE_URL=
YOUTUBE_COOKIE_FILE=/data/cookies/youtube.txt
INSTAGRAM_COOKIE_FILE=/data/cookies/instagram.txt
LINKEDIN_COOKIE_FILE=/data/cookies/linkedin.txt
REDDIT_COOKIE_FILE=/data/cookies/reddit.txt
X_COOKIE_FILE=/data/cookies/x.txt
REDDIT_CLIENT_ID=
REDDIT_USER_AGENT=
REDDIT_REFRESH_TOKEN=
ENVEOF
  chmod 600 "$APP_ENV"
}

ensure_compose_env() {
  mkdir -p "$INSTALL_DIR"
  cat > "$COMPOSE_ENV" <<EOF2
MEDIA_RELAY_DATA_ROOT=${DATA_ROOT}
MEDIA_RELAY_ENV_FILE=./config/.env
MEDIA_RELAY_CONTAINER_NAME=mpro-media-relay-bot
MEDIA_RELAY_HTTP_PORT=8080
EOF2
  chmod 600 "$COMPOSE_ENV"
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates curl tar gzip jq git openssl
}

install_docker() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    ok "Docker and Docker Compose are already available."
    docker --version || true
    docker compose version || true
    return
  fi

  . /etc/os-release
  local distro="${ID:-}"
  local codename="${VERSION_CODENAME:-}"
  case "$distro" in
    ubuntu|debian) ;;
    *) die "Automatic Docker installation currently supports Ubuntu and Debian. Skip this stage and install Docker manually on other distributions." ;;
  esac
  [[ -n "$codename" ]] || die "Could not determine OS codename."

  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${distro}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$distro" "$codename" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  docker --version
  docker compose version
}

download_project() {
  command_exists curl || die "curl is required for the project download stage."
  command_exists tar || die "tar is required for the project download stage."

  local tmp archive extracted
  tmp="$(mktemp -d)"
  archive="${tmp}/repo.tar.gz"
  extracted="${tmp}/extracted"
  mkdir -p "$extracted"

  info "Downloading ${REPO}@${REPO_REF} ..."
  curl -fL --retry 3 --connect-timeout 15 \
    "https://github.com/${REPO}/archive/refs/heads/${REPO_REF}.tar.gz" \
    -o "$archive"
  tar -xzf "$archive" -C "$extracted" --strip-components=1

  mkdir -p "$INSTALL_DIR"
  # Preserve runtime secrets/config. Only repository-owned files are refreshed.
  for item in app docs nginx docker-compose.yml .env.example .gitignore LICENSE README.md CHANGELOG.md install.sh; do
    if [[ -e "${extracted}/${item}" ]]; then
      rm -rf "${INSTALL_DIR:?}/${item}"
      cp -a "${extracted}/${item}" "${INSTALL_DIR}/${item}"
    fi
  done
  chmod +x "${INSTALL_DIR}/install.sh" 2>/dev/null || true
  rm -rf "$tmp"
  ok "Project files are available at ${INSTALL_DIR}."
}

create_runtime_dirs() {
  install -d -m 0750 "$DATA_ROOT"
  install -d -m 0750 "$DATA_ROOT/downloads" "$DATA_ROOT/tmp" "$DATA_ROOT/data"
  install -d -m 0700 "$DATA_ROOT/cookies"
  chown -R "${COOKIE_UID}:${COOKIE_GID}" "$DATA_ROOT"
  ensure_base_app_env
  ensure_compose_env
  ok "Runtime storage: ${DATA_ROOT}"
}

validate_bot_token() {
  local token="$1"
  command_exists curl || return 1
  local result
  result="$(curl -fsS --max-time 12 "https://api.telegram.org/bot${token}/getMe" 2>/dev/null || true)"
  [[ -n "$result" ]] || return 1
  if command_exists jq; then
    [[ "$(printf '%s' "$result" | jq -r '.ok // false' 2>/dev/null)" == "true" ]]
  else
    grep -q '"ok":true' <<<"$result"
  fi
}

configure_telegram() {
  ensure_base_app_env
  local current token
  current="$(get_env BOT_TOKEN)"
  if [[ -n "$current" ]]; then
    info "A Telegram bot token is already configured. Press Enter to keep it."
  fi
  read -r -s -p "Telegram Bot Token (Enter=keep/skip): " token || true
  printf '\n'
  if [[ -n "$token" ]]; then
    if validate_bot_token "$token"; then
      ok "Telegram token validated with getMe."
      set_env BOT_TOKEN "$token"
    else
      warn "Telegram token could not be validated. It was not saved."
    fi
  fi

  current="$(get_env ALLOWED_CHAT_ID)"
  info "Group access is optional. Use 0 to disable group access. Current: ${current:-0}"
  local group_id
  read -r -p "Allowed Telegram group/chat ID (Enter=keep): " group_id || true
  if [[ -n "$group_id" ]]; then
    if [[ "$group_id" =~ ^-?[0-9]+$ ]]; then
      set_env ALLOWED_CHAT_ID "$group_id"
    else
      warn "Group ID must be numeric; keeping the current value."
    fi
  fi

  current="$(get_env ALLOWED_PRIVATE_USER_IDS)"
  info "Private user IDs are optional and comma-separated. Current: ${current:-<empty>}"
  local private_ids
  read -r -p "Allowed private user IDs (Enter=keep, '-'=clear): " private_ids || true
  if [[ "$private_ids" == "-" ]]; then
    set_env ALLOWED_PRIVATE_USER_IDS ""
  elif [[ -n "$private_ids" ]]; then
    if [[ "$private_ids" =~ ^[0-9]+([[:space:]]*,[[:space:]]*[0-9]+)*$ ]]; then
      private_ids="${private_ids// /}"
      set_env ALLOWED_PRIVATE_USER_IDS "$private_ids"
    else
      warn "Private IDs must be comma-separated numeric IDs; keeping the current value."
    fi
  fi
}

show_telegram_ids() {
  ensure_base_app_env
  local token
  token="$(get_env BOT_TOKEN)"
  [[ -n "$token" ]] || { warn "No BOT_TOKEN is configured."; return 0; }
  info "Send a message to the bot (or a message in the group containing the bot), then press Enter."
  read -r _ || true
  local response
  response="$(curl -fsS --max-time 15 "https://api.telegram.org/bot${token}/getUpdates" 2>/dev/null || true)"
  [[ -n "$response" ]] || { warn "Could not retrieve Telegram updates."; return 0; }
  if command_exists jq; then
    printf '%s' "$response" | jq -r '
      .result[]? |
      (.message // .channel_post // .edited_message // empty) as $m |
      ["chat_id=" + (($m.chat.id // "")|tostring), "chat_type=" + ($m.chat.type // ""), "user_id=" + (($m.from.id // "")|tostring), "title=" + ($m.chat.title // $m.from.username // $m.from.first_name // "")] | @tsv
    ' | tail -n 20
  else
    warn "Install jq for readable ID discovery output."
  fi
}

configure_runtime_settings() {
  ensure_base_app_env
  local value current

  current="$(get_env DOWNLOAD_TTL_HOURS)"
  read -r -p "Download TTL hours [${current:-24}] (Enter=keep): " value || true
  [[ "$value" =~ ^[0-9]+$ ]] && set_env DOWNLOAD_TTL_HOURS "$value"

  current="$(get_env MAX_CONCURRENT_DOWNLOADS)"
  read -r -p "Concurrent downloads [${current:-2}] (1-4, Enter=keep): " value || true
  if [[ "$value" =~ ^[1-4]$ ]]; then set_env MAX_CONCURRENT_DOWNLOADS "$value"; fi

  current="$(get_env MAX_FILE_SIZE_MB)"
  read -r -p "Max artifact size MB [${current:-2000}] (Enter=keep): " value || true
  [[ "$value" =~ ^[0-9]+$ ]] && set_env MAX_FILE_SIZE_MB "$value"

  current="$(get_env ALLOWED_MEDIA_HOSTS)"
  info "Leave the default host allowlist unchanged unless you know why you need to edit it."
  read -r -p "Allowed media hosts (Enter=keep current list): " value || true
  [[ -n "$value" ]] && set_env ALLOWED_MEDIA_HOSTS "$value"
}

configure_domain() {
  ensure_base_app_env
  local current_url current_host domain
  current_url="$(get_env PUBLIC_BASE_URL)"
  current_host="${current_url#https://}"
  current_host="${current_host#http://}"
  current_host="${current_host%%/*}"
  info "Create an A/AAAA record for the download subdomain before enabling TLS."
  [[ -n "$current_host" ]] && info "Current download domain: ${current_host}"
  read -r -p "Download domain (e.g. dl.example.com, Enter=keep/skip): " domain || true
  if [[ -n "$domain" ]]; then
    domain="${domain#https://}"
    domain="${domain#http://}"
    domain="${domain%%/*}"
    if [[ "$domain" =~ ^[A-Za-z0-9.-]+$ && "$domain" == *.* ]]; then
      set_env PUBLIC_BASE_URL "https://${domain}"
      ok "PUBLIC_BASE_URL=https://${domain}"
    else
      warn "Domain format was not accepted; keeping the current value."
    fi
  fi
}

current_domain() {
  local url
  url="$(get_env PUBLIC_BASE_URL)"
  url="${url#https://}"
  url="${url#http://}"
  printf '%s' "${url%%/*}"
}

check_dns() {
  local domain server_ip dns_ips
  domain="$(current_domain)"
  [[ -n "$domain" ]] || { warn "PUBLIC_BASE_URL is not configured."; return 0; }
  server_ip="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  dns_ips="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  info "Domain: ${domain}"
  info "Server public IPv4: ${server_ip:-unknown}"
  info "DNS IPv4: ${dns_ips:-unresolved}"
  if [[ -n "$server_ip" ]] && grep -qx "$server_ip" <<<"$dns_ips"; then
    ok "DNS points to this server IPv4."
  else
    warn "DNS does not currently resolve to this server IPv4, or the check could not confirm it."
  fi
}

validate_cookie_file() {
  local source="$1"
  [[ -f "$source" ]] || return 1
  head -n 10 "$source" 2>/dev/null | grep -qi 'Netscape HTTP Cookie File'
}

import_cookie() {
  local platform="$1"
  local filename="$2"
  local env_key="$3"
  local destination="${DATA_ROOT}/cookies/${filename}"
  local source

  if [[ -f "$destination" ]]; then
    info "Existing ${platform} cookie: ${destination}"
  fi
  read -r -p "Path to ${platform} Netscape .txt cookie (Enter=skip/keep existing): " source || true
  [[ -n "$source" ]] || return 0

  if ! validate_cookie_file "$source"; then
    warn "That file is missing or does not look like a Netscape cookie file. Skipped."
    return 0
  fi

  install -d -m 0700 "$DATA_ROOT/cookies"
  cp "$source" "$destination"
  chown "${COOKIE_UID}:${COOKIE_GID}" "$destination"
  chmod 0600 "$destination"
  set_env "$env_key" "/data/cookies/${filename}"
  ok "Imported ${platform} cookie without displaying its contents."
}

configure_cookies() {
  ensure_base_app_env
  install -d -m 0700 "$DATA_ROOT/cookies"
  chown "${COOKIE_UID}:${COOKIE_GID}" "$DATA_ROOT/cookies"

  say "Every platform below is optional. Choose only the cookie files you actually want to use."
  say "A deployment may use only one .txt file and skip all the others."

  ask_yes_no "Configure Instagram cookie?" N && import_cookie "Instagram" "instagram.txt" "INSTAGRAM_COOKIE_FILE"
  ask_yes_no "Configure X / Twitter cookie?" N && import_cookie "X / Twitter" "x.txt" "X_COOKIE_FILE"
  ask_yes_no "Configure Reddit cookie?" N && import_cookie "Reddit" "reddit.txt" "REDDIT_COOKIE_FILE"
  ask_yes_no "Configure LinkedIn cookie?" N && import_cookie "LinkedIn" "linkedin.txt" "LINKEDIN_COOKIE_FILE"
  if ask_yes_no "Configure YouTube cookie? (YouTube support is currently experimental/paused)" N; then
    import_cookie "YouTube" "youtube.txt" "YOUTUBE_COOKIE_FILE"
  fi
}

configure_reddit_oauth() {
  ensure_base_app_env
  warn "Reddit OAuth is optional. Do not configure it if Reddit cookies already work for your deployment."
  local current value
  current="$(get_env REDDIT_CLIENT_ID)"
  read -r -p "Reddit client ID (Enter=keep/skip): " value || true
  [[ -n "$value" ]] && set_env REDDIT_CLIENT_ID "$value"

  current="$(get_env REDDIT_USER_AGENT)"
  read -r -p "Reddit OAuth user agent (Enter=keep/skip): " value || true
  [[ -n "$value" ]] && set_env REDDIT_USER_AGENT "$value"

  read -r -s -p "Reddit refresh token (Enter=keep/skip): " value || true
  printf '\n'
  [[ -n "$value" ]] && set_env REDDIT_REFRESH_TOKEN "$value"
}

install_nginx_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y nginx
  systemctl enable --now nginx
}

configure_nginx() {
  local domain
  domain="$(current_domain)"
  [[ -n "$domain" ]] || { warn "No download domain is configured. Skipping Nginx configuration."; return 0; }
  command_exists nginx || { warn "Nginx is not installed. Run or install the Nginx prerequisites first."; return 0; }

  if [[ -f "$NGINX_SITE" ]]; then
    cp "$NGINX_SITE" "${NGINX_SITE}.backup-$(date +%Y%m%d-%H%M%S)"
  fi

  cat > "$NGINX_SITE" <<EOF2
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    server_tokens off;

    location ~ ^/(?:d|m|p)/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Range \$http_range;
        proxy_set_header If-Range \$http_if_range;
        proxy_buffering off;
        proxy_connect_timeout 15s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        return 404;
    }
}
EOF2

  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  if nginx -t; then
    systemctl reload nginx
    ok "Nginx configured for ${domain}."
  else
    warn "nginx -t failed. Nginx was not reloaded; inspect ${NGINX_SITE}."
    return 1
  fi
}

install_certbot_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y certbot python3-certbot-nginx
}

configure_tls() {
  local domain email
  domain="$(current_domain)"
  [[ -n "$domain" ]] || { warn "No download domain is configured. Skipping TLS."; return 0; }
  command_exists certbot || { warn "Certbot is not installed."; return 0; }
  command_exists nginx || { warn "Nginx is not installed."; return 0; }

  read -r -p "Let's Encrypt email (Enter=skip TLS): " email || true
  [[ -n "$email" ]] || { info "TLS stage skipped."; return 0; }

  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    --email "$email" \
    -d "$domain"
  ok "TLS configured for ${domain}."
}

build_bot() {
  [[ -f "$INSTALL_DIR/docker-compose.yml" ]] || { warn "Project files are missing; build skipped."; return 0; }
  command_exists docker || { warn "Docker is missing; build skipped."; return 0; }
  ensure_base_app_env
  ensure_compose_env
  cd "$INSTALL_DIR"
  docker compose config --quiet
  docker compose build
  ok "Container image built."
}

start_bot() {
  [[ -f "$INSTALL_DIR/docker-compose.yml" ]] || { warn "Project files are missing; start skipped."; return 0; }
  command_exists docker || { warn "Docker is missing; start skipped."; return 0; }
  ensure_base_app_env
  ensure_compose_env

  local token
  token="$(get_env BOT_TOKEN)"
  if [[ -z "$token" ]]; then
    warn "BOT_TOKEN is empty. The container will fail until Telegram configuration is completed."
    if ! ask_yes_no "Start anyway?" N; then return 0; fi
  fi

  cd "$INSTALL_DIR"
  docker compose up -d
  ok "Media Relay Bot started."
}

verify_installation() {
  command_exists docker || { warn "Docker is unavailable."; return 0; }
  [[ -f "$INSTALL_DIR/docker-compose.yml" ]] || { warn "Project files are missing."; return 0; }
  cd "$INSTALL_DIR"

  docker compose ps || true
  printf '\n'
  if curl -fsS --max-time 5 http://127.0.0.1:8080/health >/dev/null 2>&1; then
    ok "Local HTTP health check passed."
  else
    warn "Local HTTP health check did not pass. Check: docker compose logs --tail=100 bot"
  fi

  local token
  token="$(get_env BOT_TOKEN)"
  if [[ -n "$token" ]] && validate_bot_token "$token"; then
    ok "Telegram getMe check passed."
  else
    warn "Telegram token is missing or getMe validation failed."
  fi
}

summary() {
  section "Summary"
  say "Install directory : ${INSTALL_DIR}"
  say "Runtime data      : ${DATA_ROOT}"
  say "Application env   : ${APP_ENV}"
  say "Cookie directory  : ${DATA_ROOT}/cookies"
  say "Public base URL   : $(get_env PUBLIC_BASE_URL)"
  say ""
  say "Useful commands:"
  say "  cd ${INSTALL_DIR}"
  say "  docker compose ps"
  say "  docker compose logs -f --tail=100 bot"
  say "  docker compose restart bot"
  say ""
  say "Rerun this installer at any time. Every configuration/install stage can be skipped, so it can also be used only to import one cookie file or change one setting."
}

main() {
  require_root
  clear 2>/dev/null || true
  say "${C_BOLD}MPRO Media Relay Bot — interactive installer${C_RESET}"
  say "Repository: https://github.com/${REPO}"
  say "Stable ref: ${REPO_REF}"
  say ""
  say "${C_BOLD}Skip-first design:${C_RESET} every stage below asks before changing anything."
  say "You may rerun the installer later and execute only one stage—for example, import a single Instagram or X cookie file and skip everything else."

  section "0. Preflight (read-only)"
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    say "OS: ${PRETTY_NAME:-unknown}"
  fi
  say "Install directory: ${INSTALL_DIR}"
  say "Data directory: ${DATA_ROOT}"

  section "1. Base packages"
  if ask_run "Install/update basic packages (curl, jq, git, certificates)?"; then install_base_packages; else info "Skipped."; fi

  section "2. Docker"
  if ask_run "Install Docker Engine + Docker Compose if needed?"; then install_docker; else info "Skipped."; fi

  section "3. Project files"
  if ask_run "Download/update Media Relay Bot from GitHub stable branch?"; then download_project; else info "Skipped."; fi

  section "4. Runtime directories"
  if ask_run "Create/repair runtime directories and base config?"; then create_runtime_dirs; else info "Skipped."; fi

  # Configuration stages initialize their own files only when selected.

  section "5. Telegram"
  if ask_run "Configure Telegram token and access IDs?"; then configure_telegram; else info "Skipped."; fi

  section "6. Telegram ID helper"
  if ask_run "Show recent Telegram chat/user IDs from getUpdates?"; then show_telegram_ids; else info "Skipped."; fi

  section "7. Runtime settings"
  if ask_run "Configure TTL, concurrency, size limit, or source host allowlist?"; then configure_runtime_settings; else info "Skipped."; fi

  section "8. Domain"
  if ask_run "Configure the public download domain / PUBLIC_BASE_URL?"; then configure_domain; else info "Skipped."; fi

  section "9. DNS check"
  if ask_run "Check whether the configured domain points to this server?"; then check_dns; else info "Skipped."; fi

  section "10. Cookie files"
  if ask_run "Import or update platform cookie .txt files?"; then configure_cookies; else info "Skipped."; fi

  section "11. Reddit OAuth"
  if ask_run "Configure optional Reddit OAuth values?"; then configure_reddit_oauth; else info "Skipped."; fi

  section "12. Nginx package"
  if ask_run "Install Nginx if needed?"; then install_nginx_packages; else info "Skipped."; fi

  section "13. Nginx site"
  if ask_run "Create/update the Media Relay Nginx virtual host?"; then configure_nginx || true; else info "Skipped."; fi

  section "14. Certbot"
  if ask_run "Install Certbot + Nginx plugin if needed?"; then install_certbot_packages; else info "Skipped."; fi

  section "15. HTTPS"
  if ask_run "Request/configure a Let's Encrypt certificate?"; then configure_tls || true; else info "Skipped."; fi

  section "16. Build"
  if ask_run "Validate Compose and build the bot image?"; then build_bot; else info "Skipped."; fi

  section "17. Start / update container"
  if ask_run "Start or recreate the bot container?"; then start_bot; else info "Skipped."; fi

  section "18. Verification"
  if ask_run "Run local health and Telegram connectivity checks?"; then verify_installation; else info "Skipped."; fi

  summary
}

main "$@"
