#!/usr/bin/env node
/**
 * Fill missing lyrics with a unified placeholder (e.g. for instrumental tracks).
 *
 * Usage:
 *   node scripts/music-board/fill-missing-lyrics-placeholder.mjs <catalog.json> \
 *     [--apply] [--overwrite] [--placeholder <text>] \
 *     [--collection-id <id>]... [--collection-title <title>]... [--tag <tag>]...
 *
 * Notes:
 * - Default is DRY RUN (no writes). Add --apply to write catalog.json.
 * - If no filters are provided, all songs with missing lyrics are targeted.
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage(exitCode = 1) {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/fill-missing-lyrics-placeholder.mjs <catalog.json> [--apply] [--overwrite] [--placeholder <text>] [--collection-id <id>]... [--collection-title <title>]... [--tag <tag>]...",
      "",
      "Options:",
      "  --apply                    Write changes (default: dry run)",
      "  --overwrite                Overwrite existing lyrics (default: only fill missing)",
      "  --placeholder <text>       Placeholder text (default: 纯音乐（无歌词）)",
      "  --collection-id <id>       Only match songs in these collectionId(s) (repeatable)",
      "  --collection-title <title> Only match songs whose collection title matches (repeatable)",
      "  --tag <tag>                Only match songs whose tags include this tag (repeatable)"
    ].join("\n")
  );
  process.exit(exitCode);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function trim(value) {
  return (value ?? "").toString().trim();
}

function normalizeText(text) {
  return trim(text).toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const args = process.argv.slice(2);
  const catalogPath = args[0];
  if (!catalogPath || args.includes("--help") || args.includes("-h")) usage(0);

  let apply = false;
  let overwrite = false;
  let placeholder = "纯音乐（无歌词）";

  const collectionIds = new Set();
  const collectionTitles = new Set();
  const tagFilters = new Set();

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--apply") apply = true;
    else if (a === "--overwrite") overwrite = true;
    else if (a === "--placeholder" && args[i + 1]) {
      placeholder = args[i + 1];
      i += 1;
    } else if (a === "--collection-id" && args[i + 1]) {
      const v = trim(args[i + 1]);
      if (v) collectionIds.add(v);
      i += 1;
    } else if (a === "--collection-title" && args[i + 1]) {
      const v = trim(args[i + 1]);
      if (v) collectionTitles.add(normalizeText(v));
      i += 1;
    } else if (a === "--tag" && args[i + 1]) {
      const v = trim(args[i + 1]);
      if (v) tagFilters.add(v);
      i += 1;
    }
  }

  const placeholderTrimmed = trim(placeholder);
  if (!placeholderTrimmed) throw new Error("Empty --placeholder is not allowed");

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);

  const collectionsById = new Map(
    items
      .filter((it) => ["album", "collection", "playlist"].includes(trim(it?.type)))
      .map((it) => [trim(it?.id), trim(it?.title)])
      .filter(([id]) => id)
  );

  const hasFilters = collectionIds.size > 0 || collectionTitles.size > 0 || tagFilters.size > 0;

  let considered = 0;
  let updated = 0;

  for (const it of items) {
    if (trim(it?.type) !== "song") continue;

    const existing = trim(it?.lyrics);
    const missingLyrics = existing === "";
    if (!overwrite && !missingLyrics) continue;

    const collectionId = trim(it?.collectionId);
    const collectionTitle = normalizeText(collectionId ? collectionsById.get(collectionId) || "" : "");
    const itemTags = ensureArray(it?.tags)
      .map((t) => trim(t))
      .filter(Boolean);

    const matches =
      !hasFilters ||
      (collectionId && collectionIds.has(collectionId)) ||
      (collectionTitle && collectionTitles.has(collectionTitle)) ||
      itemTags.some((t) => tagFilters.has(t));

    if (!matches) continue;
    considered += 1;

    if (trim(it?.lyrics) !== placeholderTrimmed) {
      it.lyrics = placeholderTrimmed;
      updated += 1;
    }
  }

  if (apply && updated > 0) {
    await fs.writeFile(catalogPath, JSON.stringify({ ...catalog, items }, null, 2) + "\n", "utf8");
  }

  console.log(
    JSON.stringify(
      {
        apply,
        overwrite,
        placeholder: placeholderTrimmed,
        filters: {
          collectionIds: Array.from(collectionIds),
          collectionTitles: Array.from(collectionTitles),
          tags: Array.from(tagFilters)
        },
        songsConsidered: considered,
        songsUpdated: updated,
        catalog: path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

