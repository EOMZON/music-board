function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(el) {
  return (el?.textContent || "").toString().replace(/\s+/g, " ").trim();
}

async function waitForAnySelector(selectors, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      if (document.querySelector(sel)) return sel;
    }
    await sleep(250);
  }
  return "";
}

function albumMetaFromPage() {
  const params = new URLSearchParams(location.search || "");
  const albumuuid = params.get("albumuuid") || "";

  const titleEl =
    document.querySelector('.album-title span[title="Album title"]') ||
    document.querySelector(".album-title span") ||
    document.querySelector("h1") ||
    null;
  const artistEl =
    document.querySelector('.band-name span[title="Artist name"]') ||
    document.querySelector(".band-name span") ||
    null;

  return {
    albumuuid,
    title: text(titleEl) || document.title || "",
    artist: text(artistEl) || ""
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type !== "DK_CAPTURE_HTML") return;

  (async () => {
    await waitForAnySelector([".trackRow", ".track-row", "#js-album-upc", ".release-header"], 25000);
    const meta = albumMetaFromPage();
    const html = document.documentElement?.outerHTML || "";
    sendResponse({ ok: true, html, meta });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});

