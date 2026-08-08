import { createWriteStream } from "node:fs";
import {
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const LINKEDIN_PAGE_HOSTS = ["linkedin.com"];
const LINKEDIN_MEDIA_HOST_SUFFIXES = [
  "licdn.com",
  "licdn-ei.com",
];

function hostnameMatches(hostname, suffix) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^www\./u, "");

  return host === suffix || host.endsWith(`.${suffix}`);
}

function isLinkedInPageHost(hostname) {
  return LINKEDIN_PAGE_HOSTS.some((host) =>
    hostnameMatches(hostname, host),
  );
}

function isLinkedInMediaHost(hostname) {
  return LINKEDIN_MEDIA_HOST_SUFFIXES.some((host) =>
    hostnameMatches(hostname, host),
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u002f", "/")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/");
}

function getMetaContent(html, key) {
  const escaped = key.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );

  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "iu",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      "iu",
    ),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }

  return "";
}

function normaliseMediaUrl(value) {
  const decoded = decodeHtml(value).trim();

  try {
    const parsed = new URL(decoded);

    if (
      parsed.protocol !== "https:" ||
      !isLinkedInMediaHost(parsed.hostname) ||
      !parsed.pathname.includes("/dms/image/")
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function assetIdForUrl(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname;
    const match = /\/dms\/image\/([^/]+)/u.exec(pathname);
    return match?.[1] || rawUrl;
  } catch {
    return rawUrl;
  }
}

function candidateScore(rawUrl, fromMeta = false) {
  const value = rawUrl.toLowerCase();

  const blocked = [
    "profile-displayphoto",
    "company-logo",
    "company-background",
    "profile-background",
    "emoji",
    "badge",
    "logo-shrink",
    "ghost",
    "default",
  ];

  if (blocked.some((part) => value.includes(part))) {
    return -10000;
  }

  let score = fromMeta ? 250 : 0;

  const qualityMarkers = [
    ["feedshare-shrink_2048_1536", 1200],
    ["feedshare-shrink_1920", 1150],
    ["feedshare-shrink_1280", 1100],
    ["feedshare-shrink_800_800", 850],
    ["feedshare-shrink_800", 820],
    ["article-cover_image-shrink_1280", 800],
    ["article-cover_image-shrink_600_2000", 760],
    ["image-shrink_2048", 720],
    ["image-shrink_1280", 700],
    ["image-shrink_800", 520],
    ["feedshare", 450],
  ];

  for (const [marker, points] of qualityMarkers) {
    if (value.includes(marker)) {
      score += points;
      break;
    }
  }

  return score;
}

function extractCandidateUrls(html) {
  const decodedHtml = decodeHtml(html);
  const candidates = [];

  for (const key of [
    "og:image",
    "og:image:secure_url",
    "twitter:image",
  ]) {
    const value = getMetaContent(html, key);
    const url = normaliseMediaUrl(value);

    if (url) {
      candidates.push({
        url,
        fromMeta: true,
      });
    }
  }

  const urlPattern = /https:\/\/[^"'<>\\\s]+/giu;

  for (const raw of decodedHtml.match(urlPattern) || []) {
    const url = normaliseMediaUrl(raw);

    if (url) {
      candidates.push({
        url,
        fromMeta: false,
      });
    }
  }

  const bestByAsset = new Map();

  for (const candidate of candidates) {
    const score = candidateScore(
      candidate.url,
      candidate.fromMeta,
    );

    if (score < 400 && !candidate.fromMeta) {
      continue;
    }

    const key = assetIdForUrl(candidate.url);
    const existing = bestByAsset.get(key);

    if (!existing || score > existing.score) {
      bestByAsset.set(key, {
        ...candidate,
        score,
      });
    }
  }

  return [...bestByAsset.values()]
    .filter((candidate) => candidate.score > -1000)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function extensionForType(contentType, rawUrl) {
  const type = String(contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  const byType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  if (byType[type]) {
    return byType[type];
  }

  try {
    const extension = path.extname(
      new URL(rawUrl).pathname,
    );

    if (/^\.(?:jpe?g|png|webp|gif)$/iu.test(extension)) {
      return extension.toLowerCase();
    }
  } catch {
    // Ignore URL parsing errors.
  }

  return ".jpg";
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 20000,
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(rawUrl, destination) {
  const response = await fetchWithTimeout(
    rawUrl,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
          "Chrome/140.0 Safari/537.36",
        accept:
          "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        referer: "https://www.linkedin.com/",
      },
      redirect: "follow",
    },
  );

  if (!response.ok || !response.body) {
    throw new Error(
      `LinkedIn image request failed with HTTP ${response.status}.`,
    );
  }

  const finalUrl = new URL(response.url);

  if (!isLinkedInMediaHost(finalUrl.hostname)) {
    throw new Error(
      "LinkedIn image redirected outside a trusted LinkedIn media host.",
    );
  }

  await pipeline(
    response.body,
    createWriteStream(destination, {
      mode: 0o600,
    }),
  );

  return response.headers.get("content-type") || "";
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function probeImage(filePath) {
  const result = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
  );

  if (result.code !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams?.[0];

    if (!stream) {
      return null;
    }

    return {
      width: Number(stream.width || 0),
      height: Number(stream.height || 0),
    };
  } catch {
    return null;
  }
}

async function isUsefulPostImage(filePath) {
  const [fileStat, dimensions] = await Promise.all([
    stat(filePath),
    probeImage(filePath),
  ]);

  if (fileStat.size < 30 * 1024) {
    return false;
  }

  if (!dimensions) {
    return fileStat.size >= 100 * 1024;
  }

  return (
    Math.max(dimensions.width, dimensions.height) >= 600 &&
    Math.min(dimensions.width, dimensions.height) >= 300
  );
}

export async function downloadLinkedInPublicImages({
  url,
  outputDir,
  log = () => {},
}) {
  const parsed = new URL(url);

  if (!isLinkedInPageHost(parsed.hostname)) {
    return {
      supported: false,
      files: [],
      metadata: null,
    };
  }

  const response = await fetchWithTimeout(
    parsed.toString(),
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
          "Chrome/140.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.8",
      },
      redirect: "follow",
    },
  );

  if (!response.ok) {
    throw new Error(
      `LinkedIn public page returned HTTP ${response.status}.`,
    );
  }

  const finalPageUrl = new URL(response.url);

  if (!isLinkedInPageHost(finalPageUrl.hostname)) {
    throw new Error(
      "LinkedIn page redirected outside linkedin.com.",
    );
  }

  const html = await response.text();

  if (html.length > 6_000_000) {
    throw new Error(
      "LinkedIn page exceeded the fallback parser size limit.",
    );
  }

  const title =
    getMetaContent(html, "og:title") ||
    getMetaContent(html, "twitter:title");

  const description =
    getMetaContent(html, "og:description") ||
    getMetaContent(html, "twitter:description");

  const candidates = extractCandidateUrls(html);

  log("linkedin_image_candidates", {
    candidate_count: candidates.length,
  });

  await mkdir(outputDir, {
    recursive: true,
  });

  const files = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const temporaryName = path.join(
      outputDir,
      `linkedin-image-${String(index + 1).padStart(2, "0")}.tmp`,
    );

    try {
      const contentType = await downloadImage(
        candidate.url,
        temporaryName,
      );

      const extension = extensionForType(
        contentType,
        candidate.url,
      );

      const finalPath = temporaryName.replace(
        /\.tmp$/u,
        extension,
      );

      await rename(temporaryName, finalPath);

      if (await isUsefulPostImage(finalPath)) {
        files.push(finalPath);
      } else {
        await rm(finalPath, { force: true });
        log("linkedin_image_rejected", {
          index,
          reason: "small_or_ui_asset",
        });
      }
    } catch (error) {
      await rm(temporaryName, { force: true });

      log("linkedin_image_failed", {
        index,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  return {
    supported: true,
    files,
    metadata: {
      extractor: "linkedin-public-html",
      title,
      description,
      webpage_url: finalPageUrl.toString(),
    },
  };
}
