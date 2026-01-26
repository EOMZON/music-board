# SOP：同步网易云专辑与曲目（站内播放）

目标：把网易云艺人页的 **全部专辑 + 全部曲目** 同步到本项目的 `catalog.json`，并保持站内可播放（使用网易云 `outchain` iframe）。

本 SOP 的产物：

- 数据：`album/DONE/music-board/docs/music-board/catalog.json`
- 页面：`album/DONE/music-board/docs/music-board/index.html`
- 同步脚本：`album/DONE/music-board/scripts/music-board/sync-netease-artist-albums-api.mjs`

## 前置条件

- 你能访问 `music.163.com`
- Node.js 可用（`node`）

## 1) 一键同步（推荐）

在项目根目录执行：

```bash
cd /Users/zon/Desktop/MINE/10_music/album/DONE/music-board
node scripts/music-board/sync-netease-artist-albums-api.mjs 30005081 docs/music-board/catalog.json --limit 10
```

说明：

- `30005081` 是网易云艺人 ID（音右）
- 这个脚本会：
  - 通过 `https://music.163.com/api/artist/albums/<artistId>?limit&offset` 拉取全部专辑（分页）
  - 对每张专辑用 `https://music.163.com/api/v1/album/<albumId>` 拉取曲目列表
  - 自动写入/更新：
    - `type:"album"` 的专辑条目
    - `type:"song"` 的曲目条目（带 `collectionId`）
    - 每首歌的 `embeds[]`（用于站内 iframe 播放）

## 2) 校验与预览

校验 `catalog.json` 是否是合法 JSON：

```bash
python3 -m json.tool docs/music-board/catalog.json >/dev/null && echo OK
```

本地预览（避免直接双击导致 `fetch` 失败）：

```bash
python3 -m http.server 8011 --bind 127.0.0.1
```

打开：`http://127.0.0.1:8011/docs/music-board/`

## 3) 部署（可选）

如果你要从这个新目录部署到 Vercel（Prod）：

```bash
vercel deploy --cwd docs/music-board --prod --yes
```

如果你要把域名指向这个部署（示例）：

```bash
vercel domains add music.zondev.top yinyou
```

注意：DNS 仍需按 Vercel 提示配置（通常是 `A music.zondev.top 76.76.21.21`）。

## 4) 失败排查

- 返回 `{"code":-462,...}`：说明某些旧接口被风控（这就是为什么我们用 `api/v1/album/<id>` 取曲目）。
- 个别曲目无法播放：通常是版权/地区限制；站内仍会显示图标与条目，但 embed 可能不可用。

## 5) 为后续“其他平台同步”预留的约定

后续接入其他平台（抖音/Spotify/Apple 等）时，建议遵循：

- 只改 `docs/music-board/catalog.json`（单一事实来源）
- 每个平台同步脚本放到：`album/DONE/music-board/scripts/music-board/`
- 统一写入：
  - `links[]`：平台页面链接（默认只显示图标，不引导跳转）
  - `embeds[]`：可站内播放的 iframe（有就写，没有就不写）

