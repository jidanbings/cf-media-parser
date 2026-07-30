// ========================================
// Worker 入口 — Cloudflare Pages ES Module Worker
// ========================================
//
// 构建命令: npm run build (esbuild src/worker.js --bundle --format=esm --outfile=_worker.js)
//
// 架构:
//   src/worker.js    ← 入口 (本文件)
//   src/router.js    ← 路由分发
//   src/config.js    ← 配置常量
//   src/parsers/     ← ParserFactory + 各平台解析器 (工厂模式, 借鉴 media-parser)
//   src/utils/       ← 工具模块 (jwt, zip, security, response, fetcher)
// ========================================

import { handleRequest } from './router.js';
import { cleanupRateMap } from './utils/security.js';

export default {
  async fetch(request, env, ctx) {
    // 定期清理过期缓存
    cleanupRateMap(Date.now());
    return handleRequest(request, env, ctx);
  }
};
