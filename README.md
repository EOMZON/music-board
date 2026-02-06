# Music Board（合集 + 站内播放）

这是一个纯静态的个人音乐主页：

- 首页展示“合集（专辑/歌单）”
- 点击合集可查看曲目列表
- 选择曲目后在页面底部用外链播放器播放（尽量不跳转）
- 各平台入口仅用图标呈现（默认不跳转；点击图标用于站内筛选/切换平台视角）
- `Notes` 页可用于维护 DistroKid 变更/发布记录（本地维护，避免依赖抓取）

## 结构

- `index.html`：主页
- `app.js`：页面逻辑（从 HTML 中拆出来，便于维护）
- `catalog.json`：数据（你主要维护这个）
- `scripts/music-board/*`：离线导入/同步脚本（可选）
- `SOP/*`：同步/维护流程（可选）
- `tools/*`：辅助工具（可选）

## 本地预览

直接双击打开 `index.html` 可能会因为浏览器安全策略导致 `fetch` 失败；建议用一个本地静态服务器：

```bash
python3 -m http.server 8000
```

然后打开：`http://localhost:8000/`

## 从网易云“另存为 HTML”批量导入（可选）

如果你把网易云专辑页“另存为网页（HTML）”，可以用脚本离线解析出专辑 + 曲目链接：

```bash
node scripts/music-board/import-netease-album-html.mjs 春节/发布情况/网易云.html > out.json
```

输出的 `out.json` 里会包含可直接拷进 `catalog.json` 的 `items`（含歌曲 id、专辑 id、以及外链播放器 URL）。

也可以直接把 HTML 合并写回 `catalog.json`：

```bash
node scripts/music-board/import-netease-album-html-to-catalog.mjs 春节/发布情况/网易云.html catalog.json
```

## 从链接列表生成 items（网易云 / YouTube）

复制粘贴 URL 列表到文本文件（每行 1 个 URL），即可生成可粘贴进 `catalog.json` 的 `items`：

```bash
cat links.txt | node scripts/music-board/urls-to-items.mjs > items.json
```

说明：
- YouTube 的 `watch?v=...` / `playlist?list=...` 会生成可播放的 `embeds`
- YouTube 的 `channel/UC...` 会生成该频道的 Uploads（上传）播放列表条目（可在站内播放），但不会自动拆出每首歌

## 从 YouTube 播放列表“另存为 HTML”导入（专辑 + 曲目）

如果你希望“每个专辑（合集）→ 每首曲目都对应到具体的 YouTube 歌曲/视频”，推荐做法是：

1) 在 YouTube 创建/整理一个播放列表（playlist）作为“专辑”（每首歌一个视频，顺序就是曲序）
2) 打开该播放列表页面，浏览器「另存为网页（HTML）」保存快照
3) 用脚本离线解析出 `album + tracks`：

```bash
node scripts/music-board/import-youtube-playlist-html.mjs path/to/playlist.html > out.json
```

然后把 `out.json` 里对应的 `items[]` 复制进 `catalog.json` 的 `items[]` 即可（可手动补全 `releaseDate/cover/title/artist`）。

## 从 YouTube 播放列表在线导入（r.jina.ai，免另存为）

某些环境无法直连 `youtube.com`，但可以访问 `r.jina.ai`（文本代理）。此时可直接在线拉取公开 playlist 的曲目列表：

```bash
node scripts/music-board/import-youtube-playlist-jina.mjs 'https://www.youtube.com/playlist?list=OLAK5uy_...' > yt.json
```

说明：该方式依赖第三方代理服务；如不希望经过第三方，请用“另存为 HTML”或浏览器插件导出。

## 把 YouTube “专辑播放”绑定到已存在的专辑（逐曲对应）

如果你的站点里已经有一张专辑（例如网易云导入的 `netease-album-...`），只缺 YouTube 播放渠道：

1) 先把 YouTube 播放列表导出为 items（任选其一）：

```bash
# A) 另存为 HTML → 导入
node scripts/music-board/import-youtube-playlist-html.mjs path/to/playlist.html > yt.json

# B) 在线导入（r.jina.ai）
node scripts/music-board/import-youtube-playlist-jina.mjs 'https://www.youtube.com/playlist?list=OLAK5uy_...' > yt.json

# C) 用 Tampermonkey 插件导出（见下方 “YouTube 导出插件”）
```

2) 把该 YouTube 播放列表的“专辑 + 每首曲目”贴到已有专辑的曲目上（会给每首歌追加 youtube links/embeds）：

```bash
# dry run（先看匹配情况）
node scripts/music-board/attach-youtube-playlist-to-collection.mjs yt.json catalog.json \
  --collection-id netease-album-359139954

# 写入
node scripts/music-board/attach-youtube-playlist-to-collection.mjs yt.json catalog.json \
  --collection-id netease-album-359139954 --apply
```

如果 `yt.json` 里有多个 playlist，额外加 `--playlist-id OLAK5uy_...` 指定。
如遇到标题不完全一致（例如带 `(Official Audio)`），脚本默认会做“安全的包含匹配”；如需关闭可加 `--no-fuzzy`。

## 从 YouTube 频道链接自动拉“上传列表”（可选）

如果你只提供频道链接（`channel/UC...`），不使用 API key 的情况下，能稳定自动拉取的是「Uploads（上传）」列表（通常只包含最新一批视频）。

```bash
node scripts/music-board/import-youtube-channel-rss.mjs https://www.youtube.com/channel/UCzJDxfLe42TOFdYGSrG-cyw --limit 15 > out.json
```

这会生成 1 个合集（Uploads）+ 多个曲目（每个视频 1 首，带可播放的 embed）。

## YouTube 导出“插件”（Tampermonkey，可选）

如果你希望“直接根据链接拉取更多视频/播放列表曲目”，而不想保存 HTML 快照或配置 API key，可以用一个浏览器 Userscript：

- 文件：`tools/youtube-music-board-export.user.js`
- 安装：Chrome/Edge 安装 Tampermonkey → 新建脚本 → 粘贴该文件内容 → 保存启用
- 用法：打开 YouTube 的 playlist 页面或 channel 页面，右下角会出现 `Export → Music Board`，点击后会下载一个 JSON
- 合并进站点：用 `scripts/music-board/merge-items-to-catalog.mjs` 合并到 `catalog.json`

```bash
# dry run（看统计）
node scripts/music-board/merge-items-to-catalog.mjs out.json catalog.json

# 写入 catalog.json
node scripts/music-board/merge-items-to-catalog.mjs out.json catalog.json --apply
```

## 从 DistroKid “另存为 HTML”导入（可选）

你可以用离线解析的方式，把 DistroKid 的发行信息（平台分发 + UPC/ISRC）合并进 `catalog.json`：

```bash
# 1) 先导入 My Music（只会创建/更新 distrokid-album-<albumuuid> 的专辑 stub）
node scripts/music-board/import-distrokid-mymusic-html.mjs "/Users/zon/Desktop/MINE/10_music/album/DONE/已发布的网页/20250124distorikd专辑列表.html" catalog.json

# 2) 再导入单个专辑详情页（补全 releaseDate/UPC/ISRC，并按 UPC > releaseDate+title 合并）
node scripts/music-board/import-distrokid-album-html.mjs "/Users/zon/Desktop/MINE/10_music/album/DONE/已发布的网页/20250125拉丁.html" catalog.json
```

## 给 DistroKid 曲目补上网易云链接（可选）

前提：同一个 `catalog.json` 里同时存在 “DistroKid 导入的专辑/曲目” 和 “网易云同步/导入的专辑/曲目”。

```bash
# 默认 dry run；确认无误后加 --apply 写入
node scripts/music-board/attach-netease-to-distrokid.mjs catalog.json --apply
```

## 同步网易云歌词（优先，可选）

如果 `catalog.json` 里的曲目能解析出网易云 `songId`（例如条目 id 是 `netease-song-<id>`，或 `refs/links/embeds` 里能找到），可以用脚本把歌词拉回写入：

```bash
# 默认 dry run；确认无误后加 --apply 写入
node scripts/music-board/sync-netease-lyrics-api.mjs catalog.json --apply
```

如需强制覆盖已有歌词（以网易云为准）：

```bash
node scripts/music-board/sync-netease-lyrics-api.mjs catalog.json --apply --overwrite
```

## 把本地歌词/风格标签合并进站点（可选）

从你的工作目录（例如 `/Users/zon/Desktop/MINE/10_music/album`）里扫描：

- `*_歌词.txt` / `*.lrc`
- `*_metadata.json`（如有 `inspiration/duration/version/createdAt/lyrics` 会一并写入）
- `tracklist.json`（如有 `mood` 会写入 `mood`，并聚合为专辑 `styleTags`）

```bash
# 默认 dry run；确认无误后加 --apply 写入
node scripts/music-board/import-local-album-metadata.mjs "/Users/zon/Desktop/MINE/10_music/album" catalog.json --apply
```

如果本地目录里当前没有歌词文件，但这是一个 git 仓库，你还可以加 `--git-history` 去历史里捞一捞（兜底）：

```bash
node scripts/music-board/import-local-album-metadata.mjs "/Users/zon/Desktop/MINE/10_music/album" catalog.json --apply --git-history
```

如果你之前把缺失歌词填成了占位（例如 `纯音乐（无歌词）`），后续又找到了真实歌词，可以用下面的参数只把“占位歌词”当作缺失来覆盖：

```bash
node scripts/music-board/import-local-album-metadata.mjs "/Users/zon/Desktop/MINE/10_music/album" catalog.json --apply --git-history \
  --treat-lyrics-placeholder-as-missing "纯音乐（无歌词）"
```

## 给缺失歌词填占位（可选）

当某些曲目确实是“纯音乐/暂无歌词”，但你又不希望页面显示“暂无歌词”，可以批量把空歌词填成统一占位：

```bash
# 默认 dry run；确认无误后加 --apply 写入
node scripts/music-board/fill-missing-lyrics-placeholder.mjs catalog.json \
  --collection-id <albumId> \
  --placeholder "纯音乐（无歌词）" --apply
```

## 维护数据（catalog.json）

目前页面读取 `items[]`（兼容旧格式），建议：

- 合集：`type: "album" | "collection" | "playlist"`
- 曲目：`type: "song"` 且带 `collectionId` 指向所属合集
- `links[]`：各平台链接（页面只显示图标）
- `embeds[]`：可播放的 iframe URL（用于站内播放）

如果某个平台不支持外链播放器（embed），该曲目就无法“站内播放”（只能显示图标或未来改为自托管音频）。

### Notes（可选）

你可以在 `catalog.json` 根级新增 `notes[]`，用于维护“新闻/更新/发行记录”：

```json
{
  "notes": [
    { "date": "2026-01-20", "title": "DistroKid 更新", "body": "…", "tags": ["distrokid"], "links": [{ "label": "source", "url": "..." }] }
  ]
}
```

也可以用 Bing RSS 做一个“半自动”抓取（噪音较大，仅作线索，非权威更新）：

```bash
node scripts/music-board/bing-rss-to-notes.mjs "distrokid update" --limit 10
```

### 图标是否可点击

默认图标是“只展示不跳转”。如需允许点击图标跳转到平台页：

- 设置 `profile.settings.iconLinks` 为 `true`

### 平台筛选（图标=站内“平台视角”）

页面顶部的“平台图标 dock”默认会打开 `#/p/<platform>`，用来筛选出该平台下可展示/可播放的合集与曲目：

- 再次点击当前已激活的平台图标：清除筛选并回到首页
- 或点击搜索框右侧的 `Platform: ... ×`：清除筛选

### 从一段 store 名单生成平台图标（可选）

如果你能拿到 DistroKid（或其他分发商）的 “stores/platforms” 文本名单（复制粘贴即可），可以转成 `profile.platforms[]`：

```bash
cat stores.txt | node scripts/music-board/stores-to-platforms.mjs
```
