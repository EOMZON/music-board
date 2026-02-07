#!/usr/bin/env node
/**
 * Attach a YouTube album playlist to an existing collection in catalog.json,
 * using track order (index) instead of per-video IDs.
 *
 * Why:
 * - Some environments cannot fetch YouTube pages to get video IDs.
 * - Many "Albums & Singles" playlists keep the same order as the album tracklist.
 * - This enables a "YouTube" playable source for every track with minimal data.
 *
 * Usage:
 *   node scripts/music-board/attach-youtube-playlist-by-index.mjs <catalog.json> \
 *     --collection-id <id> --playlist-id <ytPlaylistId> [--apply]
 *
 * Notes:
 * - Default is DRY RUN; add --apply to write catalog.json.
 * - If a track has an existing non-empty YouTube embed, it will be kept as-is.
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/attach-youtube-playlist-by-index.mjs <catalog.json> --collection-id <id> --playlist-id <id> [--apply]",
      "",
      "Flags:",
      "  --collection-id <id>   Existing collection/album id in catalog.json",
      "  --playlist-id <id>     YouTube playlist id (e.g. OLAK5uy_...)",
      "  --apply                Write changes (default: dry run)"
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = { catalogPath: "", collectionId: "", playlistId: "", apply: false };
  const rest = argv.slice(2);
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--apply") {
      out.apply = true;
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
  out.catalogPath = positional[0] || "";
  return out;
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

function getExistingYoutubeEmbedUrl(item) {
  const embeds = Array.isArray(item?.embeds) ? item.embeds : [];
  const e = embeds.find((x) => platformKey(x?.platform) === "youtube");
  const url = (e?.url ?? "").toString().trim();
  return url || "";
}

function addTag(item, tag) {
  if (!item || typeof item !== "object") return;
  if (!Array.isArray(item.tags)) item.tags = [];
  if (!item.tags.includes(tag)) item.tags.push(tag);
}

function isLikelyPlaylistId(id) {
  const raw = (id ?? "").toString().trim();
  return /^[a-zA-Z0-9_-]{6,}$/.test(raw);
}

function playlistUrl(playlistId, index) {
  const base = `https://www.youtube.com/playlist?list=${playlistId}`;
  if (!index) return base;
  return `${base}&index=${index}`;
}

function playlistEmbedUrl(playlistId, index) {
  const base = `https://www.youtube.com/embed/videoseries?list=${playlistId}`;
  if (!index) return base;
  return `${base}&index=${index}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.catalogPath || !args.collectionId || !args.playlistId) {
    usage();
    process.exit(1);
  }
  if (!isLikelyPlaylistId(args.playlistId)) {
    console.error(`Invalid playlist id: ${args.playlistId}`);
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

  const tracks = [];
  for (const item of catalog.items) {
    if (item?.type !== "song") continue;
    if ((item?.collectionId ?? "") !== args.collectionId) continue;
    tracks.push(item);
  }
  if (tracks.length === 0) {
    console.error(`No tracks found under collectionId=${args.collectionId} in catalog.json`);
    process.exit(1);
  }

  // Attach to collection.
  const listUrl = playlistUrl(args.playlistId);
  upsertPlatformLink(collection, { platform: "youtube", label: "YouTube · Playlist", url: listUrl });
  upsertPlatformEmbed(collection, {
    platform: "youtube",
    label: "YouTube playlist embed",
    url: playlistEmbedUrl(args.playlistId),
    height: 360
  });
  addTag(collection, "youtube");

  // Attach to tracks by index.
  let tracksUpdated = 0;
  let tracksSkipped = 0;
  let trackNoFilled = 0;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const existingYt = getExistingYoutubeEmbedUrl(t);
    if (existingYt) {
      tracksSkipped++;
      addTag(t, "youtube");
      continue;
    }

    const index = (Number.isFinite(t.trackNo) ? t.trackNo : (i + 1));
    if (!Number.isFinite(t.trackNo)) {
      t.trackNo = index;
      trackNoFilled++;
    }

    upsertPlatformLink(t, { platform: "youtube", label: "YouTube · Playlist", url: playlistUrl(args.playlistId, index) });
    upsertPlatformEmbed(t, {
      platform: "youtube",
      label: "YouTube playlist embed",
      url: playlistEmbedUrl(args.playlistId, index),
      height: 220
    });
    addTag(t, "youtube");
    tracksUpdated++;
  }

  const summary = {
    apply: args.apply,
    playlistId: args.playlistId,
    targetCollection: { id: collection.id, title: collection.title || "" },
    tracksInCollection: tracks.length,
    updated: tracksUpdated,
    skippedExistingYoutube: tracksSkipped,
    filledTrackNo: trackNoFilled
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

