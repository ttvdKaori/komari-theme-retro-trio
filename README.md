# Komari Retro Trio

一个 [Komari Monitor](https://github.com/komari-monitor/komari) 主题：**一套主题，三种皮肤**，访客可在页面右上角一键切换。

Three switchable skins in one Komari theme: **Retro Terminal / Cyberpunk / Pixel Game**.

## 皮肤预览 | Skins

| 皮肤 | 说明 |
|---|---|
| `TERM` 复古终端 | VT323 字体、磷光绿、CRT 扫描线 + 辉光 + 暗角、闪烁光标；浅色模式为电传纸色 |
| `CYBR` 赛博朋克 | Orbitron 字体、霓虹青/品红、网格地板、切角卡片、霓虹光晕 |
| `PIXL` 像素游戏 | Press Start 2P 像素标题、像素切角、分段进度条；浅色模式为 GameBoy 绿 |

皮肤选择保存在访客浏览器 localStorage，互不影响；管理员可在后台设置默认皮肤。

## 功能

- 总览：在线/总节点、总上行/下行、总流量
- 节点卡片：状态、CPU/内存/硬盘进度条、实时网速、流量、运行时间、价格/到期时间
- 节点详情页：完整实时指标 + 4 小时 CPU / 内存 / 网络 / Ping 历史曲线（纯手绘 Canvas，零依赖）
- WebSocket `/api/clients` 实时数据，断线自动重连
- 明暗 / 跟随系统、中文 / English 切换（兼容官方 `appearance`、`language` localStorage 字段）
- 单文件 vanilla JS SPA，hash 路由，无构建步骤、无第三方 JS 库

## 安装

1. 在 [Releases](../../releases) 下载 `RetroTrio.zip`
2. Komari 管理后台 → 主题 → 上传主题包
3. 启用 **Komari Retro Trio**

或手动安装：解压后放到 Komari 数据目录 `theme/RetroTrio/` 下（保证 `komari-theme.json` 与 `dist/` 位于该目录根部），然后在后台启用。

## 后台可配置项

| 配置 | 说明 |
|---|---|
| `default_style` | 新访客的默认皮肤（terminal / cyber / pixel） |
| `scanlines` | 复古终端皮肤的 CRT 扫描线/辉光开关 |
| `glow` | 赛博朋克皮肤的霓虹辉光开关 |
| `footer_text` | 页脚附加 HTML |

配置值通过 `/api/public` 的 `theme_settings` 公开下发（Komari ≥ 1.0.5）。

## 目录结构

```
├── komari-theme.json   # 主题清单（含 managed 动态配置）
└── dist/
    ├── index.html      # 含官方要求的 title/description 占位符
    └── assets/
        ├── app.css     # 三套皮肤的全部样式
        └── app.js      # 全部逻辑（i18n / WS / 路由 / Canvas 图表）
```

## 本地开发

无需构建，直接编辑 `dist/` 内文件后重新打包：

```bash
python3 -c "
import zipfile, os
with zipfile.ZipFile('RetroTrio.zip','w',zipfile.ZIP_DEFLATED) as z:
    z.write('komari-theme.json')
    for root,_,fs in os.walk('dist'):
        for f in fs: z.write(os.path.join(root,f))
"
```

## License

MIT
