#!/usr/bin/env node
/**
 * Convert a plain text list of store/platform names into `profile.platforms[]`.
 *
 * Usage:
 *   cat stores.txt | node scripts/music-board/stores-to-platforms.mjs
 *   node scripts/music-board/stores-to-platforms.mjs stores.txt
 *
 * Output:
 *   JSON array: [{ platform, label, url: "" }, ...]
 */

import fs from "node:fs/promises";

function normalizeText(text) {
  return (text ?? "").toString().trim();
}

function slugify(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function mapPlatform(name) {
  const s = name.toLowerCase();
  const pick = (platform, label) => ({ platform, label: label || name, url: "" });

  if (/(^|[^a-z])spotify([^a-z]|$)/.test(s)) return pick("spotify", "Spotify");
  if (/(apple music|itunes)/.test(s)) return pick("apple", "Apple Music");
  if (/amazon/.test(s)) return pick("amazon", "Amazon Music");
  if (/youtube/.test(s)) return pick("youtube", "YouTube Music");
  if (/tiktok/.test(s)) return pick("tiktok", "TikTok");
  if (/douyin/.test(s)) return pick("douyin", "抖音");
  if (/(instagram|facebook|meta)/.test(s)) return pick("instagram", "Instagram / Facebook");
  if (/pandora/.test(s)) return pick("pandora", "Pandora");
  if (/deezer/.test(s)) return pick("deezer", "Deezer");
  if (/tidal/.test(s)) return pick("tidal", "TIDAL");
  if (/soundcloud/.test(s)) return pick("soundcloud", "SoundCloud");
  if (/bandcamp/.test(s)) return pick("bandcamp", "Bandcamp");
  if (/bilibili/.test(s)) return pick("bilibili", "B 站");

  if (/(netease|163)/.test(s)) return pick("netease", "网易云");
  if (/(tencent|qq music|qq\b)/.test(s)) return pick("qq", "QQ 音乐");
  if (/kugou/.test(s)) return pick("kugou", "酷狗");
  if (/kuwo/.test(s)) return pick("kuwo", "酷我");

  if (/anghami/.test(s)) return pick("anghami", "Anghami");
  if (/(jiosaavn|saavn)/.test(s)) return pick("jiosaavn", "JioSaavn");
  if (/kkbox/.test(s)) return pick("kkbox", "KKBOX");
  if (/qobuz/.test(s)) return pick("qobuz", "Qobuz");
  if (/napster/.test(s)) return pick("napster", "Napster");
  if (/boomplay/.test(s)) return pick("boomplay", "Boomplay");
  if (/audiomack/.test(s)) return pick("audiomack", "Audiomack");
  if (/audius/.test(s)) return pick("audius", "Audius");

  const slug = slugify(name);
  return pick(slug || "link", name);
}

async function readStdin() {
  return await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const input = args[0] ? await fs.readFile(args[0], "utf8") : await readStdin();
  const rawLines = input.split(/\r?\n/g).map((l) => l.trim());

  const lines = rawLines
    .map((l) => l.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);

  if (lines.length === 0) {
    console.error("No store names found. Paste a list of store/platform names.");
    process.exit(1);
  }

  const out = [];
  const seen = new Set();
  for (const name of lines) {
    const item = mapPlatform(name);
    const key = `${item.platform}::${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

