#!/usr/bin/env node
/**
 * Import a NetEase album HTML snapshot (saved page HTML) into catalog items.
 *
 * Usage:
 *   node scripts/music-board/import-netease-album-html.mjs path/to/网易云.html > items.json
 *
 * Then copy items from items.json into docs/music-board/catalog.json -> items[]
 */

import fs from "node:fs/promises";
import path from "node:path";

function pickFirstMatch(re, text) {
  const m = text.match(re);
  return m ? m[1] : "";
}

function decodeHtml(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripTags(text) {
  return decodeHtml(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseAlbum(html) {
  const albumId =
    pickFirstMatch(/data-rid="(\d+)"\s+data-type="19"/, html) ||
    pickFirstMatch(/href="\/album\?id=(\d+)"/, html) ||
    "";

  const title = stripTags(pickFirstMatch(/<h2 class="f-ff2">([\s\S]*?)<\/h2>/, html));
  const artist = stripTags(pickFirstMatch(/<p class="intr"><b>歌手：<\/b>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/, html));
  const releaseDate = stripTags(pickFirstMatch(/<p class="intr"><b>发行时间：<\/b>([\s\S]*?)<\/p>/, html));
  const cover = pickFirstMatch(/<div class="cover[^"]*">[\s\S]*?<img[^>]*src="([^"]+)"/, html);

  const albumUrl = albumId ? `https://music.163.com/#/album?id=${albumId}` : "";
  const albumItem = {
    id: albumId ? `netease-album-${albumId}` : `netease-album-${Math.random().toString(36).slice(2, 8)}`,
    type: "album",
    title: title || "(未命名专辑)",
    artist: artist || "",
    releaseDate: releaseDate || "",
    cover: cover || "",
    tags: ["netease", "album"].concat(title ? [title] : []),
    links: albumUrl
      ? [{ platform: "netease", label: "网易云 · 专辑", url: albumUrl }]
      : [],
    embeds: []
  };

  const songRows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html))) {
    const row = rowMatch[0];
    const songId = pickFirstMatch(/data-res-id="(\d+)"\s+data-res-type="18"/, row);
    if (!songId) continue;
    const songTitle = stripTags(pickFirstMatch(/<b[^>]*title="([^"]+)"/, row)) || stripTags(pickFirstMatch(/<b[^>]*>([\s\S]*?)<\/b>/, row));
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

  return { albumItem, songs };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/music-board/import-netease-album-html.mjs <file1.html> [file2.html ...]");
    process.exit(1);
  }

  const out = [];
  for (const file of args) {
    const html = await fs.readFile(file, "utf8");
    const { albumItem, songs } = parseAlbum(html);
    out.push({ source: path.resolve(file), items: [albumItem, ...songs] });
  }

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
