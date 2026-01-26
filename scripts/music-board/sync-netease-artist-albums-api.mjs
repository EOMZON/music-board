#!/usr/bin/env node
/**
 * Sync ALL NetEase albums for an artist into docs/music-board/catalog.json, including tracks (embeds).
 *
 * APIs used (public):
 * - Artist albums (paginated): https://music.163.com/api/artist/albums/<artistId>?limit=<n>&offset=<n>
 * - Album details + songs:     https://music.163.com/api/v1/album/<albumId>
 *
 * Usage:
 *   node 3_clone_douyin/tools/已发布/scripts/music-board/sync-netease-artist-albums-api.mjs \
 *     30005081 \
 *     3_clone_douyin/tools/已发布/docs/music-board/catalog.json
 *
 * Optional:
 *   --limit 10   (page size for artist albums pagination)
 */

import fs from "node:fs/promises";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
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
      label: l?.label || "",
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
      label: e?.label || "",
      url,
      height: Number.isFinite(e?.height) ? e.height : undefined
    });
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "music-board/1.0 (sync-netease-artist-albums-api)",
      "Referer": "https://music.163.com/"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.json();
}

function toAlbumItemFromArtistList(album, artistNameFallback = "") {
  const albumId = album?.id;
  const title = album?.name || "(未命名专辑)";
  const cover = normalizeCover(album?.picUrl || album?.blurPicUrl || "");
  const releaseDate = toISODate(album?.publishTime || 0) || "";
  const trackCount = Number.isFinite(album?.size) ? album.size : undefined;
  const artist = album?.artist?.name || artistNameFallback || "";

  return {
    id: `netease-album-${albumId}`,
    type: "album",
    title,
    artist,
    releaseDate,
    cover,
    trackCount,
    tags: ["netease", "album"].concat(title ? [title] : []),
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

function toAlbumItemFromAlbumApi(albumId, api) {
  const album = api?.album || {};
  const title = album?.name || "(未命名专辑)";
  const cover = normalizeCover(album?.picUrl || album?.blurPicUrl || "");
  const releaseDate = toISODate(album?.publishTime || 0) || "";
  const trackCount = Number.isFinite(album?.size) ? album.size : undefined;
  const artist = album?.artist?.name || "";

  return {
    id: `netease-album-${albumId}`,
    type: "album",
    title,
    artist,
    releaseDate,
    cover,
    trackCount,
    tags: ["netease", "album"].concat(title ? [title] : []),
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

function toSongItemFromAlbumApi(song, albumId, albumMeta) {
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

async function fetchAllArtistAlbums(artistId, limit) {
  let offset = 0;
  const out = [];
  for (let guard = 0; guard < 50; guard += 1) {
    const url = `https://music.163.com/api/artist/albums/${artistId}?limit=${limit}&offset=${offset}`;
    const json = await fetchJson(url);
    if (json?.code !== 200) throw new Error(`Unexpected response code for artist albums: ${json?.code}`);
    const chunk = ensureArray(json?.hotAlbums);
    out.push(...chunk);
    if (!json?.more) break;
    offset += limit;
    if (chunk.length === 0) break;
  }
  const dedup = new Map();
  for (const a of out) if (Number.isFinite(a?.id)) dedup.set(a.id, a);
  return Array.from(dedup.values());
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let limit = 10;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--limit") {
      const n = Number(args[i + 1] || "");
      if (Number.isFinite(n) && n > 0) limit = Math.min(50, Math.floor(n));
      i += 1;
      continue;
    }
    positional.push(a);
  }
  return { positional, limit };
}

async function main() {
  const { positional, limit } = parseArgs(process.argv);
  const [artistId, catalogPath] = positional;
  if (!artistId || !/^\d+$/.test(artistId) || !catalogPath) {
    console.error("Usage: node sync-netease-artist-albums-api.mjs <artistId> <catalog.json> [--limit N]");
    process.exit(1);
  }

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);
  const byId = new Map(items.map((it) => [it?.id, it]));

  const artistAlbums = await fetchAllArtistAlbums(artistId, limit);
  const artistName = artistAlbums[0]?.artist?.name || catalog?.profile?.name || "";

  let albumsAdded = 0;
  let albumsUpdated = 0;
  let songsAdded = 0;
  let songsUpdated = 0;

  for (const a of artistAlbums) {
    if (!Number.isFinite(a?.id)) continue;
    const albumId = String(a.id);
    const incomingAlbumFromList = toAlbumItemFromArtistList(a, artistName);
    const prevAlbum = byId.get(incomingAlbumFromList.id);
    if (prevAlbum) {
      byId.set(incomingAlbumFromList.id, mergeAlbum(prevAlbum, incomingAlbumFromList));
      albumsUpdated += 1;
    } else {
      byId.set(incomingAlbumFromList.id, incomingAlbumFromList);
      albumsAdded += 1;
    }

    const albumApi = await fetchJson(`https://music.163.com/api/v1/album/${albumId}`);
    const incomingAlbumFromApi = toAlbumItemFromAlbumApi(albumId, albumApi);
    const curAlbum = byId.get(incomingAlbumFromApi.id);
    byId.set(incomingAlbumFromApi.id, mergeAlbum(curAlbum, incomingAlbumFromApi));

    const albumMeta = byId.get(incomingAlbumFromApi.id);
    const songs = ensureArray(albumApi?.songs).filter((s) => Number.isFinite(s?.id));
    for (const s of songs) {
      const incomingSong = toSongItemFromAlbumApi(s, albumId, albumMeta);
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
  console.log(JSON.stringify({ artistId, artistAlbums: artistAlbums.length, albumsAdded, albumsUpdated, songsAdded, songsUpdated }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

