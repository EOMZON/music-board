#!/usr/bin/env node
/**
 * Import a YouTube channel uploads RSS feed into catalog items.
 *
 * Notes:
 * - No API key needed.
 * - RSS typically returns only the most recent uploads (often ~15).
 * - This produces ONE collection ("Uploads") with song items.
 *
 * Usage:
 *   node scripts/music-board/import-youtube-channel-rss.mjs <channelId|channelUrl> [--limit N] > out.json
 *
 * Example:
 *   node scripts/music-board/import-youtube-channel-rss.mjs UCzJDxfLe42TOFdYGSrG-cyw --limit 15 > out.json
 */

function parseArgs(argv) {
  const args = { input: "", limit: 15 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!args.input && !a.startsWith("--")) {
      args.input = a;
      continue;
    }
    if (a === "--limit") {
      const n = Number(rest[i + 1]);
      if (Number.isFinite(n) && n > 0) args.limit = Math.floor(n);
      i++;
      continue;
    }
  }
  return args;
}

function extractChannelId(input) {
  const raw = (input ?? "").toString().trim();
  if (!raw) return "";
  if (/^UC[a-zA-Z0-9_-]+$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (!/youtube\.com$/i.test(u.hostname.replace(/^www\./i, ""))) return "";
    if (u.pathname.startsWith("/channel/")) {
      const id = u.pathname.split("/")[2] || "";
      if (/^UC[a-zA-Z0-9_-]+$/.test(id)) return id;
    }
  } catch {}
  return "";
}

function uploadsPlaylistIdFromChannelId(channelId) {
  const raw = (channelId ?? "").toString().trim();
  if (!raw.startsWith("UC")) return "";
  return `UU${raw.slice(2)}`;
}

function decodeXml(s) {
  return (s ?? "").toString()
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function pickFirst(re, text) {
  const m = (text ?? "").toString().match(re);
  return m ? m[1] : "";
}

function parseRss(xml) {
  const authorBlock = pickFirst(/<author>([\s\S]*?)<\/author>/i, xml);
  const channelName = decodeXml(pickFirst(/<name>([\s\S]*?)<\/name>/i, authorBlock));
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml))) {
    const entry = m[1] || "";
    const videoId = decodeXml(pickFirst(/<yt:videoId>([^<]+)<\/yt:videoId>/i, entry));
    if (!videoId) continue;
    const title = decodeXml(pickFirst(/<title>([\s\S]*?)<\/title>/i, entry));
    const published = decodeXml(pickFirst(/<published>([^<]+)<\/published>/i, entry));
    const url = decodeXml(pickFirst(/<link[^>]+href="([^"]+)"/i, entry));
    const thumbnail = decodeXml(pickFirst(/<media:thumbnail[^>]+url="([^"]+)"/i, entry));
    entries.push({ videoId, title, published, url, thumbnail });
  }
  return { channelName, entries };
}

function toDateOnly(iso) {
  const raw = (iso ?? "").toString();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

async function main() {
  const { input, limit } = parseArgs(process.argv);
  if (!input) {
    console.error("Usage: node scripts/music-board/import-youtube-channel-rss.mjs <channelId|channelUrl> [--limit N]");
    process.exit(1);
  }

  const channelId = extractChannelId(input);
  if (!channelId) {
    console.error("Unsupported input. Please provide a channel id like UCxxxx or a channel URL like https://www.youtube.com/channel/UCxxxx");
    process.exit(1);
  }

  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const res = await fetch(rssUrl, { headers: { "user-agent": "music-board/1.0" } });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const xml = await res.text();
  const { channelName, entries } = parseRss(xml);
  const sliced = entries.slice(0, limit);

  const uploadsListId = uploadsPlaylistIdFromChannelId(channelId);
  const collectionId = `youtube-channel-uploads-${channelId}`;
  const cover = sliced[0]?.thumbnail || "";

  const collectionItem = {
    id: collectionId,
    type: "collection",
    title: "YouTube Uploads",
    artist: channelName || "",
    releaseDate: "",
    cover,
    trackCount: sliced.length || undefined,
    tags: ["youtube", "channel", "uploads"],
    links: [
      { platform: "youtube", label: "YouTube · Channel", url: `https://www.youtube.com/channel/${channelId}` },
      { platform: "youtube", label: "YouTube · Uploads", url: `https://www.youtube.com/playlist?list=${uploadsListId}` }
    ],
    embeds: [
      {
        platform: "youtube",
        label: "YouTube uploads playlist embed",
        url: `https://www.youtube.com/embed/videoseries?list=${uploadsListId}`,
        height: 360
      }
    ]
  };

  const items = [collectionItem];
  for (const e of sliced) {
    items.push({
      id: `youtube-video-${e.videoId}`,
      type: "song",
      title: e.title || "",
      artist: channelName || "",
      releaseDate: toDateOnly(e.published),
      cover: e.thumbnail || "",
      collectionId,
      tags: ["youtube", "song"],
      links: [{ platform: "youtube", label: "YouTube · Video", url: e.url || `https://www.youtube.com/watch?v=${e.videoId}` }],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube embed",
          url: `https://www.youtube.com/embed/${e.videoId}`,
          height: 220
        }
      ]
    });
  }

  process.stdout.write(JSON.stringify([{ source: rssUrl, items }], null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

