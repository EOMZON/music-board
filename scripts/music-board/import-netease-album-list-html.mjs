#!/usr/bin/env node
/**
 * Import a NetEase "album list" HTML snapshot (musician center table) and merge into a catalog.json.
 *
 * Input HTML example patterns:
 * - <tr ... data-row-key="358551174"> ... <a href="/#/album?id=358551174" ... title="灯火向晚"> ...
 * - cover in style: background-image: url("http://p1.music.126.net/...jpg?...thumbnail=100x0");
 * - date in table cell: 2026-01-16
 * - track count in table cell: 8
 *
 * Usage:
 *   node scripts/music-board/import-netease-album-list-html.mjs \
 *     "/Users/zon/Desktop/MINE/10_music/album/已发布/专辑列表.html" \
 *     "3_clone_douyin/tools/已发布/docs/music-board/catalog.json"
 *
 * Notes:
 * - This imports ALBUM items only (no track lists). Track counts are stored as `trackCount`.
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

function normalizeCover(url) {
  const raw = (url ?? "").toString().trim();
  if (!raw) return "";
  const noQuotes = raw.replace(/^["']|["']$/g, "");
  const noQuery = noQuotes.split("?")[0];
  const https = noQuery.replace(/^http:\/\//i, "https://");
  return https;
}

function toAlbumItem({ albumId, title, cover, releaseDate, trackCount }) {
  const id = `netease-album-${albumId}`;
  return {
    id,
    type: "album",
    title: title || "(未命名专辑)",
    artist: "",
    releaseDate: releaseDate || "",
    cover: cover || "",
    trackCount: Number.isFinite(trackCount) ? trackCount : undefined,
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

function parseAlbumListHtml(html) {
  const rows = [];
  const trRe = /<tr\b[\s\S]*?<\/tr>/g;
  let m;
  while ((m = trRe.exec(html))) {
    const row = m[0];
    const albumId =
      (row.match(/data-row-key="(\d+)"/) || [])[1] ||
      (row.match(/href="\/#\/album\?id=(\d+)"/) || [])[1] ||
      "";
    if (!albumId) continue;

    const title =
      (row.match(/title="([^"]+)"/) || [])[1] ||
      stripTags((row.match(/albumColumnAlbumNameText[\s\S]*?>([\s\S]*?)<\/a>/) || [])[1] || "");

    const coverRaw =
      (row.match(/background-image:\s*url\(&quot;([^&]+?)&quot;\)/) || [])[1] ||
      (row.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/) || [])[1] ||
      "";

    const tdTexts = [];
    const tdRe = /<td\b[\s\S]*?<\/td>/g;
    let td;
    while ((td = tdRe.exec(row))) tdTexts.push(stripTags(td[0]));

    const trackCount = tdTexts.length >= 2 && /^\d+$/.test(tdTexts[1]) ? Number(tdTexts[1]) : NaN;
    const releaseDate = tdTexts.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(tdTexts[2]) ? tdTexts[2] : "";

    rows.push({
      albumId,
      title: decodeHtml(title).trim(),
      cover: normalizeCover(decodeHtml(coverRaw)),
      releaseDate,
      trackCount
    });
  }

  const dedup = new Map();
  for (const r of rows) dedup.set(r.albumId, r);
  return Array.from(dedup.values()).sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || ""));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function addTag(tags, tag) {
  const set = new Set(ensureArray(tags).filter(Boolean));
  set.add(tag);
  return Array.from(set);
}

function mergeAlbum(existing, incoming) {
  const next = { ...(existing || {}), ...(incoming || {}) };
  next.type = "album";
  next.tags = addTag(addTag(next.tags, "netease"), "album");
  next.links = ensureArray(next.links);

  const hasNeteaseAlbumLink = next.links.some((l) => (l?.platform || "") === "netease" && (l?.url || "").includes("/#/album?id="));
  if (!hasNeteaseAlbumLink && incoming?.links?.[0]?.url) next.links.push(incoming.links[0]);

  if (!existing?.title || existing.title === "(未命名专辑)") next.title = incoming.title;
  if (!existing?.cover) next.cover = incoming.cover;
  if (!existing?.releaseDate) next.releaseDate = incoming.releaseDate;
  if (!Number.isFinite(existing?.trackCount) && Number.isFinite(incoming?.trackCount)) next.trackCount = incoming.trackCount;

  return next;
}

async function main() {
  const [htmlPath, catalogPath] = process.argv.slice(2);
  if (!htmlPath || !catalogPath) {
    console.error(
      "Usage: node scripts/music-board/import-netease-album-list-html.mjs <album_list.html> <catalog.json>"
    );
    process.exit(1);
  }

  const html = await fs.readFile(htmlPath, "utf8");
  const rows = parseAlbumListHtml(html);
  if (rows.length === 0) {
    console.error("No albums found in HTML. Please confirm the snapshot contains <tr ... data-row-key=\"<albumId>\"> rows.");
    process.exit(1);
  }

  const rawCatalog = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(rawCatalog);
  if (!catalog || typeof catalog !== "object") throw new Error("catalog.json is not an object");

  const items = ensureArray(catalog.items);
  const byId = new Map(items.map((it) => [it?.id, it]));

  let added = 0;
  let updated = 0;

  for (const r of rows) {
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

  const merged = Array.from(byId.values());
  catalog.items = merged;

  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  const relCatalog = path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath;
  console.log(JSON.stringify({ albumsFound: rows.length, added, updated, catalog: relCatalog }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
