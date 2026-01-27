# DistroKid Snapshot Saver (Chrome extension)

一键下载：

- 当前 `My Music` 页面 HTML
- `My Music` 里的每一张专辑详情页（`/dashboard/album/?albumuuid=...`）HTML

这些 HTML 可以直接喂给本仓库的脚本解析并合并到 `docs/music-board/catalog.json`。

## 安装（本地加载）

1. 打开 Chrome → `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录：`tools/distrokid-snapshot-extension/`

## 使用

1. 登录 DistroKid
2. 打开 `https://distrokid.com/mymusic/`
3. 右下角会出现 `DK Snapshot` 按钮（也可以直接点击浏览器工具栏里的扩展图标来打开/关闭面板）
4. 点击后：
   - `Download this page (My Music)`：下载当前页面 HTML
   - `Download all albums`：按 URL 逐个下载每张专辑详情页 HTML（更稳定，不会卡在“open …”）

默认下载到 Chrome 的下载目录下的子目录：`distrokid-snapshots/`。

建议：

- 关闭 Chrome 的“每次下载前询问保存位置”，否则会弹很多次确认。
- 或把 Chrome 的下载目录设置到你想要的归档文件夹（例如你现在的 `已发布的网页/`）。

如果你点了 `Download all albums` 但只下载了 1 个文件，通常是：

- My Music 页面还没加载完（扩展会自动滚动尝试加载更多，但你也可以手动滚动到底再点一次）
- 你先点了 `Download this page (My Music)`，然后没等它完成（面板状态会显示进度）
- Chrome 下载设置/安全策略拦截（看下载栏/下载内容页面是否提示“阻止了多个下载”）

如果你看到 `Finished. done=0 failed=N`：

- 打开 `chrome://downloads/` 看每个文件的失败原因（常见是被拦截/中断）
- 打开 `chrome://extensions/` → 本扩展 → `Service worker` → Inspect，查看控制台报错

## 导入到 music-board

拿到下载的 HTML 后（路径按你的下载目录调整）：

```bash
# 导入 My Music 列表页（生成/更新 distrokid-album-<albumuuid> 专辑 stub）
node scripts/music-board/import-distrokid-mymusic-html.mjs "/path/to/distrokid-snapshots/distrokid_mymusic_*.html" docs/music-board/catalog.json

# 导入专辑详情页（补全 releaseDate/UPC/ISRC，且按 UPC > releaseDate+title 合并）
node scripts/music-board/import-distrokid-album-html.mjs /path/to/distrokid-snapshots/distrokid_album_*.html docs/music-board/catalog.json
```
