# cf-media-parser

🌐 **多平台媒体解析下载工具** — 基于 Cloudflare Workers + Pages 的零成本部署方案，支持 12 个主流平台的**视频、图文、动图、音频**内容解析与代理下载。JWT 令牌认证（密码 + UA 绑定），切换网络不受影响。

> ⛔ **B站（哔哩哔哩）永久放弃支持** — 由于 B站的反爬机制过于激进（Cloudflare Workers 的 TLS 指纹检测返回 412），本项目永久放弃对 B站 的支持。如果你需要解析 B站视频，请使用 [ucmao/media-parser](https://github.com/ucmao/media-parser)（Python VPS 部署版）。


[![Deploy to Cloudflare](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare)](https://dash.cloudflare.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📑 目录

- [功能特点](#-功能特点)
- [快速开始](#-快速开始)
- [API 接口](#-api-接口)
- [项目结构 / 解析策略 / 构建命令](#-项目结构--解析策略--构建命令)
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
| **UA 绑定** | 令牌绑定登录时的浏览器 User-Agent，换浏览器需重新登录，切换网络不影响 |
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

将本项目 **fork 到你的 GitHub 账号下**，然后关联 Cloudflare Pages，每次推送自动构建部署，一劳永逸。

---

#### ① Fork 项目到你的 GitHub 账号

这一步是把原项目复制一份到你自己名下，之后你所有修改都推送到自己的仓库。

1. **打开原项目地址**（在浏览器中打开）：
   ```
   https://github.com/jidanbings/cf-media-parser
   ```

2. **点击 Fork 按钮**：
   - 页面右上角有一个 **Fork** 按钮（就在头像旁边），点击它
   - 下拉菜单中选择 **Create fork**

3. **配置 Fork 参数**：
   - **Owner**：选择你的个人 GitHub 账号（默认就是你自己，不用改）
   - **Repository name**：保持 `cf-media-parser` 不变即可
   - **Description**：可选，可以写一句说明
   - **☑️ Copy the `main` branch only**：保持勾选（只复制主分支，够了）

4. **点击「Create fork」**：
   - 等待几秒钟，GitHub 会完成复制
   - 完成后浏览器会自动跳转到你自己的仓库页面
   - 地址栏显示：`https://github.com/你的用户名/cf-media-parser`

✅ Fork 完成。现在你名下有了一个完全独立的仓库，你可以随意修改它。

---

#### ② 将你的仓库代码克隆到本地（可选）

这一步**不是必须的**——如果你想修改代码、更新功能或者自定义配置，才需要拉到本地；如果只想直接用原版，可以直接跳到第③步。

> 💡 **什么时候需要拉到本地？**
> - 你想修改代码或自定义功能 → 需要
> - 你用原版不动，直接部署 → 不需要，跳到第③步
> - 你以后想更新代码 → 需要，先拉到本地再改

```bash
# ① 克隆你自己的仓库（替换为你的 GitHub 用户名）
git clone https://github.com/你的用户名/cf-media-parser.git

# ② 进入项目目录
cd cf-media-parser

# ③ 查看 remote 地址，确认是连接到你的仓库
git remote -v
# 应该显示：
#   origin  https://github.com/你的用户名/cf-media-parser.git (fetch)
#   origin  https://github.com/你的用户名/cf-media-parser.git (push)
```

> ⚠️ **如果你之前已经克隆了原仓库**，只需改一下 remote 地址即可：
> ```bash
> git remote set-url origin https://github.com/你的用户名/cf-media-parser.git
> git push -u origin main
> ```

**以后想更新代码时：**

```bash
# 修改代码后，提交并推送到你的 GitHub 仓库
git add .
git commit -m "你的修改说明"
git push origin main
```

推送完成后，Cloudflare Pages 会自动检测到仓库变化，自动重新构建并部署。不需要手动操作。

---

#### ③ 在 Cloudflare Pages 控制台创建项目

1. **登录 Cloudflare 控制台**：
   - 打开 https://dash.cloudflare.com/
   - 输入你的邮箱和密码登录
   - 如果没有账号，先注册一个（支持 Google/GitHub 登录）

2. **进入 Pages 页面**：
   - 登录后，左侧侧边栏找到 **Workers 和 Pages**
   - 点击展开后，选择上面的 **Pages** 选项卡
   - 页面中间点击 **创建** 按钮
   - 在弹出的选项中，选择 **Pages**

3. **选择连接到 Git**：
   - 你会看到两个选项：
     - **连接到 Git** ← 选这个
     - **直接上传**
   - 点击 **连接到 Git**

4. **授权 Cloudflare 访问 GitHub**（第一次使用时需要）：
   - 如果是第一次在 Cloudflare 连接 GitHub，会跳转到 GitHub 授权页面
   - 点击 **Authorize Cloudflare Pages**（授权）
   - 输入 GitHub 密码确认（如果需要）
   - 授权完成后，自动跳转回 Cloudflare 页面

5. **选择你的仓库**：
   - Cloudflare 会列出你 GitHub 账号下的所有仓库
   - 在列表中找到你 fork 的 `cf-media-parser`
   - 点击对应行的 **设置** 或 **导入** 按钮

---

#### ④ 配置构建设置（最关键的一步！）

选择仓库后，进入构建设置页面。这里需要**严格按照下表填写**：

| 设置项 | 填写值 | 说明 |
|--------|--------|------|
| **项目名称** | `media-parser` | 可以自定义，比如 `my-parser` 或 `cf-video-downloader`，这个名称会出现在 Pages 域名中 |
| **生产分支** | `main` | 使用默认的 main 分支即可，不改 |
| **构建命令** | `npm install && npm run build:dist` | 这是构建命令，**必须填写** |
| **构建输出目录** | `dist` | 告诉 Cloudflare 部署 `dist/` 文件夹里的内容 |
| **根目录** | （留空） | 不用填，默认就是项目根目录 |

> 📦 **构建命令 `npm install && npm run build:dist` 做了两件事：**
> 1. `npm install` — 安装项目依赖（从 `package.json` 读取）
> 2. `npm run build:dist` — 运行构建脚本：
>    - 用 esbuild 把 `src/` 目录下的 23 个源文件打包成 `dist/_worker.js`（单文件 Worker）
>    - 把 `index.html`、`video.html`、`music.html`、`option.html`、`_routes.json` 复制到 `dist/` 目录

> 🔒 **输出目录设为 `dist` 的安全性：**
> 设置输出目录为 `dist` 后，Cloudflare 只把 `dist/` 里面的内容部署到 CDN 上。`src/`（源代码）、`docs/`（文档）、`package.json`、`node_modules/` 等目录**都不会暴露到公网**，保证了源码安全。

---

#### ⑤ 点击「保存并部署」

1. 确认所有设置都正确后，点击页面底部的 **保存并部署** 按钮

2. Cloudflare 会自动开始构建流程，你会看到一个实时的构建日志界面：
   ```
   🔄 Cloning repository...        ← 拉取你的 GitHub 仓库代码
   📦 Installing dependencies...   ← 执行 npm install 安装依赖
   🔨 Building...                  ← 执行 npm run build:dist 构建
   ✅ Build complete!              ← 构建完成
   🚀 Deploying...                 ← 正在部署到 Cloudflare 全球网络
   ✅ Deployment complete!         ← 部署完成
   ```

3. 整个过程大约需要 **1-3 分钟**，取决于网络状况

4. 部署成功后，Cloudflare 会自动分配一个域名，格式如下：
   ```
   https://media-parser-xxx.pages.dev
   ```
   - 其中 `xxx` 是一个随机字符串
   - 例如：`https://media-parser-3a1b2c3d.pages.dev`
   - 点击这个域名，就可以访问你的工具了

5. **你可以自定义域名**（可选）：
   - 在项目 → **自定义域** → **设置自定义域**
   - 输入你自己的域名（需要有 DNS 管理权限）
   - Cloudflare 会自动添加 DNS 记录

---

#### ⑥ 配置环境变量（必须操作，否则工具无法运行）

部署完成后，还需要配置两个环境变量，否则工具会返回 500 错误。

1. **进入环境变量设置页面**：
   - 在你刚刚创建的 Pages 项目中
   - 点击顶部导航栏的 **设置** 选项卡
   - 在左侧找到 **环境变量**
   - 在 **生产环境变量**（Production）一栏，点击 **添加变量**

2. **添加第一个变量：`SECRET_KEY`**

   | 字段 | 值 |
   |------|-----|
   | **变量名** | `SECRET_KEY` |
   | **值** | 任意字符串，建议 16 位以上 |
   | **加密** | ☑️ 勾选（对变量值加密） |

3. **添加第二个变量：`JWT_SECRET`**

   | 字段 | 值 |
   |------|-----|
   | **变量名** | `JWT_SECRET` |
   | **值** | 另一个不同的随机字符串 |
   | **加密** | ☑️ 勾选 |

4. **点击「保存」**

> ⚠️ **两条铁律：**
> 1. **两个变量都必须配置**，少一个工具无法运行
> 2. 两个变量的值**不要相同**，建议用不同的随机字符串
> 3. `SECRET_KEY` 是登录密码，你会用它登录工具；`JWT_SECRET` 是 JWT 签名密钥，内部使用

> 💡 **生成随机密钥的几种方法：**
> - **方法一（推荐）**：在你的电脑命令行执行：
>   ```bash
>   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
>   # 输出示例: 7a3f9c1e5b8d2f6a0c4e7b9d1f3a5c7e
>   ```
> - **方法二**：用在线密码生成器生成两个不同字符串
> - **方法三**：自己随便输入两串不同的乱码，比如 `MySecretKey2024!` 和 `AnotherRandomKey2024!`

---

#### ⑦ 重新部署使环境变量生效

环境变量修改后，需要重新部署才能生效。

1. 进入项目页面，点击顶部的 **部署** 选项卡
2. 在部署列表中，找到最新的一条部署记录
3. 点击该记录右侧的 **...**（更多操作）
4. 在下拉菜单中选择 **重试部署**
5. Cloudflare 会重新拉取代码并部署（这次环境变量带上了）

> 💡 **每次修改环境变量后，都要重试部署一次**，否则修改不会生效。

---

#### ⑧ 验证部署是否成功

1. 打开你的 Pages 域名，例如：
   ```
   https://media-parser-xxx.pages.dev
   ```

2. 应该能看到登录页面，一个输入密码的界面

3. **测试登录**：
   ```
   步骤一：在输入框中输入你设置的 SECRET_KEY（密码）
   步骤二：点击「登录」或「提交」按钮
   步骤三：登录成功 → 自动跳转到功能选择页面
   步骤四：点击「视频解析」进入解析页面
   步骤五：粘贴一个抖音/快手等平台的分享链接
   步骤六：点击「解析」按钮
   步骤七：✅ 成功显示视频标题、封面、作者、下载按钮
   ```

4. **常见验证问题排查**：

   | 现象 | 原因 | 解决办法 |
   |------|------|----------|
   | 打开页面显示 **500 错误** | `SECRET_KEY` 或 `JWT_SECRET` 未配置 | 去环境变量页面添加，然后重新部署 |
   | 输入密码后提示 **密钥错误** | 输入的密码与 `SECRET_KEY` 不一致 | 检查环境变量中的 `SECRET_KEY` 值 |
   | **页面白屏/空白** | 构建输出目录配置错误 | 确保输出目录设为 `dist` |
   | **404 页面** | 路由问题 | 检查 `_routes.json` 是否在 `dist/` 目录中 |
   | 解析结果 **一直加载中** | 平台反爬升级 | 更新代码或提 Issue |

---

#### ⑨ 日常使用：自动部署流程

以后的使用流程非常简单：

```bash
# ① 在本地修改代码（如果需要）
git add .
git commit -m "更新了 XXX 功能"
git push origin main
```

每次 `git push` 到 GitHub 后，Cloudflare Pages 会自动检测到仓库代码变化，然后自动执行：
```
代码推送 → GitHub 触发 Webhook → Cloudflare 拉取新代码
    → 安装依赖 → 构建 → 部署到全球 CDN（约 1-2 分钟）
```

**全程不需要你再登录 Cloudflare 控制台。** 这是推荐这种部署方式的最大原因。

---

#### ⑩ 如何更新到原项目的最新版本

如果你想同步原项目的最新更新：

```bash
# ① 添加原项目为 upstream 远程仓库（只需要做一次）
git remote add upstream https://github.com/jidanbings/cf-media-parser.git

# ② 拉取原项目的最新代码
git fetch upstream

# ③ 合并到你的本地 main 分支
git checkout main
git merge upstream/main

# ④ 如果有冲突，解决冲突后提交
# ⑤ 推送到你的 GitHub 仓库，自动部署
git push origin main
```

> 💡 建议定期同步原项目的更新，以获得最新的功能、优化和安全修复。

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

## 🏗️ 项目结构 / 🧠 解析策略 / ⚙️ 构建命令

> 📖 **这三个部分的详细内容已整合到架构文档中，请参阅：**
> - [项目结构](docs/architecture.md#项目结构)
> - [解析策略](docs/architecture.md#各平台解析策略详解)
> - [构建命令详解](docs/architecture.md#构建命令详解)
>
> `docs/architecture.md` 包含了项目的完整架构说明、目录结构、各平台解析方式、构建命令表、构建流程图等详细信息。

---

## 📋 更新日志

### v3.3.0（2026-07-30）— 登录流程优化 + UA 绑定

**🐛 修复：**
- **登录 500 错误** — `Response.redirect()` 在 Workers 中传相对路径抛异常，改为手动 302 构造
- **Admin 接口 404** — 前端请求 `/api/admin/info` 与后端路由 `/admin/info` 路径不匹配，统一为 `/admin/info`
- **重定向响应丢失** — `addSecurityHeaders` 重构 Response body 流导致 302 不被浏览器识别，重定向响应直接透传

**⚡ 优化：**
- **减少 50% 请求量** — `isAuth` 在每个页面请求中只调用 1 次（之前 2 次），登录流程从 4 次请求降至 2 次
- **去掉冗余前端自检** — 环境变量检查由后端统一处理，删除 `index.html` 中多余的 `fetch('/admin/info')`
- **精简 `index.html`** — 移除死代码（env-error 样式/HTML/JS），从 97 行缩至 50 行

**🔐 安全：**
- **UA 绑定** — JWT 令牌绑定登录时的浏览器 User-Agent，换浏览器需重新登录
- **去 IP 绑定** — 不绑定 IP 地址，WiFi/移动数据切换不受影响
- **全局错误兜底** — Worker 入口加 try-catch，避免裸 500，返回 JSON 错误详情

**📝 文档：**
- `video.html` 页脚移除「文档」链接
- README 更新安全性说明

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
