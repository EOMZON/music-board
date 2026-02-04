#!/usr/bin/env node
/**
 * Sync NetEase lyrics into catalog.json using the public lyrics API.
 *
 * API used (public):
 *   https://music.163.com/api/song/lyric?os=pc&id=<songId>&lv=-1&kv=-1&tv=-1
 *
 * Matching:
 * - `netease-song-<id>`
 * - `refs.netease.songId`
 * - NetEase song URL in `links[]`
 * - NetEase outchain embed URL in `embeds[]`
 *
 * Usage:
 *   node scripts/music-board/sync-netease-lyrics-api.mjs <catalog.json> [--apply] [--overwrite] [--collection-id <id> ...] [--limit N] [--concurrency N]
 *
 * Notes:
 * - Default is DRY RUN (no writes). Add --apply to write catalog.json.
 * - Lyrics are stored as plain text (timestamps stripped).
 */

import fs from "node:fs/promises";

function usage(exitCode = 1) {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/sync-netease-lyrics-api.mjs <catalog.json> [--apply] [--overwrite] [--collection-id <id> ...] [--limit N] [--concurrency N]",
      "",
      "Options:",
      "  --apply            Write changes (default: dry run)",
      "  --overwrite        Overwrite existing lyrics (default: only fill missing)",
      "  --collection-id    Only process songs with collectionId=<id> (repeatable)",
      "  --limit N          Only process first N matched songs",
      "  --concurrency N    Parallel fetches (default: 3, max: 8)"
    ].join("\n")
  );
  process.exit(exitCode);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseSongIdFromUrl(urlString) {
  const raw = (urlString ?? "").toString().trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.replace("#/", ""));
    const id = u.searchParams.get("id");
    return id && /^\d+$/.test(id) ? id : "";
  } catch {
    const m = raw.match(/[?&]id=(\d+)/);
    return m ? m[1] : "";
  }
}

function parseNeteaseSongId(item) {
  const id = (item?.id ?? "").toString();
  const m = id.match(/^netease-song-(\d+)$/);
  if (m) return m[1];

  const ref = (item?.refs?.netease?.songId ?? "").toString().trim();
  if (ref && /^\d+$/.test(ref)) return ref;

  for (const l of ensureArray(item?.links)) {
    const p = (l?.platform ?? "").toString().trim().toLowerCase();
    if (p !== "netease") continue;
    const songId = parseSongIdFromUrl(l?.url);
    if (songId) return songId;
  }

  for (const e of ensureArray(item?.embeds)) {
    const p = (e?.platform ?? "").toString().trim().toLowerCase();
    if (p !== "netease") continue;
    const url = (e?.url ?? "").toString();
    const idFromQuery = parseSongIdFromUrl(url);
    if (idFromQuery) return idFromQuery;
    const m2 = url.match(/(?:^|[?&])id=(\d+)(?:&|$)/);
    if (m2) return m2[1];
  }

  return "";
}

function stripLrcToPlainText(lrc) {
  const text = (lrc ?? "").toString();
  if (!text.trim()) return "";
  const lines = text.split(/\r?\n/g);
  const out = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (/^\s*\[(?:ar|ti|al|by|offset|length):/i.test(line)) continue;
    const stripped = line.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])+\s*/g, "");
    out.push(stripped.replace(/\s+$/g, ""));
  }
  const normalized = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "music-board/1.0 (sync-netease-lyrics-api)",
      "Referer": "https://music.163.com/"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.json();
}

async function fetchLyricsPlain(songId) {
  const url = `https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`;
  const json = await fetchJson(url);
  const code = Number(json?.code ?? NaN);
  if (code !== 200) return { ok: false, reason: `code=${json?.code}` };

  if (json?.nolyric) return { ok: false, reason: "nolyric" };
  if (json?.uncollected) return { ok: false, reason: "uncollected" };

  const lrc = stripLrcToPlainText(json?.lrc?.lyric || "");
  if (!lrc) return { ok: false, reason: "empty" };
  return { ok: true, lyrics: lrc };
}

function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job()
      .catch(() => {})
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      next();
    });
}

async function main() {
  const args = process.argv.slice(2);
  const catalogPath = args[0];
  if (!catalogPath || args.includes("--help") || args.includes("-h")) usage(0);

  let apply = false;
  let overwrite = false;
  let limit = Infinity;
  let concurrency = 3;
  const collectionIds = [];

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--apply") apply = true;
    else if (a === "--overwrite") overwrite = true;
    else if (a === "--collection-id" && args[i + 1]) {
      collectionIds.push(args[i + 1]);
      i += 1;
    }
    else if (a === "--limit" && args[i + 1]) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
      i += 1;
    } else if (a === "--concurrency" && args[i + 1]) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) concurrency = Math.min(8, Math.floor(n));
      i += 1;
    }
  }

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);
  const songs = items.filter((it) => (it?.type || "") === "song");

  const collectionIdSet = new Set(collectionIds.map((x) => (x ?? "").toString()).filter(Boolean));

  const targets = [];
  for (const it of songs) {
    if (collectionIdSet.size > 0) {
      const cid = (it?.collectionId ?? "").toString();
      if (!collectionIdSet.has(cid)) continue;
    }
    const songId = parseNeteaseSongId(it);
    if (!songId) continue;
    const hasLyrics = (it?.lyrics ?? "").toString().trim() !== "";
    if (!overwrite && hasLyrics) continue;
    targets.push({ item: it, songId });
  }

  const limitedTargets = targets.slice(0, limit);
  const limiter = createLimiter(concurrency);

  let fetched = 0;
  let updated = 0;
  let noLyrics = 0;
  let failed = 0;

  const failures = [];

  await Promise.all(
    limitedTargets.map(({ item, songId }) =>
      limiter(async () => {
        fetched += 1;
        try {
          const res = await fetchLyricsPlain(songId);
          if (!res.ok) {
            if (["nolyric", "uncollected", "empty"].includes(res.reason)) noLyrics += 1;
            else failed += 1;
            if (failures.length < 30) failures.push({ id: item?.id || "", title: item?.title || "", songId, reason: res.reason });
            return;
          }
          const before = (item?.lyrics ?? "").toString();
          item.lyrics = res.lyrics;
          if (before.trim() !== item.lyrics.trim()) updated += 1;
        } catch (err) {
          failed += 1;
          if (failures.length < 30) failures.push({ id: item?.id || "", title: item?.title || "", songId, reason: String(err?.message || err) });
        }
      })
    )
  );

  if (apply) {
    await fs.writeFile(catalogPath, JSON.stringify({ ...catalog, items }, null, 2) + "\n", "utf8");
  }

  console.log(
    JSON.stringify(
      {
        apply,
        overwrite,
        limit: Number.isFinite(limit) ? limit : null,
        concurrency,
        collectionIds: collectionIdSet.size ? Array.from(collectionIdSet) : undefined,
        matched: targets.length,
        fetched,
        updated,
        noLyrics,
        failed,
        sampleFailures: failures
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
