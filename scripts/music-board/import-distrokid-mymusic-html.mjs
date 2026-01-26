#!/usr/bin/env node
/**
 * Import a DistroKid "My music" HTML snapshot into a catalog.json.
 *
 * This creates/updates stub album items keyed by `distrokid-album-<albumuuid>`.
 * The snapshot typically contains: title, artist, cover, trackCount, and store icons.
 *
 * Notes:
 * - The My Music list page does NOT reliably include release date or UPC.
 *   Use `import-distrokid-album-html.mjs` to enrich with releaseDate/UPC/ISRC.
 *
 * Usage:
 *   node scripts/music-board/import-distrokid-mymusic-html.mjs <mymusic.html> <catalog.json>
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

function addTag(tags, tag) {
  const set = new Set(ensureArray(tags).filter(Boolean));
  set.add(tag);
  return Array.from(set);
}

function normalizeCover(url) {
  const raw = (url ?? "").toString().trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://")) return raw.replace(/^http:\/\//i, "https://");
  return raw;
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

function platformLabel(platform) {
  const map = {
    netease: "网易云",
    qq: "QQ 音乐",
    spotify: "Spotify",
    apple: "Apple Music",
    youtube: "YouTube Music",
    tiktok: "TikTok",
    amazon: "Amazon Music",
    deezer: "Deezer",
    tidal: "TIDAL",
    pandora: "Pandora",
    qobuz: "Qobuz",
    kkbox: "KKBOX",
    jiosaavn: "JioSaavn",
    anghami: "Anghami",
    boomplay: "Boomplay",
    joox: "JOOX",
    instagram: "Instagram / Facebook"
  };
  return map[platform] || platform || "Link";
}

function platformKey(platform) {
  return (platform ?? "").toString().trim().toLowerCase().replace(/\s+/g, "");
}

function mapIconToPlatform(iconName) {
  const icon = (iconName ?? "").toString().trim().toLowerCase();
  const pick = (platform, label) => ({ platform, label: label || platformLabel(platform), url: "" });

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

function looksDefaultLabel(label, platform) {
  const l = (label ?? "").toString().trim().toLowerCase();
  const p = (platform ?? "").toString().trim().toLowerCase();
  if (!l) return true;
  return l === p || l === "link";
}

function mergeLinks(existing, incoming) {
  const canonicalPlatform = (platform) => {
    const k = platformKey(platform);
    if (k === "facebook") return "instagram";
    return (platform ?? "").toString().trim();
  };

  const byPlatform = new Map();
  for (const l of ensureArray(existing)) {
    const canonical = canonicalPlatform(l?.platform);
    const p = platformKey(canonical);
    if (!p) continue;
    byPlatform.set(p, { ...l, platform: canonical });
  }
  for (const l of ensureArray(incoming)) {
    const canonical = canonicalPlatform(l?.platform);
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

function parseMymusicHtml(html) {
  const releases = [];

  const rowRe = /<a\b[^>]*class="[^"]*\brelease-row\b[^"]*"[\s\S]*?<\/a>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const block = m[0];

    const albumuuid =
      (block.match(/albumuuid=([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{16})/i) || [])[1] || "";
    if (!albumuuid) continue;

    const coverRaw =
      (block.match(/artwork-thumb"[^>]*style="[^"]*background-image:url\(['"]?([^'")]+)['"]?\)/i) || [])[1] || "";
    const cover = normalizeCover(decodeHtml(coverRaw));

    const titleRaw =
      (block.match(/<div class="tableCell item-title"[\s\S]*?<span[^>]*translate="no"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "";
    const title = stripTags(titleRaw);

    const artistRaw =
      (block.match(/<div style="color:#BBB;"[^>]*translate="no"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "";
    const artist = stripTags(artistRaw);

    const trackCountMatch = block.match(/(\d+)\s+tracks/i);
    const trackCount = trackCountMatch ? Number(trackCountMatch[1]) : NaN;

    const icons = Array.from(block.matchAll(/src="\/images\/icons\/([a-z0-9]+)\.png"/gi)).map((x) => x[1]);
    const links = [];
    for (const icon of icons) links.push(mapIconToPlatform(icon));

    releases.push({
      albumuuid,
      title,
      artist,
      cover,
      trackCount: Number.isFinite(trackCount) ? trackCount : undefined,
      links
    });
  }

  const dedup = new Map();
  for (const r of releases) {
    const prev = dedup.get(r.albumuuid);
    if (!prev) {
      dedup.set(r.albumuuid, r);
      continue;
    }
    const next = { ...prev };
    if (!next.title && r.title) next.title = r.title;
    if (!next.artist && r.artist) next.artist = r.artist;
    if (!next.cover && r.cover) next.cover = r.cover;
    if (!Number.isFinite(next.trackCount) && Number.isFinite(r.trackCount)) next.trackCount = r.trackCount;
    next.links = mergeLinks(next.links, r.links);
    dedup.set(r.albumuuid, next);
  }

  return Array.from(dedup.values());
}

function toAlbumItem(r) {
  const id = `distrokid-album-${r.albumuuid}`;
  return {
    id,
    type: "album",
    title: r.title || "(未命名专辑)",
    artist: r.artist || "",
    releaseDate: "",
    cover: r.cover || "",
    trackCount: Number.isFinite(r.trackCount) ? r.trackCount : undefined,
    tags: ["distrokid", "album"].concat(r.title ? [r.title] : []),
    links: ensureArray(r.links),
    embeds: [],
    refs: { distrokid: { albumuuid: r.albumuuid } }
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
  if (!Number.isFinite(next.trackCount) && Number.isFinite(incoming.trackCount)) next.trackCount = incoming.trackCount;
  if (!next.refs) next.refs = {};
  next.refs = { ...next.refs, distrokid: { ...(next.refs?.distrokid || {}), ...(incoming.refs?.distrokid || {}) } };

  return next;
}

async function main() {
  const [htmlPath, catalogPath] = process.argv.slice(2);
  if (!htmlPath || !catalogPath) {
    console.error("Usage: node scripts/music-board/import-distrokid-mymusic-html.mjs <mymusic.html> <catalog.json>");
    process.exit(1);
  }

  const html = await fs.readFile(htmlPath, "utf8");
  const releases = parseMymusicHtml(html);
  if (releases.length === 0) {
    console.error("No releases found in HTML. Please confirm it is a saved DistroKid My Music page.");
    process.exit(1);
  }

  const rawCatalog = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(rawCatalog);
  if (!catalog || typeof catalog !== "object") throw new Error("catalog.json is not an object");

  const items = ensureArray(catalog.items);
  const byId = new Map(items.map((it) => [it?.id, it]));

  let added = 0;
  let updated = 0;

  for (const r of releases) {
    const incoming = toAlbumItem(r);
    const prev = byId.get(incoming.id);
    if (prev) {
      byId.set(incoming.id, mergeAlbum(prev, incoming));
      updated += 1;
    } else {
      byId.set(incoming.id, incoming);
      added += 1;
    }
  }

  catalog.items = Array.from(byId.values());
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  const relCatalog = path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath;
  console.log(JSON.stringify({ releasesFound: releases.length, added, updated, catalog: relCatalog }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
