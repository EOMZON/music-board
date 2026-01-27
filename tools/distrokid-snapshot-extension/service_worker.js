const DEFAULT_OPTIONS = Object.freeze({
  folder: "distrokid-snapshots",
  delayMs: 500,
  timeoutMs: 60000
});

const pendingDownloadWaiters = new Map();

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sanitizePathPart(name) {
  const raw = (name ?? "").toString().trim();
  if (!raw) return "untitled";
  return raw
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeFolder(folder) {
  const f = sanitizePathPart(folder || DEFAULT_OPTIONS.folder);
  return f.replace(/^\.+/g, "_");
}

function buildFilename({ kind, albumuuid, title, artist, folder, ext = "html" }) {
  const baseFolder = normalizeFolder(folder);
  const safeKind = sanitizePathPart(kind || "snapshot");
  const safeTitle = sanitizePathPart(title || "");
  const safeArtist = sanitizePathPart(artist || "");
  const safeUuid = sanitizePathPart(albumuuid || "");
  const parts = [safeKind, safeUuid, safeArtist, safeTitle].filter(Boolean);
  const base = parts.join(" -- ").slice(0, 200);
  return `${baseFolder}/${base || safeKind}.${ext}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

async function downloadHtml(html, filename) {
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  return await chromeCall(chrome.downloads.download, { url, filename, saveAs: false });
}

async function downloadUrlToFile(url, filename) {
  return await chromeCall(chrome.downloads.download, {
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

async function waitForDownload(downloadId, timeoutMs) {
  const existing = pendingDownloadWaiters.get(downloadId);
  if (existing) return existing.promise;

  const initial = await chromeCall(chrome.downloads.search, { id: downloadId }).catch(() => []);
  const item = Array.isArray(initial) ? initial[0] : null;
  if (item?.state === "complete") return;
  if (item?.state === "interrupted") {
    const reason = item?.error ? ` (${item.error})` : "";
    throw new Error(`Download interrupted${reason}`);
  }

  let resolve = null;
  let reject = null;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timer = setTimeout(() => {
    pendingDownloadWaiters.delete(downloadId);
    reject(new Error(`Timeout waiting for download ${downloadId}`));
  }, Math.max(5000, timeoutMs || DEFAULT_OPTIONS.timeoutMs));

  pendingDownloadWaiters.set(downloadId, { promise, resolve, reject, timer });
  return promise;
}

chrome.downloads.onChanged.addListener((delta) => {
  const waiter = pendingDownloadWaiters.get(delta.id);
  if (!waiter) return;

  const state = delta.state?.current;
  if (state === "complete") {
    clearTimeout(waiter.timer);
    pendingDownloadWaiters.delete(delta.id);
    waiter.resolve();
    return;
  }

  if (state === "interrupted") {
    const reason = delta.error?.current ? ` (${delta.error.current})` : "";
    clearTimeout(waiter.timer);
    pendingDownloadWaiters.delete(delta.id);
    waiter.reject(new Error(`Download interrupted${reason}`));
  }
});

async function waitForTabComplete(tabId, timeoutMs) {
  const initial = await chromeCall(chrome.tabs.get, tabId).catch(() => null);
  if (initial?.status === "complete") return;

  await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timeout waiting for tab ${tabId} to finish loading`));
    }, timeoutMs);

    const listener = (id, info) => {
      if (done) return;
      if (id !== tabId) return;
      if (info.status !== "complete") return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendTabMessageWithRetries(tabId, message, { retries = 8, backoffMs = 300 } = {}) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      return await chromeCall(chrome.tabs.sendMessage, tabId, message);
    } catch (err) {
      lastErr = err;
      await wait(backoffMs);
    }
  }
  throw lastErr || new Error("Failed to send message to tab");
}

async function captureAlbumHtml({ url, timeoutMs, delayMs }) {
  const tab = await chromeCall(chrome.tabs.create, { url, active: false });
  try {
    await waitForTabComplete(tab.id, timeoutMs);
    if (delayMs) await wait(delayMs);
    const res = await sendTabMessageWithRetries(tab.id, { type: "DK_CAPTURE_HTML" }, { retries: 10, backoffMs: 350 });
    if (!res?.ok || !res?.html) throw new Error(res?.error || "No HTML captured");
    return res;
  } finally {
    if (tab?.id != null) await chromeCall(chrome.tabs.remove, tab.id).catch(() => {});
  }
}

function mergeOptions(input) {
  const o = input && typeof input === "object" ? input : {};
  return {
    folder: typeof o.folder === "string" && o.folder.trim() ? o.folder.trim() : DEFAULT_OPTIONS.folder,
    delayMs: Number.isFinite(o.delayMs) ? Math.max(0, Math.floor(o.delayMs)) : DEFAULT_OPTIONS.delayMs,
    timeoutMs: Number.isFinite(o.timeoutMs) ? Math.max(5000, Math.floor(o.timeoutMs)) : DEFAULT_OPTIONS.timeoutMs
  };
}

function post(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    // ignore
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "dk-snapshot") return;

  let cancelled = false;
  let running = false;

  port.onDisconnect.addListener(() => {
    cancelled = true;
  });

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "DK_CANCEL") {
      cancelled = true;
      post(port, { type: "DK_CANCELLED" });
      return;
    }

    if (msg.type === "DK_DOWNLOAD_HTML") {
      (async () => {
        const options = mergeOptions(msg.options);
        const kind = msg.kind || "distrokid";
        const filename = buildFilename({
          kind: `${kind}_${nowStamp()}`,
          folder: options.folder,
          ext: "html"
        });
        post(port, { type: "DK_LOG", level: "info", message: `Downloading ${filename}` });
        const downloadId = await downloadHtml(msg.html || "", filename);
        post(port, { type: "DK_DOWNLOADED", downloadId, filename });
      })().catch((err) => {
        post(port, { type: "DK_ERROR", message: err?.message || String(err) });
      });
      return;
    }

    if (msg.type === "DK_EXPORT_ALBUMS") {
      if (running) {
        post(port, { type: "DK_ERROR", message: "Export already running." });
        return;
      }

      (async () => {
        running = true;
        cancelled = false;

        const options = mergeOptions(msg.options);
        const mode = msg.mode === "tab-capture" ? "tab-capture" : "download-url";
        const albums = Array.isArray(msg.albums) ? msg.albums : [];
        const queue = albums
          .map((a) => ({
            url: a?.url || "",
            albumuuid: a?.albumuuid || "",
            title: a?.title || "",
            artist: a?.artist || ""
          }))
          .filter((a) => a.url && a.albumuuid);

        const total = queue.length;
        post(port, { type: "DK_STARTED", total, options, mode });

        let done = 0;
        let failed = 0;

        for (const task of queue) {
          if (cancelled) break;
          const idx = done + failed + 1;

          try {
            if (mode === "tab-capture") {
              post(port, { type: "DK_PROGRESS", phase: "open", idx, total, task });
              const res = await captureAlbumHtml({ url: task.url, timeoutMs: options.timeoutMs, delayMs: options.delayMs });
              const meta = res.meta || {};
              const filename = buildFilename({
                kind: "distrokid_album",
                albumuuid: meta.albumuuid || task.albumuuid,
                title: meta.title || task.title,
                artist: meta.artist || task.artist,
                folder: options.folder,
                ext: "html"
              });
              post(port, { type: "DK_PROGRESS", phase: "download", idx, total, task: { ...task, meta }, filename });
              await downloadHtml(res.html, filename);
              done += 1;
              post(port, { type: "DK_PROGRESS", phase: "done", idx, total, task: { ...task, meta }, filename, done, failed });
            } else {
              const filename = buildFilename({
                kind: "distrokid_album",
                albumuuid: task.albumuuid,
                title: task.title,
                artist: task.artist,
                folder: options.folder,
                ext: "html"
              });
              post(port, { type: "DK_PROGRESS", phase: "download_url", idx, total, task, filename });
              const downloadId = await downloadUrlToFile(task.url, filename);
              await waitForDownload(downloadId, options.timeoutMs);
              done += 1;
              post(port, { type: "DK_PROGRESS", phase: "done", idx, total, task, filename, done, failed });
            }
          } catch (err) {
            failed += 1;
            post(port, { type: "DK_PROGRESS", phase: "error", idx, total, task, error: err?.message || String(err), done, failed });
          }
        }

        post(port, { type: "DK_FINISHED", done, failed, cancelled });
      })()
        .catch((err) => {
          post(port, { type: "DK_ERROR", message: err?.message || String(err) });
        })
        .finally(() => {
          running = false;
        });

      return;
    }
  });
});

async function focusTab(tab) {
  if (!tab || tab.id == null) return;
  if (tab.windowId != null) await chromeCall(chrome.windows.update, tab.windowId, { focused: true }).catch(() => {});
  await chromeCall(chrome.tabs.update, tab.id, { active: true }).catch(() => {});
}

async function findOrOpenMyMusicTab() {
  const urls = ["https://distrokid.com/mymusic*", "https://*.distrokid.com/mymusic*"];
  const tabs = await chromeCall(chrome.tabs.query, { url: urls }).catch(() => []);
  if (tabs && tabs.length) return tabs[0];
  return await chromeCall(chrome.tabs.create, { url: "https://distrokid.com/mymusic/", active: true });
}

chrome.action.onClicked.addListener(() => {
  (async () => {
    const tab = await findOrOpenMyMusicTab();
    await focusTab(tab);
    await waitForTabComplete(tab.id, DEFAULT_OPTIONS.timeoutMs).catch(() => {});
    await wait(250);
    await sendTabMessageWithRetries(tab.id, { type: "DK_TOGGLE_UI" }, { retries: 10, backoffMs: 300 }).catch(() => {});
  })().catch(() => {});
});
