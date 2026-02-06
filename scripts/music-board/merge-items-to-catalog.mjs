#!/usr/bin/env node
/**
 * Merge exported items JSON into catalog.json (dedupe by id).
 *
 * Usage:
 *   node scripts/music-board/merge-items-to-catalog.mjs <items.json> <catalog.json> [--apply]
 *
 * - Default is DRY RUN (no writes). Add --apply to write.
 * - Accepts these input formats:
 *   1) [{ source, items: [...] }, ...]
 *   2) { items: [...] }
 *   3) [...] (direct items array)
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  console.error(
    [
      "Usage: node scripts/music-board/merge-items-to-catalog.mjs <items.json> <catalog.json> [--apply]",
      "",
      "Flags:",
      "  --apply    Write catalog.json (default: dry run)"
    ].join("\n")
  );
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

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const args = argv.filter((a) => a !== "--apply");
  if (args.length < 2) {
    usage();
    process.exit(1);
  }

  const itemsPath = args[0];
  const catalogPath = args[1];

  const itemsRaw = await fs.readFile(itemsPath, "utf8");
  const itemsJson = JSON.parse(itemsRaw);
  const incomingAll = normalizeItemsJson(itemsJson).filter(isItemLike);
  if (incomingAll.length === 0) {
    console.error("No items found in input JSON.");
    process.exit(1);
  }

  const catalogRaw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(catalogRaw);
  if (!Array.isArray(catalog.items)) catalog.items = [];

  const byId = new Map();
  for (const item of catalog.items) {
    if (isItemLike(item)) byId.set(item.id, item);
  }

  let added = 0;
  let updated = 0;
  for (const inc of incomingAll) {
    const existing = byId.get(inc.id);
    if (existing) {
      Object.assign(existing, inc);
      updated++;
      continue;
    }
    catalog.items.push(inc);
    byId.set(inc.id, inc);
    added++;
  }

  const relCatalog = path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath;
  const relItems = path.relative(process.cwd(), path.resolve(itemsPath)) || itemsPath;
  const summary = { apply, incoming: incomingAll.length, added, updated, catalog: relCatalog, input: relItems };

  if (!apply) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    process.stderr.write("DRY RUN: add --apply to write catalog.json\n");
    return;
  }

  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

