// ==UserScript==
// @name         YouTube → Music Board Exporter
// @namespace    zondev.music-board
// @version      0.1.0
// @description  Export YouTube playlist/channel videos into music-board catalog items JSON (no API key).
// @match        https://www.youtube.com/*
// @match        https://music.youtube.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const APP = {
    maxItems: 5000,
    maxFetchPages: 200
  };

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function uniqBy(arr, keyFn) {
    const out = [];
    const seen = new Set();
    for (const x of arr) {
      const k = keyFn(x);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  function getText(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node?.simpleText === "string") return node.simpleText;
    if (Array.isArray(node?.runs)) return node.runs.map((r) => r?.text || "").join("").trim();
    return "";
  }

  function pickThumbnailUrl(thumbnailLike) {
    const thumbs = thumbnailLike?.thumbnails;
    if (!Array.isArray(thumbs) || thumbs.length === 0) return "";
    const last = thumbs[thumbs.length - 1];
    return typeof last?.url === "string" ? last.url : "";
  }

  function walk(root, visit) {
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || (typeof cur !== "object" && !Array.isArray(cur))) continue;
      if (seen.has(cur)) continue;
      seen.add(cur);

      visit(cur);

      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
        continue;
      }
      for (const v of Object.values(cur)) stack.push(v);
    }
  }

  function findFirstRenderer(root, rendererKey) {
    let found = null;
    walk(root, (node) => {
      if (found) return;
      if (!node || typeof node !== "object" || Array.isArray(node)) return;
      if (node[rendererKey] && typeof node[rendererKey] === "object") found = node[rendererKey];
    });
    return found;
  }

  function findAllContinuationTokens(root) {
    const tokens = [];
    walk(root, (node) => {
      const token = node?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === "string" && token) tokens.push(token);
    });
    return tokens;
  }

  function getInitialData() {
    // YouTube sometimes exposes it as window.ytInitialData or window["ytInitialData"].
    const d = window.ytInitialData || window["ytInitialData"];
    return d && typeof d === "object" ? d : null;
  }

  function getYtCfg() {
    const ytcfg = window.ytcfg;
    if (ytcfg && typeof ytcfg.get === "function") return ytcfg;
    return null;
  }

  function getInnertube() {
    const ytcfg = getYtCfg();
    const apiKey = ytcfg?.get?.("INNERTUBE_API_KEY");
    const context = ytcfg?.get?.("INNERTUBE_CONTEXT");
    const clientName = ytcfg?.get?.("INNERTUBE_CLIENT_NAME");
    const clientVersion = ytcfg?.get?.("INNERTUBE_CLIENT_VERSION");
    return {
      apiKey: typeof apiKey === "string" ? apiKey : "",
      context: context && typeof context === "object" ? context : null,
      clientName: Number.isFinite(clientName) ? clientName : 1,
      clientVersion: typeof clientVersion === "string" ? clientVersion : ""
    };
  }

  async function youtubeiBrowse({ continuation, browseId, params }) {
    const it = getInnertube();
    if (!it.apiKey || !it.context) throw new Error("Missing INNERTUBE config (try reloading the page).");

    const url = `${location.origin}/youtubei/v1/browse?key=${encodeURIComponent(it.apiKey)}`;
    const body = {
      context: it.context
    };
    if (continuation) body.continuation = continuation;
    if (browseId) body.browseId = browseId;
    if (params) body.params = params;

    const headers = {
      "content-type": "application/json",
      "x-youtube-client-name": String(it.clientName || 1)
    };
    if (it.clientVersion) headers["x-youtube-client-version"] = it.clientVersion;

    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`youtubei browse failed: ${res.status} ${res.statusText}`);
    return await res.json();
  }

  function parsePlaylistVideoRenderers(root) {
    const out = [];
    walk(root, (node) => {
      const r = node?.playlistVideoRenderer;
      if (!r || typeof r !== "object") return;
      const videoId = typeof r.videoId === "string" ? r.videoId : "";
      if (!videoId) return;
      const idxText = getText(r.index);
      const trackNo = idxText && /^\d+$/.test(idxText) ? Number(idxText) : undefined;
      out.push({
        videoId,
        title: getText(r.title) || "",
        thumbnail: pickThumbnailUrl(r.thumbnail) || "",
        trackNo
      });
    });
    return out;
  }

  function parseChannelVideoRenderers(root) {
    const out = [];
    walk(root, (node) => {
      const r = node?.videoRenderer;
      if (!r || typeof r !== "object") return;
      const videoId = typeof r.videoId === "string" ? r.videoId : "";
      if (!videoId) return;
      out.push({
        videoId,
        title: getText(r.title) || "",
        thumbnail: pickThumbnailUrl(r.thumbnail) || "",
        publishedText: getText(r.publishedTimeText) || ""
      });
    });
    return out;
  }

  function toCatalogItemsFromPlaylist({ playlistId, playlistTitle, artist, cover, videos }) {
    const albumId = `youtube-playlist-${playlistId}`;
    const albumUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

    const albumItem = {
      id: albumId,
      type: "album",
      title: playlistTitle || "(未命名 YouTube 专辑)",
      artist: artist || "",
      releaseDate: "",
      cover: cover || (videos[0]?.thumbnail || ""),
      trackCount: videos.length || undefined,
      tags: ["youtube", "album"].concat(playlistTitle ? [playlistTitle] : []),
      links: [{ platform: "youtube", label: "YouTube · Playlist", url: albumUrl }],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube playlist embed",
          url: `https://www.youtube.com/embed/videoseries?list=${playlistId}`,
          height: 360
        }
      ]
    };

    const songs = videos.map((v, i) => {
      const trackNo = Number.isFinite(v.trackNo) ? v.trackNo : i + 1;
      const watchUrl = `https://www.youtube.com/watch?v=${v.videoId}&list=${playlistId}`;
      return {
        id: `youtube-video-${v.videoId}`,
        type: "song",
        title: v.title || "",
        artist: artist || "",
        releaseDate: "",
        cover: v.thumbnail || "",
        collectionId: albumId,
        trackNo,
        tags: ["youtube", "song"].concat(playlistTitle ? [playlistTitle] : []),
        links: [{ platform: "youtube", label: "YouTube · Video", url: watchUrl }],
        embeds: [
          {
            platform: "youtube",
            label: "YouTube embed",
            url: `https://www.youtube.com/embed/${v.videoId}`,
            height: 220
          }
        ]
      };
    });

    return [albumItem, ...songs];
  }

  function toCatalogItemsFromChannelVideos({ channelId, channelName, videos }) {
    const uploadsListId = `UU${channelId.slice(2)}`;
    const collectionId = `youtube-channel-uploads-${channelId}`;
    const cover = videos[0]?.thumbnail || "";

    const collectionItem = {
      id: collectionId,
      type: "collection",
      title: "YouTube Uploads",
      artist: channelName || "",
      releaseDate: "",
      cover,
      trackCount: videos.length || undefined,
      tags: ["youtube", "channel", "uploads"],
      links: [
        { platform: "youtube", label: "YouTube · Channel", url: `https://www.youtube.com/channel/${channelId}` },
        { platform: "youtube", label: "YouTube · Uploads", url: `https://www.youtube.com/playlist?list=${uploadsListId}` }
      ],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube uploads playlist embed",
          url: `https://www.youtube.com/embed/videoseries?list=${uploadsListId}`,
          height: 360
        }
      ]
    };

    const songs = videos.map((v, i) => ({
      id: `youtube-video-${v.videoId}`,
      type: "song",
      title: v.title || "",
      artist: channelName || "",
      releaseDate: "",
      cover: v.thumbnail || "",
      collectionId,
      trackNo: i + 1,
      tags: ["youtube", "song"],
      links: [{ platform: "youtube", label: "YouTube · Video", url: `https://www.youtube.com/watch?v=${v.videoId}` }],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube embed",
          url: `https://www.youtube.com/embed/${v.videoId}`,
          height: 220
        }
      ]
    }));

    return [collectionItem, ...songs];
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function ensureUi() {
    const id = "music-board-export-btn";
    if (document.getElementById(id)) return;

    const btn = document.createElement("button");
    btn.id = id;
    btn.type = "button";
    btn.textContent = "Export → Music Board";
    btn.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:999999",
      "padding:10px 12px",
      "border-radius:12px",
      "border:1px solid rgba(255,255,255,.18)",
      "background:rgba(0,0,0,.72)",
      "color:#fff",
      "font:12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      "backdrop-filter: blur(10px)",
      "cursor:pointer"
    ].join(";");

    const tip = document.createElement("div");
    tip.id = "music-board-export-tip";
    tip.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:54px",
      "z-index:999999",
      "max-width:320px",
      "padding:10px 12px",
      "border-radius:12px",
      "border:1px solid rgba(0,0,0,.08)",
      "background:rgba(255,255,255,.92)",
      "color:#111",
      "font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      "box-shadow: 0 10px 30px rgba(0,0,0,.18)",
      "display:none",
      "white-space:pre-wrap"
    ].join(";");
    tip.textContent = "";

    function showTip(message) {
      tip.textContent = message;
      tip.style.display = "block";
      clearTimeout(showTip._t);
      showTip._t = setTimeout(() => (tip.style.display = "none"), 4800);
    }

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Exporting…";
      try {
        const url = new URL(location.href);
        const listId = url.searchParams.get("list");

        // Prefer playlist export if we're on a playlist.
        if (listId) {
          showTip("Detected playlist. Fetching items (may take a bit)…");
          const out = await exportPlaylist(listId);
          const jsonText = JSON.stringify(out, null, 2) + "\n";
          const ok = await copyToClipboard(jsonText);
          downloadJson(`music-board-youtube-playlist-${listId}.json`, out);
          showTip(ok ? "Done. JSON copied + downloaded." : "Done. JSON downloaded.");
          return;
        }

        // Otherwise attempt channel videos export.
        showTip("Detected non-playlist page. Trying channel videos export…");
        const out = await exportChannelVideos();
        const jsonText = JSON.stringify(out, null, 2) + "\n";
        const ok = await copyToClipboard(jsonText);
        downloadJson(`music-board-youtube-channel.json`, out);
        showTip(ok ? "Done. JSON copied + downloaded." : "Done. JSON downloaded.");
      } catch (err) {
        showTip(`Export failed: ${err?.message || String(err)}`);
        console.error(err);
      } finally {
        btn.disabled = false;
        btn.textContent = "Export → Music Board";
      }
    });

    document.documentElement.appendChild(btn);
    document.documentElement.appendChild(tip);
  }

  async function exportPlaylist(playlistId) {
    const initialData = getInitialData();
    if (!initialData) throw new Error("Missing ytInitialData.");

    const metadata = findFirstRenderer(initialData, "playlistMetadataRenderer");
    const header = findFirstRenderer(initialData, "playlistHeaderRenderer");
    const playlistTitle =
      (metadata && typeof metadata.title === "string" ? metadata.title : "") ||
      getText(header?.title) ||
      "";
    const artist = getText(header?.ownerText) || getText(header?.subtitle) || "";
    const cover =
      pickThumbnailUrl(header?.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail) ||
      pickThumbnailUrl(header?.playlistHeaderBanner?.playlistVideoThumbnailRenderer?.thumbnail) ||
      "";

    let videos = parsePlaylistVideoRenderers(initialData);
    videos = uniqBy(videos, (v) => v.videoId);

    let token = findAllContinuationTokens(initialData)[0] || "";
    let pages = 0;
    while (token && videos.length < APP.maxItems && pages < APP.maxFetchPages) {
      pages++;
      const res = await youtubeiBrowse({ continuation: token });
      const newVideos = uniqBy(parsePlaylistVideoRenderers(res), (v) => v.videoId);
      const before = videos.length;
      videos = uniqBy(videos.concat(newVideos), (v) => v.videoId);
      const nextToken = findAllContinuationTokens(res)[0] || "";
      token = nextToken && videos.length > before ? nextToken : "";
      await sleep(120);
    }

    // Ensure stable ordering by trackNo, fallback to current order.
    const hasTrackNo = videos.some((v) => Number.isFinite(v.trackNo));
    if (hasTrackNo) {
      videos.sort((a, b) => {
        const aNo = Number.isFinite(a.trackNo) ? a.trackNo : 1e9;
        const bNo = Number.isFinite(b.trackNo) ? b.trackNo : 1e9;
        return aNo - bNo;
      });
    }

    const items = toCatalogItemsFromPlaylist({ playlistId, playlistTitle, artist, cover, videos });
    return [{ source: location.href, items }];
  }

  function extractChannelIdFromInitial(initialData) {
    const meta = initialData?.metadata?.channelMetadataRenderer;
    const id = meta?.externalId;
    return typeof id === "string" && id.startsWith("UC") ? id : "";
  }

  function extractChannelNameFromInitial(initialData) {
    const meta = initialData?.metadata?.channelMetadataRenderer;
    const name = meta?.title;
    return typeof name === "string" ? name : "";
  }

  async function exportChannelVideos() {
    const initialData = getInitialData();
    if (!initialData) throw new Error("Missing ytInitialData.");

    const channelId =
      extractChannelIdFromInitial(initialData) ||
      (location.pathname.startsWith("/channel/") ? (location.pathname.split("/")[2] || "") : "");
    if (!channelId || !channelId.startsWith("UC")) {
      throw new Error("This page does not look like a channel page. Open the channel Videos tab and retry.");
    }

    const channelName = extractChannelNameFromInitial(initialData);

    let videos = parseChannelVideoRenderers(initialData);
    videos = uniqBy(videos, (v) => v.videoId);

    let token = findAllContinuationTokens(initialData)[0] || "";
    let pages = 0;
    while (token && videos.length < APP.maxItems && pages < APP.maxFetchPages) {
      pages++;
      const res = await youtubeiBrowse({ continuation: token });
      const newVideos = uniqBy(parseChannelVideoRenderers(res), (v) => v.videoId);
      const before = videos.length;
      videos = uniqBy(videos.concat(newVideos), (v) => v.videoId);
      const nextToken = findAllContinuationTokens(res)[0] || "";
      token = nextToken && videos.length > before ? nextToken : "";
      await sleep(120);
    }

    const items = toCatalogItemsFromChannelVideos({ channelId, channelName, videos });
    return [{ source: location.href, items }];
  }

  // Keep UI alive across SPA navigations.
  ensureUi();
  const mo = new MutationObserver(() => ensureUi());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
