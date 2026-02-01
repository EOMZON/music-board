#!/usr/bin/env node
/**
 * Fill missing lyrics for instrumental tracks with a unified placeholder.
 *
 * Matching (default):
 * - Only songs whose `tags` include "EMPTY" or "HAPPY"
 * - Only when `lyrics` is missing/blank (unless --overwrite)
 *
 * Usage:
 *   node scripts/music-board/fill-instrumental-placeholder.mjs <catalog.json> [--apply] [--overwrite]
 *
 * Options:
 *   --apply                 Write changes (default: dry run)
 *   --overwrite             Overwrite existing lyrics (default: only fill missing)
 *   --placeholder <text>    Placeholder text (default: 纯音乐（无歌词）)
 *   --tags <csv>            Comma-separated tags to match (default: EMPTY,HAPPY)
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage(exitCode = 1) {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/fill-instrumental-placeholder.mjs <catalog.json> [--apply] [--overwrite] [--placeholder <text>] [--tags <csv>]",
      "",
      "Options:",
      "  --apply                 Write changes (default: dry run)",
      "  --overwrite             Overwrite existing lyrics (default: only fill missing)",
      "  --placeholder <text>    Placeholder text (default: 纯音乐（无歌词）)",
      "  --tags <csv>            Comma-separated tags to match (default: EMPTY,HAPPY)"
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

function parseCsvList(text) {
  const raw = (text ?? "").toString().trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const catalogPath = args[0];
  if (!catalogPath || args.includes("--help") || args.includes("-h")) usage(0);

  let apply = false;
  let overwrite = false;
  let placeholder = "纯音乐（无歌词）";
  let tags = ["EMPTY", "HAPPY"];

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--apply") apply = true;
    else if (a === "--overwrite") overwrite = true;
    else if (a === "--placeholder" && args[i + 1]) {
      placeholder = args[i + 1];
      i += 1;
    } else if (a === "--tags" && args[i + 1]) {
      tags = parseCsvList(args[i + 1]);
      i += 1;
    }
  }

  const placeholderTrimmed = trim(placeholder);
  if (!placeholderTrimmed) throw new Error("Empty --placeholder is not allowed");
  const tagSet = new Set(tags.map((t) => trim(t)).filter(Boolean));
  if (tagSet.size === 0) throw new Error("Empty --tags is not allowed");

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);

  let considered = 0;
  let updated = 0;

  for (const it of items) {
    if (trim(it?.type) !== "song") continue;
    const itemTags = ensureArray(it?.tags).map((t) => trim(t));
    const matchesTag = itemTags.some((t) => tagSet.has(t));
    if (!matchesTag) continue;
    considered += 1;

    const hasLyrics = trim(it?.lyrics) !== "";
    if (!overwrite && hasLyrics) continue;

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
        tags: Array.from(tagSet),
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

