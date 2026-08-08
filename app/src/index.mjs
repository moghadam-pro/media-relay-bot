import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import {
  initializeDownloadStore,
  keepDownload,
  registerDownload,
} from "./download-store.mjs";
import {
  classifyDownloadError,
  downloadMedia,
} from "./media-downloader.mjs";

const BOT_TOKEN = process.env.BOT_TOKEN?.trim();
const ALLOWED_CHAT_ID = Number(
  process.env.ALLOWED_CHAT_ID,
);
const POLL_TIMEOUT_SECONDS = Number(
  process.env.POLL_TIMEOUT_SECONDS || "30",
);
const DOWNLOAD_DIR =
  process.env.DOWNLOAD_DIR || "/data/downloads";
const TEMP_DIR =
  process.env.TEMP_DIR || "/data/tmp";
const MAX_CONCURRENT_DOWNLOADS = Number(
  process.env.MAX_CONCURRENT_DOWNLOADS || "2",
);
const MAX_FILE_SIZE_MB = Number(
  process.env.MAX_FILE_SIZE_MB || "2000",
);

const ALLOWED_PRIVATE_USER_IDS = new Set(
  (process.env.ALLOWED_PRIVATE_USER_IDS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Number.isSafeInteger),
);

const ALLOWED_MEDIA_HOSTS = new Set(
  (process.env.ALLOWED_MEDIA_HOSTS || "")
    .split(",")
    .map((value) =>
      value
        .trim()
        .toLowerCase()
        .replace(/^www\./u, ""),
    )
    .filter(Boolean),
);

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required.");
}

if (!Number.isSafeInteger(ALLOWED_CHAT_ID)) {
  throw new Error(
    "ALLOWED_CHAT_ID must be a valid integer.",
  );
}

if (
  !Number.isInteger(MAX_CONCURRENT_DOWNLOADS) ||
  MAX_CONCURRENT_DOWNLOADS < 1 ||
  MAX_CONCURRENT_DOWNLOADS > 4
) {
  throw new Error(
    "MAX_CONCURRENT_DOWNLOADS must be between 1 and 4.",
  );
}

const telegramBaseUrl =
  `https://api.telegram.org/bot${BOT_TOKEN}`;

const queue = [];
let activeDownloads = 0;
let updateOffset = 0;

function log(event, data = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...data,
  }));
}

function normaliseError(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

async function telegram(method, payload = {}) {
  const response = await fetch(
    `${telegramBaseUrl}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram ${method} failed: ${JSON.stringify(result)}`,
    );
  }

  return result.result;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isAllowedMediaUrl(value) {
  if (!isValidHttpUrl(value)) {
    return false;
  }

  try {
    const hostname = new URL(value)
      .hostname
      .toLowerCase()
      .replace(/^www\./u, "");

    for (const allowedHost of ALLOWED_MEDIA_HOSTS) {
      if (
        hostname === allowedHost ||
        hostname.endsWith(`.${allowedHost}`)
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function isAuthorizedMessage(message) {
  if (!message?.chat || !message?.from) {
    return false;
  }

  if (message.chat.type === "private") {
    return ALLOWED_PRIVATE_USER_IDS.has(
      message.from.id,
    );
  }

  return message.chat.id === ALLOWED_CHAT_ID;
}

function extractUrls(message) {
  const values = [];
  const text =
    message.text ||
    message.caption ||
    "";

  const entities = [
    ...(message.entities || []),
    ...(message.caption_entities || []),
  ];

  for (const entity of entities) {
    if (
      entity.type === "text_link" &&
      entity.url
    ) {
      values.push(entity.url);
      continue;
    }

    if (entity.type === "url") {
      values.push(
        text.slice(
          entity.offset,
          entity.offset + entity.length,
        ),
      );
    }
  }

  const plainUrls = text.match(
    /https?:\/\/[^\s<>()]+/giu,
  ) || [];

  values.push(...plainUrls);

  return [...new Set(values)]
    .map((value) =>
      value.replace(/[),.;!?]+$/u, ""),
    )
    .filter(isAllowedMediaUrl);
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes);
  let index = 0;

  while (
    value >= 1024 &&
    index < units.length - 1
  ) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

async function sendStatus(job, text) {
  const message = await telegram(
    "sendMessage",
    {
      chat_id: job.chatId,
      text,
      reply_parameters: {
        message_id: job.sourceMessageId,
        allow_sending_without_reply: true,
      },
      link_preview_options: {
        is_disabled: true,
      },
    },
  );

  job.statusMessageId = message.message_id;
}

async function editStatus(
  job,
  text,
  replyMarkup = null,
  previewUrl = null,
) {
  const payload = {
    chat_id: job.chatId,
    message_id: job.statusMessageId,
    text,
    ...(replyMarkup
      ? { reply_markup: replyMarkup }
      : {}),
    link_preview_options: previewUrl
      ? {
          is_disabled: false,
          url: previewUrl,
          prefer_large_media: true,
          show_above_text: true,
        }
      : {
          is_disabled: true,
        },
  };

  try {
    await telegram(
      "editMessageText",
      payload,
    );
    return true;
  } catch (error) {
    if (previewUrl) {
      log("telegram_preview_failed", {
        job_id: job.id,
        error: normaliseError(error),
      });

      try {
        await telegram(
          "editMessageText",
          {
            ...payload,
            link_preview_options: {
              is_disabled: true,
            },
          },
        );
        return false;
      } catch (fallbackError) {
        log("status_edit_failed", {
          job_id: job.id,
          error: normaliseError(fallbackError),
        });
        return false;
      }
    }

    log("status_edit_failed", {
      job_id: job.id,
      error: normaliseError(error),
    });
    return false;
  }
}

function splitText(value, maxLength = 3600) {
  const text = String(value || "").trim();

  if (!text) {
    return [];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(
      "\n",
      maxLength,
    );

    if (splitAt < maxLength * 0.6) {
      splitAt = maxLength;
    }

    chunks.push(
      remaining.slice(0, splitAt).trim(),
    );

    remaining = remaining
      .slice(splitAt)
      .trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sendCaptionContinuation(
  job,
  chunks,
  downloadUrl,
) {
  for (
    let index = 0;
    index < chunks.length;
    index += 1
  ) {
    try {
      await telegram(
        "sendMessage",
        {
          chat_id: job.chatId,
          text: [
            index === 0
              ? "📝 Caption continued:"
              : "📝 Continued:",
            chunks[index],
            "",
            `⬇️ ${downloadUrl}`,
          ].join("\n"),
          reply_parameters: {
            message_id: job.sourceMessageId,
            allow_sending_without_reply: true,
          },
          link_preview_options: {
            is_disabled: true,
          },
        },
      );
    } catch (error) {
      log("caption_send_failed", {
        job_id: job.id,
        chunk_index: index,
        error: normaliseError(error),
      });
    }
  }
}

function platformLabel(metadata, url) {
  if (metadata?.extractor) {
    return metadata.extractor;
  }

  try {
    return new URL(url)
      .hostname
      .replace(/^www\./u, "");
  } catch {
    return "media";
  }
}

function errorMessageFor(code, url) {
  const platform = platformLabel(null, url);

  const messages = {
    authentication_required:
      "This source requires additional authentication, cookies, or an API token for this post.",
    extractor_unsupported:
      "The current extractors cannot parse this post format yet.",
    no_video_format:
      "No downloadable video format was found for this URL.",
    access_blocked:
      "The source blocked or rate-limited this server request.",
    size_limit:
      "The resulting media exceeds the configured server size limit.",
    download_failed:
      "No downloadable media could be collected from this URL.",
  };

  return [
    "❌ Download failed.",
    "",
    `🌐 ${platform}`,
    `⚠️ ${messages[code] || messages.download_failed}`,
  ].join("\n");
}

function buildCompletion({
  result,
  access,
}) {
  const metadata = result.metadata || {};

  const title = String(
    metadata.title || "",
  ).trim();

  const uploader = String(
    metadata.uploader || "",
  ).trim();

  const description = String(
    metadata.description || "",
  ).trim();

  const originalUrl =
    metadata.webpage_url || "";

  const isDirectVideo =
    result.previewKind === "video" &&
    !result.isArchive;

  if (isDirectVideo) {
    const captionBudget = 900;

    const inlineCaption =
      description.slice(
        0,
        captionBudget,
      );

    const lines = [];

    if (inlineCaption) {
      lines.push(
        "📝 Caption:",
        inlineCaption +
          (
            description.length >
            captionBudget
              ? "…"
              : ""
          ),
      );
    }

    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(
      "⚠️ Link 24hr Available",
    );

    return {
      text: lines.join("\n"),
      remainingCaption: "",
    };
  }

  const lines = [
    result.isArchive
      ? "✅ Media bundle is ready."
      : "✅ Media is ready in the best available quality.",
    "",
    `📄 ${result.artifactName}`,
    `📦 ${formatBytes(result.artifactSize)}`,
  ];

  if (result.mediaCount > 1) {
    lines.push(
      `🧩 ${result.mediaCount} media items`,
    );
  }

  if (title) {
    lines.push(
      "",
      `📌 ${title}`,
    );
  }

  if (uploader) {
    lines.push(
      `👤 ${uploader}`,
    );
  }

  if (originalUrl) {
    lines.push(
      `🔗 Original post: ${originalUrl}`,
    );
  }

  const captionBudget = 1500;

  const inlineCaption =
    description.slice(
      0,
      captionBudget,
    );

  if (inlineCaption) {
    lines.push(
      "",
      "📝 Caption:",
      inlineCaption +
        (
          description.length >
          captionBudget
            ? "…"
            : ""
        ),
    );
  }

  lines.push(
    "",
    "⬇️ Download:",
    access.downloadUrl ||
      "PUBLIC_BASE_URL is not configured.",
    "",
    "⚠️ This link expires automatically unless a trusted user keeps it permanently.",
  );

  const remainingCaption =
    description.length >
    captionBudget
      ? description.slice(
          captionBudget,
        )
      : "";

  return {
    text: lines.join("\n"),
    remainingCaption,
  };
}

async function processJob(job) {
  try {
    await editStatus(
      job,
      "⬇️ Downloading media in the best available quality…",
    );

    log("download_started", {
      job_id: job.id,
      source_message_id: job.sourceMessageId,
      active_downloads: activeDownloads,
      queue_length: queue.length,
    });

    const result = await downloadMedia({
      url: job.url,
      jobId: job.id,
      downloadRoot: DOWNLOAD_DIR,
      tempRoot: TEMP_DIR,
      log,
    });

    const access = await registerDownload({
      filePath: result.artifactPath,
      fileName: result.artifactName,
      fileSize: result.artifactSize,
      mimeType: result.mimeType,
      previewKind: result.previewKind,
      title: result.metadata?.title || "",
    });

    const completion = buildCompletion({
      result,
      access,
    });

    const isDirectVideo =
      result.previewKind === "video" &&
      !result.isArchive;

    const replyMarkup = access.downloadUrl
      ? {
          inline_keyboard: isDirectVideo
            ? [
                [
                  {
                    text:
                      `⬇️ Download · ${formatBytes(result.artifactSize)}`,
                    url:
                      access.downloadUrl,
                  },
                ],
                [
                  {
                    text:
                      "♾️ Keep permanently",
                    callback_data:
                      `keep:${access.token}`,
                  },
                ],
              ]
            : [
                [
                  {
                    text:
                      "♾️ Keep permanently",
                    callback_data:
                      `keep:${access.token}`,
                  },
                ],
              ],
        }
      : null;

    const telegramPreviewUrl =
      result.previewKind === "video"
        ? access.mediaUrl
        : access.previewUrl;

    await editStatus(
      job,
      completion.text,
      replyMarkup,
      telegramPreviewUrl,
    );

    if (
      completion.remainingCaption &&
      access.downloadUrl
    ) {
      await sendCaptionContinuation(
        job,
        splitText(
          completion.remainingCaption,
        ),
        access.downloadUrl,
      );
    }

    log("download_completed", {
      job_id: job.id,
      file_name: result.artifactName,
      file_size: result.artifactSize,
      media_count: result.mediaCount,
      archive: result.isArchive,
      expires_at:
        new Date(access.expiresAt)
          .toISOString(),
      attempts: result.attempts,
    });
  } catch (error) {
    const code =
      error?.code ||
      classifyDownloadError(
        normaliseError(error),
      );

    log("download_failed", {
      job_id: job.id,
      error_type: code,
      source_host: (() => {
        try {
          return new URL(job.url).hostname;
        } catch {
          return null;
        }
      })(),
      error: normaliseError(error),
      attempts: error?.attempts || null,
    });

    await rm(
      `${DOWNLOAD_DIR}/${job.id}`,
      {
        recursive: true,
        force: true,
      },
    );

    await rm(
      `${TEMP_DIR}/${job.id}`,
      {
        recursive: true,
        force: true,
      },
    );

    await editStatus(
      job,
      errorMessageFor(code, job.url),
    );
  }
}

function pumpQueue() {
  while (
    activeDownloads <
      MAX_CONCURRENT_DOWNLOADS &&
    queue.length > 0
  ) {
    const job = queue.shift();
    activeDownloads += 1;

    log("job_started_from_queue", {
      job_id: job.id,
      active_downloads: activeDownloads,
      queue_length: queue.length,
    });

    processJob(job)
      .catch((error) => {
        log("job_unhandled_error", {
          job_id: job.id,
          error: normaliseError(error),
        });
      })
      .finally(() => {
        activeDownloads -= 1;

        log("download_slot_released", {
          job_id: job.id,
          active_downloads: activeDownloads,
          queue_length: queue.length,
        });

        pumpQueue();
      });
  }
}

async function enqueueMessageUrl(
  message,
  url,
) {
  const job = {
    id: randomUUID(),
    chatId: message.chat.id,
    sourceMessageId: message.message_id,
    sourceUserId: message.from?.id || null,
    url,
    statusMessageId: null,
  };

  await sendStatus(
    job,
    "⏳ URL accepted and queued.",
  );

  queue.push(job);

  log("job_queued", {
    job_id: job.id,
    chat_id: job.chatId,
    source_message_id: job.sourceMessageId,
    source_host: (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })(),
    active_downloads: activeDownloads,
    queue_length: queue.length,
  });

  pumpQueue();
}

async function handleCallbackQuery(
  callbackQuery,
) {
  const callbackId = callbackQuery?.id;
  const userId = callbackQuery?.from?.id;
  const data = callbackQuery?.data || "";

  if (!data.startsWith("keep:")) {
    return;
  }

  if (
    !ALLOWED_PRIVATE_USER_IDS.has(userId)
  ) {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text:
          "Only trusted users can keep files permanently.",
        show_alert: true,
      },
    );
    return;
  }

  const token = data.slice("keep:".length);
  const result = await keepDownload(
    token,
    userId,
  );

  if (!result.ok) {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text:
          result.reason === "expired"
            ? "This file has already expired."
            : "The file was not found.",
        show_alert: true,
      },
    );
    return;
  }

  await telegram(
    "answerCallbackQuery",
    {
      callback_query_id: callbackId,
      text: result.alreadyPersistent
        ? "This file was already permanent."
        : "This file is now permanent.",
      show_alert: false,
    },
  );

  const message = callbackQuery.message;

  if (!message?.text) {
    return;
  }

  let updatedText = message.text.replace(
    /⚠️ (?:This link expires automatically unless a trusted user keeps it permanently\.?|Link 24hr Available)/u,
    "♾️ Link kept permanently",
  );

  if (
    !updatedText.includes(
      "♾️ Link kept permanently",
    )
  ) {
    updatedText +=
      "\n\n♾️ Link kept permanently";
  }

  const remainingKeyboard =
    (
      message.reply_markup
        ?.inline_keyboard || []
    )
      .map(
        (row) =>
          row.filter(
            (button) =>
              !String(
                button.callback_data || "",
              ).startsWith("keep:"),
          ),
      )
      .filter(
        (row) => row.length > 0,
      );

  await telegram(
    "editMessageText",
    {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: updatedText,
      link_preview_options: {
        is_disabled: true,
      },
      reply_markup: {
        inline_keyboard:
          remainingKeyboard,
      },
    },
  );

  log("persistent_callback_completed", {
    user_id: userId,
    already_persistent:
      result.alreadyPersistent,
  });
}

async function handleMessage(message) {
  if (
    !message ||
    message.from?.is_bot
  ) {
    return;
  }

  if (!isAuthorizedMessage(message)) {
    log("unauthorised_message_ignored", {
      chat_id: message.chat?.id || null,
      user_id: message.from?.id || null,
      chat_type: message.chat?.type || null,
      message_id: message.message_id || null,
    });
    return;
  }

  const urls = extractUrls(message);

  if (urls.length === 0) {
    return;
  }

  await enqueueMessageUrl(
    message,
    urls[0],
  );
}

async function pollForever() {
  while (true) {
    try {
      const updates = await telegram(
        "getUpdates",
        {
          offset: updateOffset,
          timeout: POLL_TIMEOUT_SECONDS,
          allowed_updates: [
            "message",
            "callback_query",
          ],
        },
      );

      for (const update of updates) {
        updateOffset = Math.max(
          updateOffset,
          update.update_id + 1,
        );

        try {
          if (update.callback_query) {
            await handleCallbackQuery(
              update.callback_query,
            );
          } else if (update.message) {
            await handleMessage(
              update.message,
            );
          }
        } catch (error) {
          log("update_processing_failed", {
            update_id: update.update_id,
            error: normaliseError(error),
          });
        }
      }
    } catch (error) {
      log("poll_failed", {
        error: normaliseError(error),
      });

      await new Promise((resolve) =>
        setTimeout(resolve, 3000),
      );
    }
  }
}

async function main() {
  await mkdir(DOWNLOAD_DIR, {
    recursive: true,
  });

  await mkdir(TEMP_DIR, {
    recursive: true,
  });

  await initializeDownloadStore({
    log,
  });

  await telegram(
    "deleteWebhook",
    {
      drop_pending_updates: false,
    },
  );

  const me = await telegram("getMe");

  log("bot_started", {
    bot_id: me.id,
    bot_username: me.username,
    allowed_chat_id: ALLOWED_CHAT_ID,
    allowed_private_user_count:
      ALLOWED_PRIVATE_USER_IDS.size,
    quality_mode: "best_available",
    max_concurrent_downloads:
      MAX_CONCURRENT_DOWNLOADS,
    max_file_size_mb: MAX_FILE_SIZE_MB,
  });

  await pollForever();
}

main().catch((error) => {
  log("fatal_error", {
    error: normaliseError(error),
  });
  process.exitCode = 1;
});
