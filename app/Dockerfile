FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        python3 \
        python3-venv \
        zip \
    && python3 -m venv /opt/media-tools \
    && /opt/media-tools/bin/python -m pip install --no-cache-dir --upgrade pip \
    && /opt/media-tools/bin/python -m pip install --no-cache-dir --pre "yt-dlp[default,curl-cffi]" \
    && /opt/media-tools/bin/python -m pip install --no-cache-dir "gallery-dl==1.32.7" \
    && ln -s /opt/media-tools/bin/yt-dlp /usr/local/bin/yt-dlp \
    && ln -s /opt/media-tools/bin/gallery-dl /usr/local/bin/gallery-dl \
    && yt-dlp --version \
    && gallery-dl --version \
    && ffmpeg -version | head -n 1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=996:996 package.json ./
COPY --chown=996:996 src ./src

ENV HOME=/tmp
ENV PATH="/opt/media-tools/bin:${PATH}"

USER 996:996
CMD ["node", "src/index.mjs"]
