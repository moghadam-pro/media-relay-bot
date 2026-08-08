import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  downloadLinkedInPublicImages,
} from "./linkedin-fallback.mjs";

const MAX_FILE_SIZE_MB = Number(
  process.env.MAX_FILE_SIZE_MB || "2000",
);

const YOUTUBE_COOKIE_FILE =
  process.env.YOUTUBE_COOKIE_FILE?.trim() || "";

const INSTAGRAM_COOKIE_FILE =
  process.env.INSTAGRAM_COOKIE_FILE?.trim() || "";

const REDDIT_REFRESH_TOKEN =
  process.env.REDDIT_REFRESH_TOKEN?.trim() || "";

const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
  ".mov",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".mp3",
  ".m4a",
  ".opus",
  ".wav",
]);

const GALLERY_PREFERRED_HOSTS = new Set([
  "instagram.com",
  "instagr.am",
  "x.com",
  "twitter.com",
  "reddit.com",
  "redd.it",
  "pinterest.com",
  "pin.it",
  "bsky.app",
  "threads.net",
  "threads.com",
]);

function normaliseError(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

function normalisedHostname(rawUrl) {
  try {
    return new URL(rawUrl)
      .hostname
      .toLowerCase()
      .replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function hostnameMatches(hostname, candidate) {
  return (
    hostname === candidate ||
    hostname.endsWith(`.${candidate}`)
  );
}

function isLinkedIn(rawUrl) {
  return hostnameMatches(
    normalisedHostname(rawUrl),
    "linkedin.com",
  );
}

function isInstagram(rawUrl) {
  const hostname = normalisedHostname(rawUrl);
  return (
    hostnameMatches(hostname, "instagram.com") ||
    hostname === "instagr.am"
  );
}

function isReddit(rawUrl) {
  const hostname = normalisedHostname(rawUrl);
  return (
    hostnameMatches(hostname, "reddit.com") ||
    hostname === "redd.it"
  );
}

function isGalleryPreferred(rawUrl) {
  const hostname = normalisedHostname(rawUrl);

  for (const candidate of GALLERY_PREFERRED_HOSTS) {
    if (hostnameMatches(hostname, candidate)) {
      return true;
    }
  }

  return false;
}

function shouldAllowPostPlaylist(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hostname = normalisedHostname(rawUrl);
    const pathname = url.pathname.toLowerCase();

    if (
      hostnameMatches(hostname, "instagram.com") ||
      hostname === "instagr.am"
    ) {
      return (
        pathname.startsWith("/p/") ||
        pathname.startsWith("/reel/") ||
        pathname.startsWith("/reels/")
      );
    }

    if (
      hostnameMatches(hostname, "reddit.com") ||
      hostname === "redd.it"
    ) {
      return pathname.includes("/comments/");
    }

    if (hostnameMatches(hostname, "linkedin.com")) {
      return (
        pathname.includes("/posts/") ||
        pathname.includes("/feed/update/")
      );
    }

    if (hostnameMatches(hostname, "tiktok.com")) {
      return pathname.includes("/photo/");
    }
  } catch {
    return false;
  }

  return false;
}

function cookieSourceForUrl(rawUrl) {
  const hostname = normalisedHostname(rawUrl);

  const isYouTube =
    hostnameMatches(hostname, "youtube.com") ||
    hostname === "youtu.be";

  if (isYouTube && YOUTUBE_COOKIE_FILE) {
    return YOUTUBE_COOKIE_FILE;
  }

  if (isInstagram(rawUrl) && INSTAGRAM_COOKIE_FILE) {
    return INSTAGRAM_COOKIE_FILE;
  }

  return null;
}

async function copyCookieForJob(url, tempDir) {
  const source = cookieSourceForUrl(url);

  if (!source) {
    return null;
  }

  try {
    const destination = path.join(
      tempDir,
      "cookies.txt",
    );

    await copyFile(source, destination);
    await chmod(destination, 0o600);
    return destination;
  } catch {
    return null;
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function walkFiles(directory) {
  const files = [];
  let entries;

  try {
    entries = await readdir(
      directory,
      { withFileTypes: true },
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(
      directory,
      entry.name,
    );

    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function isMediaFile(filePath) {
  return MEDIA_EXTENSIONS.has(
    path.extname(filePath).toLowerCase(),
  );
}

async function collectMediaFiles(outputDir) {
  return (await walkFiles(outputDir))
    .filter(isMediaFile);
}

function firstUsefulEntry(info) {
  if (!Array.isArray(info?.entries)) {
    return null;
  }

  return info.entries.find(
    (entry) => entry && typeof entry === "object",
  ) || null;
}

function metadataFromInfo(info, sourceUrl) {
  if (!info || typeof info !== "object") {
    return null;
  }

  const firstEntry = firstUsefulEntry(info);

  return {
    title:
      info.title ||
      info.fulltitle ||
      firstEntry?.title ||
      firstEntry?.fulltitle ||
      "",
    description:
      info.description ||
      info.comment ||
      firstEntry?.description ||
      firstEntry?.comment ||
      "",
    uploader:
      info.creator ||
      info.uploader ||
      info.channel ||
      info.artist ||
      firstEntry?.creator ||
      firstEntry?.uploader ||
      firstEntry?.channel ||
      "",
    extractor:
      info.extractor_key ||
      info.extractor ||
      firstEntry?.extractor_key ||
      firstEntry?.extractor ||
      "",
    webpage_url:
      info.webpage_url ||
      info.original_url ||
      firstEntry?.webpage_url ||
      firstEntry?.original_url ||
      sourceUrl,
  };
}

function ytDlpPlaylistArgs(url) {
  if (shouldAllowPostPlaylist(url)) {
    return [
      "--yes-playlist",
      "--playlist-end",
      "20",
    ];
  }

  return ["--no-playlist"];
}

async function extractMetadata({
  url,
  cookieFile,
}) {
  const args = [
    ...ytDlpPlaylistArgs(url),
    "--skip-download",
    "--ignore-no-formats-error",
    "--js-runtimes",
    "node",
    "--no-warnings",
    "--dump-single-json",
  ];

  if (cookieFile) {
    args.push("--cookies", cookieFile);
  }

  args.push(url);

  const result = await runProcess(
    "yt-dlp",
    args,
  );

  if (result.code !== 0 || !result.stdout.trim()) {
    return null;
  }

  try {
    return metadataFromInfo(
      JSON.parse(result.stdout),
      url,
    );
  } catch {
    return null;
  }
}

async function runYtDlp({
  url,
  outputDir,
  tempDir,
  cookieFile,
}) {
  const outputTemplate = path.join(
    outputDir,
    "%(title).120B-%(id)s.%(ext)s",
  );

  const args = [
    ...ytDlpPlaylistArgs(url),
    "--no-cache-dir",
    "--js-runtimes",
    "node",
    "--newline",
    "--restrict-filenames",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--max-filesize",
    `${MAX_FILE_SIZE_MB}M`,
    "--format",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "--write-info-json",
    "--sleep-requests",
    "1",
    "--sleep-interval",
    "2",
    "--max-sleep-interval",
    "5",
    "--paths",
    `temp:${tempDir}`,
    "--output",
    outputTemplate,
  ];

  if (cookieFile) {
    args.push("--cookies", cookieFile);
  }

  args.push(url);

  return runProcess("yt-dlp", args);
}

async function runGalleryDl({
  url,
  outputDir,
  cookieFile,
}) {
  const galleryDir = path.join(
    outputDir,
    "gallery",
  );

  await mkdir(galleryDir, {
    recursive: true,
  });

  const args = [
    "--config-ignore",
    "--dest",
    galleryDir,
    "--no-mtime",
    "--filesize-max",
    `${MAX_FILE_SIZE_MB}M`,
  ];

  if (isInstagram(url)) {
    args.push(
      "-o",
      "extractor.instagram.previews=true",
      "-o",
      "extractor.instagram.videos=true",
    );
  }

  if (isReddit(url)) {
    args.push(
      "-o",
      "extractor.reddit.previews=true",
    );

    if (REDDIT_REFRESH_TOKEN) {
      args.push(
        "-o",
        `extractor.reddit.refresh-token=${REDDIT_REFRESH_TOKEN}`,
      );
    }
  }

  if (cookieFile) {
    args.push("--cookies", cookieFile);
  }

  args.push(url);

  return runProcess("gallery-dl", args);
}

function classifyMime(filePath) {
  const extension = path.extname(filePath)
    .toLowerCase();

  const map = {
    ".mp4": ["video/mp4", "video"],
    ".m4v": ["video/x-m4v", "video"],
    ".webm": ["video/webm", "video"],
    ".mkv": ["video/x-matroska", "video"],
    ".mov": ["video/quicktime", "video"],
    ".jpg": ["image/jpeg", "image"],
    ".jpeg": ["image/jpeg", "image"],
    ".png": ["image/png", "image"],
    ".webp": ["image/webp", "image"],
    ".gif": ["image/gif", "image"],
    ".mp3": ["audio/mpeg", "file"],
    ".m4a": ["audio/mp4", "file"],
    ".opus": ["audio/opus", "file"],
    ".wav": ["audio/wav", "file"],
  };

  return map[extension] || [
    "application/octet-stream",
    "file",
  ];
}

async function removeInfoJsonFiles(outputDir) {
  const files = await walkFiles(outputDir);

  for (const filePath of files) {
    if (filePath.endsWith(".info.json")) {
      await rm(filePath, { force: true });
    }
  }
}

async function findInfoMetadata(outputDir, sourceUrl) {
  const files = await walkFiles(outputDir);
  const infoFile = files.find(
    (filePath) => filePath.endsWith(".info.json"),
  );

  if (!infoFile) {
    return null;
  }

  try {
    const info = JSON.parse(
      await readFile(infoFile, "utf8"),
    );

    return metadataFromInfo(info, sourceUrl);
  } catch {
    return null;
  }
}

async function totalSize(files) {
  let size = 0;

  for (const filePath of files) {
    size += (await stat(filePath)).size;
  }

  return size;
}

function safeArchiveName(metadata) {
  const raw = metadata?.title || "media-bundle";

  const safe = raw
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .replace(/\s+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);

  return `${safe || "media-bundle"}.zip`;
}

function safeFilePart(value) {
  const safe = String(value || "media")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .replace(/\s+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 100);

  return safe || "media";
}

function fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function dedupeFiles(files) {
  const seen = new Set();
  const unique = [];

  for (const filePath of files) {
    const fileStat = await stat(filePath);
    const digest = await fileHash(filePath);
    const key = `${fileStat.size}:${digest}`;

    if (seen.has(key)) {
      await rm(filePath, { force: true });
      continue;
    }

    seen.add(key);
    unique.push(filePath);
  }

  return unique;
}

async function removeEmptyDirectories(directory, keepRoot = true) {
  let entries;

  try {
    entries = await readdir(
      directory,
      { withFileTypes: true },
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    await removeEmptyDirectories(
      path.join(directory, entry.name),
      false,
    );
  }

  const remaining = await readdir(directory);

  if (!keepRoot && remaining.length === 0) {
    await rm(directory, { recursive: true, force: true });
    return true;
  }

  return remaining.length === 0;
}

async function createArchive({
  outputDir,
  tempDir,
  files,
  metadata,
}) {
  const stagingDir = path.join(
    tempDir,
    "bundle",
  );

  await mkdir(stagingDir, {
    recursive: true,
  });

  for (let index = 0; index < files.length; index += 1) {
    const source = files[index];
    const extension = path.extname(source).toLowerCase();
    const base = safeFilePart(
      path.basename(source, extension),
    );
    const destination = path.join(
      stagingDir,
      `${String(index + 1).padStart(2, "0")}-${base}${extension}`,
    );

    await copyFile(source, destination);
  }

  const description = String(
    metadata?.description || "",
  ).trim();

  const sourceUrl = String(
    metadata?.webpage_url || "",
  ).trim();

  if (description || sourceUrl) {
    const captionParts = [];

    if (description) {
      captionParts.push(description);
    }

    if (sourceUrl) {
      captionParts.push(
        `Original URL: ${sourceUrl}`,
      );
    }

    await writeFile(
      path.join(stagingDir, "caption.txt"),
      `${captionParts.join("\n\n")}\n`,
      { mode: 0o600 },
    );
  }

  const archiveName = safeArchiveName(metadata);
  const archivePath = path.join(
    outputDir,
    archiveName,
  );

  const result = await runProcess(
    "zip",
    [
      "-q",
      "-r",
      archivePath,
      ".",
    ],
    { cwd: stagingDir },
  );

  if (result.code !== 0) {
    throw new Error(
      `zip failed: ${result.stderr.trim() || "unknown error"}`,
    );
  }

  return archivePath;
}

async function removeSourceMedia(files) {
  for (const filePath of files) {
    await rm(filePath, { force: true });
  }
}

async function promoteSingleArtifact(
  filePath,
  outputDir,
) {
  if (path.dirname(filePath) === outputDir) {
    return filePath;
  }

  const destination = path.join(
    outputDir,
    path.basename(filePath),
  );

  try {
    await rename(filePath, destination);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }

    await copyFile(filePath, destination);
    await rm(filePath, { force: true });
  }

  return destination;
}

export function classifyDownloadError(errorText) {
  const text = String(errorText || "").toLowerCase();

  if (
    text.includes("sign in to confirm") ||
    text.includes("login required") ||
    text.includes("authentication") ||
    text.includes("account authentication is required") ||
    text.includes("refresh-token")
  ) {
    return "authentication_required";
  }

  if (
    text.includes("unable to extract") ||
    text.includes("no suitable extractor") ||
    text.includes("unsupported url")
  ) {
    return "extractor_unsupported";
  }

  if (
    text.includes("no video formats") ||
    text.includes("requested format is not available")
  ) {
    return "no_video_format";
  }

  if (
    text.includes("403") ||
    text.includes("forbidden") ||
    text.includes("429") ||
    text.includes("too many requests")
  ) {
    return "access_blocked";
  }

  return "download_failed";
}

async function runEngine({
  engine,
  url,
  outputDir,
  tempDir,
  cookieFile,
  attempts,
}) {
  const result = engine === "gallery-dl"
    ? await runGalleryDl({
        url,
        outputDir,
        cookieFile,
      })
    : await runYtDlp({
        url,
        outputDir,
        tempDir,
        cookieFile,
      });

  attempts.push({
    engine,
    code: result.code,
    error: result.stderr.trim(),
  });

  return result;
}

export async function downloadMedia({
  url,
  jobId,
  downloadRoot,
  tempRoot,
  log = () => {},
}) {
  const outputDir = path.join(
    downloadRoot,
    jobId,
  );

  const tempDir = path.join(
    tempRoot,
    jobId,
  );

  await mkdir(outputDir, {
    recursive: true,
  });

  await mkdir(tempDir, {
    recursive: true,
  });

  try {
    const cookieFile = await copyCookieForJob(
      url,
      tempDir,
    );

    let preferredEngine = "yt-dlp";

    if (isLinkedIn(url)) {
      preferredEngine = "yt-dlp+linkedin-fallback";
    } else if (isGalleryPreferred(url)) {
      preferredEngine = "gallery-dl";
    }

    log("download_configuration", {
      job_id: jobId,
      source_host: normalisedHostname(url),
      cookie_enabled: Boolean(cookieFile),
      reddit_authenticated: Boolean(REDDIT_REFRESH_TOKEN),
      preferred_engine: preferredEngine,
      playlist_enabled: shouldAllowPostPlaylist(url),
    });

    let metadata = await extractMetadata({
      url,
      cookieFile,
    });

    const attempts = [];

    if (isLinkedIn(url)) {
      await runEngine({
        engine: "yt-dlp",
        url,
        outputDir,
        tempDir,
        cookieFile,
        attempts,
      });

      let linkedInFiles = await collectMediaFiles(
        outputDir,
      );

      if (linkedInFiles.length === 0) {
        try {
          const linkedInResult =
            await downloadLinkedInPublicImages({
              url,
              outputDir,
              log,
            });

          attempts.push({
            engine: "linkedin-public-html",
            code:
              linkedInResult.files.length > 0
                ? 0
                : 1,
            error:
              linkedInResult.files.length > 0
                ? ""
                : "No high-confidence public post images discovered",
          });

          if (!metadata && linkedInResult.metadata) {
            metadata = linkedInResult.metadata;
          }
        } catch (error) {
          attempts.push({
            engine: "linkedin-public-html",
            code: 1,
            error: normaliseError(error),
          });
        }
      }
    } else if (isGalleryPreferred(url)) {
      await runEngine({
        engine: "gallery-dl",
        url,
        outputDir,
        tempDir,
        cookieFile,
        attempts,
      });

      let currentFiles = await collectMediaFiles(
        outputDir,
      );

      if (currentFiles.length <= 1) {
        await runEngine({
          engine: "yt-dlp",
          url,
          outputDir,
          tempDir,
          cookieFile,
          attempts,
        });
      }
    } else {
      await runEngine({
        engine: "yt-dlp",
        url,
        outputDir,
        tempDir,
        cookieFile,
        attempts,
      });

      const currentFiles = await collectMediaFiles(
        outputDir,
      );

      if (currentFiles.length === 0) {
        await runEngine({
          engine: "gallery-dl",
          url,
          outputDir,
          tempDir,
          cookieFile,
          attempts,
        });
      }
    }

    if (!metadata) {
      metadata = await findInfoMetadata(
        outputDir,
        url,
      );
    }

    await removeInfoJsonFiles(outputDir);

    let files = await collectMediaFiles(outputDir);
    files = await dedupeFiles(files);

    await removeEmptyDirectories(outputDir, true);

    if (files.length === 0) {
      const combinedError = attempts
        .map((attempt) =>
          `${attempt.engine}: ${attempt.error || `exit ${attempt.code}`}`,
        )
        .join(" | ");

      const error = new Error(
        combinedError || "No downloadable media found.",
      );

      error.code = classifyDownloadError(combinedError);
      error.attempts = attempts;

      await rm(outputDir, {
        recursive: true,
        force: true,
      });

      throw error;
    }

    const aggregateSize = await totalSize(files);
    const maxBytes =
      MAX_FILE_SIZE_MB * 1024 * 1024;

    if (aggregateSize > maxBytes) {
      await rm(outputDir, {
        recursive: true,
        force: true,
      });

      const error = new Error(
        `Media bundle exceeds ${MAX_FILE_SIZE_MB} MB.`,
      );
      error.code = "size_limit";
      throw error;
    }

    const mediaCount = files.length;
    let artifactPath;
    let previewKind = "file";
    let mimeType = "application/octet-stream";
    let isArchive = false;

    if (files.length > 1) {
      artifactPath = await createArchive({
        outputDir,
        tempDir,
        files,
        metadata,
      });

      previewKind = "file";
      mimeType = "application/zip";
      isArchive = true;

      await removeSourceMedia(files);
      await removeEmptyDirectories(outputDir, true);
    } else {
      artifactPath = await promoteSingleArtifact(
        files[0],
        outputDir,
      );

      [mimeType, previewKind] = classifyMime(
        artifactPath,
      );

      await removeEmptyDirectories(outputDir, true);
    }

    const artifactStat = await stat(artifactPath);

    log("media_collected", {
      job_id: jobId,
      media_count: mediaCount,
      archive: isArchive,
      artifact_name: path.basename(artifactPath),
    });

    return {
      artifactPath,
      artifactName: path.basename(artifactPath),
      artifactSize: artifactStat.size,
      mimeType,
      previewKind,
      isArchive,
      mediaCount,
      metadata: metadata || {
        title: "",
        description: "",
        uploader: "",
        extractor: "",
        webpage_url: url,
      },
      attempts,
    };
  } finally {
    await rm(tempDir, {
      recursive: true,
      force: true,
    });
  }
}
