#!/usr/bin/env node
/**
 * Import a DistroKid album dashboard HTML snapshot into a catalog.json.
 *
 * Extracts:
 * - albumuuid, title, artist, cover, releaseDate, upc
 * - store icons (some stores provide direct URLs, e.g. Spotify)
 * - track list (title + ISRC)
 *
 * Merging rules:
 * - Album match priority: UPC > releaseDate+title > distrokid albumuuid.
 * - Track match priority: ISRC > title (within matched album).
 *
 * Usage:
 *   node scripts/music-board/import-distrokid-album-html.mjs <album1.html> [album2.html ...] <catalog.json>
 */

import fs from "node:fs/promises";
import path from "node:path";

function decodeHtml(text) {
  return (text ?? "")
    .toString()
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function stripTags(text) {
  return decodeHtml((text ?? "").toString().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCover(url) {
  const raw = (url ?? "").toString().trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://")) return raw.replace(/^http:\/\//i, "https://");
  return raw;
}

function toISODateFromEnglish(text) {
  const raw = (text ?? "").toString().trim();
  if (!raw) return "";
  const m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return "";
  const month = m[1].toLowerCase();
  const day = Number(m[2]);
  const year = Number(m[3]);
  const map = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
  };
  const mm = map[month];
  if (!mm || !Number.isFinite(day) || !Number.isFinite(year)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(mm)}-${pad(day)}`;
}

function normalizeKey(text) {
  return (text ?? "")
    .toString()
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s·•—–\-_/\\:：,，.。!?！？'"“”‘’()（）\\[\\]{}<>]+/g, "");
}

function platformKey(platform) {
  return (platform ?? "").toString().trim().toLowerCase().replace(/\s+/g, "");
}

function slugify(text) {
  return (text ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function mapIconToPlatform(iconName) {
  const icon = (iconName ?? "").toString().trim().toLowerCase();
  const pick = (platform, label) => ({ platform, label, url: "" });

  if (icon === "spotify") return pick("spotify", "Spotify");
  if (icon === "applemusic" || icon === "itunes") return pick("apple", "Apple Music");
  if (icon === "youtubemusic") return pick("youtube", "YouTube Music");
  if (icon === "tiktok") return pick("tiktok", "TikTok");
  if (icon === "netease") return pick("netease", "网易云");
  if (icon === "tencent") return pick("qq", "QQ 音乐");

  if (icon === "amazon") return pick("amazon", "Amazon Music");
  if (icon === "deezer") return pick("deezer", "Deezer");
  if (icon === "tidal") return pick("tidal", "TIDAL");
  if (icon === "rdio") return pick("pandora", "Pandora");
  if (icon === "qobuz") return pick("qobuz", "Qobuz");
  if (icon === "saavn") return pick("jiosaavn", "JioSaavn");
  if (icon === "anghami") return pick("anghami", "Anghami");
  if (icon === "boomplay") return pick("boomplay", "Boomplay");
  if (icon === "joox") return pick("joox", "JOOX");
  if (icon === "facebook") return pick("instagram", "Instagram / Facebook");

  const slug = slugify(icon);
  return pick(slug || "link", iconName);
}

function mergeLinks(existing, incoming) {
  const byPlatform = new Map();
  for (const l of ensureArray(existing)) {
    const canonical = (() => {
      const k = platformKey(l?.platform);
      if (k === "facebook") return "instagram";
      return (l?.platform ?? "").toString().trim();
    })();
    const p = platformKey(canonical);
    if (!p) continue;
    byPlatform.set(p, { ...l, platform: canonical });
  }

  const looksDefaultLabel = (label, platform) => {
    const l = (label ?? "").toString().trim().toLowerCase();
    const p = (platform ?? "").toString().trim().toLowerCase();
    if (!l) return true;
    return l === p || l === "link";
  };

  for (const l of ensureArray(incoming)) {
    const canonical = (() => {
      const k = platformKey(l?.platform);
      if (k === "facebook") return "instagram";
      return (l?.platform ?? "").toString().trim();
    })();
    const p = platformKey(canonical);
    if (!p) continue;
    const prev = byPlatform.get(p);
    if (!prev) {
      byPlatform.set(p, { ...l, platform: canonical });
      continue;
    }
    const next = { ...prev };
    if (l?.label && looksDefaultLabel(next.label, next.platform)) next.label = l.label;
    if ((!next.url || next.url === "") && l?.url) next.url = l.url;
    byPlatform.set(p, next);
  }
  return Array.from(byPlatform.values());
}

function addTag(tags, tag) {
  const set = new Set(ensureArray(tags).filter(Boolean));
  set.add(tag);
  return Array.from(set);
}

function parseAlbumuuid(html) {
  return (
    (html.match(/albumuuid\s*=\s*["']([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{16})["']/i) || [])[1] ||
    (html.match(/albumuuid=([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{16})/i) || [])[1] ||
    ""
  );
}

function parseAlbumMeta(html) {
  const title = stripTags((html.match(/<span[^>]*title="Album title"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "");
  const artist = stripTags((html.match(/<span[^>]*title="Artist name"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "");
  const coverRaw = (html.match(/<img[^>]*class="album-image"[^>]*src="([^"]+)"/i) || [])[1] || "";
  const cover = normalizeCover(decodeHtml(coverRaw));

  const releaseRaw =
    (html.match(/<span>\s*Release date:\s*<\/span>\s*<span[^>]*class="info-value"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "";
  const releaseDate = toISODateFromEnglish(stripTags(releaseRaw));

  const upc = stripTags((html.match(/id="js-album-upc"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "");

  return { title, artist, cover, releaseDate, upc };
}

function parseStores(html) {
  const startIdx = html.indexOf('class="store-icons"');
  if (startIdx < 0) return [];
  const slice = html.slice(startIdx, startIdx + 40000);

  const links = [];
  const linkedIconRe = /<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<img\b[^>]*src="\/images\/icons\/([^"\/]+)\.png"[^>]*>/gi;
  let m;
  while ((m = linkedIconRe.exec(slice))) {
    const url = decodeHtml(m[1]);
    const icon = m[2];
    const it = mapIconToPlatform(icon);
    it.url = url;
    links.push(it);
  }

  const iconRe = /<img\b[^>]*src="\/images\/icons\/([^"\/]+)\.png"[^>]*>/gi;
  while ((m = iconRe.exec(slice))) {
    const icon = m[1];
    links.push(mapIconToPlatform(icon));
  }

  return mergeLinks([], links);
}

function parseTracks(html) {
  const parts = html.split('<div class="track-row trackRow">');
  if (parts.length <= 1) return [];
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const num = stripTags((seg.match(/<div class="track-cell track-num"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "");
    const titleRaw = (seg.match(/<div class="track-cell track-name"[\s\S]*?<span[^>]*title="([^"]+)"/i) || [])[1] || "";
    const title = stripTags(decodeHtml(titleRaw));
    const isrc = stripTags((seg.match(/<div class="isrc-value">\s*([A-Z0-9]+)\s*<\/div>/i) || [])[1] || "");
    if (!title) continue;
    out.push({ trackNo: /^\d+$/.test(num) ? Number(num) : undefined, title, isrc });
  }
  const dedup = new Map();
  for (const t of out) {
    const k = t.isrc ? `isrc:${t.isrc}` : `t:${normalizeKey(t.title)}`;
    if (!dedup.has(k)) dedup.set(k, t);
  }
  return Array.from(dedup.values());
}

function pickTrackPlatforms(albumLinks) {
  const allow = new Set(["spotify", "apple", "youtube", "tiktok", "netease", "qq"]);
  return ensureArray(albumLinks).filter((l) => allow.has(platformKey(l?.platform)));
}

function toIncomingAlbum({ albumuuid, meta, albumLinks, tracks }) {
  const id = `distrokid-album-${albumuuid}`;
  return {
    id,
    type: "album",
    title: meta.title || "(未命名专辑)",
    artist: meta.artist || "",
    releaseDate: meta.releaseDate || "",
    cover: meta.cover || "",
    trackCount: tracks.length || undefined,
    upc: meta.upc || "",
    tags: ["distrokid", "album"].concat(meta.title ? [meta.title] : []),
    links: albumLinks,
    embeds: [],
    refs: { distrokid: { albumuuid } }
  };
}

function mergeAlbum(existing, incoming) {
  const next = { ...(existing || {}) };
  next.type = "album";
  next.tags = addTag(addTag(next.tags, "distrokid"), "album");
  next.links = mergeLinks(ensureArray(next.links), ensureArray(incoming.links));

  if (!next.title || next.title === "(未命名专辑)") next.title = incoming.title;
  if (!next.artist) next.artist = incoming.artist;
  if (!next.cover) next.cover = incoming.cover;
  if (!next.releaseDate) next.releaseDate = incoming.releaseDate;
  if (!Number.isFinite(next.trackCount) && Number.isFinite(incoming.trackCount)) next.trackCount = incoming.trackCount;
  if (!next.upc && incoming.upc) next.upc = incoming.upc;
  if (!next.refs) next.refs = {};
  next.refs = { ...next.refs, distrokid: { ...(next.refs?.distrokid || {}), ...(incoming.refs?.distrokid || {}) } };
  return next;
}

function findAlbumMatch(items, incoming) {
  const upc = (incoming?.upc || "").toString().trim();
  if (upc) {
    const byUpc = items.find((it) => (it?.type === "album" || it?.type === "collection") && (it?.upc || "") === upc);
    if (byUpc) return byUpc;
  }

  const releaseDate = (incoming?.releaseDate || "").toString().trim();
  const titleKey = normalizeKey(incoming?.title || "");
  if (releaseDate && titleKey) {
    const byTitleDate = items.find(
      (it) =>
        (it?.type === "album" || it?.type === "collection") &&
        (it?.releaseDate || "") === releaseDate &&
        normalizeKey(it?.title || "") === titleKey
    );
    if (byTitleDate) return byTitleDate;
  }

  const albumuuid = incoming?.refs?.distrokid?.albumuuid || "";
  if (albumuuid) {
    const byUuid = items.find((it) => (it?.refs?.distrokid?.albumuuid || "") === albumuuid);
    if (byUuid) return byUuid;
  }

  return null;
}

function findTrackByIsrc(items, isrc) {
  const key = (isrc || "").toString().trim().toUpperCase();
  if (!key) return null;
  return items.find((it) => it?.type === "song" && (it?.isrc || "").toString().trim().toUpperCase() === key) || null;
}

function stripAlbumPrefix(trackTitle, albumTitle) {
  const t = (trackTitle ?? "").toString().trim();
  const a = (albumTitle ?? "").toString().trim();
  if (!t || !a) return t;
  const loweredT = t.normalize("NFKC");
  const loweredA = a.normalize("NFKC");
  if (loweredT.startsWith(loweredA + " ")) return t.slice(a.length + 1).trim();
  if (loweredT.startsWith(loweredA)) return t.slice(a.length).trim();
  return t;
}

function findTrackByTitleInAlbum(items, albumId, trackTitle, albumTitle) {
  const key = normalizeKey(stripAlbumPrefix(trackTitle, albumTitle));
  if (!key) return null;
  const candidates = items.filter((it) => it?.type === "song" && (it?.collectionId || "") === (albumId || ""));
  const direct = candidates.find((it) => normalizeKey(it?.title || "") === key);
  if (direct) return direct;
  const contains = candidates.find((it) => normalizeKey(it?.title || "").includes(key) || key.includes(normalizeKey(it?.title || "")));
  return contains || null;
}

function toNewTrackItem({ albumId, albumMeta, track, albumLinks }) {
  const isrc = (track?.isrc || "").toString().trim().toUpperCase();
  const id = isrc ? `isrc-${isrc}` : `distrokid-track-${albumMeta?.albumuuid || albumId}-${track?.trackNo || "x"}`;
  return {
    id,
    type: "song",
    title: stripAlbumPrefix(track?.title || "", albumMeta?.title || ""),
    artist: albumMeta?.artist || "",
    releaseDate: albumMeta?.releaseDate || "",
    cover: albumMeta?.cover || "",
    collectionId: albumId,
    isrc,
    tags: ["distrokid", "song"].concat(albumMeta?.title ? [albumMeta.title] : []),
    links: pickTrackPlatforms(albumLinks),
    embeds: [],
    refs: { distrokid: { albumuuid: albumMeta?.albumuuid || "" } }
  };
}

function mergeTrack(existing, incoming) {
  const next = { ...(existing || {}) };
  next.type = "song";
  next.tags = addTag(next.tags, "distrokid");
  next.links = mergeLinks(ensureArray(next.links), ensureArray(incoming.links));
  if (!next.isrc && incoming.isrc) next.isrc = incoming.isrc;
  if (!next.releaseDate) next.releaseDate = incoming.releaseDate;
  if (!next.cover) next.cover = incoming.cover;
  return next;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node scripts/music-board/import-distrokid-album-html.mjs <album1.html> [album2.html ...] <catalog.json>");
    process.exit(1);
  }

  const catalogPath = args[args.length - 1];
  const htmlPaths = args.slice(0, -1);

  const rawCatalog = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(rawCatalog);
  if (!catalog || typeof catalog !== "object") throw new Error("catalog.json is not an object");

  const items = ensureArray(catalog.items);
  const byId = new Map(items.map((it) => [it?.id, it]));

  let albumsFound = 0;
  let albumsCreated = 0;
  let albumsMerged = 0;
  let tracksMatched = 0;
  let tracksCreated = 0;
  let tracksUpdated = 0;

  for (const htmlPath of htmlPaths) {
    const html = await fs.readFile(htmlPath, "utf8");
    const albumuuid = parseAlbumuuid(html);
    if (!albumuuid) continue;
    albumsFound += 1;

    const meta = parseAlbumMeta(html);
    const albumLinks = parseStores(html);
    const tracks = parseTracks(html);

    const incoming = toIncomingAlbum({ albumuuid, meta: { ...meta }, albumLinks, tracks });
    const currentItems = Array.from(byId.values());
    const matchedAlbum = findAlbumMatch(currentItems, incoming);
    let albumId = "";
    let albumWasCreated = false;

    if (matchedAlbum) {
      albumId = matchedAlbum.id || "";
      byId.set(albumId, mergeAlbum(matchedAlbum, incoming));
      albumsMerged += 1;
    } else {
      albumId = incoming.id;
      byId.set(incoming.id, incoming);
      albumsCreated += 1;
      albumWasCreated = true;
    }

    const mergedAlbum = byId.get(albumId) || incoming;
    const currentAfterAlbum = Array.from(byId.values());
    const existingTracksForAlbum = currentAfterAlbum.filter(
      (it) => it?.type === "song" && (it?.collectionId || "") === albumId
    ).length;
    const canCreateTracks = albumWasCreated || (albumId.startsWith("distrokid-album-") && existingTracksForAlbum === 0);

    const albumMetaForTracks = {
      albumuuid,
      title: mergedAlbum?.title || incoming.title,
      artist: mergedAlbum?.artist || incoming.artist,
      releaseDate: mergedAlbum?.releaseDate || incoming.releaseDate,
      cover: mergedAlbum?.cover || incoming.cover
    };

    for (const t of tracks) {
      const isrc = (t?.isrc || "").toString().trim().toUpperCase();
      const current = Array.from(byId.values());

      const byIsrc = isrc ? findTrackByIsrc(current, isrc) : null;
      if (byIsrc) {
        const incomingTrack = toNewTrackItem({ albumId: byIsrc.collectionId || albumId, albumMeta: albumMetaForTracks, track: t, albumLinks });
        incomingTrack.id = byIsrc.id;
        byId.set(byIsrc.id, mergeTrack(byIsrc, incomingTrack));
        tracksUpdated += 1;
        tracksMatched += 1;
        continue;
      }

      const byTitle = findTrackByTitleInAlbum(current, albumId, t.title, albumMetaForTracks.title);
      if (byTitle) {
        const incomingTrack = toNewTrackItem({ albumId, albumMeta: albumMetaForTracks, track: t, albumLinks });
        incomingTrack.id = byTitle.id;
        byId.set(byTitle.id, mergeTrack(byTitle, incomingTrack));
        tracksUpdated += 1;
        tracksMatched += 1;
        continue;
      }

      if (canCreateTracks) {
        const incomingTrack = toNewTrackItem({ albumId, albumMeta: albumMetaForTracks, track: t, albumLinks });
        if (!byId.has(incomingTrack.id)) {
          byId.set(incomingTrack.id, incomingTrack);
          tracksCreated += 1;
        }
      }
    }
  }

  catalog.items = Array.from(byId.values());
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  const relCatalog = path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath;
  console.log(
    JSON.stringify(
      { albumsFound, albumsCreated, albumsMerged, tracksMatched, tracksUpdated, tracksCreated, catalog: relCatalog },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
