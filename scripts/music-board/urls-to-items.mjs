#!/usr/bin/env node
/**
 * Convert a plain text list of URLs to catalog items.
 *
 * Usage:
 *   cat links.txt | node scripts/music-board/urls-to-items.mjs
 *
 * Output:
 *   JSON array of items you can paste into docs/music-board/catalog.json -> items[]
 */

function parseId(urlString, key) {
  try {
    const url = new URL(urlString.replace("#/", ""));
    const id = url.searchParams.get(key);
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function tryParseUrl(urlString) {
  const raw = (urlString ?? "").toString().trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {}
  try {
    return new URL(raw.replace("#/", ""));
  } catch {}
  return null;
}

function inferNetease(url) {
  const isNetease = /music\.163\.com/.test(url);
  if (!isNetease) return null;

  const songId = url.includes("song") ? parseId(url, "id") : null;
  if (songId) {
    return {
      id: `netease-song-${songId}`,
      type: "song",
      title: "",
      artist: "",
      releaseDate: "",
      tags: ["netease"],
      links: [{ platform: "netease", label: "网易云 · 单曲", url }],
      embeds: [
        {
          platform: "netease",
          label: "网易云外链播放器（如不可用可删）",
          url: `https://music.163.com/outchain/player?type=2&id=${songId}&auto=0&height=66`,
          height: 86
        }
      ]
    };
  }

  const albumId = url.includes("album") ? parseId(url, "id") : null;
  if (albumId) {
    return {
      id: `netease-album-${albumId}`,
      type: "album",
      title: "",
      artist: "",
      releaseDate: "",
      tags: ["netease", "album"],
      links: [{ platform: "netease", label: "网易云 · 专辑", url }],
      embeds: []
    };
  }

  const artistAlbumId = url.includes("artist/album") ? parseId(url, "id") : null;
  if (artistAlbumId) {
    return {
      id: `netease-artist-albums-${artistAlbumId}`,
      type: "collection",
      title: "我的专辑（网易云）",
      artist: "",
      releaseDate: "",
      tags: ["netease", "albums"],
      links: [{ platform: "netease", label: "网易云 · 专辑列表", url }],
      embeds: []
    };
  }

  return {
    id: `netease-link-${Math.random().toString(36).slice(2, 8)}`,
    type: "other",
    title: "",
    artist: "",
    releaseDate: "",
    tags: ["netease"],
    links: [{ platform: "netease", label: "网易云链接", url }],
    embeds: []
  };
}

function isLikelyYoutubeId(id) {
  const raw = (id ?? "").toString().trim();
  return /^[a-zA-Z0-9_-]{6,}$/.test(raw);
}

function inferYoutube(urlString) {
  const url = tryParseUrl(urlString);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const isYoutube = host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com";
  if (!isYoutube) return null;

  const label = host === "music.youtube.com" ? "YouTube Music" : "YouTube";

  const listId = url.searchParams.get("list");

  let videoId = "";
  if (host === "youtu.be") {
    videoId = url.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v") || "";
  } else if (url.pathname.startsWith("/shorts/")) {
    videoId = url.pathname.split("/")[2] || "";
  } else if (url.pathname.startsWith("/embed/")) {
    videoId = url.pathname.split("/")[2] || "";
  }

  if (videoId && isLikelyYoutubeId(videoId)) {
    return {
      id: `youtube-video-${videoId}`,
      type: "song",
      title: "",
      artist: "",
      releaseDate: "",
      tags: ["youtube"],
      links: [{ platform: "youtube", label, url: urlString }],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube embed",
          url: `https://www.youtube.com/embed/${videoId}`,
          height: 220
        }
      ]
    };
  }

  if (listId && isLikelyYoutubeId(listId)) {
    return {
      id: `youtube-playlist-${listId}`,
      type: "playlist",
      title: "",
      artist: "",
      releaseDate: "",
      tags: ["youtube", "playlist"],
      links: [{ platform: "youtube", label: `${label} · Playlist`, url: urlString }],
      embeds: [
        {
          platform: "youtube",
          label: "YouTube playlist embed",
          url: `https://www.youtube.com/embed/videoseries?list=${listId}`,
          height: 360
        }
      ]
    };
  }

  return {
    id: `youtube-link-${Math.random().toString(36).slice(2, 8)}`,
    type: "other",
    title: "",
    artist: "",
    releaseDate: "",
    tags: ["youtube"],
    links: [{ platform: "youtube", label, url: urlString }],
    embeds: []
  };
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
  const input = (await readStdin()).trim();
  if (!input) {
    console.error("No input. Provide URLs via stdin.");
    process.exit(1);
  }

  const urls = input
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith("#"));

  const items = [];
  for (const u of urls) {
    const item = inferNetease(u) || inferYoutube(u) || {
      id: `link-${Math.random().toString(36).slice(2, 8)}`,
      type: "other",
      title: "",
      artist: "",
      releaseDate: "",
      tags: [],
      links: [{ platform: "", label: "Link", url: u }],
      embeds: []
    };
    items.push(item);
  }

  process.stdout.write(JSON.stringify(items, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
