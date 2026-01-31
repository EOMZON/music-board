#!/usr/bin/env node
/**
 * Import local "album working folder" metadata into catalog.json:
 * - lyrics from *_歌词.txt / *.lrc / *_metadata.json
 * - mood/style from tracklist.json (if present)
 * - inspiration/duration/version/createdAt from *_metadata.json
 *
 * Matches by normalized song title (conservative, offline, no network).
 *
 * Usage:
 *   node scripts/music-board/import-local-album-metadata.mjs <albumRoot> <catalog.json> [--apply] [--overwrite] [--git-history]
 *
 * Default is DRY RUN (no writes). Add --apply to write catalog.json.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function usage(exitCode = 1) {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/import-local-album-metadata.mjs <albumRoot> <catalog.json> [--apply] [--overwrite] [--git-history]",
      "",
      "Options:",
      "  --apply        Write changes (default: dry run)",
      "  --overwrite    Overwrite existing fields (default: only fill missing)",
      "  --git-history  Also scan git history for lyric files (fallback when current working tree has none)"
    ].join("\n")
  );
  process.exit(exitCode);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replaceAll("♭", " ")
    .replaceAll("♯", " ")
    .replaceAll("（", "(")
    .replaceAll("）", ")")
    .replaceAll("【", "[")
    .replaceAll("】", "]")
    .replaceAll("：", ":")
    .replaceAll("，", ",")
    .replaceAll("。", ".");
}

function normalizeTitle(s) {
  const raw = normalizeText(s).normalize("NFKC");
  const noTrackNo = raw.replace(/^\s*\d+\s*[-._\s]+\s*/g, "");
  const noLyricsSuffix = noTrackNo
    .replace(/(?:[_\-\s]*歌词)\s*$/g, "")
    .replace(/(?:[_\-\s]*lyric(?:s)?)\s*$/gi, "")
    .replace(/(?:[_\-\s]*lrc)\s*$/gi, "");
  const noBrackets = noLyricsSuffix.replace(/[\[\]【】()（）{}<>《》]/g, " ");
  const noPunct = noBrackets.replace(/[·•!！?？,:：;；"'“”‘’`~@#$%^&*+=|\\/]/g, " ");
  const noChords = noPunct.replace(/\b(?:maj|min|dim|aug)\d{0,2}\b/gi, " ");
  return noChords.replace(/\s+/g, " ").trim();
}

function isLyricsNoise(text) {
  const t = (text ?? "").toString();
  if (!t.trim()) return true;
  const hints = ["AI 作曲", "灵感创作", "模型选择", "优化提示词", "素材列表", "生成歌曲", "0/500"];
  const hit = hints.filter((h) => t.includes(h)).length;
  if (hit >= 3) return true;
  return false;
}

function maybeSet(obj, key, value, overwrite) {
  if (value == null) return false;
  const v = typeof value === "string" ? value.trim() : value;
  if (typeof v === "string" && !v) return false;
  if (!overwrite && obj[key] != null && String(obj[key]).trim() !== "") return false;
  obj[key] = v;
  return true;
}

async function readText(filePath) {
  return await fs.readFile(filePath, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function runGitLines(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout.split(/\r?\n/g));
      reject(new Error(stderr.trim() || `git exited with code ${code}`));
    });
  });
}

async function gitIsRepo(dir) {
  try {
    const lines = await runGitLines(dir, ["rev-parse", "--is-inside-work-tree"]);
    return (lines.join("\n").trim() || "").toLowerCase() === "true";
  } catch {
    return false;
  }
}

async function gitShowText(repoDir, commitHash, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repoDir, "--no-pager", "show", `${commitHash}:${filePath}`], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      reject(new Error(stderr.trim() || `git show exited with code ${code}`));
    });
  });
}

function parseGitLogHeadMap(lines) {
  const byPath = new Map();
  let current = "";
  for (const raw of lines) {
    const line = (raw ?? "").toString().trim();
    if (!line) continue;
    if (/^[0-9a-f]{40}$/i.test(line)) {
      current = line;
      continue;
    }
    if (!current) continue;
    if (!byPath.has(line)) byPath.set(line, current);
  }
  return byPath;
}

async function walk(rootDir) {
  const out = [];
  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (ent.isFile()) out.push(full);
    }
  }
  return out;
}

function stripLyricTitleSuffix(title) {
  let t = (title ?? "").toString().trim();
  if (!t) return "";
  t = t.replace(/\s*\(\d+\)\s*$/g, "").trim();
  t = t.replace(/-vocal(?:[._-].*)?$/i, "").trim();
  t = t.replace(/-iphone(?:[._-].*)?$/i, "").trim();
  return t.trim();
}

function titleFromLyricFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const noSuffix = base.replace(/(?:[_\-\s]*歌词)\s*$/g, "").trim();
  return stripLyricTitleSuffix(noSuffix);
}

function titleFromMvFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/(?:[_\-\s]*mv)\s*$/gi, "").trim();
}

function isProbablyLyricsText(text, options = {}) {
  const t = (text ?? "").toString().replace(/^\uFEFF/, "").trim();
  if (!t) return false;
  if (t.length > 40000) return false;
  if (t.includes("```")) return false;
  if (/<html|<body|<script/i.test(t)) return false;

  const hint = (options?.filenameHint ?? "").toString().toLowerCase();
  const relaxed = /\b(vocal|lyrics|pure|asr)\b/i.test(hint) || hint.includes("歌词");

  const lines = t
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < (relaxed ? 2 : 6)) return false;

  const headings = lines.filter((l) => /^#{1,6}\s+/.test(l)).length;
  if (headings / lines.length > 0.1) return false;

  const kv = lines.filter((l) => /^[^\s]{1,20}\s*[:：]\s*\S+/.test(l)).length;
  if (kv / lines.length > 0.3) return false;

  const longLines = lines.filter((l) => l.length > 140).length;
  if (longLines / lines.length > 0.2) return false;

  const hasSection = lines.some((l) => /^\[[^\]]{1,20}\]$/i.test(l));
  if (hasSection) return true;

  const avgLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
  return avgLen < 80;
}

function extractMvLyrics(text) {
  const raw = (text ?? "").toString();
  const title =
    (raw.match(/\btitle\s*:\s*'([^']+)'/) || [])[1] ||
    (raw.match(/\btitle\s*:\s*"([^"]+)"/) || [])[1] ||
    "";
  const lyricsRaw =
    (raw.match(/\blyricsRaw\s*:\s*`([\s\S]*?)`/) || [])[1] ||
    (raw.match(/\blyricsRaw\s*:\s*'([\s\S]*?)'/) || [])[1] ||
    (raw.match(/\blyricsRaw\s*:\s*"([\s\S]*?)"/) || [])[1] ||
    "";
  return { title, lyricsRaw };
}

function mergeSetArray(existing, incoming) {
  const set = new Set(ensureArray(existing).filter(Boolean));
  for (const t of ensureArray(incoming)) if (t) set.add(t);
  return Array.from(set);
}

function makeCompositeKey(albumKey, trackKey) {
  return `${albumKey}::${trackKey}`;
}

function guessAlbumFromPath(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const seg = parts[i];
    if (/^\d{8}\s+/.test(seg)) return seg.replace(/^\d{8}\s+/, "").trim();
  }
  return "";
}

function isDistrokidSong(item) {
  if (!item || (item.type || "") !== "song") return false;
  const id = (item.id || "").toString();
  if (id.startsWith("isrc-")) return true;
  return ensureArray(item.tags).includes("distrokid");
}

async function ingestTracklist(tracklistPath, maps) {
  const dir = path.dirname(tracklistPath);
  const folder = path.basename(dir);
  const albumGuess = folder.replace(/^\d{8}\s+/, "").trim();
  const albumKey = normalizeTitle(albumGuess);

  const data = await readJson(tracklistPath);
  if (!Array.isArray(data)) return;

  const moods = new Set();

  for (const row of data) {
    const title = (row?.title ?? "").toString().trim();
    if (!title) continue;
    const key = normalizeTitle(title);
    if (!key) continue;
    const compositeKey = albumKey ? makeCompositeKey(albumKey, key) : "";

    const mood = (row?.mood ?? "").toString().trim();
    if (mood) {
      maps.moodByTitle.set(key, mood);
      if (compositeKey) maps.moodByAlbumTitle.set(compositeKey, mood);
      moods.add(mood);
    }

    const lyricRel = (row?.lyric ?? "").toString().trim();
    if (lyricRel) {
      const lyricPath = path.resolve(dir, lyricRel);
      try {
        const text = await readText(lyricPath);
        if (!isLyricsNoise(text)) {
          const prev = maps.lyricByTitle.get(key);
          if (!prev || text.trim().length > prev.text.trim().length) maps.lyricByTitle.set(key, { text, source: lyricPath });
          if (compositeKey) maps.lyricByAlbumTitle.set(compositeKey, { text, source: lyricPath });
        }
      } catch {}
    }

    const metaRel = (row?.meta ?? "").toString().trim();
    if (metaRel) {
      const metaPath = path.resolve(dir, metaRel);
      try {
        const meta = await readJson(metaPath);
        const prev = maps.metaByTitle.get(key) || {};
        maps.metaByTitle.set(key, { ...prev, ...meta, __source: metaPath });
        if (compositeKey) {
          const prevComposite = maps.metaByAlbumTitle.get(compositeKey) || {};
          maps.metaByAlbumTitle.set(compositeKey, { ...prevComposite, ...meta, __source: metaPath });
        }
      } catch {}
    }
  }

  if (albumGuess && moods.size && albumKey) {
    const prev = maps.albumStyleTagsByTitle.get(albumKey) || [];
    maps.albumStyleTagsByTitle.set(albumKey, mergeSetArray(prev, Array.from(moods)));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.includes("--help") || args.includes("-h")) usage(0);

  const albumRoot = args[0];
  const catalogPath = args[1];

  let apply = false;
  let overwrite = false;
  let gitHistory = false;
  for (let i = 2; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--apply") apply = true;
    else if (a === "--overwrite") overwrite = true;
    else if (a === "--git-history") gitHistory = true;
  }

  const maps = {
    lyricByTitle: new Map(), // trackKey -> {text, source}
    metaByTitle: new Map(), // trackKey -> meta json
    moodByTitle: new Map(), // trackKey -> mood
    lyricByAlbumTitle: new Map(), // albumKey::trackKey -> {text, source}
    metaByAlbumTitle: new Map(), // albumKey::trackKey -> meta json
    moodByAlbumTitle: new Map(), // albumKey::trackKey -> mood
    albumStyleTagsByTitle: new Map() // albumKey -> [styleTags...]
  };

  const files = await walk(albumRoot);
  for (const f of files) {
    const name = path.basename(f);
    const ext = path.extname(name).toLowerCase();

    if (name === "tracklist.json") {
      try {
        await ingestTracklist(f, maps);
      } catch {}
      continue;
    }

    if (name.endsWith("_metadata.json")) {
      try {
        const meta = await readJson(f);
        const title = (meta?.title ?? "").toString().trim() || name.replace(/_metadata\.json$/i, "");
        const key = normalizeTitle(title);
        if (!key) continue;
        const prev = maps.metaByTitle.get(key) || {};
        maps.metaByTitle.set(key, { ...prev, ...meta, __source: f });

        const albumGuess = guessAlbumFromPath(f);
        const albumKey = normalizeTitle(albumGuess);
        if (albumKey) {
          const compositeKey = makeCompositeKey(albumKey, key);
          const prevComposite = maps.metaByAlbumTitle.get(compositeKey) || {};
          maps.metaByAlbumTitle.set(compositeKey, { ...prevComposite, ...meta, __source: f });
        }
      } catch {}
      continue;
    }

    const isLyrics =
      ext === ".lrc" ||
      (ext === ".txt" && name.includes("歌词")) ||
      (ext === ".txt" && /_歌词\.txt$/i.test(name));
    if (isLyrics) {
      const title = titleFromLyricFilename(f);
      const key = normalizeTitle(title);
      if (!key) continue;
      try {
        const text = await readText(f);
        if (isLyricsNoise(text)) continue;
        const prev = maps.lyricByTitle.get(key);
        if (!prev || text.trim().length > prev.text.trim().length) maps.lyricByTitle.set(key, { text, source: f });

        const albumGuess = guessAlbumFromPath(f);
        const albumKey = normalizeTitle(albumGuess);
        if (albumKey) maps.lyricByAlbumTitle.set(makeCompositeKey(albumKey, key), { text, source: f });
      } catch {}
      continue;
    }

    const isPlainLyricsText = ext === ".txt" || ext === ".md";
    if (isPlainLyricsText) {
      const base = path.basename(f, ext).trim();
      if (!base) continue;
      if (name.includes("歌词")) continue;
      if (name.toLowerCase() === "readme.md") continue;

      let text = "";
      try {
        text = await readText(f);
      } catch {
        continue;
      }
      if (isLyricsNoise(text)) continue;
      if (!isProbablyLyricsText(text, { filenameHint: name })) continue;

      const key = normalizeTitle(stripLyricTitleSuffix(base));
      if (!key) continue;
      const prev = maps.lyricByTitle.get(key);
      if (!prev || text.trim().length > prev.text.trim().length) maps.lyricByTitle.set(key, { text, source: f });

      const albumGuess = guessAlbumFromPath(f);
      const albumKey = normalizeTitle(albumGuess);
      if (albumKey) maps.lyricByAlbumTitle.set(makeCompositeKey(albumKey, key), { text, source: f });
      continue;
    }

    if (ext === ".js") {
      if (!name.endsWith("_mv.js")) {
        continue;
      }
      let text = "";
      try {
        text = await readText(f);
      } catch {
        continue;
      }
      const { title, lyricsRaw } = extractMvLyrics(text);
      const pickedTitle = (title || titleFromMvFilename(f) || "").toString().trim();
      const pickedLyrics = (lyricsRaw ?? "").toString();
      if (!pickedTitle || !pickedLyrics.trim()) continue;
      if (isLyricsNoise(pickedLyrics)) continue;

      const key = normalizeTitle(pickedTitle);
      if (!key) continue;
      const prev = maps.lyricByTitle.get(key);
      if (!prev || pickedLyrics.trim().length > prev.text.trim().length) maps.lyricByTitle.set(key, { text: pickedLyrics, source: f });

      const albumGuess = guessAlbumFromPath(f);
      const albumKey = normalizeTitle(albumGuess);
      if (albumKey) maps.lyricByAlbumTitle.set(makeCompositeKey(albumKey, key), { text: pickedLyrics, source: f });
    }
  }

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);
  const collectionsById = new Map(
    items
      .filter((it) => ["album", "collection", "playlist"].includes((it?.type || "").toString()))
      .map((it) => [it?.id, (it?.title || "").toString().trim()])
  );

  const titleCounts = new Map();
  const distrokidTitleCounts = new Map();
  for (const it of items) {
    if ((it?.type || "") !== "song") continue;
    const tKey = normalizeTitle((it?.title || "").toString().trim());
    if (!tKey) continue;
    titleCounts.set(tKey, (titleCounts.get(tKey) || 0) + 1);
    if (isDistrokidSong(it)) distrokidTitleCounts.set(tKey, (distrokidTitleCounts.get(tKey) || 0) + 1);
  }

  if (gitHistory && (await gitIsRepo(albumRoot))) {
    const wantTitleKeys = new Set();
    const wantCompositeKeys = new Set();
    for (const it of items) {
      if ((it?.type || "") !== "song") continue;
      const title = (it?.title || "").toString().trim();
      const key = normalizeTitle(title);
      if (!key) continue;
      const lyricsMissing = overwrite || (it?.lyrics ?? "").toString().trim() === "";
      if (!lyricsMissing) continue;

      const collectionTitle = collectionsById.get(it.collectionId || "") || "";
      const albumKey = normalizeTitle(collectionTitle);
      const compositeKey = albumKey ? makeCompositeKey(albumKey, key) : "";
      const ambiguousTitle = (titleCounts.get(key) || 0) > 1;

      const hasAlbumLyric = compositeKey ? maps.lyricByAlbumTitle.has(compositeKey) : false;
      const hasTitleLyric = maps.lyricByTitle.has(key);

      if (!hasTitleLyric) wantTitleKeys.add(key);
      if (compositeKey && !hasAlbumLyric && (ambiguousTitle || !hasTitleLyric)) wantCompositeKeys.add(compositeKey);
    }

    if (wantTitleKeys.size || wantCompositeKeys.size) {
      let lines = [];
      try {
        lines = await runGitLines(albumRoot, ["log", "--all", "--name-only", "--pretty=format:%H", "--diff-filter=AMCR"]);
      } catch {
        lines = [];
      }
      const headByPath = parseGitLogHeadMap(lines);

      for (const [relPath, commitHash] of headByPath) {
        const name = path.basename(relPath);
        const ext = path.extname(name).toLowerCase();
        const isLyrics =
          ext === ".lrc" ||
          (ext === ".txt" && name.includes("歌词")) ||
          (ext === ".txt" && /_歌词\.txt$/i.test(name));
        if (!isLyrics) continue;

        const absLike = path.resolve(albumRoot, relPath);
        const title = titleFromLyricFilename(relPath);
        const key = normalizeTitle(title);
        if (!key) continue;
        const albumGuess = guessAlbumFromPath(absLike);
        const albumKey = normalizeTitle(albumGuess);
        const compositeKey = albumKey ? makeCompositeKey(albumKey, key) : "";

        const wantsComposite = compositeKey && wantCompositeKeys.has(compositeKey) && !maps.lyricByAlbumTitle.has(compositeKey);
        const wantsTitle = wantTitleKeys.has(key) && !maps.lyricByTitle.has(key);
        if (!wantsComposite && !wantsTitle) continue;

        let text = "";
        try {
          text = await gitShowText(albumRoot, commitHash, relPath);
        } catch {
          continue;
        }
        if (!text || isLyricsNoise(text)) continue;

        if (wantsComposite && compositeKey) maps.lyricByAlbumTitle.set(compositeKey, { text, source: `${albumRoot}@${commitHash}:${relPath}` });
        if (wantsTitle) maps.lyricByTitle.set(key, { text, source: `${albumRoot}@${commitHash}:${relPath}` });
      }
    }
  }

  let songUpdated = 0;
  let albumUpdated = 0;
  let skippedAmbiguous = 0;

  for (const it of items) {
    const type = (it?.type || "").toString();
    const title = (it?.title || "").toString().trim();
    const key = normalizeTitle(title);
    if (!key) continue;

    if (type === "song") {
      let touched = false;

      const collectionTitle = collectionsById.get(it.collectionId || "") || "";
      const albumKey = normalizeTitle(collectionTitle);
      const compositeKey = albumKey ? makeCompositeKey(albumKey, key) : "";
      const ambiguousTitle = (titleCounts.get(key) || 0) > 1;

      const lyricAlbum = compositeKey ? maps.lyricByAlbumTitle.get(compositeKey) : null;
      const lyricTitle = maps.lyricByTitle.get(key) || null;
      const lyric = lyricAlbum || lyricTitle;
      const lyricIsFallback = !lyricAlbum && !!lyricTitle;
      if (lyric) {
        if (lyricIsFallback && ambiguousTitle) {
          const dkCount = distrokidTitleCounts.get(key) || 0;
          if (dkCount > 1) {
            skippedAmbiguous += 1;
          } else {
            touched = maybeSet(it, "lyrics", lyric.text, overwrite) || touched;
          }
        } else {
          touched = maybeSet(it, "lyrics", lyric.text, overwrite) || touched;
        }
      }

      const moodAlbum = compositeKey ? maps.moodByAlbumTitle.get(compositeKey) : "";
      const moodTitle = maps.moodByTitle.get(key) || "";
      const mood = moodAlbum || moodTitle;
      const moodIsFallback = !moodAlbum && !!moodTitle;
      if (mood) {
        if (moodIsFallback && ambiguousTitle) {
          skippedAmbiguous += 1;
        } else {
          touched = maybeSet(it, "mood", mood, overwrite) || touched;
        }
      }

      const metaAlbum = compositeKey ? maps.metaByAlbumTitle.get(compositeKey) : null;
      const metaTitle = maps.metaByTitle.get(key) || null;
      const meta = metaAlbum || metaTitle;
      const metaIsFallback = !metaAlbum && !!metaTitle;
      if (meta) {
        if (metaIsFallback && ambiguousTitle) {
          skippedAmbiguous += 1;
        } else {
          touched = maybeSet(it, "duration", meta?.duration, overwrite) || touched;
          touched = maybeSet(it, "version", meta?.version, overwrite) || touched;
          touched = maybeSet(it, "createdAt", meta?.createdAt, overwrite) || touched;

          const inspiration = meta?.inspiration && typeof meta.inspiration === "object" ? meta.inspiration : null;
          if (inspiration && Object.keys(inspiration).length) {
            touched = maybeSet(it, "inspiration", inspiration, overwrite) || touched;
          }

          const lyricsFromMeta = (meta?.lyrics ?? "").toString();
          if (lyricsFromMeta && !isLyricsNoise(lyricsFromMeta)) {
            touched = maybeSet(it, "lyrics", lyricsFromMeta, overwrite) || touched;
          }
        }
      }

      if (touched) songUpdated += 1;
      continue;
    }

    if (["album", "collection", "playlist"].includes(type)) {
      const styles = maps.albumStyleTagsByTitle.get(key);
      if (!styles || styles.length === 0) continue;
      const prev = Array.isArray(it.styleTags) ? it.styleTags : [];
      const next = mergeSetArray(prev, styles);
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        it.styleTags = next;
        albumUpdated += 1;
      }
    }
  }

  if (apply) {
    await fs.writeFile(catalogPath, JSON.stringify({ ...catalog, items }, null, 2) + "\n", "utf8");
  }

  const relCatalog = path.relative(process.cwd(), path.resolve(catalogPath)) || catalogPath;
  console.log(
    JSON.stringify(
      {
        apply,
        overwrite,
        found: {
          lyrics: maps.lyricByTitle.size,
          meta: maps.metaByTitle.size,
          moods: maps.moodByTitle.size,
          albumStyleTags: maps.albumStyleTagsByTitle.size
        },
        skippedAmbiguous,
        updated: { songs: songUpdated, albums: albumUpdated },
        catalog: relCatalog
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
