#!/usr/bin/env node
/**
 * Fill missing `lyrics` in catalog.json from a Baidu Pan share link.
 *
 * Strategy:
 * - Verify share extraction code via `/share/verify` (gets BDCLND / randsk cookie)
 * - Recursively enumerate `.txt` files via `/share/list`
 * - For each file, call `/share/list?newdocpreview=1&fid=...` to obtain `picdocpreview`
 * - Fetch lyrics text from `picdocpreview` (pcsdata docview endpoint)
 * - Match by normalized song title and write into catalog.json
 *
 * Usage:
 *   node scripts/music-board/sync-baidu-pan-share-lyrics.mjs <catalog.json> \
 *     --share <url-or-key> --pwd <code> [--sekey <sekey>] [--apply] [--overwrite]
 *     [--strip-prefixes <csv>] [--title-alias <from>=<to>] [--title-alias-file <path>]
 *     [--dump-files <path>] [--concurrency 4]
 */

import fs from "node:fs/promises";
import path from "node:path";

function usage(exitCode = 1) {
  console.error(
    [
      "Usage:",
      "  node scripts/music-board/sync-baidu-pan-share-lyrics.mjs <catalog.json> --share <url-or-key> --pwd <code> [--sekey <sekey>] [--apply] [--overwrite] [--strip-prefixes <csv>] [--title-alias <from>=<to>] [--title-alias-file <path>] [--dump-files <path>] [--concurrency 4]",
      "",
      "Options:",
      "  --share <url-or-key>   Baidu Pan share URL or share key (e.g. 1xxxx...)",
      "  --pwd <code>           Extraction code (提取码)",
      "  --sekey <sekey>        Optional decoded BDCLND/randsk (skip /share/verify when provided)",
      "  --apply                Write catalog.json (default: dry run)",
      "  --overwrite            Overwrite existing lyrics (default: only fill missing)",
      "  --strip-prefixes <csv> Additional title prefixes to strip from lyric filenames (e.g. 韩流,圣诞)",
      "  --title-alias <a=b>    Map a lyric filename title to a catalog title (repeatable)",
      "  --title-alias-file     JSON mapping file: {\"from\":\"to\"} or [{\"from\":\"...\",\"to\":\"...\"}]",
      "  --dump-files <path>    Write a JSON index of discovered lyric files (for debugging/mapping)",
      "  --concurrency <n>       Concurrent fetches (default: 4)"
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

function stripLyricTitleSuffix(title) {
  let t = (title ?? "").toString().trim();
  if (!t) return "";
  t = t.replace(/\s*\(\d+\)\s*$/g, "").trim();
  t = t.replace(/-vocal(?:[._-].*)?$/i, "").trim();
  t = t.replace(/-iphone(?:[._-].*)?$/i, "").trim();
  t = t.replace(/[._-]formatted(?:[._-].*)?$/i, "").trim();
  t = t.replace(/[._-]pure(?:[._-].*)?$/i, "").trim();
  t = t.replace(/[._-]asr(?:[._-].*)?$/i, "").trim();
  return t.trim();
}

function isLyricsNoise(text) {
  const t = (text ?? "").toString();
  if (!t.trim()) return true;
  const hints = ["AI 作曲", "灵感创作", "模型选择", "优化提示词", "素材列表", "生成歌曲", "0/500"];
  const hit = hints.filter((h) => t.includes(h)).length;
  if (hit >= 3) return true;
  return false;
}

function parseCsvList(text) {
  const raw = (text ?? "").toString().trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseAliasPair(text) {
  const raw = (text ?? "").toString().trim();
  if (!raw) return null;
  const idx = raw.indexOf("=");
  if (idx <= 0) return null;
  const from = raw.slice(0, idx).trim();
  const to = raw.slice(idx + 1).trim();
  if (!from || !to) return null;
  return { from, to };
}

async function loadAliasFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const json = JSON.parse(raw);
  if (Array.isArray(json)) {
    return json
      .map((x) => ({ from: trim(x?.from), to: trim(x?.to) }))
      .filter((x) => x.from && x.to);
  }
  if (json && typeof json === "object") {
    return Object.entries(json)
      .map(([from, to]) => ({ from: trim(from), to: trim(to) }))
      .filter((x) => x.from && x.to);
  }
  return [];
}

function canonicalizeKey(key, aliasMap) {
  let k = trim(key);
  if (!k || !aliasMap || aliasMap.size === 0) return k;
  // guard against accidental loops / multi-hop chains
  for (let i = 0; i < 6; i += 1) {
    const next = aliasMap.get(k);
    if (!next || next === k) return k;
    k = next;
  }
  return k;
}

function createLimiter(limit) {
  const q = [];
  let active = 0;

  const runNext = () => {
    if (!q.length) return;
    if (active >= limit) return;
    const job = q.shift();
    active += 1;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      q.push({ fn, resolve, reject });
      runNext();
    });
}

function getSetCookieHeaders(headers) {
  if (typeof headers?.getSetCookie === "function") return headers.getSetCookie();
  const single = headers?.get?.("set-cookie");
  return single ? [single] : [];
}

function parseCookiePair(setCookieValue) {
  const raw = (setCookieValue ?? "").toString().trim();
  if (!raw) return null;
  const first = raw.split(";")[0] || "";
  const idx = first.indexOf("=");
  if (idx <= 0) return null;
  const name = first.slice(0, idx).trim();
  const value = first.slice(idx + 1).trim();
  if (!name) return null;
  return [name, value];
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }

  set(name, value) {
    if (!name) return;
    this.map.set(name, value ?? "");
  }

  get(name) {
    return this.map.get(name);
  }

  headerValue() {
    return Array.from(this.map.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  ingestFrom(headers) {
    for (const sc of getSetCookieHeaders(headers)) {
      const pair = parseCookiePair(sc);
      if (!pair) continue;
      this.set(pair[0], pair[1]);
    }
  }
}

function parseShareKey(share) {
  const s = trim(share);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("s");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
      if (parts.length >= 2 && parts[0] === "s") return parts[1];
    } catch {}
    return "";
  }
  return s.replace(/^\/+|\/+$/g, "");
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWithCookies(url, jar, options = {}) {
  const headers = new Headers(options.headers || {});
  if (jar) {
    const cookie = jar.headerValue();
    if (cookie) headers.set("cookie", cookie);
  }
  if (!headers.has("user-agent")) {
    headers.set(
      "user-agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );
  }

  const res = await fetch(url, { ...options, headers });
  if (jar) jar.ingestFrom(res.headers);
  return res;
}

async function fetchJson(url, jar, options = {}, { retries = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetchWithCookies(url, jar, options);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await sleep(300 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

async function fetchText(url, jar, options = {}, { retries = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetchWithCookies(url, jar, options);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return text;
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await sleep(300 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

function parseShareIdsFromHtml(html) {
  const s = (html ?? "").toString();
  const shareId = (s.match(/\bshareid\s*:\s*\"(\d+)\"/) || [])[1] || (s.match(/\bshareid\s*:\s*(\d+)\b/) || [])[1] || "";
  const shareUk = (s.match(/\bshare_uk\s*:\s*\"(\d+)\"/) || [])[1] || (s.match(/\bshare_uk\s*:\s*(\d+)\b/) || [])[1] || "";
  return { shareId, shareUk };
}

function extLower(filename) {
  return path.extname((filename ?? "").toString()).toLowerCase();
}

const LYRIC_DOC_EXTS = new Set([".txt", ".lrc", ".md", ".doc", ".docx", ".pdf"]);

function isMappingDocFilename(filename) {
  const f = trim(filename).toLowerCase();
  if (!f) return false;
  if (f.includes("名称映射")) return true;
  if (f.includes("映射表")) return true;
  if (f.includes("source_map") || f.includes("sourcemap")) return true;
  if (f.includes("name_map") || f.includes("namemap")) return true;
  return false;
}

function isDistrokidTracksCsv(filename) {
  const f = trim(filename).toLowerCase();
  return f === "distrokid_tracks.csv";
}

function stripBom(s) {
  return (s ?? "").toString().replace(/^\uFEFF/, "");
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const raw = stripBom(text);
  const lines = raw.split(/\r?\n/g).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      const k = header[i];
      if (!k) continue;
      row[k] = cols[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseTsv(text) {
  const raw = stripBom(text);
  const lines = raw.split(/\r?\n/g).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const header = lines[0].split("\t").map((h) => h.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      const k = header[i];
      if (!k) continue;
      row[k] = cols[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseMarkdownTable(text) {
  const lines = (text ?? "").toString().split(/\r?\n/g);
  const tableLines = lines.map((l) => l.trim()).filter((l) => l.startsWith("|") && l.includes("|"));
  if (tableLines.length < 2) return null;

  const parseRow = (line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

  const header = parseRow(tableLines[0]);
  const sep = parseRow(tableLines[1]);
  const isSep = sep.length && sep.every((c) => /^:?-{2,}:?$/.test(c));
  const dataLines = isSep ? tableLines.slice(2) : tableLines.slice(1);

  const rows = dataLines
    .map(parseRow)
    .filter((cells) => cells.some((c) => c && !/^:?-{2,}:?$/.test(c)));

  return { header, rows };
}

function isJsonLike(text) {
  const t = (text ?? "").toString().trim();
  if (!t) return false;
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function addAlias(aliasMap, fromTitle, toTitle, { overwrite = false } = {}) {
  const fromKey = normalizeTitle(fromTitle);
  const toKey = normalizeTitle(toTitle);
  if (!fromKey || !toKey || fromKey === toKey) return false;
  if (!overwrite && aliasMap.has(fromKey)) return false;
  aliasMap.set(fromKey, toKey);
  return true;
}

function ingestTitleAliasesFromMarkdown(mdText, aliasMap) {
  const table = parseMarkdownTable(mdText);
  if (!table) return 0;

  const header = table.header.map((h) => (h ?? "").toString().trim());
  const findIdx = (pred) => header.findIndex((h) => pred(h));

  const idxOldTitle = findIdx((h) => h.includes("原歌名") || h.includes("原曲名") || h === "原名");
  const idxNewTitle = findIdx((h) => h.includes("新歌名") || h.includes("发布用") || h.includes("发布"));
  if (idxOldTitle < 0 || idxNewTitle < 0) return 0;

  let added = 0;
  for (const cells of table.rows) {
    const oldTitle = (cells[idxOldTitle] ?? "").toString().trim();
    const newTitle = (cells[idxNewTitle] ?? "").toString().trim();
    if (!oldTitle || !newTitle) continue;
    if (addAlias(aliasMap, oldTitle, newTitle)) added += 1;
  }
  return added;
}

function ingestTitleAliasesFromRows(rows, aliasMap) {
  let added = 0;
  for (const row of ensureArray(rows)) {
    const oldTitle = trim(
      getAnyRowValue(row, [
        "原歌名",
        "原曲名",
        "old_title",
        "oldTitle",
        "old title",
        "original_title",
        "originalTitle",
        "original title"
      ])
    );
    const newTitle = trim(
      getAnyRowValue(row, [
        "新歌名",
        "发布歌名",
        "new_title",
        "newTitle",
        "new title",
        "publish_title",
        "publishTitle",
        "publish title"
      ])
    );
    if (oldTitle && newTitle && addAlias(aliasMap, oldTitle, newTitle)) added += 1;

    const mapTitle = trim(getAnyRowValue(row, ["title", "Title", "歌名", "曲名"]));
    const mapSource = trim(getAnyRowValue(row, ["source", "Source", "lyrics", "lyric", "歌词", "歌词文件", "文件"]));
    if (mapTitle && mapSource) {
      const stem = stripLyricTitleSuffix(path.basename(mapSource, path.extname(mapSource)));
      if (stem && addAlias(aliasMap, stem, mapTitle)) added += 1;
    }
  }
  return added;
}

function getAnyRowValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  const wanted = ensureArray(keys)
    .map((k) => (k ?? "").toString().trim())
    .filter(Boolean);
  for (const k of wanted) {
    if (k in row) return row[k];
  }
  const lowered = new Map(Object.keys(row).map((k) => [k.toLowerCase().replace(/\s+/g, ""), k]));
  for (const k of wanted) {
    const normalized = k.toLowerCase().replace(/\s+/g, "");
    const real = lowered.get(normalized);
    if (real) return row[real];
  }
  // fallback: fuzzy contains
  const rowKeys = Object.keys(row);
  for (const k of wanted) {
    const needle = k.toLowerCase().replace(/\s+/g, "");
    const hit = rowKeys.find((rk) => rk.toLowerCase().replace(/\s+/g, "").includes(needle));
    if (hit) return row[hit];
  }
  return "";
}

function coerceDocviewUrlToText(url) {
  try {
    const u = new URL(url);
    const ft = (u.searchParams.get("file_type") || "").toLowerCase();
    if (ft && ft !== "txt") u.searchParams.set("file_type", "txt");
    return u.toString();
  } catch {
    return url;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const catalogPath = args[0];
  if (!catalogPath || args.includes("--help") || args.includes("-h")) usage(0);

  let share = "";
  let pwd = "";
  let sekeyInput = "";
  let apply = false;
  let overwrite = false;
  let dumpFilesPath = "";
  let concurrency = 4;
  let stripPrefixes = [];
  const aliasPairs = [];
  let aliasFilePath = "";

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--share" && args[i + 1]) {
      share = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--pwd" && args[i + 1]) {
      pwd = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--sekey" && args[i + 1]) {
      sekeyInput = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--strip-prefixes" && args[i + 1]) {
      stripPrefixes = parseCsvList(args[i + 1]);
      i += 1;
      continue;
    }
    if (a === "--title-alias" && args[i + 1]) {
      const pair = parseAliasPair(args[i + 1]);
      if (pair) aliasPairs.push(pair);
      i += 1;
      continue;
    }
    if (a === "--title-alias-file" && args[i + 1]) {
      aliasFilePath = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--apply") {
      apply = true;
      continue;
    }
    if (a === "--overwrite") {
      overwrite = true;
      continue;
    }
    if (a === "--dump-files" && args[i + 1]) {
      dumpFilesPath = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, Math.min(16, Number(args[i + 1]) || 4));
      i += 1;
      continue;
    }
  }

  const shareKey = parseShareKey(share);
  if (!shareKey || !pwd) {
    console.error("Missing required args: --share and --pwd");
    usage(1);
  }

  const aliasMap = new Map();
  if (aliasFilePath) {
    const loaded = await loadAliasFile(aliasFilePath);
    for (const p of loaded) {
      const fromKey = normalizeTitle(p.from);
      const toKey = normalizeTitle(p.to);
      if (fromKey && toKey) aliasMap.set(fromKey, toKey);
    }
  }
  for (const p of aliasPairs) {
    const fromKey = normalizeTitle(p.from);
    const toKey = normalizeTitle(p.to);
    if (fromKey && toKey) aliasMap.set(fromKey, toKey);
  }

  const shortUrl = shareKey;
  const surl = shortUrl.startsWith("1") ? shortUrl.slice(1) : shortUrl;

  const jar = new CookieJar();
  const sharePageUrl = `https://pan.baidu.com/s/${encodeURIComponent(shortUrl)}`;
  const shareHtml = await fetchText(sharePageUrl, jar, { method: "GET" });
  const { shareId, shareUk } = parseShareIdsFromHtml(shareHtml);
  if (!shareId || !shareUk) throw new Error("Failed to parse shareid/share_uk from share page HTML");

  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const items = ensureArray(catalog?.items);
  const albumTitlePrefixes = items
    .filter((it) => ["album", "collection", "playlist"].includes(trim(it?.type)))
    .map((it) => trim(it?.title))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const extraPrefixes = stripPrefixes.map((x) => trim(x)).filter(Boolean);
  const prefixCandidates = Array.from(new Set(albumTitlePrefixes.concat(extraPrefixes))).sort((a, b) => b.length - a.length);

  const stripKnownAlbumPrefix = (title) => {
    const t = trim(title);
    if (!t) return "";
    for (const albumTitle of prefixCandidates) {
      if (!albumTitle) continue;
      if (t === albumTitle) continue;
      if (!t.startsWith(albumTitle)) continue;
      const rest = t.slice(albumTitle.length);
      if (/^[\s\-_—–:：]+/.test(rest)) return rest.replace(/^[\s\-_—–:：]+/, "").trim();
    }
    return t;
  };

  let sekey = trim(sekeyInput);
  if (sekey) {
    try {
      sekey = decodeURIComponent(sekey);
    } catch {}
  }
  let verifyErrno = null;
  if (!sekey) {
    const verifyUrl = `https://pan.baidu.com/share/verify?surl=${encodeURIComponent(surl)}&t=${Date.now()}&channel=chunlei&web=1&app_id=250528&bdstoken=&logid=&clienttype=0`;
    const verifyBody = new URLSearchParams({ pwd, vcode: "", vcode_str: "" }).toString();
    const verify = await fetchJson(
      verifyUrl,
      jar,
      {
        method: "POST",
        headers: {
          referer: sharePageUrl,
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: verifyBody
      },
      { retries: 1 }
    );
    verifyErrno = Number(verify?.errno);
    if (verifyErrno === 0) {
      const randsk = trim(verify?.randsk || jar.get("BDCLND"));
      if (!randsk) throw new Error("Missing randsk/BDCLND after share/verify");
      sekey = decodeURIComponent(randsk);
    } else {
      throw new Error(`Share verify failed (errno=${verify?.errno}): ${verify?.show_msg || verify?.err_msg || ""}`.trim());
    }
  }
  if (!sekey) throw new Error("Missing sekey (decoded BDCLND/randsk)");

  const allTextFiles = [];
  const allCandidateLyricDocs = [];
  const allMappingDocs = [];
  const allDistrokidTracksCsv = [];
  const dirQueue = [];

  const root = await fetchJson(
    `https://pan.baidu.com/share/list?is_from_web=1&sekey=${encodeURIComponent(sekey)}&uk=${encodeURIComponent(
      shareUk
    )}&shareid=${encodeURIComponent(shareId)}&order=name&desc=0&showempty=0&web=1&page=1&num=1000&root=1`,
    jar
  );
  if (Number(root?.errno) !== 0) {
    throw new Error(`share/list root failed (errno=${root?.errno}): ${root?.show_msg || ""}`.trim());
  }
  for (const it of ensureArray(root?.list)) {
    if (Number(it?.isdir) === 1 && trim(it?.path)) dirQueue.push(trim(it.path));
    if (Number(it?.isdir) === 0) {
      const filename = trim(it?.server_filename);
      if (isDistrokidTracksCsv(filename)) allDistrokidTracksCsv.push(it);
      if (isMappingDocFilename(filename)) {
        allMappingDocs.push(it);
        continue;
      }
      const ext = extLower(filename);
      if (ext === ".txt") allTextFiles.push(it);
      if (LYRIC_DOC_EXTS.has(ext)) allCandidateLyricDocs.push(it);
    }
  }

  while (dirQueue.length) {
    const dir = dirQueue.pop();
    const listing = await fetchJson(
      `https://pan.baidu.com/share/list?is_from_web=1&sekey=${encodeURIComponent(sekey)}&uk=${encodeURIComponent(
        shareUk
      )}&shareid=${encodeURIComponent(shareId)}&order=name&desc=0&showempty=0&web=1&page=1&num=1000&dir=${encodeURIComponent(dir)}`,
      jar
    );
    if (Number(listing?.errno) !== 0) {
      console.warn(`[warn] share/list failed for dir=${dir}: errno=${listing?.errno} ${listing?.show_msg || ""}`.trim());
      continue;
    }
    for (const it of ensureArray(listing?.list)) {
      if (Number(it?.isdir) === 1 && trim(it?.path)) dirQueue.push(trim(it.path));
      if (Number(it?.isdir) === 0) {
        const filename = trim(it?.server_filename);
        if (isDistrokidTracksCsv(filename)) allDistrokidTracksCsv.push(it);
        if (isMappingDocFilename(filename)) {
          allMappingDocs.push(it);
          continue;
        }
        const ext = extLower(filename);
        if (ext === ".txt") allTextFiles.push(it);
        if (LYRIC_DOC_EXTS.has(ext)) allCandidateLyricDocs.push(it);
      }
    }
  }

  const isrcRows = new Map(); // ISRC -> [{...row, __source}]
  let fetchedCsv = 0;
  let parsedCsvRows = 0;

  const limit = createLimiter(concurrency);

  let mappingDocsFetched = 0;
  let titleAliasesAuto = 0;

  await Promise.all(
    allMappingDocs.map((file) =>
      limit(async () => {
        const fsId = trim(file?.fs_id);
        const filename = trim(file?.server_filename);
        if (!fsId || !filename) return;

        const metaUrl = `https://pan.baidu.com/share/list?is_from_web=1&sekey=${encodeURIComponent(sekey)}&uk=${encodeURIComponent(
          shareUk
        )}&shareid=${encodeURIComponent(shareId)}&web=1&newdocpreview=1&fid=${encodeURIComponent(fsId)}`;

        let meta;
        try {
          meta = await fetchJson(metaUrl, jar);
        } catch (e) {
          console.warn(`[warn] mapping preview meta failed for ${filename}: ${e?.message || e}`);
          return;
        }
        if (Number(meta?.errno) !== 0) {
          console.warn(`[warn] mapping preview meta errno=${meta?.errno} for ${filename}: ${meta?.show_msg || ""}`.trim());
          return;
        }

        const item = ensureArray(meta?.list)[0] || {};
        const picdocpreview = trim(item?.picdocpreview);
        if (!picdocpreview) return;

        let text = "";
        try {
          text = await fetchText(coerceDocviewUrlToText(picdocpreview), null, { method: "GET" });
        } catch (e) {
          console.warn(`[warn] mapping preview fetch failed for ${filename}: ${e?.message || e}`);
          return;
        }

        text = stripBom(text).trim();
        if (!text) return;

        mappingDocsFetched += 1;

        const lower = filename.toLowerCase();
        if (lower.endsWith(".md")) {
          titleAliasesAuto += ingestTitleAliasesFromMarkdown(text, aliasMap);
          return;
        }
        if (lower.endsWith(".tsv")) {
          const rows = parseTsv(text);
          titleAliasesAuto += ingestTitleAliasesFromRows(rows, aliasMap);
          return;
        }
        if (lower.endsWith(".csv")) {
          const rows = parseCsv(text);
          titleAliasesAuto += ingestTitleAliasesFromRows(rows, aliasMap);
          return;
        }
        if (lower.endsWith(".json") && isJsonLike(text)) {
          try {
            const json = JSON.parse(text);
            const pairs = Array.isArray(json)
              ? json.map((x) => ({ from: trim(x?.from), to: trim(x?.to) })).filter((x) => x.from && x.to)
              : Object.entries(json).map(([from, to]) => ({ from: trim(from), to: trim(to) })).filter((x) => x.from && x.to);
            for (const p of pairs) if (addAlias(aliasMap, p.from, p.to)) titleAliasesAuto += 1;
          } catch {}
        }
      })
    )
  );

  await Promise.all(
    allDistrokidTracksCsv.map((file) =>
      limit(async () => {
        const fsId = trim(file?.fs_id);
        const filename = trim(file?.server_filename);
        if (!fsId || !filename) return;

        const metaUrl = `https://pan.baidu.com/share/list?is_from_web=1&sekey=${encodeURIComponent(sekey)}&uk=${encodeURIComponent(
          shareUk
        )}&shareid=${encodeURIComponent(shareId)}&web=1&newdocpreview=1&fid=${encodeURIComponent(fsId)}`;

        let meta;
        try {
          meta = await fetchJson(metaUrl, jar);
        } catch (e) {
          console.warn(`[warn] csv preview meta failed for ${filename}: ${e?.message || e}`);
          return;
        }
        if (Number(meta?.errno) !== 0) {
          console.warn(`[warn] csv preview meta errno=${meta?.errno} for ${filename}: ${meta?.show_msg || ""}`.trim());
          return;
        }

        const item = ensureArray(meta?.list)[0] || {};
        const picdocpreview = trim(item?.picdocpreview);
        if (!picdocpreview) return;

        let text = "";
        try {
          text = await fetchText(coerceDocviewUrlToText(picdocpreview), null, { method: "GET" });
        } catch (e) {
          console.warn(`[warn] csv preview fetch failed for ${filename}: ${e?.message || e}`);
          return;
        }

        fetchedCsv += 1;
        const rows = parseCsv(text);
        parsedCsvRows += rows.length;

        const source = trim(file?.path) || filename;
        for (const row of rows) {
          const isrc = trim(getAnyRowValue(row, ["isrc", "ISRC", "ISRC Code", "ISRCCode", "isrc_code"])).toUpperCase();
          if (!isrc) continue;
          if (!isrcRows.has(isrc)) isrcRows.set(isrc, []);
          isrcRows.get(isrc).push({ ...row, __source: source });
        }
      })
    )
  );

  const lyricsByKey = new Map(); // normalized title -> {text, sources:[...]}
  const byKeySources = new Map(); // normalized title -> Set(sources)

  let fetched = 0;
  let skipped = 0;

  await Promise.all(
    allCandidateLyricDocs.map((file) =>
      limit(async () => {
        const fsId = trim(file?.fs_id);
        const filename = trim(file?.server_filename);
        if (!fsId || !filename) {
          skipped += 1;
          return;
        }

        const baseTitle = stripLyricTitleSuffix(path.basename(filename, path.extname(filename)));
        const key = canonicalizeKey(normalizeTitle(stripKnownAlbumPrefix(baseTitle)), aliasMap);
        if (!key) {
          skipped += 1;
          return;
        }

        const metaUrl = `https://pan.baidu.com/share/list?is_from_web=1&sekey=${encodeURIComponent(sekey)}&uk=${encodeURIComponent(
          shareUk
        )}&shareid=${encodeURIComponent(shareId)}&web=1&newdocpreview=1&fid=${encodeURIComponent(fsId)}`;

        let meta;
        try {
          meta = await fetchJson(metaUrl, jar);
        } catch (e) {
          console.warn(`[warn] preview meta failed for ${filename}: ${e?.message || e}`);
          skipped += 1;
          return;
        }
        if (Number(meta?.errno) !== 0) {
          console.warn(`[warn] preview meta errno=${meta?.errno} for ${filename}: ${meta?.show_msg || ""}`.trim());
          skipped += 1;
          return;
        }

        const item = ensureArray(meta?.list)[0] || {};
        const picdocpreview = trim(item?.picdocpreview);
        if (!picdocpreview) {
          skipped += 1;
          return;
        }

        let text = "";
        try {
          text = await fetchText(coerceDocviewUrlToText(picdocpreview), null, { method: "GET" });
        } catch (e) {
          console.warn(`[warn] preview fetch failed for ${filename}: ${e?.message || e}`);
          skipped += 1;
          return;
        }

        text = stripBom(text).trim();
        if (isLyricsNoise(text)) {
          skipped += 1;
          return;
        }

        fetched += 1;
        const source = trim(file?.path) || filename;
        const prev = lyricsByKey.get(key);
        if (!byKeySources.has(key)) byKeySources.set(key, new Set());
        byKeySources.get(key).add(source);
        if (!prev || text.length > prev.text.length) lyricsByKey.set(key, { text, sources: [] });
      })
    )
  );

  // finalize sources into the stored object (optional, for debugging)
  for (const [key, set] of byKeySources.entries()) {
    const obj = lyricsByKey.get(key);
    if (obj) obj.sources = Array.from(set);
  }

  let updated = 0;
  let updatedByIsrc = 0;
  let candidates = 0;
  for (const it of items) {
    if (trim(it?.type) !== "song") continue;
    const title = trim(it?.title);
    if (!title) continue;
    const missing = trim(it?.lyrics) === "";
    if (!overwrite && !missing) continue;
    candidates += 1;
    const key = canonicalizeKey(normalizeTitle(title), aliasMap);
    const lyr = lyricsByKey.get(key);
    if (lyr?.text) {
      it.lyrics = lyr.text;
      updated += 1;
      continue;
    }

    const isrc = trim(it?.isrc).toUpperCase();
    if (!isrc) continue;
    const rows = ensureArray(isrcRows.get(isrc));
    if (!rows.length) continue;

    let picked = null;
    for (const row of rows) {
      const fileStem = trim(getAnyRowValue(row, ["file_stem", "fileStem", "file stem", "File stem", "File Stem"]));
      const fileName = trim(getAnyRowValue(row, ["file_name", "fileName", "file name", "File name", "File Name", "filename", "Filename"]));
      const rowTitle = trim(getAnyRowValue(row, ["title", "Title", "track title", "Track Title", "Track title", "track"]));
      const candidatesKeys = [
        canonicalizeKey(normalizeTitle(stripLyricTitleSuffix(fileStem)), aliasMap),
        canonicalizeKey(normalizeTitle(stripLyricTitleSuffix(path.basename(fileName, path.extname(fileName)))), aliasMap),
        canonicalizeKey(normalizeTitle(stripLyricTitleSuffix(rowTitle)), aliasMap)
      ].filter(Boolean);

      for (const k of candidatesKeys) {
        const hit = lyricsByKey.get(k);
        if (!hit?.text) continue;
        picked = hit;
        break;
      }
      if (picked) break;
    }
    if (!picked?.text) continue;
    it.lyrics = picked.text;
    updated += 1;
    updatedByIsrc += 1;
  }

  const summary = {
    shareKey: shortUrl,
    shareId,
    shareUk,
    verifyErrno,
    stripPrefixes: extraPrefixes,
    titleAliases: aliasMap.size,
    titleAliasesAuto,
    mappingDocs: allMappingDocs.length,
    mappingDocsFetched,
    scannedDistrokidTracksCsv: allDistrokidTracksCsv.length,
    fetchedDistrokidTracksCsv: fetchedCsv,
    parsedDistrokidTracksCsvRows: parsedCsvRows,
    mappedIsrcCount: isrcRows.size,
    scannedTxtFiles: allTextFiles.length,
    scannedCandidateLyricDocs: allCandidateLyricDocs.length,
    fetchedTxtLyrics: fetched,
    skippedTxtFiles: skipped,
    catalogSongs: items.filter((it) => trim(it?.type) === "song").length,
    catalogSongsConsidered: candidates,
    catalogSongsUpdated: updated,
    catalogSongsUpdatedByIsrc: updatedByIsrc,
    dryRun: !apply,
    overwrite
  };

  if (apply && updated > 0) {
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  }

  if (dumpFilesPath) {
    const out = {
      generatedAt: new Date().toISOString(),
      shareKey: shortUrl,
      shareId,
      shareUk,
      files: allCandidateLyricDocs
        .map((f) => {
          const filename = trim(f?.server_filename);
          const baseTitle = stripLyricTitleSuffix(path.basename(filename, path.extname(filename)));
          const key = canonicalizeKey(normalizeTitle(stripKnownAlbumPrefix(baseTitle)), aliasMap);
          return {
            filename,
            path: trim(f?.path) || filename,
            key,
            ext: extLower(filename),
            size: Number.isFinite(Number(f?.size)) ? Number(f.size) : undefined,
            fs_id: trim(f?.fs_id) || undefined
          };
        })
        .filter((f) => f.filename)
    };
    await fs.writeFile(dumpFilesPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    summary.dumpFilesOut = path.relative(process.cwd(), path.resolve(dumpFilesPath)) || dumpFilesPath;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
