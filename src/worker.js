// Worker 入口 — Cloudflare Pages ES Module Worker
// 构建命令: npm run build

import { handleRequest } from './router.js';
import { cleanupRateMap } from './utils/security.js';

export default {
  async fetch(request, env, ctx) {
    cleanupRateMap(Date.now());
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      // 全局错误兜底
      console.error('未捕获异常:', err && err.stack ? err.stack : err);
      return new Response(
        JSON.stringify({ error: '服务内部错误，请稍后重试', code: 'INTERNAL_ERROR' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          }
        }
      );
    }
  }
};
