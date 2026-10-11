# cf-media-parser

🌐 **三平台媒体解析下载工具** — 基于 Cloudflare Workers + Pages 的零成本部署方案，支持**抖音、快手、哔哩哔哩**三个平台的**视频、图文、动图、音频**内容解析下载。

> ✨ **v4.0.0 起无需登录。** 打开即用，环境变量全部可选——不配置也能解析常规内容。
>
> 🎯 **v5.0.0 收敛为三个平台**，各有独立入口页：`/douyin` · `/kuaishou` · `/bilibili`

[![Deploy to Cloudflare](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare)](https://dash.cloudflare.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ 支持平台

| 平台 | 图标 | 内容类型 | 解析方式 |
|------|------|---------|---------|
| 抖音 | 🎵 | 短视频、图文图集、实况照片、背景音乐 | 移动端接口 + 分享页 + Web API |
| 快手 | 🎬 | 短视频、图文图集 | 多路由 + GraphQL 兜底 |
| 哔哩哔哩 | 📺 | 常规视频、番剧、剧集 | 官方接口 + 单文件流 |

**三个平台各有独立入口页**：`/douyin` · `/kuaishou` · `/bilibili`

> 📌 **为什么只有三个？** 与其把十几个平台都做到「勉强能用」，不如把最常用的三个做到稳定可靠。早期版本曾支持 12 个平台（小红书、微博、YouTube、知乎等），v5.0.0 已下线。

### 核心能力

- **智能识别** — 自动从分享文案中抽取链接，检测平台，提取标题、作者、封面
- **画质仲裁** — 多路流并存时按编码（H.264 优先）、分辨率、码率、体积依次排序取优
- **高清原片** — 抖音自动升清至 1080p；快手取创作者原始图片
- **直链复制** — 图片网格点开灯箱预览，可单条复制、批量复制或格式化导出
- **视频流代理** — 支持 Range 请求，进度条可拖拽
- **分段切换** — B站多 P、多分集视频可在页面内直接切换播放

> **关于下载方式**：本项目**不提供 ZIP 打包**。图片可预览、直链可复制，视频保留直接下载按钮。

---

## 🚀 快速开始

### 方法一：连接 GitHub 自动部署（推荐）

1. **Fork 本项目**到你的 GitHub 账号下
2. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/) → **Workers 和 Pages** → **Pages** → **创建** → **连接到 Git**
3. 授权 Cloudflare 访问 GitHub，选择你 fork 的 `cf-media-parser`
4. 配置构建设置：

| 设置项 | 填写值 |
|--------|--------|
| 项目名称 | `media-parser`（可自定义） |
| 生产分支 | `main` |
| 构建命令 | `npm install && npm run build:dist` |
| 构建输出目录 | `dist` |

5. 点击「保存并部署」，约 1-3 分钟完成，得到一个 `https://media-parser-xxx.pages.dev` 域名

> 🔒 输出目录设为 `dist`：Cloudflare 只部署 `dist/`，`src/`、`docs/`、`scripts/` 等源码不会暴露到公网。

### 方法二：手动上传

```bash
npm install
npm run build:dist        # 生成 dist/
```

进入 Cloudflare Pages 项目 → **部署** → **创建部署** → **直接上传**，把 `dist/` 里的 **10 个文件**（含 `assets/` 目录）全选拖入上传区。

> ⚠️ `assets/` 目录必须一并上传，否则页面样式与脚本将 404。

### 方法三：Wrangler CLI

```bash
npm install -g wrangler
npx wrangler login
npx wrangler pages deploy dist --project-name media-parser
```

### 可选环境变量

**全部可选**，不配置也能解析常规内容。可在 Pages 项目 → **设置** → **环境变量** 按需补充：

| 变量 | 平台 | 作用 |
|------|------|------|
| `DOUYIN_COOKIE` | 抖音 | 提升图文实况成功率 |
| `KUAISHOU_COOKIE` | 快手 | 提升解析成功率 |
| `BILIBILI_COOKIE` | 哔哩哔哩 | 提升解析成功率 |

取值直接粘贴浏览器里对应站点的 Cookie 字符串。

---

## 📖 API 接口

所有接口**无需鉴权**，但受速率限制与同源校验约束。

### 解析内容

```http
GET /api/parse?url=https://www.douyin.com/video/xxxxx
# 或
POST /api/parse
Content-Type: application/json

{"url": "https://www.douyin.com/video/xxxxx"}
```

**响应格式：**

```json
{
  "success": true,
  "data": {
    "platform": "抖音",
    "platformIcon": "🎵",
    "title": "视频标题",
    "cover": "https://...",
    "author": "作者昵称",
    "type": "video | images | gif | audio | mixed",
    "videos": [{ "url": "...", "quality": "高清" }],
    "images": [{ "url": "...", "index": 1 }],
    "gifs":   [{ "url": "...", "index": 1 }],
    "audio": "https://...",
    "downloads": [{ "url": "...", "label": "下载视频", "quality": "高清" }]
  }
}
```

### 媒体代理（下载 / 流式播放）

```http
GET /api/media?url=https://xxx&filename=video.mp4
GET /api/media?url=https://xxx&mode=stream
Range: bytes=0-1000000
```

| 参数 | 说明 |
|------|------|
| `url` | 媒体原始 URL（必填） |
| `filename` | 下载文件名（受白名单校验） |
| `mode` | `download`（默认）或 `stream` |

支持 `HEAD` 请求获取文件大小。

### 图片代理

```http
GET /api/proxy/image?url=https://xxx
```

按域名自动匹配 Referer。

### 健康检查

```http
GET /api/health
```

### 兼容别名

| 旧接口 | 等价于 |
|--------|--------|
| `GET /api/download?url=...&filename=...` | `GET /api/media?url=...&filename=...` |
| `GET /api/stream?url=...` | `GET /api/media?url=...&mode=stream` |

---

## ⚙️ 本地构建

```bash
npm install                # 安装依赖（仅 esbuild）

npm run build              # 打包 Worker → dist/_worker.js
npm run copy:dist          # 复制静态资源 → dist/
npm run build:dist         # 完整构建（上述两步）
npm run deploy             # 构建 + 同步到 ../dash/
npm run dev                # 监听模式，源码变化自动重建
```

> 测试与自检命令（`npm test` / `npm run check`）的脚本位于本地 `tests/` 目录（不上传仓库），仅供本地开发自检使用。

---

## 🏗️ 项目结构

```
cf-media-parser-main/
├── src/                  # 源码（esbuild 打包为单文件 Worker）
│   ├── worker.js         #   入口
│   ├── router.js         #   路由与中间件
│   ├── config.js         #   配置常量（三平台域名映射）
│   ├── parsers/          #   三个平台解析器（工厂模式）
│   │   ├── factory.js    #     注册表与分发
│   │   ├── douyin.js     #     抖音
│   │   ├── kuaishou.js   #     快手
│   │   ├── bilibili.js   #     B站
│   │   ├── a_bogus.js    #     抖音签名算法
│   │   └── base.js       #     共享工具
│   └── utils/            #   security / response
├── assets/               # 前端资源（warmth 设计系统 + parse 解析页）
├── scripts/              # 构建脚本（copy-dist）
├── docs/architecture.md  # 架构文档
├── CHANGELOG.md          # 更新日志
├── index.html            # 首页（三平台入口）
├── douyin.html           # 抖音解析页
├── kuaishou.html         # 快手解析页
├── bilibili.html         # 哔哩哔哩解析页
└── dist/                 # 构建产物（部署此目录）
```

> 📖 详细设计规范、各平台解析策略、安全体系见 [架构文档](docs/architecture.md)；历史版本变更见 [更新日志](CHANGELOG.md)。

---

## ⚠️ 法律声明

本工具仅用于**学习研究**目的。请遵守各平台服务条款，下载内容仅限个人学习使用，不得用于商业用途或二次分发。使用者需自行承担因使用本工具产生的法律责任。

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。
