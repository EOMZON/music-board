#!/usr/bin/env node
/**
 * Attach a YouTube playlist (album) + per-track video embeds to an existing collection in catalog.json.
 *
 * Why:
 * - Your site already has albums/tracks (e.g. NetEase).
 * - You want to add YouTube as an extra playable platform per track, mapping each track to the right video.
 *
 * Input:
 * - JSON produced by:
 *   - scripts/music-board/import-youtube-playlist-html.mjs
 *   - tools/youtube-music-board-export.user.js
 *
 * Usage:
 *   node scripts/music-board/attach-youtube-playlist-to-collection.mjs <youtubeExport.json> <catalog.json> \
 *     --collection-id <existingCollectionId> [--playlist-id <ytPlaylistId>] [--apply]
 *
 * Notes:
 * - Default is DRY RUN; add --apply to write catalog.json.
 * - Mapping strategy:
 *   1) Exact title match (normalized) if possible
 *   2) Fallback: same track count → map by track order
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/attach-youtube-playlist-to-collection.mjs <youtubeExport.json> <catalog.json> --collection-id <id> [--playlist-id <id>] [--apply]",
      "",
      "Flags:",
      "  --collection-id <id>   Existing collection/album id in catalog.json (e.g. netease-album-359139954)",
      "  --playlist-id <id>     YouTube playlist id (e.g. OLAK5uy_...) if the export includes multiple playlists",
      "  --fuzzy               Enable safe fuzzy title match (default: on)",
      "  --apply                Write changes (default: dry run)"
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = { exportPath: "", catalogPath: "", collectionId: "", playlistId: "", apply: false, fuzzy: true };
  const rest = argv.slice(2);
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--apply") {
      out.apply = true;
      continue;
    }
    if (a === "--no-fuzzy") {
      out.fuzzy = false;
      continue;
    }
    if (a === "--fuzzy") {
      out.fuzzy = true;
      continue;
    }
    if (a === "--collection-id") {
      out.collectionId = rest[i + 1] || "";
      i++;
      continue;
    }
    if (a === "--playlist-id") {
      out.playlistId = rest[i + 1] || "";
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    positional.push(a);
  }
  out.exportPath = positional[0] || "";
  out.catalogPath = positional[1] || "";
  return out;
}

function normalizeItemsJson(json) {
  if (Array.isArray(json)) {
    if (json.length > 0 && json[0] && typeof json[0] === "object" && Array.isArray(json[0].items)) {
      return json.flatMap((x) => (Array.isArray(x?.items) ? x.items : []));
    }
    return json;
  }
  if (json && typeof json === "object" && Array.isArray(json.items)) return json.items;
  return [];
}

function isItemLike(x) {
  return x && typeof x === "object" && typeof x.id === "string" && x.id.trim() !== "";
}

function platformKey(platform) {
  return (platform ?? "").toString().trim().toLowerCase().replace(/\s+/g, "");
}

function ensureArray(obj, key) {
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key];
}

function upsertPlatformLink(item, link) {
  const links = ensureArray(item, "links");
  const key = platformKey(link?.platform);
  if (!key) return;
  const idx = links.findIndex((l) => platformKey(l?.platform) === key);
  if (idx >= 0) {
    links[idx] = { ...links[idx], ...link };
    return;
  }
  links.push(link);
}

function upsertPlatformEmbed(item, embed) {
  const embeds = ensureArray(item, "embeds");
  const key = platformKey(embed?.platform);
  if (!key) return;
  const idx = embeds.findIndex((e) => platformKey(e?.platform) === key);
  if (idx >= 0) {
    embeds[idx] = { ...embeds[idx], ...embed };
    return;
  }
  embeds.push(embed);
}

function normTitle(t) {
  return (t ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s·•\u00B7\u2022]+/g, " ")
    .replace(/[()（）【】[\]「」『』{}]/g, "")
    .replace(/[.,!?，。！？:：;；"'“”‘’`~\-_/\\|]+/g, "")
    .replace(/\s+/g, "");
}

function safeContainsMatch(trackKey, candidateKey) {
  if (!trackKey || !candidateKey) return false;
  if (trackKey.length < 2) return false;
  if (candidateKey.length < 2) return false;
  return candidateKey.includes(trackKey) || trackKey.includes(candidateKey);
}

function isYoutubePlaylistAlbum(item) {
  const id = (item?.id ?? "").toString();
  if (!id.startsWith("youtube-playlist-")) return false;
  return ["album", "playlist", "collection"].includes((item?.type ?? "").toString());
}

function extractPlaylistIdFromItemId(itemId) {
  const raw = (itemId ?? "").toString();
  const m = raw.match(/^youtube-playlist-(.+)$/);
  return m ? m[1] : "";
}

function deriveYoutubeWatchUrl(videoId, playlistId) {
  if (!videoId) return "";
  if (playlistId) return `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.exportPath || !args.catalogPath || !args.collectionId) {
    usage();
    process.exit(1);
  }

  const exportRaw = await fs.readFile(args.exportPath, "utf8");
  const exportJson = JSON.parse(exportRaw);
  const exportedItems = normalizeItemsJson(exportJson).filter(isItemLike);
  if (exportedItems.length === 0) {
    console.error("No items found in youtubeExport.json.");
    process.exit(1);
  }

  const playlistAlbums = exportedItems.filter(isYoutubePlaylistAlbum);
  if (playlistAlbums.length === 0) {
    console.error("No YouTube playlist album item found in export (expected id like youtube-playlist-...).");
    process.exit(1);
  }

  let album = null;
  if (args.playlistId) {
    album = playlistAlbums.find((a) => extractPlaylistIdFromItemId(a.id) === args.playlistId) || null;
    if (!album) {
      console.error(`playlist-id not found in export: ${args.playlistId}`);
      process.exit(1);
    }
  } else if (playlistAlbums.length === 1) {
    album = playlistAlbums[0];
  } else {
    console.error("Multiple playlist albums in export. Please pass --playlist-id <id>.");
    console.error("Found:");
    for (const a of playlistAlbums.slice(0, 20)) {
      console.error(`- ${extractPlaylistIdFromItemId(a.id) || a.id} :: ${a.title || ""}`);
    }
    process.exit(1);
  }

  const playlistId = extractPlaylistIdFromItemId(album.id);
  const ytSongs = exportedItems
    .filter((x) => (x?.type ?? "") === "song")
    .filter((x) => typeof x?.id === "string" && x.id.startsWith("youtube-video-"))
    .filter((x) => (x?.collectionId ?? "") === album.id);

  if (ytSongs.length === 0) {
    console.error("No YouTube songs found for this playlist album in export.");
    process.exit(1);
  }

  const catalogRaw = await fs.readFile(args.catalogPath, "utf8");
  const catalog = JSON.parse(catalogRaw);
  if (!Array.isArray(catalog.items)) catalog.items = [];

  const collection = catalog.items.find((x) => x?.id === args.collectionId) || null;
  if (!collection) {
    console.error(`Collection not found in catalog.json: ${args.collectionId}`);
    process.exit(1);
  }

  const targetTracksAll = catalog.items.filter((x) => x?.type === "song" && x?.collectionId === args.collectionId);
  if (targetTracksAll.length === 0) {
    console.error(`No tracks found under collectionId=${args.collectionId} in catalog.json`);
    process.exit(1);
  }

  // Preserve catalog order as default sequence (if trackNo missing).
  const targetTracks = targetTracksAll.map((t, i) => ({ t, idx: i }));

  const ytByTitle = new Map();
  for (const y of ytSongs) {
    const key = normTitle(y.title || "");
    if (!key) continue;
    if (!ytByTitle.has(key)) ytByTitle.set(key, []);
    ytByTitle.get(key).push(y);
  }

  const trackMatches = [];
  const unmatchedTracks = [];
  const usedYoutubeIds = new Set();

  // First pass: exact normalized title match.
  for (const { t } of targetTracks) {
    const key = normTitle(t.title || "");
    const candidates = key ? (ytByTitle.get(key) || []) : [];
    const picked = candidates.find((c) => !usedYoutubeIds.has(c.id)) || null;
    if (picked) {
      usedYoutubeIds.add(picked.id);
      trackMatches.push({ trackId: t.id, trackTitle: t.title || "", youtubeId: picked.id, youtubeTitle: picked.title || "" });
    } else {
      unmatchedTracks.push(t);
    }
  }

  // Second pass: safe fuzzy (contains) match if enabled, only when unique.
  if (args.fuzzy && unmatchedTracks.length > 0) {
    const remaining = ytSongs.filter((y) => !usedYoutubeIds.has(y.id));
    const remainingWithKeys = remaining.map((y) => ({ y, key: normTitle(y.title || "") })).filter((x) => x.key);

    const stillUnmatched = [];
    for (const t of unmatchedTracks) {
      const tKey = normTitle(t.title || "");
      if (!tKey) {
        stillUnmatched.push(t);
        continue;
      }
      const hits = remainingWithKeys.filter((c) => safeContainsMatch(tKey, c.key));
      if (hits.length !== 1) {
        stillUnmatched.push(t);
        continue;
      }
      const picked = hits[0].y;
      if (usedYoutubeIds.has(picked.id)) {
        stillUnmatched.push(t);
        continue;
      }
      usedYoutubeIds.add(picked.id);
      trackMatches.push({ trackId: t.id, trackTitle: t.title || "", youtubeId: picked.id, youtubeTitle: picked.title || "" });
    }
    unmatchedTracks.length = 0;
    unmatchedTracks.push(...stillUnmatched);
  }

  // Final pass: if counts match, map remaining by order.
  const remainingYt = ytSongs.filter((y) => !usedYoutubeIds.has(y.id));
  if (unmatchedTracks.length > 0 && remainingYt.length > 0 && unmatchedTracks.length === remainingYt.length) {
    for (let i = 0; i < unmatchedTracks.length; i++) {
      const t = unmatchedTracks[i];
      const y = remainingYt[i];
      usedYoutubeIds.add(y.id);
      trackMatches.push({ trackId: t.id, trackTitle: t.title || "", youtubeId: y.id, youtubeTitle: y.title || "" });
    }
    unmatchedTracks.length = 0;
  }

  // Attach to collection (playlist link + embed).
  const playlistUrl = playlistId ? `https://www.youtube.com/playlist?list=${playlistId}` : "";
  if (playlistUrl) {
    upsertPlatformLink(collection, { platform: "youtube", label: "YouTube · Playlist", url: playlistUrl });
    upsertPlatformEmbed(collection, {
      platform: "youtube",
      label: "YouTube playlist embed",
      url: `https://www.youtube.com/embed/videoseries?list=${playlistId}`,
      height: 360
    });
  }
  if (Array.isArray(collection.tags) && !collection.tags.includes("youtube")) collection.tags.push("youtube");

  // Attach to tracks.
  const ytById = new Map(ytSongs.map((y) => [y.id, y]));
  let tracksUpdated = 0;
  for (const m of trackMatches) {
    const track = catalog.items.find((x) => x?.id === m.trackId);
    const y = ytById.get(m.youtubeId);
    if (!track || !y) continue;
    const videoId = (y.id || "").replace(/^youtube-video-/, "");
    const watchUrl = deriveYoutubeWatchUrl(videoId, playlistId);
    upsertPlatformLink(track, { platform: "youtube", label: "YouTube · Video", url: watchUrl || "" });
    upsertPlatformEmbed(track, {
      platform: "youtube",
      label: "YouTube embed",
      url: `https://www.youtube.com/embed/${videoId}`,
      height: 220
    });
    if (Array.isArray(track.tags) && !track.tags.includes("youtube")) track.tags.push("youtube");
    tracksUpdated++;
  }

  // Optionally add YouTube to profile platform filter.
  if (catalog.profile && typeof catalog.profile === "object") {
    if (!Array.isArray(catalog.profile.platforms)) catalog.profile.platforms = [];
    const hasYoutube = catalog.profile.platforms.some((p) => platformKey(p?.platform) === "youtube");
    if (!hasYoutube) {
      catalog.profile.platforms.push({ platform: "youtube", label: "YouTube", url: playlistUrl || "" });
    }
  }

  const summary = {
    apply: args.apply,
    playlistId,
    youtubeAlbum: { id: album.id, title: album.title || "" },
    targetCollection: { id: collection.id, title: collection.title || "" },
    tracksInCollection: targetTracksAll.length,
    youtubeTracks: ytSongs.length,
    matched: trackMatches.length,
    updated: tracksUpdated,
    unmatchedTracks: unmatchedTracks.slice(0, 20).map((t) => ({ id: t.id, title: t.title || "" }))
  };

  const relCatalog = path.relative(process.cwd(), path.resolve(args.catalogPath)) || args.catalogPath;

  if (!args.apply) {
    process.stdout.write(JSON.stringify({ ...summary, catalog: relCatalog }, null, 2) + "\n");
    process.stderr.write("DRY RUN: add --apply to write catalog.json\n");
    return;
  }

  await fs.writeFile(args.catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ ...summary, catalog: relCatalog }, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
