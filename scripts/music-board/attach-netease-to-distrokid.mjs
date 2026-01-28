#!/usr/bin/env node
/**
 * Attach NetEase links/embeds to matching DistroKid albums + tracks inside the same catalog.json.
 *
 * Intended workflow:
 * 1) Import/sync NetEase items (API or HTML) into catalog.json
 * 2) Import DistroKid items into the SAME catalog.json
 * 3) Run this script to copy NetEase URLs into DistroKid items (so the DistroKid release can play on-site)
 *
 * Matching rules (conservative):
 * - Album: normalized title MUST match; if both have releaseDate, it MUST match too.
 * - Track: normalized title MUST match within the matched albums.
 *
 * Usage:
 *   node scripts/music-board/attach-netease-to-distrokid.mjs <catalog.json> [--apply] [--album <distrokidAlbumId>]
 *
 * Default is DRY RUN (no writes). Add --apply to save.
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage(exitCode = 1) {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/attach-netease-to-distrokid.mjs <catalog.json> [--apply] [--album <distrokidAlbumId>]",
      "",
      "Options:",
      "  --apply                 Write changes (default: dry run)",
      "  --album <id>            Only process a single DistroKid album id (e.g. distrokid-album-...)"
    ].join("\n")
  );
  process.exit(exitCode);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeKey(text) {
  return (text ?? "")
    .toString()
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s·•—–\-_/\\:：,，.。!?！？'"“”‘’()（）\[\]{}<>《》]+/g, "");
}

function platformKey(platform) {
  return (platform ?? "").toString().trim().toLowerCase().replace(/\s+/g, "");
}

function mergeLinksByPlatform(existing, incoming) {
  const out = [];
  const byPlatform = new Map();
  for (const l of ensureArray(existing)) {
    const p = platformKey(l?.platform);
    if (!p) continue;
    byPlatform.set(p, { ...l, platform: (l?.platform ?? "").toString().trim() });
  }
  for (const l of ensureArray(incoming)) {
    const p = platformKey(l?.platform);
    if (!p) continue;
    const prev = byPlatform.get(p);
    if (!prev) {
      byPlatform.set(p, { ...l, platform: (l?.platform ?? "").toString().trim() });
      continue;
    }
    const next = { ...prev };
    if ((!next.url || next.url === "") && l?.url) next.url = l.url;
    if ((!next.label || next.label === "" || next.label.toLowerCase() === p) && l?.label) next.label = l.label;
    byPlatform.set(p, next);
  }
  for (const [, v] of byPlatform) out.push(v);
  return out;
}

function mergeEmbeds(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const e of ensureArray(existing).concat(ensureArray(incoming))) {
    const p = platformKey(e?.platform);
    const url = (e?.url || "").toString();
    if (!url) continue;
    const key = `${p}::${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform: (e?.platform ?? "").toString().trim(),
      label: e?.label || "",
      url,
      height: Number.isFinite(e?.height) ? e.height : undefined
    });
  }
  return out;
}

function parseNeteaseNumericId(itemId, prefix) {
  const m = (itemId ?? "").toString().match(new RegExp(`^${prefix}-(\\\\d+)$`));
  return m ? m[1] : "";
}

function isDistrokidAlbum(item) {
  if (!item || (item.type || "") !== "album") return false;
  const id = (item.id || "").toString();
  if (id.startsWith("distrokid-album-")) return true;
  return ensureArray(item.tags).includes("distrokid");
}

function isNeteaseAlbum(item) {
  if (!item || (item.type || "") !== "album") return false;
  const id = (item.id || "").toString();
  if (id.startsWith("netease-album-")) return true;
  return ensureArray(item.tags).includes("netease");
}

function isSong(item) {
  return item && (item.type || "") === "song";
}

function pickMatchedAlbum(distroAlbum, neteaseAlbums) {
  const dkTitle = normalizeKey(distroAlbum?.title || "");
  const dkDate = (distroAlbum?.releaseDate || "").toString().trim();
  if (!dkTitle) return null;

  const candidates = neteaseAlbums
    .map((a) => {
      const nTitle = normalizeKey(a?.title || "");
      const nDate = (a?.releaseDate || "").toString().trim();
      const titleOk = nTitle && nTitle === dkTitle;
      const dateOk = !dkDate || !nDate || nDate === dkDate;
      return { album: a, titleOk, dateOk };
    })
    .filter((x) => x.titleOk && x.dateOk)
    .map((x) => x.album);

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // tie-breaker: closest trackCount (if present)
  const dkCount = Number.isFinite(distroAlbum?.trackCount) ? distroAlbum.trackCount : NaN;
  let best = candidates[0];
  let bestScore = -1;
  for (const a of candidates) {
    const nCount = Number.isFinite(a?.trackCount) ? a.trackCount : NaN;
    const score = Number.isFinite(dkCount) && Number.isFinite(nCount) ? (dkCount === nCount ? 2 : 0) : 1;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function pickMatchedTrack(distroTrack, neteaseTracks) {
  const dkTitle = normalizeKey(distroTrack?.title || "");
  if (!dkTitle) return null;
  const exact = neteaseTracks.find((t) => normalizeKey(t?.title || "") === dkTitle) || null;
  if (exact) return exact;
  const contains =
    neteaseTracks.find((t) => {
      const n = normalizeKey(t?.title || "");
      return n && (n.includes(dkTitle) || dkTitle.includes(n));
    }) || null;
  return contains;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) usage(0);

  const catalogPath = args[0];
  if (!catalogPath) usage(1);

  let apply = false;
  let albumOnly = "";

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--apply") apply = true;
    else if (a === "--album" && args[i + 1]) {
      albumOnly = args[i + 1];
      i += 1;
    }
  }

  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw);
  const items = ensureArray(catalog?.items);
  const byId = new Map(items.map((it) => [it?.id, it]));

  const distrokidAlbums = items.filter(isDistrokidAlbum).filter((a) => !albumOnly || (a.id || "") === albumOnly);
  const neteaseAlbums = items.filter(isNeteaseAlbum);

  let albumsMatched = 0;
  let albumsUpdated = 0;
  let tracksMatched = 0;
  let tracksUpdated = 0;

  for (const dkAlbum of distrokidAlbums) {
    const neAlbum = pickMatchedAlbum(dkAlbum, neteaseAlbums);
    if (!neAlbum) continue;
    albumsMatched += 1;

    const beforeLinksJson = JSON.stringify(ensureArray(dkAlbum.links));
    const mergedAlbum = { ...dkAlbum };
    mergedAlbum.links = mergeLinksByPlatform(ensureArray(dkAlbum.links), ensureArray(neAlbum.links));
    if (JSON.stringify(mergedAlbum.links) !== beforeLinksJson) albumsUpdated += 1;

    const neAlbumNumericId = parseNeteaseNumericId(neAlbum.id, "netease-album");
    if (neAlbumNumericId) {
      mergedAlbum.refs = { ...(mergedAlbum.refs || {}), netease: { ...(mergedAlbum.refs?.netease || {}), albumId: neAlbumNumericId } };
    }
    byId.set(mergedAlbum.id, mergedAlbum);

    const dkTracks = items.filter((it) => isSong(it) && (it.collectionId || "") === (dkAlbum.id || ""));
    const neTracks = items.filter((it) => isSong(it) && (it.collectionId || "") === (neAlbum.id || ""));

    const neSongIdByTitle = new Map(neTracks.map((t) => [normalizeKey(t?.title || ""), parseNeteaseNumericId(t?.id, "netease-song")]));

    for (const dkTrack of dkTracks) {
      const neTrack = pickMatchedTrack(dkTrack, neTracks);
      if (!neTrack) continue;
      tracksMatched += 1;

      const beforeLinks = JSON.stringify(ensureArray(dkTrack.links));
      const beforeEmbeds = JSON.stringify(ensureArray(dkTrack.embeds));

      const mergedTrack = { ...dkTrack };
      mergedTrack.links = mergeLinksByPlatform(ensureArray(dkTrack.links), ensureArray(neTrack.links));
      mergedTrack.embeds = mergeEmbeds(ensureArray(dkTrack.embeds), ensureArray(neTrack.embeds));

      const neSongId = neSongIdByTitle.get(normalizeKey(neTrack?.title || "")) || parseNeteaseNumericId(neTrack.id, "netease-song");
      if (neAlbumNumericId || neSongId) {
        mergedTrack.refs = {
          ...(mergedTrack.refs || {}),
          netease: {
            ...(mergedTrack.refs?.netease || {}),
            ...(neAlbumNumericId ? { albumId: neAlbumNumericId } : {}),
            ...(neSongId ? { songId: neSongId } : {})
          }
        };
      }

      if (JSON.stringify(mergedTrack.links) !== beforeLinks || JSON.stringify(mergedTrack.embeds) !== beforeEmbeds) {
        tracksUpdated += 1;
      }
      byId.set(mergedTrack.id, mergedTrack);
    }
  }

  if (apply) {
    catalog.items = Array.from(byId.values());
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  }

  const relCatalog = path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath;
  console.log(
    JSON.stringify(
      { apply, albumsProcessed: distrokidAlbums.length, albumsMatched, albumsUpdated, tracksMatched, tracksUpdated, catalog: relCatalog },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

