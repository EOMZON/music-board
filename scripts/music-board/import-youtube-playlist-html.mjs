#!/usr/bin/env node
/**
 * Import a YouTube playlist HTML snapshot (saved page HTML) into catalog items.
 *
 * Why HTML snapshot?
 * - Avoids API keys.
 * - Keeps this project fully static/offline-friendly.
 *
 * Usage:
 *   node scripts/music-board/import-youtube-playlist-html.mjs path/to/playlist.html > out.json
 *
 * Output:
 *   JSON array: [{ source, items: [albumItem, ...songItems] }]
 *   Copy `items` into `catalog.json` -> `items[]`.
 */

import fs from "node:fs/promises";
import path from "node:path";

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

function extractJsObject(html, needle) {
  const idx = html.indexOf(needle);
  if (idx < 0) return null;

  const eq = html.indexOf("=", idx);
  if (eq < 0) return null;

  const start = html.indexOf("{", eq);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end < 0) return null;
  const jsonText = html.slice(start, end);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
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

function findRenderer(root, rendererKey) {
  let found = null;
  walk(root, (node) => {
    if (found) return;
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (node[rendererKey] && typeof node[rendererKey] === "object") found = node[rendererKey];
  });
  return found;
}

function parsePlaylistFromInitialData(initialData) {
  const metadata = findRenderer(initialData, "playlistMetadataRenderer");
  const header = findRenderer(initialData, "playlistHeaderRenderer");
  const videoList = findRenderer(initialData, "playlistVideoListRenderer");

  const playlistId =
    (metadata && typeof metadata.playlistId === "string" ? metadata.playlistId : "") ||
    (header && typeof header.playlistId === "string" ? header.playlistId : "") ||
    "";

  const title =
    (metadata && typeof metadata.title === "string" ? metadata.title : "") ||
    getText(header?.title) ||
    "";

  const artist =
    getText(header?.ownerText) ||
    getText(header?.subtitle) ||
    "";

  const cover =
    pickThumbnailUrl(header?.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail) ||
    pickThumbnailUrl(header?.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnailRenderer?.thumbnail) ||
    pickThumbnailUrl(header?.playlistHeaderBanner?.playlistVideoThumbnailRenderer?.thumbnail) ||
    "";

  const contents = Array.isArray(videoList?.contents) ? videoList.contents : [];
  const songs = [];

  for (const item of contents) {
    const r = item?.playlistVideoRenderer;
    if (!r) continue;
    const videoId = typeof r.videoId === "string" ? r.videoId : "";
    if (!videoId) continue;

    const idxText = getText(r.index);
    const trackNo = idxText && /^\d+$/.test(idxText) ? Number(idxText) : undefined;

    const songTitle = getText(r.title) || "";
    const thumb = pickThumbnailUrl(r.thumbnail);
    const watchUrl = playlistId
      ? `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`
      : `https://www.youtube.com/watch?v=${videoId}`;

    songs.push({
      id: `youtube-video-${videoId}`,
      type: "song",
      title: songTitle,
      artist: artist,
      releaseDate: "",
      cover: thumb || "",
      collectionId: playlistId ? `youtube-playlist-${playlistId}` : "",
      trackNo,
      tags: ["youtube", "song"].concat(title ? [title] : []),
      links: [{ platform: "youtube", label: "YouTube · Video", url: watchUrl }],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube embed",
          url: `https://www.youtube.com/embed/${videoId}`,
          height: 220
        }
      ]
    });
  }

  const playlistUrl = playlistId ? `https://www.youtube.com/playlist?list=${playlistId}` : "";
  const albumItem = {
    id: playlistId ? `youtube-playlist-${playlistId}` : `youtube-playlist-${Math.random().toString(36).slice(2, 8)}`,
    type: "album",
    title: title || "(未命名 YouTube 专辑)",
    artist: artist || "",
    releaseDate: "",
    cover: cover || (songs[0]?.cover || ""),
    trackCount: songs.length || undefined,
    tags: ["youtube", "album"].concat(title ? [title] : []),
    links: [
      ...(playlistUrl ? [{ platform: "youtube", label: "YouTube · Playlist", url: playlistUrl }] : [])
    ],
    embeds: [
      ...(playlistId
        ? [
            {
              platform: "youtube",
              label: "YouTube playlist embed",
              url: `https://www.youtube.com/embed/videoseries?list=${playlistId}`,
              height: 360
            }
          ]
        : [])
    ]
  };

  // Fix collectionId if playlistId was missing when building songs.
  for (const s of songs) {
    if (!s.collectionId) s.collectionId = albumItem.id;
  }

  return { albumItem, songs, playlistId };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/music-board/import-youtube-playlist-html.mjs <playlist1.html> [playlist2.html ...]");
    process.exit(1);
  }

  const out = [];
  for (const file of args) {
    const html = await fs.readFile(file, "utf8");
    const initialData =
      extractJsObject(html, "var ytInitialData") ||
      extractJsObject(html, "ytInitialData") ||
      extractJsObject(html, "window[\"ytInitialData\"]") ||
      null;

    if (!initialData) {
      out.push({
        source: path.resolve(file),
        error: "Missing ytInitialData. Try saving the playlist page again as HTML (not a shortcut).",
        items: []
      });
      continue;
    }

    const { albumItem, songs } = parsePlaylistFromInitialData(initialData);
    out.push({ source: path.resolve(file), items: [albumItem, ...songs] });
  }

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

