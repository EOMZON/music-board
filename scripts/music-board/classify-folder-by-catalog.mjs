#!/usr/bin/env node
/**
 * Classify local audio files into two folders:
 * - 列表内: filename matches a song title in catalog.json
 * - 列表外: filename does not match
 *
 * It also classifies lyric files by default:
 * - `.lrc`
 * - `.txt` files that include `歌词` in filename (e.g. `歌名_歌词.txt`)
 *
 * Default is DRY RUN. Use --apply to actually move/copy files.
 *
 * Usage:
 *   node scripts/music-board/classify-folder-by-catalog.mjs "<folder>" docs/music-board/catalog.json
 *
 * Optional:
 *   --apply                 apply changes (default: dry run)
 *   --mode move|copy        default: move (only used with --apply)
 *   --recursive             scan subfolders too
 *   --album <albumId>       restrict catalog titles to a specific album (id or netease-album-<id>)
 *   --ext wav,mp3,m4a,flac  extensions whitelist (default includes common audio types)
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage(exitCode = 1) {
  const msg = [
    "Usage:",
    "  node scripts/music-board/classify-folder-by-catalog.mjs <folder> <catalog.json> [options]",
    "",
    "Options:",
    "  --apply                 Apply changes (default: dry run)",
    "  --mode move|copy        Operation mode (default: move)",
    "  --recursive             Scan subfolders",
    "  --album <albumId>       Restrict matching titles to a single album (id or netease-album-<id>)",
    "  --ext wav,mp3,m4a,...   Extensions whitelist",
    "",
    "Examples:",
    '  node scripts/music-board/classify-folder-by-catalog.mjs "/Users/zon/Desktop/MINE/10_music/album/待发布_网易云/20260121 春节2" docs/music-board/catalog.json',
    '  node scripts/music-board/classify-folder-by-catalog.mjs "/Users/.../20260121 春节2" docs/music-board/catalog.json --apply --mode move',
    '  node scripts/music-board/classify-folder-by-catalog.mjs "/Users/.../20260121 春节2" docs/music-board/catalog.json --album 359139954 --apply'
  ].join("\n");
  console.error(msg);
  process.exit(exitCode);
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeText(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replaceAll("（", "(")
    .replaceAll("）", ")")
    .replaceAll("【", "[")
    .replaceAll("】", "]")
    .replaceAll("：", ":")
    .replaceAll("，", ",")
    .replaceAll("。", ".");
}

function normalizeTitleOrFilename(s) {
  const raw = normalizeText(s);
  const noExt = raw.replace(/\.[a-z0-9]{1,6}$/i, "");
  const noTrackNo = noExt.replace(/^\s*\d+\s*[-._\s]+\s*/g, "");
  const noLyricsSuffix = noTrackNo
    .replace(/(?:[_\-\s]*歌词)\s*$/g, "")
    .replace(/(?:[_\-\s]*lyric(?:s)?)\s*$/gi, "")
    .replace(/(?:[_\-\s]*lrc)\s*$/gi, "");
  const noBrackets = noLyricsSuffix.replace(/[\[\]【】()（）{}<>《》]/g, " ");
  const noPunct = noBrackets.replace(/[·•!！?？,:：;；"'“”‘’`~@#$%^&*+=|\\/]/g, " ");
  return noPunct.replace(/\s+/g, " ").trim();
}

function parseAlbumArg(album) {
  const a = (album ?? "").toString().trim();
  if (!a) return "";
  if (/^netease-album-\d+$/.test(a)) return a;
  if (/^\d+$/.test(a)) return `netease-album-${a}`;
  return a;
}

function extSetFromArg(extArg) {
  const defaults = ["wav", "mp3", "m4a", "flac", "aiff", "aif", "ogg", "opus", "aac", "mp4"];
  if (!extArg) return new Set(defaults);
  const parts = extArg
    .split(",")
    .map((s) => s.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  return new Set(parts.length ? parts : defaults);
}

async function listFiles(rootDir, recursive) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === "列表内" || ent.name === "列表外") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (ent.isFile()) out.push(full);
    }
  }
  await walk(rootDir);
  return out;
}

function isLyricCandidate(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(base).replace(/^\./, "").toLowerCase();
  if (ext === "lrc") return true;
  if (ext === "txt" && base.includes("歌词")) return true;
  return false;
}

function buildTitleIndex(catalog, albumFilterId) {
  const items = ensureArray(catalog?.items);
  const songs = items.filter((it) => (it?.type || "") === "song");
  const filtered = albumFilterId ? songs.filter((s) => (s?.collectionId || "") === albumFilterId) : songs;

  const index = new Map();
  for (const s of filtered) {
    const title = (s?.title ?? "").toString().trim();
    if (!title) continue;
    const norm = normalizeTitleOrFilename(title);
    if (!norm) continue;
    if (!index.has(norm)) index.set(norm, new Set());
    index.get(norm).add(title);
  }
  return index;
}

function isMatch(fileNorm, titleIndex) {
  if (!fileNorm) return { matched: false, reason: "empty" };
  if (titleIndex.has(fileNorm)) return { matched: true, reason: "exact" };
  for (const [tNorm] of titleIndex) {
    if (tNorm.length < 2) continue;
    if (tNorm.includes(fileNorm) || fileNorm.includes(tNorm)) return { matched: true, reason: "contains" };
  }
  return { matched: false, reason: "no-match" };
}

async function uniqueDestPath(destDir, basename) {
  const ext = path.extname(basename);
  const name = path.basename(basename, ext);
  let candidate = path.join(destDir, basename);
  for (let i = 1; i < 200; i++) {
    try {
      await fs.access(candidate);
      candidate = path.join(destDir, `${name} (${i})${ext}`);
    } catch {
      return candidate;
    }
  }
  return path.join(destDir, `${name} (${Date.now()})${ext}`);
}

async function safeMove(src, dest) {
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if (e?.code !== "EXDEV") throw e;
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.includes("--help") || args.includes("-h")) usage(0);

  const folder = args[0];
  const catalogPath = args[1];

  let apply = false;
  let mode = "move";
  let recursive = false;
  let albumArg = "";
  let extArg = "";

  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply") apply = true;
    else if (a === "--recursive") recursive = true;
    else if (a === "--mode" && args[i + 1]) {
      mode = args[i + 1];
      i += 1;
    } else if (a === "--album" && args[i + 1]) {
      albumArg = args[i + 1];
      i += 1;
    } else if (a === "--ext" && args[i + 1]) {
      extArg = args[i + 1];
      i += 1;
    }
  }

  if (!["move", "copy"].includes(mode)) {
    console.error(`Invalid --mode: ${mode}`);
    usage(1);
  }

  const albumFilterId = parseAlbumArg(albumArg);
  const extSet = extSetFromArg(extArg);

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const titleIndex = buildTitleIndex(catalog, albumFilterId);

  const files = await listFiles(folder, recursive);
  const candidates = files.filter((f) => {
    const ext = path.extname(f).replace(/^\./, "").toLowerCase();
    if (extSet.has(ext)) return true;
    return isLyricCandidate(f);
  });

  const inDir = path.join(folder, "列表内");
  const outDir = path.join(folder, "列表外");

 const actions = [];
  let matched = 0;
  let unmatched = 0;

  for (const f of candidates) {
    const base = path.basename(f);
    const fileNorm = normalizeTitleOrFilename(base);
    const m = isMatch(fileNorm, titleIndex);
    const destRoot = m.matched ? inDir : outDir;
    const dest = await uniqueDestPath(destRoot, base);
    actions.push({
      src: f,
      dest,
      bucket: m.matched ? "列表内" : "列表外",
      match: m.reason,
      normalized: fileNorm
    });
    if (m.matched) matched += 1;
    else unmatched += 1;
  }

  const summary = {
    folder,
    catalog: catalogPath,
    albumFilterId: albumFilterId || null,
    recursive,
    apply,
    mode: apply ? mode : null,
    ext: Array.from(extSet),
    totalFiles: files.length,
    candidateFiles: candidates.length,
    matched,
    unmatched,
    actions
  };

  if (!apply) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }

  await fs.mkdir(inDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  for (const a of actions) {
    if (mode === "move") await safeMove(a.src, a.dest);
    else await fs.copyFile(a.src, a.dest);
  }

  process.stdout.write(JSON.stringify({ ...summary, done: true }, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
