import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";

const DOWNLOAD_DIR =
  process.env.DOWNLOAD_DIR || "/data/downloads";

const DATA_DIR =
  process.env.DATA_DIR || "/data/data";

const DOWNLOAD_TTL_HOURS = Number(
  process.env.DOWNLOAD_TTL_HOURS || "24",
);

const DOWNLOAD_HTTP_PORT = Number(
  process.env.DOWNLOAD_HTTP_PORT || "8080",
);

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL
    ?.trim()
    .replace(/\/+$/u, "") || "";

const DATABASE_FILE = path.join(
  DATA_DIR,
  "downloads.json",
);

const DOWNLOAD_ROOT = path.resolve(DOWNLOAD_DIR);
const records = new Map();

let logEvent = () => {};
let mutationQueue = Promise.resolve();
let cleanupTimer = null;
let httpServer = null;

function runSerialized(task) {
  const operation = mutationQueue.then(task, task);
  mutationQueue = operation.catch(() => {});
  return operation;
}

function isSafeDownloadPath(filePath) {
  const resolvedPath = path.resolve(filePath);

  return resolvedPath.startsWith(
    `${DOWNLOAD_ROOT}${path.sep}`,
  );
}

function publicUrlForToken(token) {
  return PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/d/${token}`
    : null;
}

function mediaUrlForToken(token) {
  return PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/m/${token}`
    : null;
}

function previewUrlForToken(token) {
  return PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/p/${token}`
    : null;
}

function contentTypeForFile(fileName, explicitType = "") {
  if (explicitType) {
    return explicitType;
  }

  const extension = path.extname(fileName).toLowerCase();

  const types = {
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".zip": "application/zip",
  };

  return types[extension] || "application/octet-stream";
}

function escapeHeaderFilename(fileName) {
  return fileName
    .replace(/[^\x20-\x7E]/gu, "_")
    .replace(/["\\]/gu, "_");
}

function contentDisposition(record, inline) {
  const fallbackName = escapeHeaderFilename(
    record.fileName,
  );

  const mode = inline ? "inline" : "attachment";

  return (
    `${mode}; filename="${fallbackName}"; ` +
    `filename*=UTF-8''${encodeURIComponent(record.fileName)}`
  );
}

function parseRange(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(
    rangeHeader.trim(),
  );

  if (!match) {
    return { invalid: true };
  }

  let start;
  let end;

  if (match[1] === "") {
    const suffixLength = Number(match[2]);

    if (
      !Number.isInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return { invalid: true };
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end =
      match[2] === ""
        ? fileSize - 1
        : Number(match[2]);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
    invalid: false,
  };
}

function htmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function persistRecordsUnlocked() {
  await mkdir(DATA_DIR, {
    recursive: true,
  });

  const temporaryFile =
    `${DATABASE_FILE}.tmp-${process.pid}`;

  const payload = JSON.stringify(
    [...records.values()],
    null,
    2,
  );

  await writeFile(
    temporaryFile,
    `${payload}\n`,
    { mode: 0o600 },
  );

  await rename(temporaryFile, DATABASE_FILE);
}

async function loadRecords() {
  await mkdir(DATA_DIR, {
    recursive: true,
  });

  try {
    const raw = await readFile(
      DATABASE_FILE,
      "utf8",
    );

    const storedRecords = JSON.parse(raw);

    if (!Array.isArray(storedRecords)) {
      throw new Error(
        "Download database must contain an array.",
      );
    }

    for (const record of storedRecords) {
      if (
        typeof record?.token !== "string" ||
        typeof record?.filePath !== "string" ||
        typeof record?.fileName !== "string" ||
        !Number.isFinite(record?.expiresAt) ||
        !isSafeDownloadPath(record.filePath)
      ) {
        continue;
      }

      records.set(record.token, {
        persistent: false,
        keptAt: null,
        keptBy: null,
        mimeType: "",
        previewKind: "file",
        title: "",
        ...record,
      });
    }

    logEvent("download_database_loaded", {
      record_count: records.size,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      await persistRecordsUnlocked();
      logEvent("download_database_created");
      return;
    }

    throw error;
  }
}

async function removeRecordFiles(record) {
  if (!isSafeDownloadPath(record.filePath)) {
    return;
  }

  const relative = path.relative(
    DOWNLOAD_ROOT,
    record.filePath,
  );

  const firstSegment = relative.split(path.sep)[0];

  if (!firstSegment || firstSegment.startsWith("..")) {
    return;
  }

  await rm(
    path.join(DOWNLOAD_ROOT, firstSegment),
    {
      recursive: true,
      force: true,
    },
  );
}

async function expireToken(token) {
  return runSerialized(async () => {
    const record = records.get(token);

    if (!record) {
      return false;
    }

    records.delete(token);
    await removeRecordFiles(record);
    await persistRecordsUnlocked();

    logEvent("download_expired", {
      file_name: record.fileName,
      file_size: record.fileSize,
    });

    return true;
  });
}

export async function cleanupExpiredDownloads() {
  return runSerialized(async () => {
    const now = Date.now();
    const expiredRecords = [];

    for (const [token, record] of records.entries()) {
      if (
        !record.persistent &&
        record.expiresAt <= now
      ) {
        records.delete(token);
        expiredRecords.push(record);
      }
    }

    for (const record of expiredRecords) {
      await removeRecordFiles(record);
    }

    if (expiredRecords.length > 0) {
      await persistRecordsUnlocked();

      logEvent("expired_downloads_cleaned", {
        deleted_count: expiredRecords.length,
      });
    }

    return expiredRecords.length;
  });
}

export async function keepDownload(token, userId) {
  return runSerialized(async () => {
    const record = records.get(token);

    if (!record) {
      return {
        ok: false,
        reason: "not_found",
      };
    }

    if (
      !record.persistent &&
      record.expiresAt <= Date.now()
    ) {
      records.delete(token);
      await removeRecordFiles(record);
      await persistRecordsUnlocked();

      return {
        ok: false,
        reason: "expired",
      };
    }

    if (record.persistent) {
      return {
        ok: true,
        alreadyPersistent: true,
        record,
      };
    }

    record.persistent = true;
    record.keptAt = Date.now();
    record.keptBy = userId;

    records.set(token, record);
    await persistRecordsUnlocked();

    logEvent("download_marked_persistent", {
      file_name: record.fileName,
      kept_by: userId,
    });

    return {
      ok: true,
      alreadyPersistent: false,
      record,
    };
  });
}

export async function registerDownload({
  filePath,
  fileName,
  fileSize,
  mimeType = "",
  previewKind = "file",
  title = "",
}) {
  if (!isSafeDownloadPath(filePath)) {
    throw new Error(
      "The downloaded file is outside DOWNLOAD_DIR.",
    );
  }

  const fileInformation = await stat(filePath);

  if (!fileInformation.isFile()) {
    throw new Error(
      "The downloaded path is not a regular file.",
    );
  }

  return runSerialized(async () => {
    const createdAt = Date.now();
    const expiresAt =
      createdAt +
      DOWNLOAD_TTL_HOURS * 60 * 60 * 1000;

    const token = randomBytes(32)
      .toString("base64url");

    const record = {
      token,
      filePath: path.resolve(filePath),
      fileName,
      fileSize,
      mimeType,
      previewKind,
      title,
      createdAt,
      expiresAt,
      persistent: false,
      keptAt: null,
      keptBy: null,
    };

    records.set(token, record);
    await persistRecordsUnlocked();

    logEvent("download_registered", {
      file_name: fileName,
      file_size: fileSize,
      preview_kind: previewKind,
      expires_at:
        new Date(expiresAt).toISOString(),
    });

    return {
      token,
      expiresAt,
      downloadUrl: publicUrlForToken(token),
      mediaUrl:
        previewKind === "file"
          ? null
          : mediaUrlForToken(token),
      previewUrl:
        previewKind === "file"
          ? null
          : previewUrlForToken(token),
    };
  });
}

async function getAvailableRecord(token) {
  const record = records.get(token);

  if (!record) {
    return { status: "not_found" };
  }

  if (
    !record.persistent &&
    record.expiresAt <= Date.now()
  ) {
    await expireToken(token);
    return { status: "expired" };
  }

  try {
    const fileInformation = await stat(
      record.filePath,
    );

    if (!fileInformation.isFile()) {
      throw new Error("Not a file");
    }

    return {
      status: "ok",
      record,
      fileInformation,
    };
  } catch {
    await expireToken(token);
    return { status: "expired" };
  }
}

async function serveFile(
  request,
  response,
  token,
  { inline = false } = {},
) {
  const available = await getAvailableRecord(token);

  if (available.status === "not_found") {
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store",
    });
    response.end("Download not found.");
    return;
  }

  if (available.status !== "ok") {
    response.writeHead(410, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store",
    });
    response.end("This download has expired.");
    return;
  }

  const { record, fileInformation } = available;
  const fileSize = fileInformation.size;
  const range = parseRange(
    request.headers.range,
    fileSize,
  );

  if (range?.invalid) {
    response.writeHead(416, {
      "content-range": `bytes */${fileSize}`,
      "accept-ranges": "bytes",
    });
    response.end();
    return;
  }

  const baseHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-type": contentTypeForFile(
      record.fileName,
      record.mimeType,
    ),
    "content-disposition": contentDisposition(
      record,
      inline,
    ),
    "x-content-type-options": "nosniff",
  };

  let streamOptions;

  if (range) {
    const responseLength =
      range.end - range.start + 1;

    streamOptions = {
      start: range.start,
      end: range.end,
    };

    response.writeHead(206, {
      ...baseHeaders,
      "content-length": responseLength,
      "content-range":
        `bytes ${range.start}-${range.end}/${fileSize}`,
    });
  } else {
    response.writeHead(200, {
      ...baseHeaders,
      "content-length": fileSize,
    });
  }

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(
    record.filePath,
    streamOptions,
  );

  stream.on("error", (error) => {
    logEvent("download_stream_failed", {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });

    response.destroy(error);
  });

  stream.pipe(response);
}

async function servePreview(
  request,
  response,
  token,
) {
  const available = await getAvailableRecord(token);

  if (available.status !== "ok") {
    response.writeHead(
      available.status === "not_found" ? 404 : 410,
      {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "private, no-store",
      },
    );

    response.end(
      available.status === "not_found"
        ? "Preview not found."
        : "Preview expired.",
    );
    return;
  }

  const { record } = available;
  const mediaUrl = mediaUrlForToken(token);
  const previewUrl = previewUrlForToken(token);
  const title = htmlEscape(
    record.title || record.fileName,
  );
  const mime = htmlEscape(
    contentTypeForFile(
      record.fileName,
      record.mimeType,
    ),
  );
  const escapedMediaUrl = htmlEscape(mediaUrl);
  const escapedPreviewUrl = htmlEscape(previewUrl);

  let mediaMeta = "";

  if (record.previewKind === "video") {
    mediaMeta = [
      '<meta property="og:type" content="video.other">',
      `<meta property="og:video" content="${escapedMediaUrl}">`,
      `<meta property="og:video:secure_url" content="${escapedMediaUrl}">`,
      `<meta property="og:video:type" content="${mime}">`,
      '<meta name="twitter:card" content="player">',
      `<meta name="twitter:player" content="${escapedMediaUrl}">`,
    ].join("\n");
  } else if (record.previewKind === "image") {
    mediaMeta = [
      '<meta property="og:type" content="article">',
      `<meta property="og:image" content="${escapedMediaUrl}">`,
      `<meta property="og:image:secure_url" content="${escapedMediaUrl}">`,
      `<meta property="og:image:type" content="${mime}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:image" content="${escapedMediaUrl}">`,
    ].join("\n");
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${escapedPreviewUrl}">
<meta name="twitter:title" content="${title}">
${mediaMeta}
<title>${title}</title>
</head>
<body>
<p><a href="${htmlEscape(publicUrlForToken(token))}">Download media</a></p>
</body>
</html>`;

  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  response.end(html);
}

function startHttpServer() {
  httpServer = createServer(
    async (request, response) => {
      try {
        const requestUrl = new URL(
          request.url || "/",
          `http://${request.headers.host || "localhost"}`,
        );

        if (requestUrl.pathname === "/health") {
          response.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store",
          });

          response.end(
            JSON.stringify({
              ok: true,
              downloads: records.size,
              ttlHours: DOWNLOAD_TTL_HOURS,
            }),
          );
          return;
        }

        if (
          request.method !== "GET" &&
          request.method !== "HEAD"
        ) {
          response.writeHead(405, {
            allow: "GET, HEAD",
          });
          response.end();
          return;
        }

        const match =
          /^\/(d|m|p)\/([A-Za-z0-9_-]{20,})$/u.exec(
            requestUrl.pathname,
          );

        if (!match) {
          response.writeHead(404, {
            "content-type": "text/plain; charset=utf-8",
          });
          response.end("Not found.");
          return;
        }

        const [, route, token] = match;

        if (route === "p") {
          await servePreview(
            request,
            response,
            token,
          );
          return;
        }

        await serveFile(
          request,
          response,
          token,
          { inline: route === "m" },
        );
      } catch (error) {
        logEvent("download_http_failed", {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });

        if (!response.headersSent) {
          response.writeHead(500, {
            "content-type": "text/plain; charset=utf-8",
          });
        }

        response.end("Internal server error.");
      }
    },
  );

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);

    httpServer.listen(
      DOWNLOAD_HTTP_PORT,
      "0.0.0.0",
      () => {
        httpServer.off("error", reject);

        logEvent("download_http_started", {
          port: DOWNLOAD_HTTP_PORT,
          public_base_url:
            PUBLIC_BASE_URL || null,
        });

        resolve();
      },
    );
  });
}

export async function initializeDownloadStore({
  log,
}) {
  logEvent =
    typeof log === "function"
      ? log
      : () => {};

  if (
    !Number.isFinite(DOWNLOAD_TTL_HOURS) ||
    DOWNLOAD_TTL_HOURS <= 0
  ) {
    throw new Error(
      "DOWNLOAD_TTL_HOURS must be greater than zero.",
    );
  }

  if (
    !Number.isInteger(DOWNLOAD_HTTP_PORT) ||
    DOWNLOAD_HTTP_PORT < 1 ||
    DOWNLOAD_HTTP_PORT > 65535
  ) {
    throw new Error(
      "DOWNLOAD_HTTP_PORT is invalid.",
    );
  }

  await loadRecords();
  await cleanupExpiredDownloads();
  await startHttpServer();

  cleanupTimer = setInterval(
    () => {
      cleanupExpiredDownloads()
        .catch((error) => {
          logEvent("download_cleanup_failed", {
            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        });
    },
    60 * 1000,
  );

  cleanupTimer.unref();
}
