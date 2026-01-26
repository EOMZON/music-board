#!/usr/bin/env node
/**
 * Sync NetEase album + track data into docs/music-board/catalog.json using the public album API.
 *
 * This fetches:
 *   https://music.163.com/api/v1/album/<albumId>
 *
 * Usage:
 *   node scripts/music-board/sync-netease-albums-api.mjs docs/music-board/catalog.json
 *
 * Sync a specific album (recommended for "add one album" workflow):
 *   node scripts/music-board/sync-netease-albums-api.mjs docs/music-board/catalog.json --album 359139954
 *   node scripts/music-board/sync-netease-albums-api.mjs docs/music-board/catalog.json --album-url "https://music.163.com/#/album?id=359139954"
 *
 * Behavior:
 * - Finds existing items with id like `netease-album-<id>`
 * - If syncing specific album ids, it will auto-create a stub album item if missing
 * - Fetches album details and songlist
 * - Merges album metadata (title/cover/releaseDate/trackCount)
 * - Adds/updates songs as `netease-song-<id>` with embeds for in-page playback
 */

import fs from "node:fs/promises";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function platformLabel(platform) {
  const map = {
    netease: "网易云"
  };
  return map[platform] || platform || "Link";
}

function addTags(existing, tags) {
  const set = new Set(ensureArray(existing).filter(Boolean));
  for (const t of ensureArray(tags)) if (t) set.add(t);
  return Array.from(set);
}

function toISODate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeCover(url) {
  const raw = (url ?? "").toString().trim();
  if (!raw) return "";
  const noQuery = raw.split("?")[0];
  return noQuery.replace(/^http:\/\//i, "https://");
}

function pickArtistName(song) {
  const ars = ensureArray(song?.ar);
  const names = ars.map((a) => a?.name).filter(Boolean);
  return names.join(" / ");
}

function mergeLinks(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const l of ensureArray(existing).concat(ensureArray(incoming))) {
    const platform = (l?.platform || "").toString();
    const url = (l?.url || "").toString();
    if (!platform && !url) continue;
    const key = `${platform}::${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform,
      label: l?.label || (platform ? platformLabel(platform) : "Link"),
      url
    });
  }
  return out;
}

function mergeEmbeds(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const e of ensureArray(existing).concat(ensureArray(incoming))) {
    const platform = (e?.platform || "").toString();
    const url = (e?.url || "").toString();
    if (!url) continue;
    const key = `${platform}::${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform,
      label: e?.label || (platform ? platformLabel(platform) : "Embed"),
      url,
      height: Number.isFinite(e?.height) ? e.height : undefined
    });
  }
  return out;
}

function parseNeteaseAlbumId(itemId) {
  const m = (itemId ?? "").toString().match(/^netease-album-(\d+)$/);
  return m ? m[1] : null;
}

function parseAlbumIdFromUrl(urlString) {
  const raw = (urlString ?? "").toString().trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.replace("#/", ""));
    const id = u.searchParams.get("id");
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function ensureAlbumStub(byId, albumId) {
  const id = `netease-album-${albumId}`;
  if (byId.has(id)) return;
  byId.set(id, {
    id,
    type: "album",
    title: "",
    artist: "",
    releaseDate: "",
    cover: "",
    tags: ["netease", "album"],
    links: [
      {
        platform: "netease",
        label: "网易云 · 专辑",
        url: `https://music.163.com/#/album?id=${albumId}`
      }
    ],
    embeds: []
  });
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "music-board/1.0 (sync-netease-albums-api)",
      "Referer": "https://music.163.com/"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.json();
}

function toAlbumItemFromApi(albumId, api) {
  const album = api?.album || {};
  const cover = normalizeCover(album?.picUrl || album?.blurPicUrl || "");
  const releaseDate = toISODate(album?.publishTime || 0) || "";
  const trackCount = Number.isFinite(album?.size) ? album.size : undefined;

  return {
    id: `netease-album-${albumId}`,
    type: "album",
    title: album?.name || "(未命名专辑)",
    artist: album?.artist?.name || "",
    releaseDate,
    cover,
    trackCount,
    tags: ["netease", "album"].concat(album?.name ? [album.name] : []),
    links: [
      {
        platform: "netease",
        label: "网易云 · 专辑",
        url: `https://music.163.com/#/album?id=${albumId}`
      }
    ],
    embeds: []
  };
}

function toSongItemFromApi(song, albumId, albumMeta) {
  const songId = song?.id;
  const title = song?.name || "(未命名)";
  const artist = pickArtistName(song) || albumMeta?.artist || "";
  const cover = normalizeCover(song?.al?.picUrl || albumMeta?.cover || "");
  const releaseDate = albumMeta?.releaseDate || "";
  const albumName = albumMeta?.title || song?.al?.name || "";

  return {
    id: `netease-song-${songId}`,
    type: "song",
    title,
    artist,
    releaseDate,
    cover,
    collectionId: `netease-album-${albumId}`,
    tags: ["netease", "song"].concat(albumName ? [albumName] : []),
    links: [
      {
        platform: "netease",
        label: "网易云 · 单曲",
        url: `https://music.163.com/#/song?id=${songId}`
      }
    ],
    embeds: [
      {
        platform: "netease",
        label: "网易云外链播放器（如不可用可删）",
        url: `https://music.163.com/outchain/player?type=2&id=${songId}&auto=0&height=66`,
        height: 86
      }
    ]
  };
}

function mergeAlbum(existing, incoming) {
  const next = { ...(existing || {}), ...(incoming || {}) };
  next.type = "album";
  next.tags = addTags(next.tags, incoming.tags);
  next.links = mergeLinks(existing?.links, incoming?.links);

  if (!existing?.title || existing.title === "(未命名专辑)") next.title = incoming.title;
  if (!existing?.artist) next.artist = incoming.artist;
  if (!existing?.cover) next.cover = incoming.cover;
  if (!existing?.releaseDate) next.releaseDate = incoming.releaseDate;
  if (!Number.isFinite(existing?.trackCount) && Number.isFinite(incoming?.trackCount)) next.trackCount = incoming.trackCount;

  return next;
}

function mergeSong(existing, incoming) {
  const next = { ...(existing || {}), ...(incoming || {}) };
  next.type = "song";
  next.collectionId = incoming.collectionId || existing?.collectionId || "";
  next.tags = addTags(next.tags, incoming.tags);
  next.links = mergeLinks(existing?.links, incoming?.links);
  next.embeds = mergeEmbeds(existing?.embeds, incoming?.embeds);

  if (!existing?.title || existing.title === "(未命名)") next.title = incoming.title;
  if (!existing?.artist) next.artist = incoming.artist;
  if (!existing?.cover) next.cover = incoming.cover;
  if (!existing?.releaseDate) next.releaseDate = incoming.releaseDate;

  return next;
}

async function main() {
  const args = process.argv.slice(2);
  const catalogPath = args[0];
  if (args.includes("--help") || args.includes("-h")) {
    console.error(
      [
        "Usage:",
        "  node scripts/music-board/sync-netease-albums-api.mjs <catalog.json> [--album <id> ...] [--album-url <url> ...]",
        "",
        "Examples:",
        '  node scripts/music-board/sync-netease-albums-api.mjs docs/music-board/catalog.json --album 359139954',
        '  node scripts/music-board/sync-netease-albums-api.mjs docs/music-board/catalog.json --album-url "https://music.163.com/#/album?id=359139954"'
      ].join("\n")
    );
    process.exit(0);
  }

  if (!catalogPath) {
    console.error("Missing <catalog.json>. Use --help for usage.");
    process.exit(1);
  }

  const selectedAlbumIds = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--album" && args[i + 1]) {
      const id = args[i + 1];
      if (/^\d+$/.test(id)) selectedAlbumIds.push(id);
      i += 1;
      continue;
    }
    if (a === "--album-url" && args[i + 1]) {
      const id = parseAlbumIdFromUrl(args[i + 1]);
      if (id) selectedAlbumIds.push(id);
      i += 1;
      continue;
    }
  }

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);
  const byId = new Map(items.map((it) => [it?.id, it]));

  const albumIds = Array.from(
    new Set(
      (selectedAlbumIds.length > 0
        ? selectedAlbumIds
        : items.map((it) => parseNeteaseAlbumId(it?.id)).filter(Boolean)
      ).filter(Boolean)
    )
  );

  if (albumIds.length === 0) {
    console.error("No NetEase album ids found. Provide existing `netease-album-<id>` items, or pass `--album/--album-url`.");
    process.exit(1);
  }

  let albumsUpdated = 0;
  let songsAdded = 0;
  let songsUpdated = 0;

  for (const albumId of albumIds) {
    ensureAlbumStub(byId, albumId);
    const url = `https://music.163.com/api/v1/album/${albumId}`;
    const api = await fetchJson(url);
    const incomingAlbum = toAlbumItemFromApi(albumId, api);
    const prevAlbum = byId.get(incomingAlbum.id);
    byId.set(incomingAlbum.id, mergeAlbum(prevAlbum, incomingAlbum));
    albumsUpdated += 1;

    const albumMeta = byId.get(incomingAlbum.id);
    const songs = ensureArray(api?.songs).filter((s) => Number.isFinite(s?.id));
    for (const s of songs) {
      const incomingSong = toSongItemFromApi(s, albumId, albumMeta);
      const prevSong = byId.get(incomingSong.id);
      if (prevSong) {
        byId.set(incomingSong.id, mergeSong(prevSong, incomingSong));
        songsUpdated += 1;
      } else {
        byId.set(incomingSong.id, incomingSong);
        songsAdded += 1;
      }
    }
  }

  catalog.items = Array.from(byId.values());
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ albumsSynced: albumsUpdated, songsAdded, songsUpdated }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
