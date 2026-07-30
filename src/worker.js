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
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      // 全局错误兜底 — 避免裸奔 500
      const body = JSON.stringify({
        error: '内部错误: ' + err.message,
        type: err.constructor?.name || 'Error',
        // 生产环境可移除以下行
        stack: err.stack?.split('\n').slice(0, 5).join('\n')
      });
      return new Response(body, {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }
  }
};
