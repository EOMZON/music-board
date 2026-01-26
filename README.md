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

## 从 DistroKid “另存为 HTML”导入（可选）

你可以用离线解析的方式，把 DistroKid 的发行信息（平台分发 + UPC/ISRC）合并进 `catalog.json`：

```bash
# 1) 先导入 My Music（只会创建/更新 distrokid-album-<albumuuid> 的专辑 stub）
node scripts/music-board/import-distrokid-mymusic-html.mjs "/Users/zon/Desktop/MINE/10_music/album/DONE/已发布的网页/20250124distorikd专辑列表.html" catalog.json

# 2) 再导入单个专辑详情页（补全 releaseDate/UPC/ISRC，并按 UPC > releaseDate+title 合并）
node scripts/music-board/import-distrokid-album-html.mjs "/Users/zon/Desktop/MINE/10_music/album/DONE/已发布的网页/20250125拉丁.html" catalog.json
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
