const CATALOG_URL = "./catalog.json";
let ICONS_CLICKABLE = false;
let ACTIVE_PLATFORM = "";
let EMBED_FALLBACK = true;
let SHOW_EMPTY_LINKS = false;
let collectionLimit = 48;
let trackLimit = 200;

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(text) {
  return (text ?? "").toString().trim().toLowerCase();
}

function uniq(array) {
  return Array.from(new Set(array));
}

function platformLabel(platform) {
  const map = {
    netease: "网易云",
    qq: "QQ 音乐",
    kugou: "酷狗",
    kuwo: "酷我",
    spotify: "Spotify",
    apple: "Apple Music",
    youtube: "YouTube",
    soundcloud: "SoundCloud",
    bandcamp: "Bandcamp",
    bilibili: "B 站",
    tiktok: "TikTok",
    douyin: "抖音",
    amazon: "Amazon Music",
    deezer: "Deezer",
    tidal: "TIDAL",
    pandora: "Pandora",
    qobuz: "Qobuz",
    kkbox: "KKBOX",
    jiosaavn: "JioSaavn",
    anghami: "Anghami",
    boomplay: "Boomplay",
    joox: "JOOX",
    instagram: "Instagram / Facebook"
  };
  return map[platform] || platform || "Link";
}

function tagLabel(tag) {
  const raw = (tag ?? "").toString().trim();
  const key = normalizeText(raw);
  const map = {
    distrokid: "DistroKid",
    netease: "网易云",
    youtube: "YouTube",
    youtubemusic: "YouTube Music",
    apple: "Apple Music"
  };
  return map[key] || raw;
}

function platformKey(platform) {
  return normalizeText(platform).replace(/\s+/g, "");
}

function uniqByPlatform(links) {
  const out = [];
  const seen = new Set();
  for (const l of Array.isArray(links) ? links : []) {
    const k = platformKey(l?.platform || "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

function renderPlatformIcons(links, limit = 8) {
  const uniqLinksAll = uniqByPlatform(links);
  const renderable = SHOW_EMPTY_LINKS
    ? uniqLinksAll
    : uniqLinksAll.filter((l) => ((l?.url ?? "").toString().trim() !== ""));

  const shown = renderable.slice(0, limit);
  const hidden = renderable.slice(limit);
  const icons = shown.map(platformIcon).join("");
  if (hidden.length === 0) return icons;
  const moreTitle = hidden.map(l => platformLabel(l?.platform)).filter(Boolean).join(" · ");
  return icons + `
    <span class="icon static more" title="${escapeHtml(moreTitle || `${hidden.length} more`)}" aria-label="${escapeHtml(`还有 ${hidden.length} 个平台`)}" role="img">
      <span>…</span>
    </span>
  `;
}

function parseHash() {
  const raw = location.hash || "#/";
  const path = raw.replace(/^#/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { route: "home" };
  if (parts[0] === "collections") return { route: "collections" };
  if (parts[0] === "tracks") return { route: "tracks" };
  if (parts[0] === "notes") return { route: "notes" };
  if (parts[0] === "p" && parts[1]) return { route: "platform", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "c" && parts[1]) return { route: "collection", id: parts[1] };
  if (parts[0] === "t" && parts[1]) return { route: "track", id: parts[1] };
  return { route: "home" };
}

function hashNumber(text) {
  const s = (text ?? "").toString();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function coverFallback(item, label) {
  const seed = hashNumber(item?.id || label || Math.random().toString(36));
  const angle = (seed % 180) + 1;
  const stripe = 7 + (seed % 11);
  const letter = (label || item?.title || "Music").toString().trim().slice(0, 1).toUpperCase();
  return `<div class="cover-fallback" style="--angle:${angle}deg;--stripe:${stripe}px"><div class="letter">${escapeHtml(letter)}</div></div>`;
}

function coverHtml(item) {
  if (item?.cover) {
    return `<img loading="lazy" alt="${escapeHtml(item?.title || "")}" src="${escapeHtml(item.cover)}" />`;
  }
  return coverFallback(item, item?.title || item?.artist || "Music");
}

function iconSvg(platform) {
  const p = platformKey(platform);
  if (p === "netease") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 2a7 7 0 0 1 6.32 4H14.7a3.2 3.2 0 0 0-5.4 2.32v.9a2.2 2.2 0 1 0 1.4 0v-.9a1.8 1.8 0 0 1 3.6 0V15h-1.2v-2.1a.7.7 0 0 0-.7-.7H7.68A7 7 0 0 1 12 5Zm-3 14.2a.8.8 0 1 1 .8-.8.8.8 0 0 1-.8.8Zm3 0a7 7 0 0 1-6.32-4H9.3a3.2 3.2 0 0 0 5.4-2.32V12h1.6v.88A4.8 4.8 0 0 1 12 19.2Z"/></svg>';
  }
  if (p === "spotify") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm4.3 13.1a.75.75 0 0 1-1 .25 8.8 8.8 0 0 0-6.2-.9.75.75 0 0 1-.3-1.47 10.3 10.3 0 0 1 7.2 1.05.75.75 0 0 1 .3 1.07Zm.9-2.4a.9.9 0 0 1-1.2.3 10.6 10.6 0 0 0-7.7-1.1.9.9 0 0 1-.4-1.76 12.3 12.3 0 0 1 9 1.3.9.9 0 0 1 .3 1.26Zm.1-2.6a1.05 1.05 0 0 1-1.4.35 12.7 12.7 0 0 0-9.2-1.2 1.05 1.05 0 1 1-.5-2.04 14.8 14.8 0 0 1 10.7 1.4 1.05 1.05 0 0 1 .4 1.49Z"/></svg>';
  }
  if (p === "apple") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 13.3c0-2 1.7-3 1.8-3.1-1-1.4-2.5-1.6-3.1-1.6-1.3-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.9-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.8-.4 7 1.1 9.2.7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.6-.7 3-.7s1.8.7 3.1.7c1.3 0 2.1-1.1 2.8-2.2.8-1.2 1.1-2.4 1.1-2.4-.1 0-2.1-.8-2.1-3.3Zm-2.3-6.1c.6-.8 1.1-2 .9-3.2-1 .1-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.3-.6 3-1.3Z"/></svg>';
  }
  if (p === "youtube") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.9C18.2 5 12 5 12 5s-6.2 0-7.8.3A2.6 2.6 0 0 0 2.4 7.2 26.5 26.5 0 0 0 2.1 12a26.5 26.5 0 0 0 .3 4.8 2.6 2.6 0 0 0 1.8 1.9c1.6.3 7.8.3 7.8.3s6.2 0 7.8-.3a2.6 2.6 0 0 0 1.8-1.9 26.5 26.5 0 0 0 .3-4.8 26.5 26.5 0 0 0-.3-4.8ZM10.2 15.1V8.9l5.4 3.1Z"/></svg>';
  }
  if (p === "soundcloud") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 10.2v7.6h6.2a3.3 3.3 0 0 0 .2-6.6 4.6 4.6 0 0 0-9.1-.7 3 3 0 0 0-1.6.8v6.5h1.5v-6.1a.8.8 0 0 1 .8-.8.8.8 0 0 1 .8.8v6.9h1.2v-8.4a.8.8 0 0 1 1.6 0Z"/></svg>';
  }
  if (p === "bandcamp") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.3 18.7 10.7 5.3h9L13.3 18.7Z"/></svg>';
  }
  if (p === "bilibili") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.2 7.3 4.5l1.1-1.1L10.1 5h3.8l1.7-1.6 1.1 1.1L15 6.2h2.6A3.4 3.4 0 0 1 21 9.6v6.8a3.4 3.4 0 0 1-3.4 3.4H6.4A3.4 3.4 0 0 1 3 16.4V9.6a3.4 3.4 0 0 1 3.4-3.4ZM6.4 8A1.6 1.6 0 0 0 4.8 9.6v6.8A1.6 1.6 0 0 0 6.4 18h11.2a1.6 1.6 0 0 0 1.6-1.6V9.6A1.6 1.6 0 0 0 17.6 8Zm1.9 6.3a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm7.4 0a1 1 0 1 1 1-1 1 1 0 0 1-1 1Z"/></svg>';
  }
  if (p === "douyin" || p === "tiktok") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.6 3h2.2a6.5 6.5 0 0 0 3.7 3.5V9a8.6 8.6 0 0 1-3.7-1.3v6.5a6.7 6.7 0 1 1-6.7-6.7c.5 0 1 .1 1.5.2v2.4a4.1 4.1 0 1 0 3 3.9Z"/></svg>';
  }

  const letter = (platformLabel(platform) || "L").slice(0, 1).toUpperCase();
  return `<span aria-hidden="true">${escapeHtml(letter)}</span>`;
}

function platformIcon(link) {
  const platform = link?.platform || "";
  const url = ICONS_CLICKABLE ? (link?.url || "") : "";
  const label = link?.label || platformLabel(platform);

  if (url) {
    return `
      <a class="icon" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        ${iconSvg(platform)}
      </a>
    `;
  }

  return `
    <span class="icon static" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="img">
      ${iconSvg(platform)}
    </span>
  `;
}

function platformDockIcon(link) {
  const platform = link?.platform || "";
  const label = link?.label || platformLabel(platform);
  const key = platformKey(platform);
  const active = ACTIVE_PLATFORM && platformKey(ACTIVE_PLATFORM) === key;
  return `
    <a class="icon" href="#/p/${encodeURIComponent(platform)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${active ? 'aria-current="true"' : ""}>
      ${iconSvg(platform)}
    </a>
  `;
}

function collectionFromItem(item) {
  return {
    id: item.id || "",
    type: item.type || "collection",
    title: item.title || "(未命名合集)",
    artist: item.artist || "",
    releaseDate: item.releaseDate || "",
    cover: item.cover || "",
    trackCount: Number.isFinite(item.trackCount) ? item.trackCount : undefined,
    links: Array.isArray(item.links) ? item.links : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
    styleTags: Array.isArray(item.styleTags) ? item.styleTags : []
  };
}

function trackFromItem(item) {
  return {
    id: item.id || "",
    type: "song",
    title: item.title || "(未命名)",
    artist: item.artist || "",
    releaseDate: item.releaseDate || "",
    cover: item.cover || "",
    collectionId: item.collectionId || "",
    links: Array.isArray(item.links) ? item.links : [],
    embeds: Array.isArray(item.embeds) ? item.embeds : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
    lyrics: item.lyrics || "",
    mood: item.mood || "",
    styleTags: Array.isArray(item.styleTags) ? item.styleTags : [],
    inspiration: item.inspiration && typeof item.inspiration === "object" ? item.inspiration : null,
    duration: item.duration || "",
    version: item.version || "",
    createdAt: item.createdAt || ""
  };
}

function detectSchema(catalog) {
  if (Array.isArray(catalog?.collections) || Array.isArray(catalog?.tracks)) return "v2";
  if (Array.isArray(catalog?.items)) return "items";
  return "empty";
}

function getData(catalog) {
  const schema = detectSchema(catalog);
  if (schema === "v2") {
    const collections = (catalog.collections || []).map(collectionFromItem);
    const tracks = (catalog.tracks || []).map(trackFromItem);
    return { collections, tracks };
  }
  if (schema === "items") {
    const items = catalog.items || [];
    const collections = items
      .filter(i => ["album", "collection", "playlist"].includes(i.type))
      .map(collectionFromItem);
    const tracks = items
      .filter(i => i.type === "song")
      .map(trackFromItem);
    return { collections, tracks };
  }
  return { collections: [], tracks: [] };
}

function groupTracksByCollectionId(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const key = t.collectionId || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  for (const [k, list] of map.entries()) {
    list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-CN"));
    map.set(k, list);
  }
  return map;
}

function chipDefs(collections) {
  const base = [
    { key: "all", label: "All" },
    { key: "collections", label: "Collections" },
    { key: "tracks", label: "Tracks" }
  ];
  const tags = uniq(collections.flatMap(c => (c.tags || [])).filter(Boolean))
    .filter(t => t.length <= 18)
    .slice(0, 10)
    .map(t => ({ key: `tag:${t}`, label: tagLabel(t) }));
  return base.concat(tags);
}

function setNav(route) {
  const map = {
    home: "nav-home",
    collections: "nav-collections",
    tracks: "nav-tracks",
    notes: "nav-notes",
    collection: "nav-collections",
    track: "nav-tracks",
    platform: "nav-collections"
  };
  const currentId = map[route] || "nav-home";
  document.querySelectorAll(".nav a").forEach(a => a.removeAttribute("aria-current"));
  const el = document.getElementById(currentId);
  if (el) el.setAttribute("aria-current", "page");
}

function renderChips(defs, activeKey) {
  const chips = document.getElementById("chips");
  chips.innerHTML = defs.map(d => `
    <button class="chip" type="button" data-key="${escapeHtml(d.key)}"${d.key.startsWith("tag:") ? ' data-kind="tag"' : ""} aria-pressed="${d.key === activeKey ? "true" : "false"}">${escapeHtml(d.label)}</button>
  `).join("");
}

const player = {
  trackId: "",
  open: false,
  embedUrl: ""
};

function setPlayerOpen(open) {
  player.open = !!open;
  const frame = document.getElementById("player-frame");
  const btn = document.getElementById("btn-toggle");
  frame.dataset.open = open ? "true" : "false";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.textContent = open ? "Close" : "Open";
}

function clearPlayer() {
  player.trackId = "";
  player.embedUrl = "";
  document.getElementById("player-title").textContent = "选择一首歌";
  document.getElementById("player-sub").textContent = "点开合集 → 选曲 → 在此处播放（不跳转）";
  document.getElementById("player-icons").innerHTML = "";
  document.getElementById("player-iframe").src = "about:blank";
  document.getElementById("player-note").textContent = "";
  setPlayerOpen(false);
}

function itemHasPlatform(item, platform) {
  if (!platform) return true;
  const key = platformKey(platform);
  const links = Array.isArray(item?.links) ? item.links : [];
  const embeds = Array.isArray(item?.embeds) ? item.embeds : [];
  return links.some(l => platformKey(l?.platform) === key) || embeds.some(e => platformKey(e?.platform) === key);
}

function collectionHasPlatform(collection, tracksByCollectionId, platform) {
  if (!platform) return true;
  if (itemHasPlatform(collection, platform)) return true;
  const tracks = tracksByCollectionId.get(collection?.id || "") || [];
  return tracks.some(t => itemHasPlatform(t, platform));
}

function pickEmbed(track) {
  const embeds = Array.isArray(track.embeds) ? track.embeds : [];
  if (!ACTIVE_PLATFORM) return embeds.find(x => x?.url) || null;
  const key = platformKey(ACTIVE_PLATFORM);
  const preferred = embeds.find(x => x?.url && platformKey(x?.platform) === key) || null;
  if (preferred) return preferred;
  return EMBED_FALLBACK ? (embeds.find(x => x?.url) || null) : null;
}

function playTrack(track) {
  const embed = pickEmbed(track);
  const iframe = document.getElementById("player-iframe");
  const icons = document.getElementById("player-icons");
  const title = track.title || "(未命名)";
  const sub = [track.artist || "", track.releaseDate || ""].filter(Boolean).join(" · ");

  document.getElementById("player-title").textContent = title;
  document.getElementById("player-sub").textContent = sub || " ";

  icons.innerHTML = renderPlatformIcons(track.links || [], 10);

  if (embed?.url) {
    player.trackId = track.id || "";
    player.embedUrl = embed.url;
    iframe.src = embed.url;
    iframe.style.height = embed.height ? `${embed.height}px` : "96px";
    const embedPlatform = embed.platform ? platformLabel(embed.platform) : "";
    const noteBits = [];
    if (ACTIVE_PLATFORM && embedPlatform && platformKey(embed.platform) !== platformKey(ACTIVE_PLATFORM)) {
      noteBits.push(`当前筛选：${platformLabel(ACTIVE_PLATFORM)}（此曲用 ${embedPlatform} 播放）`);
    }
    if (embed.label) noteBits.push(`使用：${embed.label}`);
    document.getElementById("player-note").textContent = noteBits.join(" · ");
    setPlayerOpen(true);
  } else {
    iframe.src = "about:blank";
    document.getElementById("player-note").textContent = ACTIVE_PLATFORM
      ? `此曲在当前平台（${platformLabel(ACTIVE_PLATFORM)}）没有可用的外链播放器（embeds）。`
      : "此曲目没有可用的外链播放器（embeds）。你可以只保留平台图标，或后续改为自托管音频。";
    setPlayerOpen(true);
  }
}

function matchQueryCollection(c, q) {
  if (!q) return true;
  const hay = [
    c.title, c.artist, c.releaseDate,
    Array.isArray(c.styleTags) ? c.styleTags.join(" ") : "",
    (c.tags || []).join(" "),
    (c.links || []).map(l => `${platformLabel(l.platform)} ${l.url}`).join(" ")
  ].join(" ");
  return normalizeText(hay).includes(q);
}

function matchQueryTrack(t, q) {
  if (!q) return true;
  const hay = [
    t.title, t.artist, t.releaseDate,
    t.mood || "",
    Array.isArray(t.styleTags) ? t.styleTags.join(" ") : "",
    t.inspiration && typeof t.inspiration === "object" ? Object.entries(t.inspiration).map(([k, v]) => `${k} ${v}`).join(" ") : "",
    (t.tags || []).join(" "),
    (t.links || []).map(l => `${platformLabel(l.platform)} ${l.url}`).join(" ")
  ].join(" ");
  return normalizeText(hay).includes(q);
}

function renderCollections(collections, tracksByCollectionId, q, tagKey) {
  const filtered = collections
    .filter(c => matchQueryCollection(c, q))
    .filter(c => collectionHasPlatform(c, tracksByCollectionId, ACTIVE_PLATFORM))
    .filter(c => {
      if (!tagKey || tagKey === "all" || !tagKey.startsWith("tag:")) return true;
      const t = tagKey.slice(4);
      return (c.tags || []).includes(t);
    })
    .sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || ""));

  const limited = filtered.slice(0, collectionLimit);
  const tiles = limited.map((c, idx) => {
    const realCount = (tracksByCollectionId.get(c.id) || []).length;
    const count = realCount > 0 ? realCount : (Number.isFinite(c.trackCount) ? c.trackCount : 0);
    const meta = [c.artist || "", c.releaseDate || "", `${count} tracks`].filter(Boolean).join(" · ");
    const icons = renderPlatformIcons(c.links || [], 8);
    return `
      <article class="tile" role="link" tabindex="0" data-open="${escapeHtml(c.id)}" aria-label="打开合集：${escapeHtml(c.title)}">
        <div class="tile-cover">
          <div class="tile-idx">${String(idx + 1).padStart(2, "0")}</div>
          <div class="tile-cover-inner">${coverHtml(c)}</div>
        </div>
        <div class="tile-body">
          <div class="meta">
            <div class="title">${escapeHtml(c.title)}</div>
            <div class="sub">${escapeHtml(meta)}</div>
          </div>
          <div class="dock">${icons}</div>
        </div>
      </article>
    `;
  }).join("");

  return `
    <div class="collection-grid">
      ${tiles || `<div class="empty">没有匹配的合集。</div>`}
      ${filtered.length > collectionLimit ? `<div class="grid-more"><button class="btn" type="button" data-more="collections">Show more (${filtered.length - collectionLimit})</button></div>` : ""}
    </div>
  `;
}

function renderCollectionDetail(collection, tracks, q) {
  const filteredAll = tracks
    .filter(t => matchQueryTrack(t, q))
    .filter(t => itemHasPlatform(t, ACTIVE_PLATFORM));
  const filtered = filteredAll.slice(0, trackLimit);
  const list = filtered.map((t, idx) => {
    const meta = [t.artist || "", t.releaseDate || ""].filter(Boolean).join(" · ");
    const icons = renderPlatformIcons(t.links || [], 6);
    const badges = trackBadgesForList(t, collection, 6);
    const badgesHtml = badges.length ? `<div class="badges inline">${renderBadges(badges, 6)}</div>` : "";
    return `
      <li class="track">
        <div class="idx">${String(idx + 1).padStart(2, "0")}</div>
        <div class="tmeta">
          <div class="title">${escapeHtml(t.title)}</div>
          <div class="sub">${escapeHtml(meta)}</div>
          ${badgesHtml}
        </div>
        <div class="dock">${icons}</div>
        <button class="btn primary" type="button" data-play="${escapeHtml(t.id)}">Play</button>
        <button class="btn" type="button" data-open-track="${escapeHtml(t.id)}">Info</button>
      </li>
    `;
  }).join("");

  return `
    <ul class="list">${list}</ul>
    ${filteredAll.length === 0 ? `<div class="empty">没有匹配的歌曲。</div>` : ""}
    ${filteredAll.length > trackLimit ? `<div class="empty"><button class="btn" type="button" data-more="tracks">Show more (${filteredAll.length - trackLimit})</button></div>` : ""}
  `;
}

function renderTracksFlat(tracks, collectionsById, q) {
  const filteredAll = tracks
    .filter(t => matchQueryTrack(t, q))
    .filter(t => itemHasPlatform(t, ACTIVE_PLATFORM))
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-CN"));

  const filtered = filteredAll.slice(0, trackLimit);
  const list = filtered.map((t, idx) => {
    const col = collectionsById.get(t.collectionId || "");
    const meta = [t.artist || "", col?.title ? `in ${col.title}` : "", t.releaseDate || ""].filter(Boolean).join(" · ");
    const icons = renderPlatformIcons(t.links || [], 6);
    const badges = trackBadgesForList(t, col, 6);
    const badgesHtml = badges.length ? `<div class="badges inline">${renderBadges(badges, 6)}</div>` : "";
    return `
      <li class="track">
        <div class="idx">${String(idx + 1).padStart(2, "0")}</div>
        <div class="tmeta">
          <div class="title">${escapeHtml(t.title)}</div>
          <div class="sub">${escapeHtml(meta)}</div>
          ${badgesHtml}
        </div>
        <div class="dock">${icons}</div>
        <button class="btn primary" type="button" data-play="${escapeHtml(t.id)}">Play</button>
        <button class="btn" type="button" data-open-track="${escapeHtml(t.id)}">Info</button>
      </li>
    `;
  }).join("");

  return `<ul class="list">${list || ""}</ul>${filteredAll.length === 0 ? `<div class="empty">没有匹配的歌曲。</div>` : ""}${filteredAll.length > trackLimit ? `<div class="empty"><button class="btn" type="button" data-more="tracks">Show more (${filteredAll.length - trackLimit})</button></div>` : ""}`;
}

function renderNotes(notes, q) {
  const filteredAll = (notes || [])
    .filter(n => {
      if (!q) return true;
      const hay = [
        n.title || "",
        n.date || "",
        n.body || "",
        Array.isArray(n.tags) ? n.tags.join(" ") : ""
      ].join(" ");
      return normalizeText(hay).includes(q);
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const filtered = filteredAll.slice(0, trackLimit);

  const cards = filtered.map((n) => {
    const meta = [n.date || "", Array.isArray(n.tags) && n.tags.length ? n.tags.join(" · ") : ""].filter(Boolean).join(" · ");
    const body = (n.body || "").toString().split(/\r?\n/g).map(line => escapeHtml(line)).join("<br>");
    const links = Array.isArray(n.links)
      ? n.links.map((l) => `<div class="muted small"><a href="${escapeHtml(l.url || "")}" target="_blank" rel="noreferrer">${escapeHtml(l.label || l.url || "")}</a></div>`).join("")
      : "";
    return `
      <div class="empty" style="border-top:0;">
        <div style="font-weight:650; letter-spacing:.01em;">${escapeHtml(n.title || "(未命名)")}</div>
        <div class="muted small" style="margin-top:4px;">${escapeHtml(meta)}</div>
        ${n.body ? `<div class="muted small" style="margin-top:10px; line-height:1.8;">${body}</div>` : ""}
        ${links ? `<div style="margin-top:10px;">${links}</div>` : ""}
      </div>
    `;
  }).join("");

  return `
    <div style="padding: 16px;">
      ${cards || `<div class="empty">还没有 Notes。你可以在 <code>catalog.json</code> 里新增 <code>notes[]</code>。</div>`}
      ${filteredAll.length > trackLimit ? `<div class="grid-more"><button class="btn" type="button" data-more="tracks">Show more (${filteredAll.length - trackLimit})</button></div>` : ""}
    </div>
  `;
}

function renderBadges(tags, limit = 14) {
  const list = (Array.isArray(tags) ? tags : []).filter(Boolean);
  const shown = list.slice(0, limit);
  const hidden = list.slice(limit);
  const badges = shown.map(t => `<span class="badge">${escapeHtml(tagLabel(t))}</span>`).join("");
  if (hidden.length === 0) return badges;
  return badges + `<span class="badge">+${hidden.length}</span>`;
}

function shortenBadgeValue(value, maxLen = 26) {
  const s = (value ?? "").toString().replace(/\s+/g, " ").trim();
  if (!s) return "";
  const cleaned = s
    .replace(/\*\*/g, "")
    .replace(/__+/g, "")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (/^[\)\]】）]+$/.test(cleaned)) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, Math.max(1, maxLen - 1)).trimEnd() + "…";
}

function inspirationToBadges(inspiration, limit = 8) {
  if (!inspiration || typeof inspiration !== "object") return [];
  const priority = [
    "调性",
    "key",
    "速度",
    "bpm",
    "拍号",
    "meter",
    "节奏",
    "groove",
    "配器",
    "instrument",
    "演唱",
    "vocal"
  ];
  const priorityIndex = new Map(priority.map((k, i) => [normalizeText(k), i]));

  const entries = Object.entries(inspiration)
    .map(([k, v]) => [String(k || "").trim(), String(v == null ? "" : v).trim()])
    .map(([k, v]) => [k, shortenBadgeValue(v)])
    .filter(([k, v]) => k && v)
    .sort(([ka], [kb]) => {
      const pa = priorityIndex.get(normalizeText(ka)) ?? 999;
      const pb = priorityIndex.get(normalizeText(kb)) ?? 999;
      if (pa !== pb) return pa - pb;
      return ka.localeCompare(kb, "zh");
    })
    .map(([k, v]) => `${k}:${v}`);

  return entries.slice(0, limit);
}

function trackBadgesForList(track, collection, limit = 6) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const raw = (t ?? "").toString().trim();
    if (!raw) return;
    const key = normalizeText(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(raw);
  };

  for (const t of Array.isArray(track?.styleTags) ? track.styleTags : []) push(t);

  const mood = (track?.mood ?? "").toString().trim();
  if (mood) push(`Mood:${mood}`);

  for (const t of inspirationToBadges(track?.inspiration, limit)) push(t);

  const colTitle = (collection?.title ?? "").toString().trim();
  const generic = new Set(["distrokid", "netease", "song", "album", "collection", "playlist"]);
  for (const t of Array.isArray(track?.tags) ? track.tags : []) {
    const raw = (t ?? "").toString().trim();
    if (!raw) continue;
    const k = normalizeText(raw);
    if (generic.has(k)) continue;
    if (colTitle && raw === colTitle) continue;
    push(raw);
  }

  return out.slice(0, limit);
}

function renderKv(entries) {
  const rows = (Array.isArray(entries) ? entries : [])
    .map(([k, v]) => [String(k || "").trim(), v == null ? "" : String(v).trim()])
    .filter(([k, v]) => k && v);
  if (rows.length === 0) return "";
  return `<div class="kv">${rows.map(([k, v]) => `<div>${escapeHtml(k)}</div><div>${escapeHtml(v)}</div>`).join("")}</div>`;
}

function normalizeLyricsForDisplay(raw, titleHint = "") {
  let t = (raw ?? "").toString();
  if (!t) return "";
  t = t.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  // Normalize common "markdown saved from HTML" patterns.
  t = t.replace(/<br\s*\/?>\s*\n/gi, "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");

  const lines = t.split("\n");
  const firstNonEmpty = lines.findIndex((l) => l.trim() !== "");
  if (firstNonEmpty >= 0) {
    const m = lines[firstNonEmpty].match(/^#{1,6}\s+(.+)$/);
    if (m) {
      const head = (m[1] ?? "").toString().trim();
      if (!titleHint || normalizeText(head) === normalizeText(titleHint)) {
        lines.splice(firstNonEmpty, 1);
        while (lines[firstNonEmpty] != null && lines[firstNonEmpty].trim() === "") lines.splice(firstNonEmpty, 1);
        t = lines.join("\n");
      }
    }
  }

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function renderTrackDetail(track, collection) {
  const lyrics = normalizeLyricsForDisplay(track?.lyrics ?? "", track?.title || "");
  const mood = (track?.mood ?? "").toString().trim();
  const styleTags = Array.isArray(track?.styleTags) ? track.styleTags.filter(Boolean) : [];
  const tags = Array.isArray(track?.tags) ? track.tags.filter(Boolean) : [];
  const inspiration = track?.inspiration && typeof track.inspiration === "object" ? track.inspiration : null;
  const inspirationBadges = inspirationToBadges(inspiration, 18);

  const kv = [];
  if (collection?.title) kv.push(["Album", collection.title]);
  if (track?.duration) kv.push(["Duration", track.duration]);
  if (track?.version) kv.push(["Version", track.version]);
  if (track?.createdAt) kv.push(["Created", track.createdAt]);
  if (mood) kv.push(["Mood", mood]);
  if (inspiration) {
    for (const [k, v] of Object.entries(inspiration)) {
      const key = (k ?? "").toString().trim();
      const val = (v ?? "").toString().trim();
      if (key && val) kv.push([`Inspiration · ${key}`, val]);
    }
  }

  const badgeBlocks = [
    styleTags.length ? `<div class="badges" style="margin-top:10px;">${renderBadges(styleTags, 18)}</div>` : "",
    inspirationBadges.length ? `<div class="badges" style="margin-top:10px;">${renderBadges(inspirationBadges, 18)}</div>` : "",
    tags.length ? `<div class="badges" style="margin-top:10px;">${renderBadges(tags, 18)}</div>` : ""
  ].filter(Boolean).join("");

  return `
    <div class="detail">
      <div class="detail-card">
        ${badgeBlocks || ""}
        ${renderKv(kv) || ""}
        ${lyrics ? `<div class="lyrics">${escapeHtml(lyrics)}</div>` : `<div class="empty" style="border-top:0;margin-top:12px;">暂无歌词。</div>`}
      </div>
    </div>
  `;
}

function renderFilters() {
  const filters = document.getElementById("filters");
  if (!filters) return;
  if (!ACTIVE_PLATFORM) {
    filters.innerHTML = "";
    return;
  }
  filters.innerHTML = `
    <button class="chip" type="button" data-clear-platform="true" aria-pressed="true">
      Platform: ${escapeHtml(platformLabel(ACTIVE_PLATFORM))} ×
    </button>
  `;
}

function setHero({ coverItem, title, sub, actionsHtml }) {
  const media = document.getElementById("hero-media");
  media.innerHTML = coverItem
    ? `<div class="hero-cover">${coverHtml(coverItem)}</div>`
    : "";
  document.getElementById("hero-title").textContent = title || "";
  document.getElementById("hero-sub").textContent = sub || "";
  document.getElementById("hero-actions").innerHTML = actionsHtml || "";
}

async function main() {
  const res = await fetch(CATALOG_URL, { cache: "no-store" });
  const catalog = await res.json();
  const profile = catalog?.profile || {};
  ICONS_CLICKABLE = profile?.settings?.iconLinks === true;
  EMBED_FALLBACK = profile?.settings?.embedFallback !== false;
  SHOW_EMPTY_LINKS = profile?.settings?.showEmptyLinks === true;
  const notes = Array.isArray(catalog?.notes) ? catalog.notes : [];

  const profileNameEl = document.getElementById("profile-name");
  if (profileNameEl) profileNameEl.textContent = profile?.name || "Music";
  const profileTaglineEl = document.getElementById("profile-tagline");
  if (profileTaglineEl) profileTaglineEl.textContent = profile?.tagline || "";
  document.title = profile?.name ? `${profile.name} · Music` : "Music";

  const profileIcons = document.getElementById("profile-icons");
  const pLinks = Array.isArray(profile?.platforms) ? profile.platforms : [];
  profileIcons.innerHTML = pLinks.map(platformDockIcon).join("");

  const { collections, tracks } = getData(catalog);
  const collectionsById = new Map(collections.map(c => [c.id, c]));
  const tracksByCollectionId = groupTracksByCollectionId(tracks);
  const tracksById = new Map(tracks.map(t => [t.id, t]));

  const chips = chipDefs(collections);
  let chipKey = "all";
  renderChips(chips, chipKey);

  const qEl = document.getElementById("q");
  const content = document.getElementById("content");
  const heroTitle = document.getElementById("hero-title");
  const heroSub = document.getElementById("hero-sub");

function rerender() {
    const { route, id } = parseHash();
    setNav(route);

    if (route === "platform") {
      ACTIVE_PLATFORM = id || "";
      collectionLimit = 48;
      trackLimit = 200;
    }

    profileIcons.innerHTML = pLinks.map(platformDockIcon).join("");
    renderFilters();

    const q = normalizeText(qEl.value);

    if (route === "collection") {
      const c = collectionsById.get(id);
      if (!c) {
        setHero({ coverItem: null, title: "Not found", sub: "这个合集不存在。", actionsHtml: "" });
        content.innerHTML = `<div class="empty"><a href="#/">返回首页</a></div>`;
        return;
      }
      const list = tracksByCollectionId.get(c.id) || [];
      const tags = Array.isArray(c.tags) ? c.tags.filter(Boolean) : [];
      const styleTags = Array.isArray(c.styleTags) ? c.styleTags.filter(Boolean) : [];
      const actions = [
        `<div class="dock">${renderPlatformIcons(c.links || [], 12)}</div>`,
        styleTags.length ? `<div class="badges" style="margin-top:10px;">${renderBadges(styleTags, 18)}</div>` : "",
        tags.length ? `<div class="badges" style="margin-top:10px;">${renderBadges(tags, 18)}</div>` : ""
      ].filter(Boolean).join("");
      setHero({
        coverItem: c,
        title: c.title || "(未命名合集)",
        sub: [c.artist || "", c.releaseDate || "", `${list.length} tracks`].filter(Boolean).join(" · "),
        actionsHtml: actions
      });
      content.innerHTML = renderCollectionDetail(c, list, q);
      return;
    }

    if (route === "track") {
      const t = tracksById.get(id);
      if (!t) {
        setHero({ coverItem: null, title: "Not found", sub: "这个曲目不存在。", actionsHtml: "" });
        content.innerHTML = `<div class="empty"><a href="#/tracks">返回 Tracks</a></div>`;
        return;
      }
      const col = collectionsById.get(t.collectionId || "");
      const sub = [t.artist || "", col?.title ? `in ${col.title}` : "", t.releaseDate || ""].filter(Boolean).join(" · ");
      const actions = [
        `<div class="dock">${renderPlatformIcons(t.links || [], 12)}</div>`,
        `<button class="btn primary" type="button" data-play="${escapeHtml(t.id)}">Play</button>`,
        col?.id ? `<button class="btn" type="button" data-open="${escapeHtml(col.id)}">Album</button>` : ""
      ].filter(Boolean).join("");
      setHero({ coverItem: t, title: t.title || "(未命名)", sub, actionsHtml: actions });
      content.innerHTML = renderTrackDetail(t, col);
      return;
    }

    if (route === "tracks") {
      setHero({ coverItem: null, title: "Tracks", sub: "按歌名浏览（可直接播放）", actionsHtml: "" });
      content.innerHTML = renderTracksFlat(tracks, collectionsById, q);
      return;
    }

    if (route === "notes") {
      setHero({ coverItem: null, title: "Notes", sub: "更新 / 发行记录 / DistroKid 变更摘要（本地维护）", actionsHtml: "" });
      content.innerHTML = renderNotes(notes, q);
      return;
    }

    if (route === "collections") {
      setHero({ coverItem: null, title: "Collections", sub: "点击一个合集查看曲目并播放（平台只显示图标）", actionsHtml: "" });
      content.innerHTML = renderCollections(collections, tracksByCollectionId, q, chipKey);
      return;
    }

    if (route === "platform") {
      setHero({
        coverItem: null,
        title: platformLabel(ACTIVE_PLATFORM),
        sub: "在当前平台可播放/可展示的合集",
        actionsHtml: `<button class="btn" type="button" data-clear-platform="true">Clear platform</button>`
      });
      content.innerHTML = renderCollections(collections, tracksByCollectionId, q, chipKey);
      return;
    }

    setHero({
      coverItem: null,
      title: profile?.headline || "Latest collections",
      sub: ACTIVE_PLATFORM ? `当前筛选：${platformLabel(ACTIVE_PLATFORM)} · 点击平台图标可切换/清除` : "点击一个合集 → 选曲 → 底部播放器播放（不跳转）",
      actionsHtml: ""
    });
    content.innerHTML = renderCollections(collections, tracksByCollectionId, q, chipKey);
  }

  window.addEventListener("hashchange", rerender);
  qEl.addEventListener("input", rerender);

  document.getElementById("chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    chipKey = btn.dataset.key || "all";
    renderChips(chips, chipKey);
    rerender();
  });

  document.getElementById("content").addEventListener("click", (e) => {
    // Only prevent tile clicks when the icon is an actual link.
    // Static icons are just indicators; clicking them should still open the tile.
    if (e.target.closest("a.icon")) return;

    const more = e.target.closest("[data-more]");
    if (more) {
      const kind = more.getAttribute("data-more");
      if (kind === "collections") collectionLimit += 48;
      if (kind === "tracks") trackLimit += 200;
      rerender();
      return;
    }

    const open = e.target.closest("[data-open]");
    if (open) {
      const id = open.getAttribute("data-open");
      if (id) location.hash = `#/c/${encodeURIComponent(id)}`;
      return;
    }

    const openTrack = e.target.closest("[data-open-track]");
    if (openTrack) {
      const id = openTrack.getAttribute("data-open-track");
      if (id) location.hash = `#/t/${encodeURIComponent(id)}`;
      return;
    }

    const playBtn = e.target.closest("[data-play]");
    if (playBtn) {
      const id = playBtn.getAttribute("data-play");
      const t = tracksById.get(id);
      if (t) playTrack(t);
    }
  });

  document.getElementById("content").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const open = e.target.closest("[data-open]");
    if (!open) return;
    const id = open.getAttribute("data-open");
    if (id) location.hash = `#/c/${encodeURIComponent(id)}`;
  });

  document.getElementById("btn-toggle").addEventListener("click", () => setPlayerOpen(!player.open));
  document.getElementById("btn-close").addEventListener("click", () => clearPlayer());

  document.getElementById("profile-icons").addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#/p/"]');
    if (!a) return;
    const href = a.getAttribute("href") || "";
    const m = href.match(/^#\/p\/(.+)$/);
    if (!m) return;
    const platform = decodeURIComponent(m[1] || "");
    if (!platform) return;
    if (ACTIVE_PLATFORM && platformKey(platform) === platformKey(ACTIVE_PLATFORM)) {
      e.preventDefault();
      ACTIVE_PLATFORM = "";
      collectionLimit = 48;
      trackLimit = 200;
      profileIcons.innerHTML = pLinks.map(platformDockIcon).join("");
      renderFilters();
      location.hash = "#/";
    }
  });

  document.getElementById("filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-clear-platform]");
    if (!btn) return;
    ACTIVE_PLATFORM = "";
    collectionLimit = 48;
    trackLimit = 200;
    profileIcons.innerHTML = pLinks.map(platformDockIcon).join("");
    renderFilters();
    rerender();
  });

  document.getElementById("hero-actions").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-clear-platform]");
    if (!btn) return;
    ACTIVE_PLATFORM = "";
    collectionLimit = 48;
    trackLimit = 200;
    profileIcons.innerHTML = pLinks.map(platformDockIcon).join("");
    renderFilters();
    location.hash = "#/";
  });

  rerender();
}

main().catch((err) => {
  console.error(err);
  document.getElementById("hero-title").textContent = "Load failed";
  document.getElementById("hero-sub").textContent = "请检查 catalog.json 是否存在且为合法 JSON。";
  document.getElementById("content").innerHTML = `<div class="empty">加载失败：${escapeHtml(String(err))}</div>`;
});
