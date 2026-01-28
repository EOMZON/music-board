#!/usr/bin/env node
/**
 * Import NetEase album HTML snapshots (saved page HTML) and MERGE them into a catalog.json.
 *
 * This is the "write-to-catalog" companion of `import-netease-album-html.mjs` (which only outputs JSON).
 *
 * Usage:
 *   node scripts/music-board/import-netease-album-html-to-catalog.mjs <album1.html> [album2.html ...] <catalog.json>
 */

import fs from "node:fs/promises";
import path from "node:path";

function pickFirstMatch(re, text) {
  const m = text.match(re);
  return m ? m[1] : "";
}

function decodeHtml(text) {
  return (text ?? "")
    .toString()
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripTags(text) {
  return decodeHtml((text ?? "").toString().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function addTags(existing, tags) {
  const set = new Set(ensureArray(existing).filter(Boolean));
  for (const t of ensureArray(tags)) if (t) set.add(t);
  return Array.from(set);
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
    out.push({ platform, label: l?.label || "", url });
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

function parseAlbum(html) {
  const albumId =
    pickFirstMatch(/data-rid="(\d+)"\s+data-type="19"/, html) ||
    pickFirstMatch(/href="\/album\?id=(\d+)"/, html) ||
    "";

  if (!albumId) return null;

  const title = stripTags(pickFirstMatch(/<h2 class="f-ff2">([\s\S]*?)<\/h2>/, html));
  const artist = stripTags(pickFirstMatch(/<p class="intr"><b>歌手：<\/b>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/, html));
  const releaseDate = stripTags(pickFirstMatch(/<p class="intr"><b>发行时间：<\/b>([\s\S]*?)<\/p>/, html));
  const cover = pickFirstMatch(/<div class="cover[^"]*">[\s\S]*?<img[^>]*src="([^"]+)"/, html);

  const albumUrl = `https://music.163.com/#/album?id=${albumId}`;
  const albumItem = {
    id: `netease-album-${albumId}`,
    type: "album",
    title: title || "(未命名专辑)",
    artist: artist || "",
    releaseDate: releaseDate || "",
    cover: cover || "",
    tags: ["netease", "album"].concat(title ? [title] : []),
    links: [{ platform: "netease", label: "网易云 · 专辑", url: albumUrl }],
    embeds: []
  };

  const songRows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html))) {
    const row = rowMatch[0];
    const songId = pickFirstMatch(/data-res-id="(\d+)"\s+data-res-type="18"/, row);
    if (!songId) continue;
    const songTitle =
      stripTags(pickFirstMatch(/<b[^>]*title="([^"]+)"/, row)) || stripTags(pickFirstMatch(/<b[^>]*>([\s\S]*?)<\/b>/, row));
    songRows.push({ songId, songTitle });
  }

  const seen = new Set();
  const songs = [];
  for (const r of songRows) {
    if (seen.has(r.songId)) continue;
    seen.add(r.songId);
    const songUrl = `https://music.163.com/#/song?id=${r.songId}`;
    songs.push({
      id: `netease-song-${r.songId}`,
      type: "song",
      title: r.songTitle || "",
      artist: artist || "",
      releaseDate: releaseDate || "",
      cover: cover || "",
      collectionId: albumItem.id,
      tags: ["netease", "song"].concat(title ? [title] : []),
      links: [{ platform: "netease", label: "网易云 · 单曲", url: songUrl }],
      embeds: [
        {
          platform: "netease",
          label: "网易云外链播放器（如不可用可删）",
          url: `https://music.163.com/outchain/player?type=2&id=${r.songId}&auto=0&height=66`,
          height: 86
        }
      ]
    });
  }

  if (songs.length) albumItem.trackCount = songs.length;

  return { albumItem, songs };
}

function mergeAlbum(existing, incoming) {
  const next = { ...(existing || {}), ...(incoming || {}) };
  next.type = "album";
  next.tags = addTags(addTags(next.tags, ["netease", "album"]), ensureArray(incoming.tags));
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
  next.tags = addTags(addTags(next.tags, ["netease", "song"]), ensureArray(incoming.tags));
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
  if (args.length < 2) {
    console.error(
      "Usage: node scripts/music-board/import-netease-album-html-to-catalog.mjs <album1.html> [album2.html ...] <catalog.json>"
    );
    process.exit(1);
  }

  const catalogPath = args[args.length - 1];
  const htmlPaths = args.slice(0, -1);

  const rawCatalog = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(rawCatalog);
  if (!catalog || typeof catalog !== "object") throw new Error("catalog.json is not an object");

  const items = ensureArray(catalog.items);
  const byId = new Map(items.map((it) => [it?.id, it]));

  let albumsImported = 0;
  let songsImported = 0;
  let albumsUpdated = 0;
  let songsUpdated = 0;
  const skipped = [];

  for (const htmlPath of htmlPaths) {
    const html = await fs.readFile(htmlPath, "utf8");
    const parsed = parseAlbum(html);
    if (!parsed) {
      skipped.push(path.resolve(htmlPath));
      continue;
    }

    const { albumItem, songs } = parsed;
    const prevAlbum = byId.get(albumItem.id);
    byId.set(albumItem.id, prevAlbum ? mergeAlbum(prevAlbum, albumItem) : albumItem);
    albumsImported += 1;
    if (prevAlbum) albumsUpdated += 1;

    for (const s of songs) {
      const prevSong = byId.get(s.id);
      byId.set(s.id, prevSong ? mergeSong(prevSong, s) : s);
      songsImported += 1;
      if (prevSong) songsUpdated += 1;
    }
  }

  catalog.items = Array.from(byId.values());
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  const relCatalog = path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath;
  console.log(
    JSON.stringify(
      { albumsImported, songsImported, albumsUpdated, songsUpdated, skipped: skipped.length ? skipped : undefined, catalog: relCatalog },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

