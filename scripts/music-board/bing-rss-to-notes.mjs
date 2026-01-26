#!/usr/bin/env node
/**
 * Fetch Bing RSS search results and convert them into `notes[]` items for the music board.
 *
 * Usage:
 *   node scripts/music-board/bing-rss-to-notes.mjs "distrokid update"
 *   node scripts/music-board/bing-rss-to-notes.mjs "distrokid" --limit 10
 *
 * Output:
 *   JSON array: [{ date, title, body, tags, links }, ...]
 *
 * Notes:
 * - Bing RSS results are noisy; treat them as a starting point, not “official updates”.
 * - This tool is meant for personal/non-commercial use in your own board.
 */

function escapeXml(text) {
  return (text ?? "")
    .toString()
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function stripTags(html) {
  return escapeXml((html ?? "").toString().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseCnPubDateToISO(pubDate) {
  const s = (pubDate ?? "").toString();
  const m = s.match(/(\d{1,2})\s+(\d{1,2})月\s+(\d{4})/);
  if (!m) return "";
  const day = String(m[1]).padStart(2, "0");
  const month = String(m[2]).padStart(2, "0");
  const year = String(m[3]);
  return `${year}-${month}-${day}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/music-board/bing-rss-to-notes.mjs "query" [--limit N]');
    process.exit(1);
  }

  const queryParts = [];
  let limit = 12;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      const n = Number(args[i + 1] || "");
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
      i += 1;
      continue;
    }
    queryParts.push(args[i]);
  }
  const query = queryParts.join(" ").trim();
  if (!query) {
    console.error("Empty query.");
    process.exit(1);
  }

  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
  const res = await fetch(url, {
    headers: { "user-agent": "music-board/1.0 (bing-rss-to-notes)" }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching RSS: ${url}`);
  }
  const xml = await res.text();

  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
      const mm = block.match(r);
      return mm ? mm[1].trim() : "";
    };
    const title = stripTags(pick("title"));
    const link = stripTags(pick("link"));
    const description = stripTags(pick("description"));
    const pubDateRaw = stripTags(pick("pubDate"));
    const date = parseCnPubDateToISO(pubDateRaw) || new Date().toISOString().slice(0, 10);

    if (!title || !link) continue;

    items.push({
      date,
      title,
      body: [description, pubDateRaw ? `Bing pubDate: ${pubDateRaw}` : ""].filter(Boolean).join("\n"),
      tags: ["news", "bing", "distro"],
      links: [{ label: "source", url: link }]
    });
    if (items.length >= limit) break;
  }

  process.stdout.write(JSON.stringify(items, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

