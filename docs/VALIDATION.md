# Clean-clone validation

The repository intentionally does not contain a real `.env` file. Production secrets must never be copied into a public checkout just to validate Docker Compose.

Validate a fresh clone by pointing Compose at the placeholder environment template:

```bash
MEDIA_RELAY_ENV_FILE=./.env.example docker compose config --quiet
```

JavaScript syntax can be checked without installing Node.js on the host:

```bash
docker run --rm \
  -v "$PWD/app/src:/check:ro" \
  node:24-bookworm-slim \
  sh -lc '
    node --check /check/index.mjs &&
    node --check /check/media-downloader.mjs &&
    node --check /check/download-store.mjs &&
    node --check /check/linkedin-fallback.mjs
  '
```

For production, keep the real `.env`, cookies, runtime downloads, and runtime database outside the public source checkout. The default Compose file still uses `./.env` when `MEDIA_RELAY_ENV_FILE` is not set.
