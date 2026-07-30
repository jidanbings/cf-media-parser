# 多平台媒体解析工具 — 架构文档

基于 Cloudflare Workers + Pages 构建的多平台媒体解析下载工具，支持 12 个主流平台的视频、图文、动图内容的智能识别与批量下载。

**版本：** v3.2.1
**许可证：** MIT
**源码：** [github.com/jidanbings/cf-media-parser](https://github.com/jidanbings/cf-media-parser)

---

## 目录

1. [功能特性](#功能特性)
2. [系统架构](#系统架构)
3. [项目结构](#项目结构)
4. [构建命令详解](#构建命令详解)
5. [部署说明](#部署说明)
6. [解析引擎架构](#解析引擎架构)
7. [各平台解析策略详解](#各平台解析策略详解)
8. [安全体系](#安全体系)
9. [API 接口](#api-接口)
10. [反爬对抗设计](#反爬对抗设计)
11. [更新日志](#更新日志)

---

## 功能特性

### 内容类型识别

| 类型 | 识别方式 | 输出 |
|------|---------|------|
| **视频** | 检测 `video` / `mp4` / `m3u8` 等字段 | `videos[]` + 质量标签 |
| **图片** | 检测 `images` / `urls` 等多图数组 | `images[]` + 尺寸分级 |
| **动图** | 检测 `gif` / `webp` + 帧序列特征 | `gifs[]` + 动图标记 |
| **音频** | 检测 `music` / `audio` / `play_url` 等 | `audio` + 格式标记 |

### 下载优化

- **批量下载**：支持一次性下载多张图片
- **打包下载**：自动打包为 ZIP 文件，支持 Windows 和移动端
- **高清优先**：自动选择最高清的图片版本（1080p > 720p > 540p > 缩略图）
- **并发控制**：移动端 8 路并发，PC 端 20 路并发

### 安全机制

- **密码保护**：3 次失败后锁定 1 小时
- **登录有效期**：12 小时自动过期
- **CORS 保护**：禁止跨域访问
- **SSRF 防护**：URL 白名单验证
- **路径遍历防护**：文件名安全检查

---

## 系统架构

### 架构总览（分层视图）

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                       PRESENTATION LAYER                         │
 │                        （表示层 — 静态资源）                       │
 │                                                                   │
 │    ┌───────────┐    ┌───────────┐    ┌───────────┐               │
 │    │ index.html│    │option.html│    │video.html │               │
 │    │  登录验证   │    │  功能选择   │    │  解析下载   │               │
 │    └─────┬─────┘    └─────┬─────┘    └─────┬─────┘               │
 │          │                │                │                     │
 │          └────────────────┼────────────────┘                     │
 └───────────────────────────┼───────────────────────────────────────┘
                             │ HTTPS
 ┌───────────────────────────┼───────────────────────────────────────┐
 │  ┌────────────────────────▼────────────────────────────────────┐  │
 │  │                     GATEWAY LAYER                             │  │
 │  │                       （网关层 — Worker 入口）                 │  │
 │  │                                                               │  │
 │  │   src/worker.js  ←  ES Module Worker 入口                     │  │
 │  │   src/config.js  ←  全局配置（平台域名、UA池、安全参数）       │  │
 │  │   src/router.js  ←  路由分发 + 中间件编排                     │  │
 │  └────────────────────────┬────────────────────────────────────┘  │
 │                           │                                        │
 │  ┌────────────────────────▼────────────────────────────────────┐  │
 │  │                   MIDDLEWARE CHAIN                            │  │
 │  │                      （中间件链）                              │  │
 │  │                                                               │  │
 │  │    CORS 防护  →  速率限制  →  JWT 验证  →  路由分发          │  │
 │  │                                                               │  │
 │  │    ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐    │  │
 │  │    │ CORS    │ → │ 限流器   │ → │ JWT     │ → │ 分发器   │    │  │
 │  │    │ 来源验证 │   │ IP+路径  │   │ HS256   │   │ API/页面 │    │  │
 │  │    └─────────┘   └─────────┘   └─────────┘   └─────────┘    │  │
 │  └────────────────────────┬────────────────────────────────────┘  │
 │                           │                                        │
 │           ┌───────────────┴───────────────┐                        │
 │           ▼                               ▼                        │
 │  ┌──────────────────┐        ┌──────────────────────┐              │
 │  │   UTILITY LAYER   │        │    PARSER ENGINE      │              │
 │  │   （工具层）       │        │     （解析引擎）       │              │
 │  │                   │        │                      │              │
 │  │  ┌─────────────┐  │        │  ┌────────────────┐  │              │
 │  │  │  fetcher.js │  │        │  │   factory.js   │  │              │
 │  │  │  多UA轮换抓取 │  │        │  │  ParserFactory │  │              │
 │  │  └─────────────┘  │        │  └────────┬───────┘  │              │
 │  │  ┌─────────────┐  │        │           │           │              │
 │  │  │   jwt.js    │  │        │  ┌────────▼───────┐  │              │
 │  │  │ HS256 签发   │  │        │  │    base.js     │  │              │
 │  │  └─────────────┘  │        │  │  共享工具函数    │  │              │
 │  │  ┌─────────────┐  │        │  └────────┬───────┘  │              │
 │  │  │   zip.js    │  │        │           │           │              │
 │  │  │  CRC32 打包  │  │        │  ┌────────▼───────┐  │              │
 │  │  └─────────────┘  │        │  │  各平台解析器    │  │              │
 │  │  ┌─────────────┐  │        │  │                │  │              │
 │  │  │ security.js │  │        │  │  douyin.js     │  │              │
 │  │  │ 限流/SSRF    │  │        │  │  kuaishou.js   │  │              │
 │  │  └─────────────┘  │        │  │  xiaohongshu.js│  │              │
 │  │  ┌─────────────┐  │        │  │  ...共12个解析器│  │              │
 │  │  │ response.js │  │        │  └────────────────┘  │              │
 │  │  │ 响应/代理下载│  │        └──────────────────────┘              │
 │  │  └─────────────┘  │                                              │
 │  └──────────────────┘                                              │
 │      构建管道: esbuild --bundle --format=esm → dist/_worker.js     │
 └─────────────────────────────────────────────────────────────────────┘
```

### 请求处理流程

```
 ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
 │ 客户端请求 │ ──> │  CORS    │ ──> │  速率限制  │ ──> │ JWT 验证  │
 │          │     │  Origin  │     │ IP+路径  │     │ HS256   │
 └──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                        │
                                              ┌─────────┴─────────┐
                                              │                   │
                                         ┌────▼────┐       ┌─────▼─────┐
                                         │ 静态资源  │       │  API 路由  │
                                         │ 页面路由  │       │  分发      │
                                         └─────────┘       └─────┬─────┘
                                                                 │
                          ┌──────────────────────────────────────┼──────┐
                          │            API 路由表                 │      │
                          │                                      │      │
                          │  POST /api/verify ──── 密码验证 ──── 签发 JWT│
                          │  GET|POST /api/parse ── detectPlatform        │
                          │                           └─ parser(url)     │
                          │                           └─ 标准化结果      │
                          │  GET /api/download  ──── 代理下载文件        │
                          │  POST /api/zip ──────── ZIP 打包            │
                          │  GET /api/stream ────── 视频流代理 (Range)  │
                          │  GET /api/music ────── 汽水音乐解析         │
                          │  GET /api/logout ────── 清除 Token          │
                          └─────────────────────────────────────────────┘
```

### 数据流：一次完整的内容解析

```
 用户         Worker        目标平台        浏览器
  │             │              │              │
  ├─ POST /api/parse ──────────┤              │
  │   {url:"..."}  │              │              │
  │             │              │              │
  │             ├─ detectPlatform(url)         │
  │             │   → "抖音"    │              │
  │             │              │              │
  │             ├─ parseDouyin(url)            │
  │             │              │              │
  │             ├─── fetch(官方API) ──────────►│
  │             │              │              │
  │             ◄─── JSON ────────────────────┤
  │             │    {video,images,author}    │
  │             │              │              │
  │             ├─ 标准化结果                  │
  │             │  {success,data:{...}}       │
  │             │              │              │
  │  ◄─ JSON ───┤              │              │
  │  {data}     │              │              │
  │             │              │              │
  │  (用户点下载)│              │              │
  │             │              │              │
  ├─ GET /api/download?url=... ───────────────┤
  │             │              │              │
  │             ├─── fetch(媒体文件) ─────────►│
  │             │              │              │
  │             ├─ 流式转发                    │
  │  ◄─ stream ─┤              │              │
```

---

## 项目结构

```
cf-media-parser/
│
├── package.json                # 项目配置 + esbuild 构建脚本
│
├── src/                        # 【源代码目录】—— 23 个源文件
│   ├── worker.js               #   入口文件（ES Module Worker）
│   ├── config.js               #   常量配置（平台映射、UA池、安全参数）
│   ├── router.js               #   路由分发 + 中间件编排
│   │
│   ├── parsers/                #   【解析引擎】ParserFactory 模式
│   │   ├── factory.js          #     工厂：平台检测 → 分发 → 标准化
│   │   ├── base.js             #     共享工具函数（extractJSON, buildResult）
│   │   ├── douyin.js           #     抖音解析器 + a_bogus 签名
│   │   ├── a_bogus.js          #     抖音签名算法（RC4 + SM3）
│   │   ├── kuaishou.js         #     快手解析器
│   │   ├── xiaohongshu.js      #     小红书解析器
│   │   ├── weibo.js            #     微博解析器
│   │   ├── tiktok.js           #     TikTok 解析器
│   │   ├── youtube.js          #     YouTube 解析器
│   │   ├── xigua.js            #     西瓜视频解析器
│   │   ├── haokan.js           #     好看视频解析器
│   │   ├── zhihu.js            #     知乎解析器
│   │   ├── pipixia.js          #     皮皮虾解析器
│   │   ├── quanminkge.js       #     全民K歌解析器
│   │   ├── acfun.js            #     AcFun 解析器
│   │   └── music.js            #     汽水音乐解析器
│   │
│   └── utils/                  #   【工具层】
│       ├── fetcher.js          #     HTTP 工具（多 UA 轮换）
│       ├── jwt.js              #     JWT 签发与验证（HS256）
│       ├── zip.js              #     ZIP 打包（CRC32 实现）
│       ├── security.js         #     速率限制 / SSRF / CSRF / 文件名验证
│       └── response.js         #     JSON 响应 / 代理下载 / 流媒体
│
├── dist/                       # 【构建产出目录】npm run build:dist
│   ├── _worker.js              #   打包后的 Worker 代码（单文件）
│   ├── index.html              #   登录验证页
│   ├── video.html              #   多平台解析下载页
│   ├── music.html              #   汽水音乐解析页
│   ├── option.html             #   功能选择页
│   └── _routes.json            #   路由配置
│
├── index.html                  # 📄 登录验证页（源文件）
├── video.html                  # 📄 多平台解析下载页（源文件）
├── music.html                  # 📄 汽水音乐解析页（源文件）
├── option.html                 # 📄 功能选择页（源文件）
│
└── docs/
    └── architecture.md         # 📄 架构文档（本文档）
```

> 架构设计借鉴自 [ucmao/media-parser](https://github.com/ucmao/media-parser)（Python）的 **ParserFactory 模式**。
>
> `src/` 目录下 **23 个源文件** 通过 esbuild 打包为 **1 个文件** `dist/_worker.js`，方便部署。

---

## 构建命令详解

### 命令一览

| 命令 | 说明 | 产物 |
|------|------|------|
| `npm run build` | **构建 Worker** — 将 `src/` 源码打包 | `dist/_worker.js`（~86KB 未压缩） |
| `npm run build:minify` | **压缩构建** — 同上但压缩代码 | `dist/_worker.js`（~40KB） |
| `npm run copy:dist` | **复制页面** — 将 HTML + `_routes.json` 复制到 `dist/` | `dist/` 内 6 个文件 |
| `npm run build:dist` | **完整构建** — build + copy:dist 一步完成 | `dist/` 目录完整部署包 |
| `npm run dev` | **监听模式** — 源码变化时自动重新构建 | `dist/_worker.js` |
| `npm run deploy` | **构建 + 同步** — 构建后复制到 `dash/` 目录 | `dash/` 内 6 个文件 |

### 构建流程

```
源代码 (src/ 目录)             构建产物 (dist/ 目录)
                          │
  src/worker.js  ─────────┤
  src/config.js  ─────────┤
  src/router.js  ─────────┤
  src/parsers/   ─────────┤─── esbuild --bundle --format=esm ───→ dist/_worker.js
  │   ├── factory.js      │
  │   ├── base.js         │        ───→ 共 23 个源文件打包为 1 个文件
  │   ├── douyin.js       │
  │   ├── a_bogus.js      │                +  npm run copy:dist
  │   ├── kuaishou.js     │                       │
  │   └── ... (14个解析器)  │                       ▼
  └── src/utils/           │               ┌──────────────┐
      ├── fetcher.js       │               │  dist/       │
      ├── jwt.js           │               │  ├─ _worker.js  │
      ├── zip.js           │               │  ├─ index.html  │
      ├── security.js      │               │  ├─ video.html  │
      └── response.js      │               │  ├─ music.html  │
                          │               │  ├─ option.html │
                          │               │  └─ _routes.json│
                          │               └──────────────┘
                          │                    │
                          ▼                    ▼ 部署到 Cloudflare Pages
              worker 单文件                    (只部署 dist/ 目录)
              (~86KB / ~40KB 压缩)
```

> Cloudflare Pages 只部署 `dist/` 目录，`src/`、`docs/`、`package.json` 等源码文件**不会暴露**到 CDN 上，保证安全。

### 构建产物说明

| 文件 | 大小 | 说明 |
|------|------|------|
| `dist/_worker.js` | ~86 KB | ⭐ **核心 Worker** — 所有后端逻辑（路由、解析器、安全、工具） |
| `dist/index.html` | ~7 KB | 登录验证页面 |
| `dist/video.html` | ~50 KB | 多平台解析下载页面 |
| `dist/music.html` | ~15 KB | 汽水音乐解析页面 |
| `dist/option.html` | ~7 KB | 功能选择页面 |
| `dist/_routes.json` | <1 KB | 路由配置，确保所有请求经过 Worker |

---

## 部署说明

### 部署方式概述

Cloudflare Pages 支持两种部署方式：**连接 Git 仓库（自动部署）** 或 **手动上传**。

### 方式一：连接 GitHub 自动部署（推荐）

**① Fork 本项目到你的 GitHub**
- 打开 https://github.com/jidanbings/cf-media-parser
- 点击 **Fork** → **Create fork**，得到你自己的仓库

**② 克隆你的仓库到本地**
```bash
git clone https://github.com/你的用户名/cf-media-parser.git
cd cf-media-parser
```

**③ 在 Cloudflare Pages 控制台创建项目**
- 访问 https://dash.cloudflare.com/ → **Workers 和 Pages** → **Pages**
- 点击 **创建** → **Pages** → **连接到 Git**
- 授权 GitHub，选择你 fork 的仓库

**④ 配置构建参数**

| 设置项 | 值 |
|--------|-----|
| 项目名称 | `media-parser` |
| 生产分支 | `main` |
| 构建命令 | `npm install && npm run build:dist` |
| 构建输出目录 | `dist` |

> ⚠️ **输出目录设为 `dist`**，这样 `src/`、`docs/`、`package.json` 等源码文件不会被部署到 CDN 上。

**⑤ 点击「保存并部署」**，Cloudflare 自动完成拉取 → 安装 → 构建 → 部署。

> 以后每次 `git push`，Cloudflare Pages 会自动重新构建部署，无需手动操作。

### 方式二：手动上传文件

先本地构建：
```bash
npm run build:dist
```

构建完成后 `dist/` 目录包含 6 个文件，进入 Cloudflare Pages 项目 → **部署** → **创建部署** → **直接上传**，将 6 个文件拖入上传区域即可。

### 方式三：Wrangler CLI

```bash
npm install -g wrangler
npx wrangler login
npx wrangler pages deploy dist --project-name media-parser
```

### 环境变量（必须）

部署后，进入 Cloudflare Pages 项目 → **设置** → **环境变量** → **生产环境**，添加：

| 变量名 | 说明 | 是否必填 |
|--------|------|:--------:|
| `SECRET_KEY` | 访问密码，登录时用户输入的比对密钥 | **是** |
| `JWT_SECRET` | JWT 签名密钥，用于签发和验证登录令牌 | **是** |

> ⚠️ **两个变量都必须设置**，缺少任一变量返回 500 错误。修改环境变量后需要**重新部署**才能生效。

### 完整部署流程

```
┌─────────────────────────────────────────────────────────────┐
│ 第一步：构建（本地或 Cloudflare Pages 自动构建）               │
│                                                             │
│  npm run build:dist                                           │
│       ↓                                                      │
│  dist/ 目录（6 个文件）                                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 第二步：部署到 Cloudflare Pages                                │
│                                                             │
│  Git 集成: ← GitHub push → Pages 自动构建 → 部署 dist/        │
│  手动上传: ← 将 dist/ 里的 6 个文件拖到上传界面                 │
│       ↓                                                      │
│  Cloudflare Pages 分配域名: https://xxx.pages.dev            │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 第三步：设置环境变量（Cloudflare 控制台操作）                    │
│                                                             │
│  ┌─ SECRET_KEY ─→ 登录密码验证                                │
│  └─ JWT_SECRET ─→ JWT 令牌签名                               │
│       ↓                                                      │
│  重试部署 → 配置生效                                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 第四步：验证                                                  │
│                                                             │
│  浏览器打开 https://xxx.pages.dev                             │
│  → 看到登录页 → 输入 SECRET_KEY → 登录成功                     │
│  → 选择「视频解析」→ 粘贴链接 → 解析成功                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 解析引擎架构

### ParserFactory 模式

借鉴自 [ucmao/media-parser](https://github.com/ucmao/media-parser)（Python）的工厂模式，使用函数式注册表而非 class 继承：

```javascript
// src/parsers/factory.js
const PARSER_REGISTRY = {
  '抖音':     parseDouyin,
  '快手':     parseKuaishou,
  '小红书':   parseXiaohongshu,
  // ... 12 个平台
};

function detectPlatform(url) {
  // 域名匹配 → 返回平台名称
}

async function parseMedia(url) {
  const platform = detectPlatform(url);
  const parser = PARSER_REGISTRY[platform];
  const result = await parser(url);
  // 附加平台图标和颜色
  result.platformIcon = PLATFORM_INFO[platform].icon;
  result.platformColor = PLATFORM_INFO[platform].color;
  return result;
}
```

### 统一结果格式

所有解析器返回一致的数据结构：

```javascript
{
  success: true,
  data: {
    platform: "平台名称",         // 由 factory.js 统一附加
    platformIcon: "🎵",          // 由 factory.js 统一附加
    platformColor: "#333333",    // 由 factory.js 统一附加
    title: "视频标题",
    cover: "https://封面URL",
    author: "作者昵称",
    authorId: "作者ID",
    avatar: "https://头像URL",
    type: "video | images | gif | mixed",
    videos: [
      { url: "https://...", quality: "4K HDR" },
      { url: "https://...", quality: "高清" }
    ],
    images: [
      { url: "https://...", index: 1 }
    ],
    gifs: [
      { url: "https://...", index: 1 }
    ],
    audio: "/api/music?url=...",
    downloads: [
      { url: "/api/download?...", label: "下载视频", quality: "4K HDR" }
    ]
  }
}
```

### 共享工具函数（`base.js`）

```javascript
// 从 HTML 中提取 JSON 嵌入数据
function extractJsonFromHtml(html, marker)

// 创建空结果模板
function createEmptyResult(platform)

// 构建标准响应
function buildResult(data)
```

---

## 各平台解析策略详解

### 解析方式总览

| 平台 | 解析方式 | 核心逻辑 | 需要 Cookie |
|------|---------|---------|:----------:|
| **抖音** | a_bogus 签名 + 官方 API | 滑动窗口签名 + RC4 加密 + SM3 哈希 | 否 |
| **快手** | 移动端 INIT_STATE 提取 | 多 URL × 多 UA 轮换，花括号平衡解析 JSON | 是 |
| **小红书** | HTML `__INITIAL_STATE__` | 从页面嵌入数据提取笔记信息 | 是 |
| **微博** | Mobile API + PC API | 多 API 端点和 HTML 降级解析 | 否 |
| **TikTok** | tikwm.com API + 页面 HTML | 第三方 API + 页面嵌入数据双通道 | 否 |
| **YouTube** | oEmbed + Invidious | oEmbed 快速获取元数据，Invidious 回退 | 否 |
| **西瓜视频** | `_ROUTER_DATA` + SSR | Vue 路由数据 + 服务端渲染降级 | 否 |
| **好看视频** | `__PRELOADED_STATE__` | 百度预加载数据提取 | 否 |
| **知乎** | 官方 API v4 | 知乎标准 JSON API | 否 |
| **皮皮虾** | h5 API | 移动端 h5 接口 | 否 |
| **全民K歌** | HTML 正则提取 | 正则匹配嵌入的音频数据 | 否 |
| **AcFun** | 官方 API video info | AcFun 标准 API | 否 |

---

### 抖音（`douyin.js` + `a_bogus.js`）

| 项目 | 内容 |
|------|------|
| **方法** | a_bogus 签名 + 官方 API |
| **难度** | 中 |
| **反爬** | 需计算 a_bogus 签名参数（滑动窗口 + RC4 + SM3 哈希） |
| **核心逻辑** | 1. 提取分享链接中的视频 ID<br>2. 构造 API URL 并计算 a_bogus 签名<br>3. 请求官方接口获取视频详情<br>4. 解析返回的 JSON，提取视频/图片/作者信息 |
| **特殊处理** | 支持抖音/TikTok 双平台；a_bogus 算法会随版本更新 |

### 快手（`kuaishou.js`）

| 项目 | 内容 |
|------|------|
| **方法** | 页面嵌入数据提取 + Cookie 绕过风控 |
| **难度** | 高 |
| **反爬** | `www.kuaishou.com` 对数据中心 IP 返回风控（`{"result":2}`），需用移动端域名绕过 |
| **核心逻辑** | 1. 提取视频/图文 ID<br>2. 从页面 `window.INIT_STATE` 提取嵌入数据<br>3. 花括号平衡匹配提取 JSON<br>4. 作者数据：`photo.userName` / `photo.userEid` / `photo.headUrl` |
| **特殊处理** | 优先使用用户原始 URL；Video 和 Photo 两种类型分别处理 |

### 小红书（`xiaohongshu.js`）

| 项目 | 内容 |
|------|------|
| **方法** | 页面 HTML `__INITIAL_STATE__` 嵌入数据 |
| **难度** | 高 |
| **反爬** | 需要 Cookie 验证；页面结构可能因 A/B 测试变化 |
| **核心逻辑** | 1. 提取笔记 ID（note/xxxxx）<br>2. 请求页面 HTML<br>3. 从 `<script>` 标签提取 `__INITIAL_STATE__` JSON<br>4. 解析笔记详情、图片列表、作者信息 |

### 微博（`weibo.js`）

| 项目 | 内容 |
|------|------|
| **方法** | Mobile API + PC API + HTML 降级 |
| **难度** | 低 |
| **核心逻辑** | 1. 优先调用 Mobile API<br>2. 失败降级到 PC API<br>3. 最后尝试 HTML 页面解析 |

### TikTok（`tiktok.js`）

| 项目 | 内容 |
|------|------|
| **方法** | tikwm.com API + 页面 HTML 解析 |
| **难度** | 低 |
| **核心逻辑** | 1. 提取分享链接中的视频 ID<br>2. 调用 tikwm.com 第三方接口获取数据<br>3. 失败时回退到页面 HTML 解析 |

### YouTube（`youtube.js`）

| 项目 | 内容 |
|------|------|
| **方法** | oEmbed + Invidious API |
| **难度** | 低 |
| **核心逻辑** | 1. 优先使用 oEmbed API（快速获取元数据）<br>2. Invidious 实例作为备选 |

### 其他平台

| 平台 | 解析方式 | 核心逻辑 |
|------|---------|---------|
| **西瓜视频** | `_ROUTER_DATA` + SSR 降级 | 从 Vue 路由数据提取视频信息 |
| **好看视频** | `__PRELOADED_STATE__` | 百度预加载数据提取 |
| **知乎** | 官方 API v4 | `www.zhihu.com/api/v4/...` |
| **皮皮虾** | h5 API | 移动端接口直接调用 |
| **全民K歌** | HTML 正则提取 | 正则匹配嵌入音频 URL |
| **AcFun** | 官方 API video info | `api.acfun.cn/rest/app/...` |

---

## 安全体系

### 1. 双密钥体系

本系统采用**双密钥分离**的认证架构：

```
                 ┌───────────────────────────────────┐
                 │        Cloudflare 环境变量          │
                 │                                   │
                 │  SECRET_KEY  ────→  登录密码验证    │
                 │  (用户输入比对)      ┌──────────┐  │
                 │                     │  相等?    │  │
                 │                     └────┬─────┘  │
                 │                          │通过      │
                 │  JWT_SECRET  ────→  JWT 签发      │
                 │  (服务端签名)         ┌──────────┐  │
                 │                      │ HS256    │  │
                 │                      │ 签名     │  │
                 │                      └──────────┘  │
                 │                          │          │
                 │                     ┌────▼─────┐   │
                 │                     │ JWT Token│   │
                 │                     │ Set-Cookie│  │
                 │                     └──────────┘   │
                 └───────────────────────────────────┘
```

- `SECRET_KEY`：登录密码，用户通过 `/api/verify` 提交，与服务端比对
- `JWT_SECRET`：JWT 签名密钥，仅服务端持有，用于签发和验证 token
- 两者**均必须配置**，任一缺失将拒绝所有请求

### 2. 跨域防护（CORS）

```javascript
const origin = request.headers.get('Origin') || '';
if (origin && new URL(origin).hostname !== url.hostname) {
    return new Response('Forbidden', { status: 403 });
}
```

- 本站页面内请求：Origin = 本站域名 → 放行
- 浏览器直接访问：无 Origin 头 → 放行
- 其他网站 AJAX 调用：Origin ≠ 本站 → 403

### 3. 密码验证 + 速率限制

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `MAX_ATTEMPTS` | 3 次 | 允许的最大错误尝试次数 |
| `COOLDOWNS` | `[3600000]` | 锁定时间 1 小时 |
| `COOKIE_MAX_AGE` | 43200 秒 | 登录有效期 12 小时 |

**验证流程（后端处理，前端不参与）：**

```
表单 POST /api/verify  或  JSON POST /api/verify { key: "xxx" }

┌─ 密码正确 → clearRateLimit → 签发 JWT（HS256）→ Set-Cookie（Secure + HttpOnly）
│   ├─ 表单提交 → 302 跳转到 /option
│   └─ JSON API → 200 { success: true }
│
└─ 密码错误 → recordFailedAttempt
      ├─ 触发锁定 (第3次) → "尝试次数过多，请等待 3600 秒"
      │   ├─ 表单提交 → 302 跳转 /?error=消息
      │   └─ JSON API → 429 { error: "..." }
      └─ 未触发锁定 → "密钥错误"（不透露剩余次数）
          ├─ 表单提交 → 302 跳转 /?error=消息
          └─ JSON API → 403 { error: "..." }
```

**Token 结构**：标准 JWT（HS256，HMAC-SHA256 签名），payload 包含：

```json
{
  "iat": 1722345678,
  "exp": 1722345678 + 43200,
  "ip": "客户端IP",
  "ua": "UA哈希（防盗用预留）"
}
```

Cookie 设置 `Secure; HttpOnly; SameSite=Lax`，仅通过 HTTPS 传输，JavaScript 无法读取。

### 4. 登出 CSRF 防护

登出接口 `/api/logout` **仅接受 POST 请求**，拒绝 GET 请求。防止攻击者通过 `<img>`、`<a>` 等标签强制用户登出。

```
前端触发登出: POST /api/logout → 清除 Cookie → 302 跳转首页
攻击者 <img src="/api/logout"> → 405/404（GET 请求被忽略）
```

### 5. SSRF 防护

代理下载/流媒体 URL 需通过验证：

- 必须是 HTTPS
- 不允许指定非 443 端口
- 防止内网 / 本地地址访问（`127.0.0.1`, `localhost`, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`）

### 6. 文件名安全

- 禁止路径遍历字符（`..`, `/`, `\`, `:`）
- 仅允许白名单扩展名：`.mp4`, `.mp3`, `.m4a`, `.aac`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- 文件名最长 200 字符

### 7. 内容安全策略（CSP）与安全响应头

所有响应自动附加：

| 响应头 | 值 |
|--------|-----|
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-XSS-Protection` | `1; mode=block` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src * data: blob:; connect-src 'self'; media-src 'self'; font-src 'self' data:; frame-src 'none'` |

CSP 策略说明：

| 指令 | 效果 |
|------|------|
| `default-src 'self'` | 所有资源默认只允许同源加载 |
| `script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com` | 脚本来自同域、页面内联或 CDN（jszip/FileSaver），以及 Cloudflare 注入的 beacon |
| `style-src 'self' 'unsafe-inline'` | 样式来自同域或页面内联 |
| `img-src * data: blob:` | 图片可加载外部 URL（视频封面、头像） |
| `connect-src 'self' https://cdnjs.cloudflare.com` | API 请求仅限同域，CDN 源映射文件放行 |
| `media-src 'self'` | 媒体资源仅限同域代理 |
| `font-src 'self' data:` | 字体来自同域或 data URI |
| `frame-src 'none'` | 禁止页面被嵌入 iframe |

### 8. 速率限制实现

```javascript
// 基于 IP + 路径的内存计数器
const RATE_MAP = new Map();      // key: IP:path
const CLEANUP_INTERVAL = 900;    // 每 15 分钟清理过期条目
const RATE_MAP_MAX_ENTRIES = 500;

// 对 /api/parse 路径限流：每 IP 每 5 秒最多 3 次
```

---

## API 接口

### `POST /api/verify` — 登录验证

| 参数 | 类型 | 说明 |
|------|------|------|
| `key` | string | 访问密钥，与 `SECRET_KEY` 比对 |

### `GET /api/logout` — 退出登录

清除 `vd_token` Cookie，重定向到首页。

### `GET|POST /api/parse` — 多平台统一解析（需授权）

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `url` | string | 是 | 任意平台分享链接（GET 参数或 POST JSON body） |

**支持平台：** 抖音、快手、小红书、微博、TikTok、YouTube、西瓜视频、好看视频、知乎、皮皮虾、全民K歌、AcFun（共 12 个）

> 📌 **验证状态：** 目前仅 **抖音** 和 **快手** 两个平台经过实际验证，其余平台尚未测试，欢迎提交 PR 完善。

### `GET /api/download` — 代理下载（需授权）

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `url` | string | 是 | 原始文件 URL |
| `filename` | string | 否 | 下载文件名 |

### `POST /api/download/zip` — ZIP 打包下载（需授权）

| 参数 | 类型 | 说明 |
|------|------|------|
| `files` | array | 文件列表 `[{ url, ext, index }]` |
| `ts` | string | 时间戳 |
| `pn` | string | 平台拼音 |

### `GET /api/stream` — 视频流媒体（需授权）

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 视频流URL |

支持 `Range` 请求，用于视频进度条拖拽。

### `GET /api/music` — 汽水音乐解析（需授权）

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 汽水音乐分享链接 |

---

## 反爬对抗设计

### 1. 多 User-Agent 轮换（`fetcher.js`）

```javascript
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...Chrome/125...';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 ...) Mobile/...';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) ...Chrome/125... Mobile/...';
const UA_GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) ...Googlebot/2.1...';

// 每次请求自动从池中选取一个 UA
async function fetchPage(url, options = {}) { ... }
async function fetchJson(url, options = {}) { ... }
```

### 2. 快手多路径轮换

面对 `www.kuaishou.com` 的数据中心 IP 风控，实现了多级轮换策略：

```
输入 URL
    │
    ├── 原始 URL + Cookie（最优先）
    ├── 原始 URL + Cookie + 手机 UA
    ├── 构造 URL + Cookie
    └── 构造 URL + Cookie + 手机 UA
        成功提取到数据即返回
```

### 3. 花括号平衡匹配算法

用于从 HTML 页面中精准提取 JSON 嵌入数据：

```javascript
function extractJsonObject(text, startPos) {
  let braceCount = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') {
      if (braceCount === 0) start = i;
      braceCount++;
    } else if (ch === '}') {
      braceCount--;
      if (braceCount === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
```

### 4. 抖音 a_bogus 签名

抖音 API 要求每个请求携带 `a_bogus` 签名参数，算法实现：

- 基于请求 URL、Cookie、User-Agent 等参数生成签名
- 使用 RC4 加密 + SM3 哈希
- 滑动窗口技术确保每次签名不同

### 5. 嵌入数据提取策略

根据各平台页面结构，采用不同的数据提取路径：

| 平台 | 数据标记 | 提取方式 |
|------|---------|---------|
| 抖音 | `window._ROUTER_DATA` | JSON 解析 |
| 快手 | `window.INIT_STATE` | 花括号平衡匹配 |
| 小红书 | `__INITIAL_STATE__` | 正则提取 |
| 好看视频 | `window.__PRELOADED_STATE__` | JSON 解析 |
| 西瓜视频 | `window._ROUTER_DATA` | JSON 解析 |

---

## 更新日志

### v3.2.1（2026-07-30）— 快手封面修复

**🐛 修复：**
- **快手封面图片无法获取** — 嵌入数据中 `coverUrl` 字段可能不存在或为对象格式
  - 增加 `normalizeUrl()` 类型守卫与 `\\/` 转义处理
  - 嵌入数据提取后始终执行正则/HTML 兜底，不再短路返回
  - 新增 HTML 正则直接搜索 CDN 图片 URL 作为最后保障
- **图片代理优化** — `/api/proxy/image` 根据图片域名自动匹配 Referer
- **前端防盗链** — 封面改为通过 Worker 代理加载

### v3.2.0（2026-07-30）— B站永久放弃 + 快手优化

**⛔ B站永久放弃支持：**
- 因 B站 WAF 对 Cloudflare Workers 的 TLS 指纹检测返回 412，所有绕过方案均不可靠
- 永久放弃对 B站 的支持，删除 `bilibili.js`、`rawFetch.js` 及相关配置
- 粘贴 B站 链接直接提示不再支持

**⚡ 快手优化：**
- 解析策略从 12 次顺序尝试简化为最多 4 次，大幅减少等待时间
- 增加 URL 标准化函数，修复封面加载失败问题

### v3.1.0（2026-07-30）— 快手解析修复

**🐛 修复：**

- **快手解析器重写** — 解决作者名/ID/头像一直为空的问题
  - 发现 `www.kuaishou.com` 对数据中心 IP 返回风控拦截 `{"result":2}`
  - 改用 `v.m.chenzhongtech.com` 移动端 URL 绕过 Cloudflare 出口 IP 风控
  - 从 `window.INIT_STATE` 提取嵌入数据，支持视频和图文内容
  - 作者字段从 GraphQL 的 `user` 调整为 INIT_STATE 的 `photo.userName / userEid / headUrl`
  - 多 URL × 多 UA/Header 配置轮换，优先使用用户原始输入 URL
  - 引入花括号平衡匹配算法，精准提取页面内的 JSON 对象

**🔐 安全：**

- **新增 `JWT_SECRET` 环境变量** — 将 JWT 签名密钥与 `SECRET_KEY`（登录密码）分离
  - 推荐独立配置，增强安全性
  - 未配置时自动回退到 `SECRET_KEY`，保持向后兼容

**📝 文档：**

- 架构文档（`docs/architecture.md`）纳入仓库管理
- 更新快手解析策略说明
- 更新环境变量配置文档

### v3.0.0（2026-07-29）— 架构重构

**🏗️ 架构重构：**

- 单体 `_worker.js`（~2300 行）拆分为模块化架构（`src/` 目录，23 个源文件）
- 引入 **ParserFactory 模式**（借鉴自 [ucmao/media-parser](https://github.com/ucmao/media-parser)）
- 每个平台解析器为独立文件（`src/parsers/*.js`），易于维护和扩展
- 工具层分离：response、jwt、zip、security、fetcher 各司其职
- 新增 esbuild 构建系统（`npm run build` → `_worker.js`）
- 路由层独立（`router.js`），中间件链式编排

**📈 代码质量：**

- 所有功能 100% 保留，API 接口 100% 兼容
- 更好的错误处理和模块边界
- 完整的 JSDoc 类型注释

### v2.2.0（2026-07-30）

- 解析引擎重构
- 反爬对抗优化
- 前端混合类型徽章支持

### v2.1.0（2026-05-16）

- Token 升级为标准 JWT（HS256）
- 安全增强
- 登录有效期 12 小时

### v2.0.0（2026-05-16）

- 动图识别算法优化
- 高清图片选择算法
- 图片去重算法
- ZIP 打包优化
- 密码锁定机制

### v1.0.0（2026-05-10）

- 初始版本发布
- 支持抖音视频解析
