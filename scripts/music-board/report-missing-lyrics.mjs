#!/usr/bin/env node
/**
 * Generate a report of songs that are missing lyrics in catalog.json.
 *
 * Usage:
 *   node scripts/music-board/report-missing-lyrics.mjs <catalog.json> [--out <path>]
 *
 * Notes:
 * - A song is considered "missing lyrics" when `lyrics` is null/empty/whitespace.
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage(exitCode = 1) {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/report-missing-lyrics.mjs <catalog.json> [--out <path>]",
      "",
      "Options:",
      "  --out <path>   Write JSON report to <path> (default: print to stdout)"
    ].join("\n")
  );
  process.exit(exitCode);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return (value ?? "").toString();
}

function trim(value) {
  return str(value).trim();
}

function sortDateLike(a, b) {
  const aa = trim(a);
  const bb = trim(b);
  if (!aa && !bb) return 0;
  if (!aa) return 1;
  if (!bb) return -1;
  return aa.localeCompare(bb);
}

async function main() {
  const args = process.argv.slice(2);
  const catalogPath = args[0];
  if (!catalogPath || args.includes("--help") || args.includes("-h")) usage(0);

  let outPath = "";
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out" && args[i + 1]) {
      outPath = args[i + 1];
      i += 1;
    }
  }

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);

  const collectionsById = new Map(
    items
      .filter((it) => ["album", "collection", "playlist"].includes(trim(it?.type)))
      .map((it) => [trim(it?.id), it])
      .filter(([id]) => id)
  );

  const songs = items.filter((it) => trim(it?.type) === "song");
  const missing = songs.filter((it) => trim(it?.lyrics) === "");

  const groups = new Map();

  for (const it of missing) {
    const collectionId = trim(it?.collectionId);
    const groupKey = collectionId || "__no_collection__";
    const col = collectionId ? collectionsById.get(collectionId) : null;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        albumId: collectionId || null,
        albumTitle: trim(col?.title) || "(No album)",
        albumReleaseDate: trim(col?.releaseDate) || "",
        tracks: []
      });
    }

    groups.get(groupKey).tracks.push({
      id: trim(it?.id),
      title: trim(it?.title),
      artist: trim(it?.artist),
      releaseDate: trim(it?.releaseDate),
      isrc: trim(it?.isrc),
      collectionId: collectionId || null
    });
  }

  const byAlbum = Array.from(groups.values())
    .map((g) => ({
      ...g,
      tracks: ensureArray(g.tracks).sort((a, b) => {
        const d = sortDateLike(a.releaseDate, b.releaseDate);
        if (d !== 0) return d;
        const t = a.title.localeCompare(b.title, "en");
        if (t !== 0) return t;
        return a.id.localeCompare(b.id, "en");
      })
    }))
    .sort((a, b) => {
      const d = sortDateLike(b.albumReleaseDate, a.albumReleaseDate);
      if (d !== 0) return d;
      return a.albumTitle.localeCompare(b.albumTitle, "en");
    });

  const report = {
    generatedAt: new Date().toISOString(),
    totalSongs: songs.length,
    missingLyricsSongs: missing.length,
    byAlbum
  };

  if (outPath) {
    await fs.writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    const rel = path.relative(process.cwd(), path.resolve(outPath)) || outPath;
    console.log(
      JSON.stringify(
        {
          out: rel,
          totalSongs: report.totalSongs,
          missingLyricsSongs: report.missingLyricsSongs,
          albums: report.byAlbum.length
        },
        null,
        2
      )
    );
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

