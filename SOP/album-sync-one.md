# SOP：单张专辑同步（给我链接 → 同步数据 → 推送上线 → 本地歌曲分类）

目标：当你给我一个网易云专辑链接（`music.163.com/#/album?id=...`），我可以把该专辑的 **封面/发行日期/曲目列表/站内播放器 embeds** 同步进本工程，并 `git push` 触发网站更新；然后把你指定目录里的本地音频按“是否已在 catalog 列表中”分成 `列表内/` 与 `列表外/`。

本 SOP 的产物：

- 数据：`docs/music-board/catalog.json`
- 同步脚本：`scripts/music-board/sync-netease-albums-api.mjs`
- 分类脚本：`scripts/music-board/classify-folder-by-catalog.mjs`

## 0) 前置条件

- 你当前在项目目录：`/Users/zon/Desktop/MINE/10_music/album/DONE/music-board`
- 能访问 `music.163.com`（脚本会请求公开 API）
- `node` 可用
- 本仓库已配置 `origin`（SSH）用于推送：`git remote -v`

## 1) 输入格式（你发给我）

至少给一个专辑链接：

- `https://music.163.com/#/album?id=<albumId>`

可选再给一个“需要分类的本地目录”（例）：

- `/Users/zon/Desktop/MINE/10_music/album/待发布_网易云/20260121 春节2`

## 2) 同步专辑数据到 catalog

在项目根目录执行：

```bash
cd /Users/zon/Desktop/MINE/10_music/album/DONE/music-board
node scripts/music-board/sync-netease-albums-api.mjs docs/music-board/catalog.json --album-url "https://music.163.com/#/album?id=359139954"
```

说明：

- 这个命令会自动创建 `netease-album-<id>` 的占位条目（若不存在），并拉取 API 写回 `catalog.json`
- 只同步你指定的专辑，不会全量刷新所有专辑

## 3) 本地预览（推荐）

```bash
python3 -m http.server 8000
```

打开：`http://localhost:8000/docs/music-board/`

## 4) 推送上线（GitHub → 网站更新）

先确认只提交本次相关文件（很重要）：

```bash
git status
```

只 stage 站点相关变更：

```bash
git add docs/music-board/catalog.json
```

如果你这次还改了页面逻辑/样式（可选）：

```bash
git add docs/music-board/index.html docs/music-board/app.js docs/music-board/README.md
```

提交并推送：

```bash
git commit -m "music-board: sync netease album <albumId>"
git push origin "$(git branch --show-current)"
```

## 5) 每次“上传/同步完成”后的本地歌曲分类（列表内 / 列表外）

把某个目录里的音频按“是否已出现在 `catalog.json` 的曲目 title 中”分类。

默认是 **dry-run**（只输出计划，不动文件）：

```bash
node scripts/music-board/classify-folder-by-catalog.mjs "/Users/zon/Desktop/MINE/10_music/album/待发布_网易云/20260121 春节2" docs/music-board/catalog.json
```

确认输出没问题后再真的执行（会创建两个文件夹，并把音频移动进去）：

```bash
node scripts/music-board/classify-folder-by-catalog.mjs "/Users/zon/Desktop/MINE/10_music/album/待发布_网易云/20260121 春节2" docs/music-board/catalog.json --apply --mode move
```

执行结果：

- `.../20260121 春节2/列表内/`：文件名能匹配到 catalog 里的歌曲标题（视为“已发布/已同步”）
- `.../20260121 春节2/列表外/`：匹配不到（视为“未发布/未同步/需人工核对”）

分类范围：

- 音频：`wav/mp3/m4a/flac/...`
- 歌词：`.lrc`，以及文件名包含 `歌词` 的 `.txt`（如 `歌名_歌词.txt`）

可选：只按某一张专辑的曲目标题来匹配（更严格）：

```bash
node scripts/music-board/classify-folder-by-catalog.mjs "/path/to/folder" docs/music-board/catalog.json --album 359139954 --apply --mode move
```

## 6) 失败排查

- `fetch failed / ENOTFOUND`：网络或 DNS 问题；确认本机可打开 `music.163.com`
- 分类“误判/都进列表外”：常见原因是音频文件名和歌曲标题不一致（有编号、前后缀、工程名）；建议先 dry-run 看 `normalized` 字段，再手动改文件名或加 `--album` 收窄范围
