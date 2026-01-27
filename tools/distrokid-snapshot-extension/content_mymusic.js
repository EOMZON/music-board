const DK_WIDGET_ID = "dk-snapshot-widget";

function qs(sel, root = document) {
  return root.querySelector(sel);
}

function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function text(el) {
  return (el?.textContent || "").toString().replace(/\s+/g, " ").trim();
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeFolder(input) {
  const s = (input ?? "").toString().trim();
  return s || "distrokid-snapshots";
}

function extractAlbumsFromPage() {
  const links = qsa('a[href*="/dashboard/album/"][href*="albumuuid="]');
  const out = [];
  const seen = new Set();

  for (const a of links) {
    const href = a.getAttribute("href") || "";
    const url = new URL(href, location.origin);
    const albumuuid = url.searchParams.get("albumuuid") || "";
    if (!albumuuid || seen.has(albumuuid)) continue;
    seen.add(albumuuid);

    const row = a.closest("a") || a;

    const titleEl =
      row.querySelector('.item-title span[translate="no"]') ||
      row.querySelector('.item-title [translate="no"]') ||
      row.querySelector(".item-title span") ||
      null;
    const artistEl =
      row.querySelector('.item-title div[translate="no"]') ||
      row.querySelector('.item-title div') ||
      null;

    out.push({
      albumuuid,
      url: url.toString(),
      title: text(titleEl),
      artist: text(artistEl)
    });
  }

  return out;
}

function ensureWidget() {
  if (qs(`#${DK_WIDGET_ID}`)) return;

  const style = document.createElement("style");
  style.textContent = `
    #${DK_WIDGET_ID}{
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 2147483647;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      color: #111;
    }
    #${DK_WIDGET_ID} .dk-btn{
      appearance: none;
      border: 1px solid rgba(0,0,0,.18);
      background: rgba(255,255,255,.92);
      color: #111;
      border-radius: 999px;
      padding: 10px 12px;
      cursor: pointer;
      box-shadow: 0 10px 30px rgba(0,0,0,.12);
    }
    #${DK_WIDGET_ID} .dk-btn:hover{ background: #fff; }
    #${DK_WIDGET_ID} .dk-panel{
      margin-top: 10px;
      width: 360px;
      max-width: calc(100vw - 28px);
      border: 1px solid rgba(0,0,0,.18);
      background: rgba(255,255,255,.96);
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.12);
      display: none;
    }
    #${DK_WIDGET_ID}[data-open="true"] .dk-panel{ display:block; }
    #${DK_WIDGET_ID} .row{ display:flex; gap:10px; align-items:center; justify-content:space-between; margin-top:10px; }
    #${DK_WIDGET_ID} .label{ color: rgba(0,0,0,.62); }
    #${DK_WIDGET_ID} input{
      width: 100%;
      border: 1px solid rgba(0,0,0,.18);
      border-radius: 10px;
      padding: 8px 10px;
      background: #fff;
      color: #111;
      font: inherit;
      outline: none;
    }
    #${DK_WIDGET_ID} .actions{ display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
    #${DK_WIDGET_ID} .action{
      border-radius: 10px;
      border: 1px solid rgba(0,0,0,.18);
      background: #111;
      color: #fff;
      padding: 8px 10px;
      cursor: pointer;
      font: inherit;
    }
    #${DK_WIDGET_ID} .action.secondary{ background: rgba(255,255,255,.92); color:#111; }
    #${DK_WIDGET_ID} .action:disabled{ opacity: .55; cursor: default; }
    #${DK_WIDGET_ID} .status{
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(0,0,0,.10);
      color: rgba(0,0,0,.74);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 180px;
      overflow: auto;
    }
  `;
  document.documentElement.appendChild(style);

  const root = document.createElement("div");
  root.id = DK_WIDGET_ID;
  root.dataset.open = "false";
  root.innerHTML = `
    <button class="dk-btn" type="button" title="DistroKid Snapshot Saver">DK Snapshot</button>
    <div class="dk-panel">
      <div class="label">Downloads folder (relative)</div>
      <div class="row">
        <input id="dk-folder" type="text" placeholder="distrokid-snapshots" />
      </div>
      <div class="actions">
        <button id="dk-save-mymusic" class="action secondary" type="button">Download this page (My Music)</button>
        <button id="dk-export-albums" class="action" type="button">Download all albums</button>
        <button id="dk-cancel" class="action secondary" type="button">Cancel</button>
      </div>
      <div class="status" id="dk-status">Ready.</div>
    </div>
  `;
  document.documentElement.appendChild(root);

  return root;
}

let port = null;
let exporting = false;
let exportMode = "";

function setStatus(message) {
  const el = qs("#dk-status");
  if (!el) return;
  el.textContent = message || "";
}

function connect() {
  if (port) return port;
  port = chrome.runtime.connect({ name: "dk-snapshot" });
  port.onDisconnect.addListener(() => {
    port = null;
    exporting = false;
    exportMode = "";
    const root = qs(`#${DK_WIDGET_ID}`);
    if (root) setButtonsDisabled(root, false);
  });
  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "DK_ERROR") {
      setStatus(`Error: ${msg.message || ""}`);
      exporting = false;
      exportMode = "";
      const root = qs(`#${DK_WIDGET_ID}`);
      if (root) setButtonsDisabled(root, false);
    }
    if (msg.type === "DK_LOG") setStatus(msg.message || "");
    if (msg.type === "DK_STARTED") setStatus(`Started. total=${msg.total}`);
    if (msg.type === "DK_PROGRESS") {
      const phase = msg.phase || "";
      const idx = msg.idx || 0;
      const total = msg.total || 0;
      const t = msg.task || {};
      const name = [t.artist, t.title].filter(Boolean).join(" · ") || t.albumuuid || "";
      const extra = msg.error ? `\n${msg.error}` : msg.filename ? `\n${msg.filename}` : "";
      setStatus(`[${idx}/${total}] ${phase} ${name}${extra}`);
    }
    if (msg.type === "DK_FINISHED") {
      const suffix = msg.cancelled ? " (cancelled)" : "";
      setStatus(`Finished${suffix}. done=${msg.done} failed=${msg.failed}`);
      exporting = false;
      exportMode = "";
      const root = qs(`#${DK_WIDGET_ID}`);
      if (root) setButtonsDisabled(root, false);
    }
    if (msg.type === "DK_DOWNLOADED") {
      setStatus(`Downloaded: ${msg.filename || ""}`);
      if (exportMode === "mymusic") {
        exporting = false;
        exportMode = "";
        const root = qs(`#${DK_WIDGET_ID}`);
        if (root) setButtonsDisabled(root, false);
      }
    }
    if (msg.type === "DK_CANCELLED") setStatus("Cancelling…");
  });
  return port;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scrollToBottom() {
  try {
    const el = document.scrollingElement || document.documentElement || document.body;
    el.scrollTop = el.scrollHeight;
  } catch {
    // ignore
  }
  try {
    window.scrollTo(0, document.body.scrollHeight);
  } catch {
    // ignore
  }
}

async function autoCollectAlbums({ timeoutMs = 45000, stepMs = 900, stableRounds = 3 } = {}) {
  const start = Date.now();
  let lastCount = -1;
  let stable = 0;

  while (Date.now() - start < timeoutMs) {
    const albums = extractAlbumsFromPage();
    const count = albums.length;

    if (count === 0) {
      setStatus("Scanning… (no albums yet, waiting for page to load)");
      await sleep(500);
      continue;
    }

    if (count !== lastCount) {
      stable = 0;
      lastCount = count;
      setStatus(`Scanning… found ${count} albums (scrolling to load more)`);
      scrollToBottom();
      await sleep(stepMs);
      continue;
    }

    stable += 1;
    if (stable >= stableRounds) return albums;
    scrollToBottom();
    await sleep(stepMs);
  }

  return extractAlbumsFromPage();
}

function setButtonsDisabled(root, disabled) {
  for (const id of ["#dk-save-mymusic", "#dk-export-albums", "#dk-cancel"]) {
    const el = qs(id, root);
    if (el) el.disabled = !!disabled;
  }
  const cancel = qs("#dk-cancel", root);
  if (cancel) cancel.disabled = false;
}

function bindUi(root) {
  const toggle = qs(".dk-btn", root);
  const folder = qs("#dk-folder", root);
  const saveBtn = qs("#dk-save-mymusic", root);
  const exportBtn = qs("#dk-export-albums", root);
  const cancelBtn = qs("#dk-cancel", root);

  toggle.addEventListener("click", () => {
    root.dataset.open = root.dataset.open === "true" ? "false" : "true";
  });

  chrome.storage?.local?.get?.({ folder: "distrokid-snapshots" }, (v) => {
    folder.value = safeFolder(v?.folder || "distrokid-snapshots");
  });

  folder.addEventListener("change", () => {
    chrome.storage?.local?.set?.({ folder: safeFolder(folder.value) });
  });

  saveBtn.addEventListener("click", () => {
    if (exporting) return;
    const html = document.documentElement?.outerHTML || "";
    const p = connect();
    const opts = { folder: safeFolder(folder.value) };
    exporting = true;
    exportMode = "mymusic";
    setButtonsDisabled(root, true);
    p.postMessage({ type: "DK_DOWNLOAD_HTML", kind: "distrokid_mymusic", html, options: opts });
    setStatus(`Downloading My Music HTML… (${nowStamp()})`);
  });

  exportBtn.addEventListener("click", () => {
    (async () => {
      if (exporting) return;
      exporting = true;
      exportMode = "albums";
      setButtonsDisabled(root, true);

      const albums = await autoCollectAlbums({ timeoutMs: 45000, stepMs: 900, stableRounds: 3 });
      if (!albums.length) {
        setStatus("No albums found on this page. Try refreshing My Music.");
        exporting = false;
        exportMode = "";
        setButtonsDisabled(root, false);
        return;
      }

      const p = connect();
      const opts = { folder: safeFolder(folder.value), delayMs: 650, timeoutMs: 60000 };
      p.postMessage({ type: "DK_EXPORT_ALBUMS", mode: "download-url", albums, options: opts });
      setStatus(`Queued ${albums.length} albums…`);
    })().catch((err) => {
      setStatus(`Error: ${err?.message || String(err)}`);
      exporting = false;
      exportMode = "";
      setButtonsDisabled(root, false);
    });
  });

  cancelBtn.addEventListener("click", () => {
    const p = connect();
    exporting = false;
    exportMode = "";
    setButtonsDisabled(root, false);
    p.postMessage({ type: "DK_CANCEL" });
  });
}

const root = ensureWidget();
bindUi(root);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "DK_TOGGLE_UI") {
    root.dataset.open = root.dataset.open === "true" ? "false" : "true";
    sendResponse?.({ ok: true, open: root.dataset.open === "true" });
    return;
  }
});
