# 更新日志

所有对项目行为或结构有影响的改动都记录在此。最近的在最上面。

---

## v5.0.9 — 清理死代码 + 文档精简

纯清理，不改变运行时行为。

- 删除 `src/utils/fetcher.js`（所有导出零引用）
- 删除 `base.js` 未使用导出、`security.js` 死别名、`config.js` 死常量
- 消除 `kuaishou.js` 与 `base.js` 重复的 `extractJsonObject`
- 清理 `a_bogus.js` 注释掉的测试代码
- Worker 体积 85 KB → 82 KB
- 更新日志独立为 `CHANGELOG.md`；README 精简

---

## v5.0.8 — 代码整合：删除全部遗留死代码

纯整理，不改变运行时行为。

- 删除 17 个文件：11 个「已废弃」解析器 stub、`src/utils/jwt.js`、`assets/academia.*`、旧页面 `video/music/option.html`
- 自检改为正向断言
- 收紧 CSP

---

## v5.0.7 — 修复快手分享码被误当作 photoId

- `extractPhotoId()` 的宽松规则会把短链分享码当成 photoId，导致路由打空
- 收紧 ID 匹配；短链改用 `redirect: 'manual'` 只读 `Location`；路由顺序改为「直连页优先」

---

## v5.0.6 — 修复灯箱动图仍走图片代理

- 网格与灯箱各自实现了一份「合并图片+动图」逻辑，灯箱那份静默丢弃 `isVideo` 参数
- 合并为单一 `buildMediaList()`，消除重复实现

---

## v5.0.5 — 修正动图分类

- 抖音用 `live_photo_type === 1` 表示动图，真画面在 `images[i].video`（MP4）
- 修复：动图归入 `gifs` 并从 `images` 移除封面
- 前端动图分流渲染（MP4 用 `<video>`，真 `.gif` 用 `<img>`）

---

## v5.0.4 — 修复快手单图作品解析为空 + CDN 拼接缺陷

- 单图作品（`SINGLE_PICTURE`）媒体本体在 `coverUrls`，此前被当「封面」导致结果为空
- `atlas.cdn` 是对象数组而非字符串，改为读 `cdn` 字段

---

## v5.0.3 — 修复抖音图文作品解析为空

- Feed 接口的 `aid` 决定返回内容，须用 `6383`（主端）
- 常规流程先试 `1128` 未命中再试 `6383`
- 改用本地 Wrangler 做端到端验证

---

## v5.0.2 — 修复抖音 H.265 不能播放 + B站失败提示

- 抖音 `bit_rate` 全为 H.265 时浏览器无法解码，改用 H.264 单流
- B站 失败不再伪装成成功，改为返回明确错误信息

---

## v5.0.1 — 修复抖音视频点击播放无反应

- `/api/media` 未按 `mode` 分流，`mode=stream` 被忽略导致响应带 `attachment` 头
- `/api/media` 单独分流到 `handleMedia`
- 删除 `POST /api/download/zip` 与 `src/utils/zip.js`

---

## v5.0.0 — 收敛为三平台 + 新增 B站 + 移除 ZIP 打包

- 移除小红书、微博、TikTok、YouTube、西瓜、好看视频、知乎、皮皮虾、全民K歌、AcFun、汽水音乐共 11 个平台
- 新增哔哩哔哩解析（单文件流、番剧 PGC 支持、画质映射）
- 移除 ZIP 打包，改用复制直链 + 灯箱预览
- 三平台独立入口页 `/douyin` `/kuaishou` `/bilibili`
- Worker 体积 130 KB → 82 KB

---

## v4.3.0 — 三大平台深化

- 修复抖音 SSR 降级路径失效、`buildResult()` 丢弃音频下载项
- 抖音多接口容灾：移动端 Feed / 分享页 SSR / PC Web API
- 画质仲裁 H.264 优先；快手多路由降级 + GraphQL 兜底
- 可选环境变量 `DOUYIN_COOKIE` / `KUAISHOU_COOKIE`

---

## v4.2.0 — 修复解析缺陷

- 修复 `buildResult()` 丢弃音频下载项、JSON 提取被嵌套截断、SSR 状态解析失败、重定向丢参数

---

## v4.1.0 — 风格替换 + 修复关键交互缺陷

- 修复点击「解析」无反应：CSP 阻断 inline 事件属性，改为 `data-action` + 事件委托
- 移除 nonce 注入；新增 `serveStatic()` 修复静态资源 404
- 全站风格替换为极简玻璃设计，支持三档主题切换
- 改用系统字体栈，移除 Google Fonts 依赖

---

## v4.0.0 — 架构精简 + 安全加固

- 移除登录体系（`/api/verify`、`/api/logout`、`/admin/*`、JWT），无需任何环境变量
- 首页从登录表单重做为完整落地页
- 安全修复：响应头注入、CSP 收紧、SSRF 补全、错误信息收敛、限流覆盖、解析缓存

---

## v3.x

- v3.3.0 — 登录流程优化 + UA 绑定
- v3.2.0 — B站暂缓 + 快手优化
- v3.1.0 — 快手改用移动端网关 + 花括号平衡匹配
- v3.0.0 — 单体 `_worker.js` 拆分为模块化架构 + ParserFactory 模式 + esbuild

## v2.x / v1.x

- v2.2.0 — 解析引擎重构、混合类型徽章
- v2.1.0 — Token 升级为标准 JWT（HS256）
- v2.0.0 — 动图识别、高清图片选择、去重、密码锁定
- v1.0.0 — 初始版本，支持抖音解析
