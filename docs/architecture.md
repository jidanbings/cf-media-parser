# 多平台媒体解析工具 — 架构文档

基于 Cloudflare Workers + Pages 构建的媒体解析下载工具，支持抖音、快手、哔哩哔哩三个平台的视频、图文、动图与音频内容的智能识别与下载。

**版本：** v5.0.8
**许可证：** MIT
**源码：** [github.com/jidanbings/cf-media-parser](https://github.com/jidanbings/cf-media-parser)

> **v5.0.3** — 修复抖音图文作品解析为空：Feed 接口的 `aid` 会决定返回内容。
>
> **v5.0.2** — 修复抖音 H.265 不能播放、B站失败提示。
>
> **v5.0.0 重大变更** — 平台收敛为**抖音 / 快手 / 哔哩哔哩**三个，各设独立入口页；新增 B站解析；移除 ZIP 打包，图片改为灯箱预览 + 复制直链。详见[更新日志](#更新日志)。

---

## 目录

1. [功能特性](#功能特性)
2. [系统架构](#系统架构)
3. [项目结构](#项目结构)
4. [设计系统](#设计系统)
5. [构建与部署](#构建与部署)
6. [解析引擎架构](#解析引擎架构)
7. [各平台解析策略详解](#各平台解析策略详解)
8. [安全体系](#安全体系)
9. [API 接口](#api-接口)
10. [更新日志](#更新日志)

---

## 功能特性

### 内容类型识别

| 类型 | 识别方式 | 输出 |
|------|---------|------|
| **视频** | 检测 `video` / `mp4` / `m3u8` 等字段 | `videos[]` + 质量标签 |
| **图片** | 检测 `images` / `urls` 等多图数组 | `images[]` + 尺寸分级 |
| **动图** | 检测 `gif` / `webp` + 帧序列特征 | `gifs[]` + 动图标记 |
| **音频** | 检测 `music` / `audio` / `play_url` 等 | `audio` + 格式标记 |

### 核心能力

- **智能识别** — 自动抽取分享文案中的链接，检测平台，提取标题、作者、封面
- **高清优先** — 视频选最高码率（`bit_rate` 最大者），图片选原图
- **直链导出** — 图片灯箱预览 + 一键复制全部直链，视频单文件直接下载
- **视频流代理** — 支持 Range 请求，进度条可拖拽
- **图片代理** — 按媒体域名自动匹配 Referer
- **零配置运行** — 无需任何环境变量

### 安全机制（v4.0.0）

- **SSRF 防护** — 出站代理 URL 校验（协议、端口、内网 IP、云元数据端点）
- **响应头注入防护** — 文件名白名单 + 控制字符过滤 + RFC 5987 编码
- **严格 CSP** — 移除 `script-src 'unsafe-inline'`，改用 per-response nonce
- **速率限制** — 按路由分级的滑动窗口限流
- **同源校验** — 跨站请求拒绝
- **错误信息收敛** — 对外不泄露堆栈与内部细节

---

## 系统架构

### 架构总览（分层视图）

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                       PRESENTATION LAYER                         │
 │                    （表示层 — Cursor 暖纸浅色）                  │
 │                                                                   │
 │    ┌───────────┐    ┌───────────┐    ┌───────────┐               │
 │    │ index.html│    │douyin.html│    │kuaishou   │  bilibili.html │
 │    │  落地页     │    │  功能总览   │    │  解析下载   │               │
 │    └─────┬─────┘    └─────┬─────┘    └─────┬─────┘               │
 │          │                │                │                     │
 │    ┌─────┴────────────────┴────────────────┴─────┐               │
 │    │  assets/warmth.css  +  assets/warmth.js │               │
 │    │  共享设计系统：Token / 组件 / 主题 / 工具函数   │               │
 │    └───────────────────────┬─────────────────────┘               │
 └────────────────────────────┼─────────────────────────────────────┘
                              │ HTTPS（无鉴权，公开访问）
 ┌────────────────────────────┼─────────────────────────────────────┐
 │  ┌─────────────────────────▼──────────────────────────────────┐  │
 │  │                     GATEWAY LAYER                            │  │
 │  │                       （网关层 — Worker 入口）                │  │
 │  │                                                              │  │
 │  │   src/worker.js  ←  ES Module Worker 入口 + 全局错误兜底      │  │
 │  │   src/config.js  ←  全局配置（平台映射、UA池、安全参数）       │  │
 │  │   src/router.js  ←  路由分发 + 中间件编排                     │  │
 │  └────────────────────────┬───────────────────────────────────┘  │
 │                           │                                       │
 │  ┌────────────────────────▼───────────────────────────────────┐  │
 │  │                   MIDDLEWARE CHAIN                           │  │
 │  │                      （中间件链）                             │  │
 │  │                                                              │  │
 │  │   同源校验 → 方法白名单 → 速率限制 → 路由分发                 │  │
 │  │                                                              │  │
 │  │    ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   │  │
 │  │    │ Origin  │ → │ GET/HEAD│ → │ 限流器   │ → │ 分发器   │   │  │
 │  │    │ 同源比对 │   │ POST    │   │ 路径分级 │   │ API/页面 │   │  │
 │  │    └─────────┘   └─────────┘   └─────────┘   └─────────┘   │  │
 │  └────────────────────────┬───────────────────────────────────┘  │
 │                           │                                       │
 │           ┌───────────────┴───────────────┐                       │
 │           ▼                               ▼                       │
 │  ┌──────────────────┐        ┌──────────────────────┐             │
 │  │   UTILITY LAYER   │        │    PARSER ENGINE      │             │
 │  │   （工具层）       │        │     （解析引擎）       │             │
 │  │                   │        │                      │             │
 │  │  ┌─────────────┐  │        │  ┌────────────────┐  │             │
 │  │  │ security.js │  │        │  │   factory.js   │  │             │
 │  │  │ 限流/SSRF/   │  │        │  │  ParserFactory │  │             │
 │  │  │ 文件名校验   │  │        │  └────────┬───────┘  │             │
 │  │  └─────────────┘  │        │           │           │             │
 │  │  ┌─────────────┐  │        │  ┌────────▼───────┐  │             │
 │  │  │ response.js │  │        │  │    base.js     │  │             │
 │  │  │ 响应/安全头/  │  │        │  │  共享工具函数    │  │             │
 │  │  │ 代理下载     │  │        │  └────────┬───────┘  │             │
 │  │  └─────────────┘  │        │           │           │             │
 │  │                   │        │  ┌────────▼───────┐  │             │
 │  │                   │        │  │  douyin.js     │  │             │
 │  │                   │        │  │  kuaishou.js   │  │             │
 │  │                   │        │  │  bilibili.js   │  │             │
 │  │                   │        │  │  a_bogus.js    │  │             │
 │  │                   │        │  └────────────────┘  │             │
 │  └──────────────────┘        └──────────────────────┘             │
 │      构建管道: esbuild --bundle --format=esm → dist/_worker.js    │
 └───────────────────────────────────────────────────────────────────┘
```

### 请求处理流程

```
 ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
 │ 客户端请求 │ ──> │ 同源校验  │ ──> │ 方法白名单 │ ──> │ 速率限制  │
 │          │     │  Origin  │     │ GET/HEAD │     │ 路径分级  │
 └──────────┘     └──────────┘     │   POST   │     └────┬─────┘
                                   └──────────┘          │
                                              ┌──────────┴──────────┐
                                              │                     │
                                         ┌────▼────┐          ┌─────▼─────┐
                                         │ 页面路由  │          │  API 路由  │
                                         │ + nonce  │          │  分发      │
                                         └─────────┘          └─────┬─────┘
                                                                    │
                           ┌────────────────────────────────────────┼──────┐
                           │            API 路由表                   │      │
                           │                                        │      │
                           │  GET|POST /api/parse ── detectPlatform        │
                           │                          └─ parser(url)       │
                           │                          └─ 标准化结果 + 缓存  │
                           │  GET /api/media      ── 代理下载 / 流式播放     │
                           │      ├ mode=download ── attachment 附件        │
                           │      └ mode=stream   ── 内联播放 (Range 透传)   │
                           │  GET /api/proxy/image ── 图片代理         │
                           │  GET /api/stream     ── 视频流代理 (mode=stream)│
                           │  GET /api/health     ── 健康检查               │
                           └───────────────────────────────────────────────┘
```

### 数据流：一次完整的内容解析

```
 用户          Worker         目标平台         浏览器
  │              │               │               │
  ├─ GET /api/parse?url=... ─────┤               │
  │              │               │               │
  │              ├─ detectPlatform(url)          │
  │              │   → "抖音"     │               │
  │              │               │               │
  │              ├─ parseMedia(url)              │
  │              │   → 短链解析 → 分发解析器       │
  │              │               │               │
  │              ├─── fetch(官方API) ────────────►│
  │              │               │               │
  │              ◄─── JSON ──────────────────────┤
  │              │    {video,images,author}      │
  │              │               │               │
  │              ├─ buildResult() → 标准化         │
  │              ├─ setParseCache() → 缓存 5 分钟   │
  │              │               │               │
  │  ◄─ JSON ────┤               │               │
  │  {success,data}              │               │
  │              │               │               │
  │  (用户点下载) │               │               │
  │              │               │               │
  ├─ GET /api/media?url=... ─────┤               │
  │              │               │               │
  │              ├─ validateProxyUrl() → SSRF 校验 │
  │              ├─ 按域名匹配 Referer             │
  │              ├─── fetch(媒体文件) ───────────►│
  │              │               │               │
  │              ├─ 流式转发（Content-Disposition 安全编码）
  │  ◄─ stream ──┤               │               │
```

---

## 项目结构

```
cf-media-parser-main/
│
├── package.json                # 项目配置 + esbuild 构建脚本
├── _routes.json                # Pages 路由配置（所有请求经 Worker）
│
├── src/                        # 【源代码目录】
│   ├── worker.js               #   入口文件（ES Module Worker + 全局兜底）
│   ├── config.js               #   常量配置（平台映射、UA池、限流规则、CSP）
│   ├── router.js               #   路由分发 + 中间件编排 + 页面 nonce 注入
│   │
│   ├── parsers/                #   【解析引擎】ParserFactory 模式（三平台）
│   │   ├── factory.js          #     工厂：平台检测 → 短链解析 → 分发 → 标准化
│   │   ├── base.js             #     共享工具函数（extractJson, buildResult）
│   │   ├── douyin.js           #     抖音（移动端 Feed / SSR / Web API）
│   │   ├── kuaishou.js         #     快手（多路由 + GraphQL 兜底）
│   │   ├── bilibili.js         #     哔哩哔哩（双 API + html5 单文件流）
│   │   └── a_bogus.js          #     抖音签名算法（RC4 + SM3）
│   │
│   └── utils/                  #   【工具层】
│       ├── security.js         #     限流 / SSRF / 文件名校验 / 解析缓存
│       └── response.js         #     JSON / 安全头 / 代理下载与流媒体
│
│   # 注：v5.0.0 收敛为三平台后，曾保留 11 个「已废弃」解析器 stub 与
│   #     src/utils/jwt.js（登录鉴权时代的遗留），v5.0.8 已全部删除。
│
├── assets/                     # 【设计系统】全站共享
│   ├── warmth.css            #   Cursor-Light-Warmth Token + 组件样式（19 KB）
│   └── warmth.js             #   主题 / 手风琴 / Toast / 平台检测（6 KB）
│
├── scripts/                    # 【构建脚本】
│   ├── copy-dist.mjs           #   复制部署产物到 dist/ 或同步到 dash/
│   └── check.mjs               #   静态自检（语法、残留引用、CSP）
│
├── index.html                  # 📄 首页 — 三平台入口卡片
├── douyin.html                 # 📄 抖音解析页
├── kuaishou.html               # 📄 快手解析页
├── bilibili.html               # 📄 哔哩哔哩解析页
│
├── dist/                       # 【构建产出】npm run build:dist
│   ├── _worker.js              #   打包后的 Worker 代码（约 85 KB）
│   ├── index.html              #   首页（三平台入口）
│   ├── douyin.html             #   抖音解析页
│   ├── kuaishou.html           #   快手解析页
│   ├── bilibili.html           #   哔哩哔哩解析页
│   ├── _routes.json            #   路由配置
│   └── assets/                 #   前端资源
│       ├── warmth.css
│       ├── warmth.js
│       ├── parse.css
│       └── parse.js
│
└── docs/
    └── architecture.md         # 📄 架构文档（本文档）
```

> `src/` 目录下参与打包的源文件通过 esbuild 打包为 1 个文件 `dist/_worker.js`。

---

## 设计系统

v4.1.0 起，全站前端统一采用 **Cursor-Light-Warmth（暖纸浅色）**。设计规范集中在 `assets/warmth.css`，所有页面共用同一套 Token 与组件类。

### 设计理念

把开发者工具当作"被认真策展的作品"来呈现。页面几乎不使用色彩——一切情绪交给暖纸白与墨黑的温度差、古典油画的艺术史联想、以及近乎奢侈的留白。结构上信奉"一屏一事"：每个区块只承担一个论点，靠垂直节奏而非视觉轰炸推进叙事。所有交互元素收敛为两种形态：黑色胶囊（行动）与文字链接（导航），拒绝按钮泛滥。

### 色彩 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg` | `#F7F7F4` | 暖纸白 — 页面主背景、固定 Header |
| `--surface` | `#F2F1ED` | 媒体舞台底板、Footer |
| `--surface-deep` | `#E6E5E0` | 更深的内嵌面板、悬停底色 |
| `--ink` | `#26251E` | 暖墨色 — 正文、标题、主按钮底色 |
| `--ink-invert` | `#F7F7F4` | 墨底按钮上的文字 |
| `--ink-muted` | `rgba(38,37,30,.55)` | 标题第二行、副文案、页脚列标题 |
| `--accent` | `#C8451D` | 朱砂橙 — **仅用于文字链接** |
| `--border` | `rgba(38,37,30,.2)` | 描边按钮、分隔线 |
| `--border-hairline` | `rgba(38,37,30,.025)` | 卡片极淡分界，近隐形 |
| `--card-white` | `#FFFFFF` | 产品窗口模型、输入框 |
| `--success` / `--error` | `#3F7A46` / `#B0413E` | diff 增删、状态点 |

**三层纸底色分区**：`#F7F7F4 → #F2F1ED → #E6E5E0`。不用边框线切分区块，靠明度阶梯叠出层次——页脚即"最下面那张纸"。

**用色规则**：暖纸白 × 暖墨黑占 98% 视觉面积；朱砂橙是全站唯一彩色，仅用于文字链接且每屏 ≤1 处；禁止纯黑 `#000000`（太冷硬）与蓝紫渐变、玻璃拟态。

### 字体系统

**全部使用系统字体栈，不依赖任何外部字体服务**（离线可用，无需 CSP 放行外源）：

| 用途 | 字族 |
|------|------|
| 标题 / 正文 / 按钮 | `-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", Roboto, sans-serif` |
| 衬线斜体点缀 | `"Iowan Old Style", "Palatino Linotype", Palatino, "Songti SC", Georgia, serif` |
| 代码 / diff / 徽章 | `ui-monospace, SFMono-Regular, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace` |

**字号阶梯**（流式缩放）：

| 元素 | 尺寸 | 字重 | 字距 |
|------|------|------|------|
| Final CTA | `clamp(40px, 6vw, 72px)` | 400 | `-2px` |
| Hero 标题 | `clamp(28px, 3.6vw, 40px)` | 400 | `-.72px` |
| 区块标题 | `clamp(23px, 2.6vw, 32px)` | 400 | `-.325px` |
| 正文 | `16px` | 400 | normal |
| 徽章 | `11px` | 400 | `.04em` |

> **标题越大越不加重**：Final CTA 72px 仍用字重 400 + 负字距，以"轻声说大事"对抗营销噪音。

### 标志性元素（签名元素）

这七项构成 Cursor-Light-Warmth 的识别度：

1. **油画策展舞台** — 功能展示从不裸放，而是"挂"在浪漫主义风景油画上：`background-image` 油画 + 绝对定位白色窗口错位叠放（8–24px），配细画框
2. **字重 400 的巨型标题** — 见上
3. **双色同阶标题** — `.two-tone` 两行同字号同字重，第一行墨色、第二行 55% 透明度墨色，用色彩层级替代字号层级
4. **单点朱砂** — `.link-accent` 全站唯一彩色，配 `→` 箭头悬停右移 2px
5. **三层纸底色分区** — 见上
6. **无偏移弥散阴影** — `--shadow-float: rgba(0,0,0,.02) 0 0 16px, rgba(0,0,0,.008) 0 0 8px`，零偏移纯弥散，只负责"离开纸面 1 毫米"
7. **代码即装饰** — diff 数字、`~/downloads` 路径、等宽徽章直接作为版面元素

### 组件类速查

| 类名 | 用途 |
|------|------|
| `.container` / `.container-narrow` | 内容宽度（1300 / 760px） |
| `.section` / `.section-hero` | 标准区块 / 首屏区块间距 |
| `.band` / `.band-deep` | 三层纸底色的中/深档 |
| `.two-tone` + `.l1` / `.l2` | 双色同阶标题 |
| `.link-accent` + `.arrow` | 朱砂橙文字链接 |
| `.badge` / `.badge.pill` | 等宽徽章（4px / 胶囊） |
| `.dot` + `.ok` / `.warn` / `.live` | 状态点（`.live` 带脉冲） |
| `.diff-add` / `.diff-del` | diff 增删数字 |
| `.btn` + `.btn-primary` / `.btn-subtle` / `.btn-outline` / `.btn-text` | 按钮四层级 |
| `.site-header` / `.nav-center` / `.mobile-nav` | 固定顶栏 / 居中导航 / 移动抽屉 |
| `.stage` / `.stage-canvas` / `.stage-frame` | 油画媒体舞台 / 画布 / 细画框 |
| `.window` / `.window-bar` / `.window-body` | 白色产品窗口模型（红绿灯标题栏） |
| `.split` / `.split.reverse` | 交替媒体分栏 |
| `.logo-garden` | 灰度客户 logo 横排 |
| `.input` / `.field-label` / `.input-shell` | 胶囊输入框 |
| `.modal-overlay` / `.modal` | 模态框 |
| `.toast` | 轻提示 |
| `.notice` + `.notice-error` | 空态 / 错误提示 |
| `.theme-group` | 主题切换胶囊组 |
| `.reveal` | IntersectionObserver 入场动画钩子 |

### 圆角策略：全或无

交互件一律全圆角胶囊（`--r-pill: 9999px`），展示面（媒体舞台、窗口模型、图片、模态框）一律 4px 小圆角（`--r-face`）。**不存在 8/12/16px 的中间态。**

### 交互与动效

**运动哲学：微不可察。** 动画只服务于"出现"，幅度以 2–8px 位移、0.7–1 缩放为限，绝不弹跳、绝不循环抢戏。

| 场景 | 时长 / 曲线 |
|------|------------|
| 标准过渡 | `transform/opacity 140ms cubic-bezier(.25,1,.5,1)` |
| 入场 `fadeSlideUp` | `opacity 0→1; translateY(2px→0)` |
| 悬停 | 箭头 `translateX(2px)`、卡片 `scale(.99)` 微沉 |
| 主按钮悬停 | 背景提亮至 `#3A382F` |
| 主按钮激活 | `translateY(1px)` |

关键帧：`fadeSlideUp`、`tilePopIn`、`pulseSoft`（仅状态指示类持续动画，页面主体无自动轮播）。

### 主题切换

默认浅色。`assets/warmth.js` 读取 `localStorage['warmth-theme']`（`light` / `dark` / `system`），深色模式将三层纸底换成 `#1A1915` 系、墨色反转为纸色，胶囊体系不变。页脚提供三枚小圆钮切换，`system` 模式实时响应系统偏好变化。

### 事件系统（重要）

**CSP 的 `script-src`（含 nonce）不覆盖 inline 事件属性。** `onclick="foo()"` 会被浏览器静默阻断，表现为"点了没反应"。

因此全站**禁用 inline 事件属性**，统一使用 `data-action` + 事件委托：

```html
<!-- 正确 -->
<button data-action="parse">解析</button>
```
```javascript
// 注册（页面级）
Warmth.on('parse', myParseHandler);

// 核心动作注册在 assets/warmth.js：
//   set-theme, toggle-nav
```

委托监听器挂在 `document` 上，因此**动态生成的 DOM（如解析结果卡片）无需重新绑定**即可响应。

`npm run check` 的 `[2b]` 组会自动校验：页面无 inline 事件属性，且每个 `data-action` 都有对应处理函数。

### 可访问性

- 墨色对暖纸白对比度约 **14:1**（AAA）；55% 灰字约 **5.8:1**（AA）；朱砂橙约 **5.5:1**，仅限 ≥14px 链接使用
- 聚焦态：`2px` 墨色 outline + `2px` offset，不依赖阴影；胶囊按钮聚焦环同为胶囊形
- 触控目标：胶囊按钮 ≥36px 高、水平内边距 ≥16px；导航链接点击区扩展至 44px
- 语义化标签：`<header>` / `<nav>` / `<main>` / `<footer>` / `<section>`
- 装饰元素一律 `aria-hidden="true"`
- FAQ 使用 `aria-expanded` + `aria-controls`；模态框使用 `role="dialog"` + `aria-modal`
- `prefers-reduced-motion: reduce` 时入场动画降级为纯 opacity、脉冲类动画完全停止

---

## 构建与部署

### 构建命令

| 命令 | 说明 | 产物 |
|------|------|------|
| `npm run build` | 打包 Worker | `dist/_worker.js`（约 85 KB） |
| `npm run build:minify` | 压缩构建 | `dist/_worker.js` |
| `npm run copy:dist` | 复制静态资源到 `dist/` | `dist/` 内 10 个文件 |
| `npm run build:dist` | **完整构建**（build + copy） | 完整部署包 |
| `npm run dev` | 监听模式 | 源码变化自动重建 |
| `npm run deploy` | 构建 + 同步到 `dash/` | `dash/` 内 10 个文件 |
| `npm run check` | 静态自检 | 语法 / 残留引用 / CSP |

### 构建流程

```
源代码 (src/)                        构建产物 (dist/)
                          │
  src/worker.js  ─────────┤
  src/router.js  ─────────┤
  src/config.js  ─────────┤── esbuild --bundle --format=esm ──→ dist/_worker.js
  src/parsers/   ─────────┤
  │   ├── factory.js      │      ── 12 个源文件打包为 1 个文件
  │   ├── base.js         │
  │   ├── douyin.js       │              +  scripts/copy-dist.mjs
  │   └── a_bogus.js      │                       │
  └── src/utils/          │                       ▼
      ├── security.js     │              ┌────────────────────┐
      └── response.js     │              │  dist/             │
                          │              │  ├─ _worker.js     │
                          │              │  ├─ index.html     │
                          │              │  ├─ douyin.html    │
  静态资源 ────────────────┤              │  ├─ kuaishou.html  │
  index/douyin/kuaishou/  │              │  ├─ bilibili.html  │
  bilibili.html           │              │  ├─ _routes.json   │
  assets/*                │              │  └─ assets/        │
                          │              └────────────────────┘
                          │                       │
                          ▼                       ▼
                   Worker 单文件            部署 Cloudflare Pages
                   (~85 KB)                （只部署 dist/ 内容）
```

> Cloudflare Pages 只部署 `dist/` 目录，`src/`、`docs/`、`package.json`、`scripts/` 等源码文件**不会暴露**到 CDN。

### 部署产物清单（10 个文件）

| 文件 | 大小 | 说明 |
|------|------|------|
| `_worker.js` | ~85 KB | ⭐ 核心 Worker — 全部后端逻辑 |
| `_routes.json` | <1 KB | 路由配置，确保所有请求经过 Worker |
| `index.html` | ~25 KB | 首页（三平台入口卡片） |
| `douyin.html` | ~8 KB | 抖音解析页 |
| `kuaishou.html` | ~8 KB | 快手解析页 |
| `bilibili.html` | ~8 KB | 哔哩哔哩解析页 |
| `assets/warmth.css` | ~23 KB | 设计系统样式 |
| `assets/warmth.js` | ~8 KB | 公共脚本（主题 / 导航 / 事件委托） |
| `assets/parse.css` | ~11 KB | 解析页样式（灯箱 / 网格 / 播放器） |
| `assets/parse.js` | ~21 KB | 解析页逻辑（复制 / 预览 / 播放） |

### 方式一：连接 GitHub 自动部署（推荐）

**① Fork 仓库** → 得到你自己的副本

**② 在 Cloudflare Pages 创建项目**
- 访问 https://dash.cloudflare.com/ → **Workers 和 Pages** → **Pages**
- 点击 **创建** → **Pages** → **连接到 Git**
- 授权 GitHub，选择你 fork 的仓库

**③ 配置构建参数**

| 设置项 | 值 |
|--------|-----|
| 项目名称 | `media-parser`（可自定义） |
| 生产分支 | `main` |
| 构建命令 | `npm install && npm run build:dist` |
| 构建输出目录 | `dist` |

**④ 保存并部署**

> **无需配置任何环境变量。** v4.0.0 已移除 `SECRET_KEY` 与 `JWT_SECRET` 依赖。

以后每次 `git push`，Cloudflare 会自动重新构建部署。

### 方式二：手动上传

```bash
npm install
npm run build:dist        # 生成 dist/
npm run deploy            # 也可同步到 ../dash/
```

进入 Cloudflare Pages 项目 → **部署** → **创建部署** → **直接上传**，将 `dist/` 中的 **10 个文件**（含 `assets/` 目录）全选拖入上传区。

> ⚠️ `assets/` 目录必须一并上传，否则页面样式与脚本将 404。

### 方式三：Wrangler CLI

```bash
npm install -g wrangler
npx wrangler login
npx wrangler pages deploy dist --project-name media-parser
```

### 环境变量

**无需任何环境变量。** 这是 v4.0.0 相对旧版本最显著的部署简化。

若确需限制访问，**不要**重新在 Worker 内实现密码 + Cookie 方案（旧方案存在 UA 绑定脆弱、无会话吊销等问题），推荐使用 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)（Zero Trust），在边缘层完成身份验证。

---

## 解析引擎架构

### ParserFactory 模式

使用函数式注册表而非 class 继承：

```javascript
// src/parsers/factory.js
const PARSER_REGISTRY = {
  '抖音':       parseDouyin,
  '快手':       parseKuaishou,
  '哔哩哔哩':   parseBilibili
};

async function parseMedia(url) {
  // 1. 短链解析（v.douyin.com / v.kuaishou.com / b23.tv 等）
  const resolvedUrl = await resolveRedirectUrl(url);

  // 2. 短链解析出新平台则直接用新 URL 分发
  if (resolvedUrl !== url) {
    const newPlatform = detectPlatform(resolvedUrl);
    if (newPlatform && PARSER_REGISTRY[newPlatform]) {
      return runParser(PARSER_REGISTRY[newPlatform], resolvedUrl, newPlatform, env);
    }
  }

  // 3. 平台检测 → 分发解析器（抖音 / 快手 / 哔哩哔哩 三平台）
  const platform = detectPlatform(url);
  const parser = PARSER_REGISTRY[platform];

  // 4. 执行 + 附加平台图标与主题色
  return runParser(parser, url, platform, env);
}
```

### 统一结果格式

所有解析器返回一致的数据结构：

```javascript
{
  success: true,
  data: {
    platform: "抖音",            // 由 factory.js 统一附加
    platformIcon: "🎵",          // 由 factory.js 统一附加
    platformColor: "#333333",    // 由 factory.js 统一附加
    title: "视频标题",
    cover: "https://封面URL",
    author: "作者昵称",
    authorId: "作者ID",
    avatar: "https://头像URL",
    type: "video | images | gif | audio | mixed | video_images | video_gif | gif_images",
    videos: [{ url: "https://...", quality: "高清" }],
    images: [{ url: "https://...", index: 1 }],
    gifs:   [{ url: "https://...", index: 1 }],
    audio:  "https://...",
    downloads: [{ url: "...", label: "下载视频", quality: "高清" }]
  }
}
```

### 共享工具函数（`base.js`）

| 函数 | 作用 |
|------|------|
| `extractJsonObject(text, startPos)` | 花括号平衡匹配提取完整 JSON 对象 |
| `ensureHttps(url)` | 统一 `http://` 升级、还原 JSON 转义斜杠 |
| `createEmptyResult(platform)` | 创建空结果模板（统一字段） |
| `buildResult(info)` | 填充 `downloads`、判定 `type`、兜底 `cover` |

### `buildResult()` 的类型判定

```
hasVideo && hasGif && hasImage  →  mixed
hasVideo && hasGif              →  video_gif
hasVideo && hasImage            →  video_images
hasGif   && hasImage            →  gif_images
hasVideo                        →  video
hasGif                          →  gif
hasImage                        →  images
（皆无）                          →  mixed
```

---

## 各平台解析策略详解

> **v5.0.0 起本项目仅支持三个平台**：抖音 / 快手 / 哔哩哔哩，各自设独立入口页（`/douyin`、`/kuaishou`、`/bilibili`）。
>
> 早期版本曾支持 12 个平台，现已下线。对应解析器文件保留为废弃声明（不参与打包），如需恢复可从 git 历史找回。

### 解析方式总览

| 平台 | 入口 | 解析方式 | 需要 Cookie |
|------|------|---------|:----------:|
| **抖音** | `/douyin` | 移动端接口 + 分享页 SSR + Web API | 否 |
| **快手** | `/kuaishou` | 多路由降级 + `visionVideoDetail` GraphQL 兜底 | 建议 |
| **哔哩哔哩** | `/bilibili` | 官方双 API + `platform=html5` 单文件流 | 否 |

### 解析器健壮性设计

各解析器遵循以下通用约定：

**1. 花括号平衡匹配优先于正则**

`base.js` 提供 `extractJsonObject(text, startPos)`，通过跟踪字符串状态与嵌套深度提取完整 JSON，正确处理字符串内的花括号与转义。

**2. 码率/分辨率排序选优**

凡有多个媒体流，一律排序后取最优：H.264 优先 → 分辨率 → 码率 → 体积。

**3. 高清原图**

视频取 `/play/` 端点并升清至 1080p；图集取 `url_list` 末项作为原图。

**4. 统一协议与转义处理**

`ensureHttps()` 统一处理 JSON 转义斜杠、协议相对地址与 `http://` 升级。

**5. `buildResult()` 保留已有 downloads**

先保留解析器自行添加的下载项，再追加视频/图片下载项，避免丢弃音频等额外下载。

**6. 终端状态短路**

平台对「已删除 / 私密」的作品会返回业务错误码，命中即终止，避免无谓重试。

**7. 可选 Cookie 环境变量**

均为可选，不配置也能解析常规内容：

| 变量 | 平台 | 作用 |
|------|------|------|
| `DOUYIN_COOKIE` | 抖音 | 提升图文实况成功率 |
| `KUAISHOU_COOKIE` | 快手 | 提升解析成功率 |
| `BILIBILI_COOKIE` | 哔哩哔哩 | 提升解析成功率 |

### 抖音（`douyin.js` + `a_bogus.js`）

多接口容灾：依据内容类型选择不同主路径，各自独立降级。

```
常规视频 ── ① 移动端 Feed API（主路径）
           ├─ ② 移动端分享页 SSR
           └─ ③ PC Web 详情 API

图文/实况 ── ① PC Web 详情 API
            └─ ② 移动端分享页 SSR
```

**画质仲裁规则**：H.264 优先 → 分辨率 → 码率 → 体积。当 `bit_rate` 全为 H.265 时改用 H.264 单流。

**图文 / 动图 / 实况分类**：图文作品下每个 `images[i]` 由 `live_photo_type` 区分——`1` 为动图（归 `gifs`），`0` 且有 `video` 为实况照片（归 `videos`）。

### 快手（`kuaishou.js`）

页面嵌入数据提取：依次请求原始 URL 与构造 URL，优先 `__APOLLO_STATE__`，其次 `INIT_STATE`，花括号平衡匹配提取 JSON。

**三类作品区分**（用字段而非 URL 区分）：

| 类型 | `mainMvUrls` | `atlas.list` | 媒体来源 |
|------|:---:|:---:|------|
| 视频 | 有值 | 无 | `mainMvUrls[0]` |
| 图文/图集 | 空 | 有 | `atlas.list` |
| 单图 | 空 | 无 | `coverUrls` |

### 哔哩哔哩（`bilibili.js`）

双 API 联动：

```
① 详情 ── 常规视频：x/web-interface/view?bvid=BVxxx
          └─ 番剧：pgc/view/web/season?ep_id=xxx
② 播放 ── 常规视频：x/player/playurl?...&platform=html5
          └─ 番剧：pgc/player/web/playurl?...&ep_id=xxx
```

**要点**：`platform=html5` 返回音视频合一的单文件 MP4；播放/下载请求附带正确的 Referer；失败时返回明确错误信息。

**画质代码映射**：

| qn | 标签 |
|----|------|
| 112 | 1080P+ |
| 80 | 1080P |
| 64 | 720P |
| 32 | 480P |
| 16 | 360P |

**多 P 处理**：常规视频取 `pages[]`，优先第一 P 作为主视频，其余作为可选分段在前端切换。

---

## 安全体系

v4.0.0 移除了登录鉴权，安全模型从「身份认证」转为「接口加固 + 资源约束」。以下为当前的安全措施。

### 1. SSRF 防护

所有出站代理（`/api/media` 的下载与流式模式、`/api/stream`、`/api/proxy/image`）的 URL 均经 `validateProxyUrl()` 校验：

| 检查项 | 规则 |
|--------|------|
| 协议 | 仅 `http:` / `https:` |
| 认证信息 | 拒绝 URL 内嵌用户名/密码 |
| 端口 | 仅允许 `80` / `443` 或缺省 |
| 主机名 | 拒绝 `localhost`、`*.localhost`、`*.local`、`*.internal`、`*.home.arpa` |
| IPv4 | 拒绝 `0/8`、`10/8`、`127/8`、`169.254/16`、`172.16/12`、`192.168/16`、`100.64/10`、`≥224` |
| IPv6 | 拒绝 `::1`、`::`、`fe80::/10`、`fc00::/7`，以及 IPv4-mapped 形式 |
| 黑名单 | 云元数据端点（`metadata.google.internal`、`169.254.169.254`、`100.100.100.200`） |

### 2. 响应头注入（CRLF / XSS）防护

旧版本直接将查询参数 `filename` 拼入 `Content-Disposition`，攻击者可构造：

```
/api/media?url=...&filename=x.mp4";<script>alert(1)</script>
```

导致响应头被截断、注入脚本。

**修复措施**：
- `validateFilename()` 拒绝控制字符（`\x00-\x1f\x7f`）与 `" < > | ? * : \ / ..`
- 扩展名白名单：`.mp4 .mp3 .m4a .aac .jpg .jpeg .png .webp .gif`
- `sanitizeFilename()` 在失败时回退到安全默认值
- 输出使用 RFC 5987 双写，ASCII 回退串过滤非可打印字符：
  ```
  attachment; filename="safe_fallback.mp4"; filename*=UTF-8''<percent-encoded>
  ```

### 3. 内容安全策略（CSP）

v4.0.0 起 `script-src` **移除 `'unsafe-inline'`**，改为每响应生成 nonce：

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-<每响应随机> https://cdnjs.cloudflare.com https://static.cloudflareinsights.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src * data: blob:;
  connect-src 'self';
  media-src 'self' blob:;
  font-src 'self' data: https://fonts.gstatic.com;
  frame-src 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
```

实现方式：`servePage()` 读取 HTML 后，将内联 `<script>` 标签注入 `nonce` 属性，再由 `addSecurityHeaders(response, nonce)` 把同一 nonce 写入 CSP 头。

> `style-src` 仍保留 `'unsafe-inline'`：页面使用大量内联 `<style>` 与 `element.style` 赋值，改用 nonce 需重构全部样式注入，收益与成本不成比例。

**其他安全响应头**：

| 响应头 | 值 |
|--------|-----|
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |

### 4. 速率限制

滑动窗口限流，按路径前缀匹配第一条规则：

| 路径前缀 | 上限 | 窗口 |
|---------|------|------|
| `/api/parse` | 20 次 | 60 秒 |
| `/api/proxy/image` | 120 次 | 60 秒 |
| `/api/proxy/image` | 120 次 | 60 秒 |
| `/api/stream` | 60 次 | 60 秒 |
| `/api/download` | 60 次 | 60 秒 |
| `/api/media` | 60 次 | 60 秒 |

```javascript
// 基于 IP + 路径前缀的内存计数器
const RATE_MAP_MAX_ENTRIES = 500;   // 容量上限，超出时淘汰最旧条目
const CLEANUP_INTERVAL = 900;       // 每 15 分钟清理过期窗口
```

超限返回 `429` 并带 `Retry-After` 头。

### 5. 同源校验

```javascript
const origin = request.headers.get('Origin') || '';
if (origin && new URL(origin).hostname !== url.hostname) {
  return new Response('Forbidden', { status: 403 });
}
```

- 本站页面内请求：Origin = 本站 → 放行
- 浏览器直接访问：无 Origin 头 → 放行
- 其他网站 AJAX 调用：Origin ≠ 本站 → 403

### 6. 方法白名单

仅允许 `GET` / `HEAD` / `POST` / `OPTIONS`，其余返回 `405`。

### 7. 错误信息收敛

全局兜底不再回显堆栈与错误类名：

```javascript
catch (err) {
  console.error('未捕获异常:', err.stack);  // 仅 Worker 日志
  return new Response(JSON.stringify({
    error: '服务内部错误，请稍后重试',
    code: 'INTERNAL_ERROR'
  }), { status: 500, ... });
}
```

### 8. 输入长度限制

`/api/parse` 的 `url` 参数上限 2048 字符。

### 9. 解析缓存

按 URL 缓存解析结果 5 分钟，容量上限 50 条，超出淘汰最旧，用于减少对上游平台的重复请求。

> **缓存键**：`/api/parse` 使用 `parse|<url>` 作为键。平台收敛后不再有 `/api/music`，缓存表只服务单一入口。

---

## API 接口

所有接口**无需鉴权**，但受速率限制与同源校验约束。

### `GET|POST /api/parse` — 多平台统一解析

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `url` | string | 是 | 任意平台分享链接（GET 参数或 POST JSON body） |

**支持平台**：抖音、快手、小红书、微博、TikTok、YouTube、西瓜视频、好看视频、知乎、皮皮虾、全民K歌、AcFun（共 12 个）

**响应**：见[统一结果格式](#统一结果格式)

### `GET|HEAD /api/media` — 统一媒体代理

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `url` | string | 是 | 媒体原始 URL |
| `filename` | string | 否 | 下载文件名（受白名单校验） |
| `mode` | string | 否 | `download`（默认）/ `stream` |

`mode=stream` 时透传 `Range` 头，支持视频拖拽。`HEAD` 请求用于获取文件大小。

### `GET /api/download` — 代理下载（兼容别名）

参数同 `/api/media`，等价于 `mode=download`。

### `GET /api/stream` — 视频流媒体（兼容别名）

参数同 `/api/media`，等价于 `mode=stream`。

### `POST /api/download/zip` — ~~ZIP 打包下载~~（v5.0.0 已移除）

前端改用「复制直链」后此接口已无调用方，为避免留下未鉴权的批量抓取入口，
`src/utils/zip.js` 与路由一并删除。`/api/media` 的下载模式已覆盖单文件下载需求。

### `GET /api/proxy/image` — 图片代理

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 图片 URL |

按域名自动匹配 Referer；非 `image/*` 响应返回 `415`。

### `GET /api/music` — 汽水音乐解析

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 汽水音乐分享链接 |

### `GET /api/health` — 健康检查

```json
{ "success": true, "data": { "status": "ok", "version": "4.0.0" } }
```

### 已移除的接口（v4.0.0）

| 接口 | 原用途 | 移除原因 |
|------|--------|---------|
| `POST /api/verify` | 密码校验签发 JWT | 移除登录体系 |
| `POST /api/logout` | 清除登录 Cookie | 移除登录体系 |
| `GET /admin/*` | 下载 / 流媒体 / 信息 | 合并为 `/api/media` 与 `/api/health` |

---

## 更新日志

完整的版本变更历史已独立到 [CHANGELOG.md](../CHANGELOG.md)，本文件不再重复维护。
