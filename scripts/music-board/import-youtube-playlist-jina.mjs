#!/usr/bin/env node
/**
 * Import a YouTube playlist via r.jina.ai text proxy into catalog items.
 *
 * Why:
 * - Some environments cannot access youtube.com directly.
 * - r.jina.ai can fetch and render the public playlist page as markdown, which includes the track list.
 *
 * Usage:
 *   node scripts/music-board/import-youtube-playlist-jina.mjs <playlistUrlOrId> > out.json
 *
 * Output:
 *   JSON array: [{ source, items: [albumItem, ...songItems] }]
 */

function isLikelyId(text) {
  const raw = (text ?? "").toString().trim();
  return /^[a-zA-Z0-9_-]{6,}$/.test(raw);
}

function extractPlaylistId(input) {
  const raw = (input ?? "").toString().trim();
  if (!raw) return "";
  if (isLikelyId(raw) && !raw.includes("http")) return raw;
  try {
    const u = new URL(raw);
    const list = u.searchParams.get("list");
    return list && isLikelyId(list) ? list : "";
  } catch {
    return "";
  }
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

function uniqBy(arr, keyFn) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const k = keyFn(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function parseMarkdown(markdown) {
  const titleLine = (markdown.match(/^Title:\s*(.+)$/m) || [])[1] || "";
  const title = decodeXml(titleLine);

  // Playlist cover (optional)
  const cover = (markdown.match(/https:\/\/i\d+\.ytimg\.com\/s_p\/([a-zA-Z0-9_-]+)\/[^)\s]+/m) || [])[0] || "";

  // Track list: lines like
  // ### [万家灯火](http://www.youtube.com/watch?v=...&list=...&index=1&pp=... "万家灯火")
  const tracks = [];
  const re = /^###\s+\[([^\]]+)\]\((https?:\/\/(?:www\.)?youtube\.com\/watch\?[^)\s]+)\b/igm;
  let m;
  while ((m = re.exec(markdown))) {
    const trackTitle = decodeXml(m[1] || "");
    const watchUrl = m[2] || "";
    let videoId = "";
    let playlistId = "";
    let index = "";
    try {
      const u = new URL(watchUrl);
      videoId = u.searchParams.get("v") || "";
      playlistId = u.searchParams.get("list") || "";
      index = u.searchParams.get("index") || "";
    } catch {}
    if (!videoId || !isLikelyId(videoId)) continue;
    if (playlistId && !isLikelyId(playlistId)) playlistId = "";
    const trackNo = index && /^\d+$/.test(index) ? Number(index) : undefined;
    tracks.push({ videoId, playlistId, trackNo, title: trackTitle, watchUrl });
  }

  return { title, cover, tracks: uniqBy(tracks, (t) => `${t.videoId}:${t.trackNo || ""}`) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/music-board/import-youtube-playlist-jina.mjs <playlistUrlOrId>");
    process.exit(1);
  }

  const playlistIdInput = extractPlaylistId(args[0]);
  if (!playlistIdInput) {
    console.error("Could not extract playlist id. Provide a URL like https://www.youtube.com/playlist?list=... or the list id.");
    process.exit(1);
  }

  const sourceUrl = `https://www.youtube.com/playlist?list=${playlistIdInput}`;
  const proxyUrl = `https://r.jina.ai/http://www.youtube.com/playlist?list=${encodeURIComponent(playlistIdInput)}`;

  const res = await fetch(proxyUrl, { headers: { "user-agent": "music-board/1.0" } });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const text = await res.text();
  const { title, cover, tracks } = parseMarkdown(text);
  if (tracks.length === 0) {
    console.error("No tracks parsed from proxy output. The playlist page may have changed.");
    process.exit(1);
  }

  const playlistId = tracks.find((t) => t.playlistId)?.playlistId || playlistIdInput;
  const albumId = `youtube-playlist-${playlistId}`;
  const albumItem = {
    id: albumId,
    type: "album",
    title: title || "(未命名 YouTube 专辑)",
    artist: "",
    releaseDate: "",
    cover: cover || "",
    trackCount: tracks.length || undefined,
    tags: ["youtube", "album"].concat(title ? [title] : []),
    links: [{ platform: "youtube", label: "YouTube · Playlist", url: sourceUrl }],
    embeds: [
      {
        platform: "youtube",
        label: "YouTube playlist embed",
        url: `https://www.youtube.com/embed/videoseries?list=${playlistId}`,
        height: 360
      }
    ]
  };

  const songs = tracks.map((t, idx) => {
    const trackNo = Number.isFinite(t.trackNo) ? t.trackNo : idx + 1;
    const videoUrl = t.watchUrl
      ? t.watchUrl.replace(/^http:/i, "https:")
      : `https://www.youtube.com/watch?v=${t.videoId}&list=${playlistId}&index=${trackNo}`;
    return {
      id: `youtube-video-${t.videoId}`,
      type: "song",
      title: t.title || "",
      artist: "",
      releaseDate: "",
      cover: `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`,
      collectionId: albumId,
      trackNo,
      tags: ["youtube", "song"].concat(title ? [title] : []),
      links: [{ platform: "youtube", label: "YouTube · Video", url: videoUrl }],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube embed",
          url: `https://www.youtube.com/embed/${t.videoId}`,
          height: 220
        }
      ]
    };
  });

  process.stdout.write(JSON.stringify([{ source: proxyUrl, items: [albumItem, ...songs] }], null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

