# cf-media-parser

🌐 **多平台媒体解析下载工具** — 基于 Cloudflare Workers + Pages 构建，支持 12 个主流平台的视频、图文、动图、音频内容解析与代理下载。

> ⛔ **B站（哔哩哔哩）永久放弃支持** — 由于 B站的反爬机制过于激进（Cloudflare Workers 的 TLS 指纹检测返回 412），本项目永久放弃对 B站 的支持。如果你需要解析 B站视频，请使用 [ucmao/media-parser](https://github.com/ucmao/media-parser)（Python VPS 部署版）。

[![Deploy to Cloudflare](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare)](https://dash.cloudflare.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📑 目录

- [功能特点](#-功能特点)
- [快速开始](#-快速开始)
- [API 接口](#-api-接口)
- [项目结构](#-项目结构)
- [解析策略](#-解析策略)
- [构建命令](#-构建命令)
- [更新日志](#-更新日志)
- [法律声明](#-法律声明)

---

## ✨ 功能特点

### 📥 支持平台

| 平台 | 图标 | 内容类型 | 解析方式 | 难度 |
|------|------|---------|---------|------|
| 抖音 / TikTok | 🎵 | 视频、图文、动图、音频 | 官方 API + a_bogus 签名 | 中 |
| 快手 | 🎬 | 视频、图文、作者信息 | 移动端 INIT_STATE 提取 + Cookie 绕过 | 高 |
| 小红书 | 📕 | 图文、视频 | `__INITIAL_STATE__` 嵌入数据 | 高 |
| 微博 | 📱 | 视频、图文 | Mobile API + PC API + HTML 降级 | 低 |
| YouTube | ▶️ | 视频 | oEmbed + Invidious 回退 | 低 |
| 西瓜视频 | 🍉 | 视频 | `_ROUTER_DATA` + SSR 降级 | 中 |
| 好看视频 | 👀 | 视频 | `__PRELOADED_STATE__` 嵌入数据 | 低 |
| 知乎 | 💡 | 视频 | 官方 API v4 | 低 |
| 皮皮虾 | 🦐 | 视频 | h5 API | 低 |
| 全民K歌 | 🎤 | 音频 | HTML 正则提取 | 低 |
| AcFun | 🔴 | 视频 | 官方 API | 低 |

> 📌 **验证状态：** 目前作者仅对 **抖音** 和 **快手** 两个平台进行了实际验证，其余平台（小红书、微博、YouTube 等）的解析代码已编写但**尚未实际测试**。如果你使用了某个平台并发现可用或存在问题，欢迎提交 [Issue](https://github.com/jidanbings/cf-media-parser/issues) 或 [Pull Request](https://github.com/jidanbings/cf-media-parser/pulls) 帮助完善。

### 🔧 核心功能

- **智能识别** — 自动检测链接所属平台，提取标题、作者、封面、内容
- **类型分类** — 自动区分视频、图片、动图、音频四种内容类型
- **高清优先** — 自动选择最高画质（视频 HDR/4K、图片 1080p）
- **批量下载** — 图文内容一键打包 ZIP 下载
- **代理下载** — 服务端中转，绕过 Referer 限制
- **视频流代理** — 支持 Range 请求，进度条拖拽
- **汽水音乐** — 独立接口支持抖音音乐解析

### 🛡️ 安全机制

| 机制 | 说明 |
|------|------|
| **密码保护** | JWT 令牌验证，12 小时有效，仅服务端处理密码 |
| **速率限制** | 3 次错误锁定 1 小时，不透露剩余尝试次数 |
| **后端登录** | 密码通过表单 POST 提交，前端无验证逻辑 |
| **CORS 防护** | 禁止跨域盗用 |
| **SSRF 防护** | URL 白名单验证 |
| **路径遍历防护** | 文件名安全检查 |
| **安全响应头** | 严格 CSP、HSTS、Secure Cookie、X-Frame-Options 等 |
| **登出 CSRF 防护** | 登出仅接受 POST 请求 |

---

## 🚀 快速开始

### 方法一：连接 GitHub 自动部署（推荐）

将本项目 **fork 到你的 GitHub 账号下**，然后关联 Cloudflare Pages，每次推送自动部署。

**操作步骤：**

① **Fork 本项目到你的 GitHub**

- 打开 https://github.com/jidanbings/cf-media-parser
- 点击右上角 **Fork** → **Create fork**
- 这样你就有了自己的仓库：`https://github.com/jidanbings/cf-media-parser`

② **把代码克隆到本地并推送到你的仓库**

```bash
# 克隆你自己的仓库（替换为你的用户名）
git clone https://github.com/jidanbings/cf-media-parser.git
cd cf-media-parser

# 如果你已经克隆了原仓库，改一下 remote 地址
git remote set-url origin https://github.com/jidanbings/cf-media-parser.git
git push -u origin main
```

③ **在 Cloudflare Pages 控制台创建项目**
- 访问 https://dash.cloudflare.com/ → **Workers 和 Pages** → **Pages**
- 点击 **创建** → **Pages** → **连接到 Git**
- 授权 Cloudflare 访问你的 GitHub 账号
- 选择你 fork 的 `cf-media-parser` 仓库

④ **配置构建设置（关键！）**

| 设置项 | 值 |
|--------|-----|
| **项目名称** | `media-parser`（自定义） |
| **生产分支** | `main` |
| **构建命令** | `npm install && npm run build:dist` |
| **构建输出目录** | `dist`（只部署 `dist/` 目录内的文件） |

> 📦 构建命令做了两件事：① 用 esbuild 打包 `src/` → `dist/_worker.js`；② 复制 HTML 文件到 `dist/`。
> 输出目录设为 `dist` 后，`src/`、`docs/`、`package.json` 等源码文件**不会被部署**到 CDN 上，保证安全。

⑤ **点击「保存并部署」**

Cloudflare 会自动拉取代码 → 安装依赖 → 构建 → 部署，分配一个 `https://media-parser-xxx.pages.dev` 域名。

⑥ **以后每次 `git push` 都会自动重新构建部署**，无需手动操作。

---

### 方法二：手动上传部署

#### Step 1 — 本地构建（在你自己电脑上操作）

##### ① 安装 Node.js

确保已安装 [Node.js](https://nodejs.org/) **18 或更高版本**。打开命令行验证：

```bash
node -v
# 输出示例: v18.17.0  （版本号 >= 18 即可）
npm -v
# 输出示例: 9.6.7
```

> ❓ 没有 Node.js？去 https://nodejs.org/ 下载 LTS 版本安装，安装后重新打开命令行。

##### ② 下载项目代码

```bash
# 克隆仓库到本地
git clone https://github.com/jidanbings/cf-media-parser.git

# 进入项目目录
cd cf-media-parser
```

##### ③ 安装依赖

```bash
npm install
```

> 等待执行完成，出现 `added N packages` 字样即成功。如果报错，检查网络或 Node.js 版本。

##### ④ 构建项目

```bash
npm run build:dist
```

> 执行后会在 `dist/` 目录生成以下 6 个部署文件：
> - `dist/_worker.js` — Worker 代码（约 88KB）
> - `dist/index.html`, `dist/video.html`, `dist/music.html`, `dist/option.html` — 页面文件
> - `dist/_routes.json` — 路由配置

---

#### Step 2 — 部署到 Cloudflare Pages（两种方式选一种）

##### 方式 A：通过 Cloudflare 控制台手动上传（推荐新手）

**① 打开 Cloudflare Pages 控制台**
- 访问 https://dash.cloudflare.com/ 并登录
- 左侧菜单点击 **Workers 和 Pages**
- 点击 **Pages** 选项卡

**② 创建项目**
- 点击 **创建** → **Pages** → **直接上传**
- 输入项目名称（如 `media-parser`）
- 点击 **创建项目**（此时还不上传文件）

**③ 配置构建设置（关键！）**

创建项目后，进入项目 → **设置** → **构建**：

| 设置项 | 值 |
|--------|-----|
| 构建命令 | （留空，因为我们已经本地构建好了） |
| 构建输出目录 | `.`（英文句点，表示项目根目录） |

> ⚠️ 也可以先直接上传，Pages 会自动识别输出目录。

**④ 上传文件**

进入项目 → **部署** → **创建部署** → **直接上传**：

需要上传以下 **6 个文件**（都在 `dist/` 目录下）：

| 文件 | 说明 |
|------|------|
| `_worker.js` | ⭐ 核心 Worker 代码（约 88KB） |
| `index.html` | 登录验证页面 |
| `video.html` | 多平台解析下载页面 |
| `music.html` | 汽水音乐页面 |
| `option.html` | 功能选择页面 |
| `_routes.json` | 路由配置，确保所有请求经过 Worker |

> 💡 **快速上传方式**：先执行 `npm run build:dist` 生成 `dist/` 目录，然后把里面的 6 个文件拖到 Cloudflare 上传界面即可。或者执行 `npm run deploy` 复制到 `dash/` 文件夹再上传。

**⑤ 记录你的域名**

部署完成后 Cloudflare 会分配一个域名，例如：
```
https://media-parser-xxx.pages.dev
```

这个域名就是你的工具的访问地址。

##### 方式 B：通过 Wrangler CLI（适合开发者）

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare 账号
npx wrangler login

# 部署
npx wrangler pages deploy . --project-name media-parser
```

---

#### Step 3 — 配置环境变量（必须操作）

进入 Cloudflare Pages 项目 → **设置** → **环境变量** → **生产环境变量**，添加以下两个变量：

| 变量名 | 说明 | 必填 | 示例值 |
|--------|------|:----:|--------|
| `SECRET_KEY` | 访问密码，登录验证时比对 | **是** | `MySecureKey2024!` |
| `JWT_SECRET` | JWT 签名密钥，用于签发 token | **是** | `CItlQ5elmt-rq_7T2D54zsgWz5WB-YT0N51LCn13eBE=` |

⚠️ **两条铁律：**
1. **两个变量都必须配置**，少一个整个工具无法运行
2. 两个变量的值**不要相同**，建议用不同的随机字符串

> 💡 可以用这个命令生成随机密钥：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

配置完成后，点击 **保存**。

---

#### Step 4 — 重新部署使环境变量生效

修改环境变量后需要重新部署才能生效：

- 进入项目 → **部署**
- 找到最新的一条部署记录
- 点击右侧的 **...** → **重试部署**

---

#### Step 5 — 验证部署

打开你的 Pages 域名（如 `https://media-parser-xxx.pages.dev`），应该能看到登录页面：

```
1. 在输入框中输入你设置的 SECRET_KEY
2. 点击登录（或提交）
3. 成功后进入功能选择页
4. 点击「视频解析」进入解析页面
5. 粘贴一个抖音/快手等链接
6. 点击解析 → 成功显示内容信息
```

---

### 常见问题

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| 打开页面显示 500 错误 | `SECRET_KEY` 或 `JWT_SECRET` 未配置 | 去环境变量页面添加，然后重新部署 |
| 输入密码后提示密钥错误 | 输入的密码与 `SECRET_KEY` 不一致 | 检查环境变量中的 `SECRET_KEY` 值 |
| API 返回 403 Forbidden | CORS 跨域拦截 | 确保前端页面通过你的 Pages 域名访问 |
| 解析结果为空或未知 | 平台反爬升级 | 更新代码或提 Issue |

---

## 📖 API 接口

### 登录验证

支持两种提交方式：

**方式一：JSON API**
```http
POST /api/verify
Content-Type: application/json

{"key": "你的密钥"}
```
成功返回 `{ success: true }` + Set-Cookie，失败返回 403/429。

**方式二：HTML 表单（浏览器自动跳转）**
```html
<form action="/api/verify" method="POST">
  <input type="password" name="key">
  <button type="submit">验证</button>
</form>
```
成功 → 302 跳转到 `/option`，失败 → 302 跳转回 `/?error=消息`。

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
    "platformColor": "#333333",
    "title": "视频标题",
    "cover": "https://...",
    "author": "作者昵称",
    "authorId": "作者ID",
    "avatar": "https://...",
    "type": "video | images | gif | mixed",
    "videos": [{ "url": "...", "quality": "高清 HDR" }],
    "images": [{ "url": "...", "index": 1 }],
    "gifs": [{ "url": "...", "index": 1 }],
    "audio": "/api/music?url=...",
    "downloads": [{ "url": "...", "label": "下载视频", "quality": "高清" }]
  }
}
```

### 代理下载

```http
GET /api/download?url=https://xxx&filename=video.mp4
```

### ZIP 打包下载

```http
POST /api/download/zip
Content-Type: application/json

{"files": [{"url": "...", "ext": "jpg", "index": 1}], "ts": "1234567890", "pn": "douyin"}
```

### 视频流代理

```http
GET /api/stream?url=https://xxx
Range: bytes=0-1000000
```

### 汽水音乐解析

```http
GET /api/music?url=https://www.douyin.com/music/xxxxx
```

### 退出登录

```http
POST /api/logout
```
清理登录 Cookie，302 跳转到首页。**仅接受 POST 请求**（防 CSRF）。

---

## 🏗️ 项目结构

```
cf-media-parser/
├── package.json              # 项目配置 + esbuild 构建脚本
├── src/                      # 源代码目录
│   ├── worker.js             # 入口文件（ES Module Worker）
│   ├── config.js             # 常量配置（平台映射、UA池、安全参数）
│   ├── router.js             # 路由分发 + 中间件编排
│   ├── parsers/              # 解析引擎（ParserFactory 模式）
│   │   ├── factory.js        # 工厂：平台检测 → 分发 → 标准化
│   │   ├── base.js           # 共享工具函数
│   │   ├── douyin.js         # 抖音解析器 + a_bogus 签名
│   │   ├── a_bogus.js        # 抖音签名算法（RC4 + SM3）
│   │   ├── kuaishou.js       # 快手解析器
│   │   ├── xiaohongshu.js    # 小红书解析器
│   │   ├── weibo.js          # 微博解析器
│   │   ├── tiktok.js         # TikTok解析器
│   │   ├── youtube.js        # YouTube解析器
│   │   ├── xigua.js          # 西瓜视频解析器
│   │   ├── haokan.js         # 好看视频解析器
│   │   ├── zhihu.js          # 知乎解析器
│   │   ├── pipixia.js        # 皮皮虾解析器
│   │   ├── quanminkge.js     # 全民K歌解析器
│   │   ├── acfun.js          # AcFun解析器
│   │   └── music.js          # 汽水音乐解析器
│   └── utils/                # 工具模块
│       ├── fetcher.js        # HTTP 工具（多 UA 轮换）
│       ├── jwt.js            # JWT 签发与验证（HS256）
│       ├── zip.js            # ZIP 打包（CRC32 实现）
│       ├── security.js       # 速率限制 / SSRF / CSRF / 文件名验证
│       └── response.js       # JSON 响应 / 代理下载 / 流媒体
├── dist/                     # 构建产出目录（npm run build:dist）
│   ├── _worker.js            #   打包后的 Worker 代码
│   ├── index.html            #   登录验证页
│   ├── video.html            #   多平台解析下载页
│   ├── music.html            #   汽水音乐解析页
│   ├── option.html           #   功能选择页
│   └── _routes.json          #   路由配置
├── index.html                # 📄 登录验证页（源文件）
├── video.html                # 📄 多平台解析下载页（源文件）
├── music.html                # 📄 汽水音乐解析页（源文件）
├── option.html               # 📄 功能选择页（源文件）
└── docs/
    └── architecture.md       # 📄 架构文档
```

> 架构设计借鉴自 [ucmao/media-parser](https://github.com/ucmao/media-parser)（Python）的 **ParserFactory 模式**。

---

## 🧠 解析策略

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

## ⚙️ 构建命令详解

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
源代码 (src/ 目录)
    │
    ├── src/worker.js         ← 入口文件
    ├── src/config.js         ← 平台域名、UA池、安全配置
    ├── src/router.js         ← 路由分发 + 中间件
    ├── src/parsers/          ← 解析引擎
    │   ├── factory.js        ← ParserFactory 调度中心
    │   ├── base.js           ← 共享工具函数
    │   ├── douyin.js         ← 抖音解析器
    │   ├── a_bogus.js        ← 抖音签名算法
    │   ├── kuaishou.js       ← 快手解析器
    │   └── ...               ← 共 14 个解析器文件
    └── src/utils/            ← 工具模块
        ├── fetcher.js        ← HTTP 工具
        ├── jwt.js            ← JWT 签发验证
        ├── zip.js            ← ZIP 打包
        ├── security.js       ← 安全防护
        └── response.js       ← 响应处理
            │
            ▼  esbuild --bundle --format=esm
            │
        _worker.js（单文件，可直接上传到 Cloudflare Pages）
```

> `src/` 目录下共有 **23 个源文件**，通过 esbuild 打包为**一个文件** `_worker.js`，方便部署。

---

## 📋 更新日志

### v3.2.1（2026-07-30）— 快手封面修复

**🐛 修复：**
- **快手封面图片无法获取** — 嵌入数据中 `coverUrl` 字段可能为不存在或对象格式，导致封面一直为空
  - 增加 `normalizeUrl()` 类型守卫，兼容对象格式 `{url, width, height}`
  - 嵌入数据提取后始终执行正则兜底，不再短路返回
  - HTML 正则直接搜索快手 CDN（yximgs.com）图片 URL 作为最后保障
- **图片代理优化** — `/api/proxy/image` 根据图片域名自动匹配 Referer（如 yximgs → kuaishou.com）
- **前端封面防盗链** — 封面改为通过 Worker 代理加载，绕过 CDN 防盗链

### v3.2.0（2026-07-30）— B站永久放弃 + 快手优化

**⛔ B站永久放弃支持：**
- 因 B站 WAF 对 Cloudflare Workers 的 TLS 指纹检测返回 412，且所有绕过方案（HTTP/1.1 直连、多代理轮换、页面抓取）均不可靠，本项目**永久放弃对 B站 的支持**
- 删除 `bilibili.js`、`rawFetch.js`（connect() API）及相关配置
- 粘贴 B站 链接直接提示："本项目不支持解析B站链接。B站太恶心了。"

**⚡ 快手优化：**
- **速度提升** — 解析策略从 12 次顺序尝试简化为最多 4 次（原始 URL + Cookie → 手机 UA），大幅减少等待时间
- **封面修复** — 增加 URL 标准化函数 `normalizeUrl()`，修复协议相对路径（`//cdn`）和混合内容导致的封面加载失败

### v3.1.0（2026-07-30）— 快手解析修复

**🐛 修复：**
- **快手解析器重写** — 解决作者名/ID/头像一直为空的问题
  - 发现 `www.kuaishou.com` 对数据中心 IP 返回风控拦截 `{"result":2}`
  - 改用 `v.m.chenzhongtech.com` 移动端 URL 绕过 Cloudflare 出口 IP 风控
  - 从 `window.INIT_STATE` 提取嵌入数据，支持视频和图文内容
  - 作者字段从 GraphQL 的 `user` 调整为 INIT_STATE 的 `photo.userName / userEid / headUrl`
- **多 URL × 多 UA/Header 配置轮换** — 优先使用用户原始输入 URL，逐条尝试直到成功
- 引入**花括号平衡匹配**算法（`extractJsonObject`），精准提取页面内的 JSON 对象

**📝 文档：**
- 架构文档（`docs/architecture.md`）纳入仓库管理
- 更新快手解析策略说明为「移动端 INIT_STATE 提取 + Cookie 绕过风控」

### v3.0.0（2026-07-29）— 架构重构

**🏗️ 架构重构：**
- 单体 `_worker.js`（~2300 行）拆分为模块化架构（`src/` 目录，23 个源文件）
- 引入 **ParserFactory 模式**（借鉴自 [ucmao/media-parser](https://github.com/ucmao/media-parser)）
- 每个平台解析器为独立文件（`src/parsers/*.js`），易于维护和扩展
- 工具层分离：response、jwt、zip、security、fetcher 各司其职
- 新增 esbuild 构建系统（`npm run build` → `_worker.js`）
- 路由层独立（`router.js`），中间件链式编排

**📈 代码质量：**
- `_worker.js` 从 2294 行精简至 ~1880 行
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

---

## ⚠️ 法律声明

本工具仅用于**学习研究**目的。使用时请遵守：

1. **尊重版权** — 下载的内容仅限个人学习使用，不得用于商业用途或二次分发
2. **遵守条款** — 请遵守各平台的服务条款，不得绕过平台的反爬机制进行大规模抓取
3. **频率控制** — 请勿高频调用，避免对平台服务器造成压力
4. **合规使用** — 使用者需自行承担因使用本工具产生的法律责任

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

## 🙏 致谢

- **平台支持** — 感谢 [抖音](https://www.douyin.com/)、[快手](https://www.kuaishou.com/)、[小红书](https://www.xiaohongshu.com/)、[微博](https://weibo.com/)、[TikTok](https://www.tiktok.com/)、[YouTube](https://www.youtube.com/)、[西瓜视频](https://www.ixigua.com/)、[好看视频](https://haokan.baidu.com/)、[知乎](https://www.zhihu.com/)、[皮皮虾](https://pipix.com/)、[全民K歌](https://kg.qq.com/)、[AcFun](https://www.acfun.cn/) 等平台提供的丰富内容生态
- [ucmao/media-parser](https://github.com/ucmao/media-parser) — ParserFactory 架构灵感来源
- [Cloudflare Workers](https://dash.cloudflare.com/) — 强大的边缘计算平台
