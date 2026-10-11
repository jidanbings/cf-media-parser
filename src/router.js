// ========================================
// 路由层 — 请求分发与处理
// ========================================
//
// 本版本已移除登录鉴权：所有页面与 API 均为公开访问，
// 仅通过速率限制、SSRF 白名单与 CORS 同源校验进行保护。
// ========================================

import { SECURITY_HEADERS } from './config.js';
import {
  json, addSecurityHeaders, proxyDownload, proxyStream, proxyImage
} from './utils/response.js';
import {
  getClientIP, applyRateLimit, getParseCache, setParseCache
} from './utils/security.js';
import { parseMedia } from './parsers/factory.js';

// ========================================
// 平台 Referer 映射
// ========================================

const REFERER_RULES = [
  { match: ['yximgs', 'kuaishou', 'kwai'], referer: 'https://www.kuaishou.com/' },
  { match: ['bilivideo', 'hdslb', 'bilibili'], referer: 'https://www.bilibili.com/' },
  { match: ['douyin', 'pstatp', 'toutiao', 'byteimg', 'ibytedtos', 'douyinvod', 'douyinpic'], referer: 'https://www.douyin.com/' }
];

/**
 * 依据媒体 URL 的域名推断合适的 Referer
 * @param {string} mediaUrl
 * @returns {string}
 */
function getRefererForUrl(mediaUrl) {
  try {
    const host = new URL(mediaUrl).hostname.toLowerCase();
    for (const rule of REFERER_RULES) {
      if (rule.match.some(k => host.includes(k))) return rule.referer;
    }
  } catch { /* 忽略解析失败 */ }
  return '';
}

/** 一组通用 Referer（精确匹配失败时按顺序兜底轮换） */
const GENERIC_REFERERS = [
  'https://www.douyin.com/',
  'https://www.kuaishou.com/',
  'https://www.bilibili.com/'
];

/**
 * 组合：优先精确 Referer，再兜底轮换
 */
function referersFor(mediaUrl) {
  const exact = getRefererForUrl(mediaUrl);
  return exact ? [exact, ...GENERIC_REFERERS] : GENERIC_REFERERS;
}

// ========================================
// API 处理器
// ========================================

/** GET|POST /api/parse — 统一解析入口 */
async function handleParse(request, url, env) {
  let parseUrl = url.searchParams.get('url') || '';
  if (!parseUrl && request.method === 'POST') {
    try {
      const body = await request.json();
      parseUrl = body.url || '';
    } catch { /* 忽略非法 JSON */ }
  }
  parseUrl = String(parseUrl).trim();
  if (!parseUrl) return json({ error: '缺少 url 参数' }, 400);
  if (parseUrl.length > 2048) return json({ error: '链接过长' }, 400);

  const cacheKey = 'parse|' + parseUrl;
  const cached = getParseCache(cacheKey);
  if (cached) return json({ success: true, data: cached, cached: true });

  try {
    const parseResult = await parseMedia(parseUrl, env);
    if (parseResult && !parseResult.error) {
      setParseCache(cacheKey, parseResult);
      return json({ success: true, data: parseResult });
    }
    return json({ error: parseResult?.message || '解析失败' }, 404);
  } catch (e) {
    return json({ error: '解析失败: ' + e.message }, 500);
  }
}

/** GET /api/proxy/image — 代理 CDN 图片 */
async function handleImageProxy(url) {
  const imgUrl = url.searchParams.get('url');
  return proxyImage(imgUrl, getRefererForUrl(imgUrl || ''));
}

/** GET|HEAD /api/download — 代理下载 */
async function handleDownload(request, url) {
  const downloadUrl = url.searchParams.get('url');
  const filename = url.searchParams.get('filename') || 'download.mp4';
  return proxyDownload(request, {
    downloadUrl,
    filename,
    referers: referersFor(downloadUrl || ''),
    defaultContentType: 'video/mp4'
  });
}

/** GET /api/stream — 代理流媒体 */
async function handleStream(request, url) {
  const streamUrl = url.searchParams.get('url');
  return proxyStream(request, {
    streamUrl,
    referers: referersFor(streamUrl || '')
  });
}

/**
 * GET|HEAD /api/media — 统一媒体代理（下载 + 流式播放）
 *
 * 把原先散落在 /admin/* 的多个下载端点合并为一个语义化端点，
 * 由 mode 参数区分用途。保留 /api/download 与 /api/stream 作兼容别名。
 */
async function handleMedia(request, url) {
  const mediaUrl = url.searchParams.get('url');
  const mode = url.searchParams.get('mode') || 'download';
  const filename = url.searchParams.get('filename') || 'media.mp4';

  if (mode === 'stream') {
    return proxyStream(request, { streamUrl: mediaUrl, referers: referersFor(mediaUrl || '') });
  }
  return proxyDownload(request, {
    downloadUrl: mediaUrl,
    filename,
    referers: referersFor(mediaUrl || ''),
    defaultContentType: 'video/mp4'
  });
}

// ========================================
// 页面路由
// ========================================

/** 页面路径 → 静态资源名 */
const PAGE_ROUTES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  // 三个平台独立入口
  '/douyin': 'douyin.html',
  '/douyin.html': 'douyin.html',
  '/kuaishou': 'kuaishou.html',
  '/kuaishou.html': 'kuaishou.html',
  '/bilibili': 'bilibili.html',
  '/bilibili.html': 'bilibili.html'
};

/**
 * 可直接透传的静态资源（CSS / JS / 图片等）
 * 这些文件不做 nonce 注入，按原样返回并长缓存。
 */
const STATIC_PREFIXES = ['/assets/'];
const STATIC_EXACT = new Set(['/_routes.json']);

/** 允许透传的静态资源扩展名 */
const STATIC_EXTENSIONS = new Set([
  '.css', '.js', '.mjs', '.json', '.map',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.txt'
]);

/**
 * 判断请求是否命中静态资源
 * @param {string} path
 * @returns {boolean}
 */
function isStaticAsset(path) {
  if (STATIC_EXACT.has(path)) return true;
  if (!STATIC_PREFIXES.some(p => path.startsWith(p))) return false;

  // 阻断路径遍历与空段
  if (path.includes('..') || path.includes('//')) return false;

  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return STATIC_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * 提供静态资源（CSS / JS 等），原样透传
 * @returns {Promise<Response|null>}
 */
async function serveStatic(path, request, env, url) {
  if (!isStaticAsset(path)) return null;

  const upstream = await env.ASSETS.fetch(new Request(url.origin + path, {
    method: 'GET',
    headers: { 'X-Internal-Asset': '1' }
  }));

  if (!upstream.ok) return null;

  const headers = new Headers(upstream.headers);
  // 未启用内容哈希，采用较短缓存 + 重验证，避免改版后拿到旧文件
  headers.set('Cache-Control', 'public, max-age=300, must-revalidate');

  return new Response(upstream.body, { status: 200, headers });
}

/**
 * 提供静态页面
 * @returns {Promise<Response|null>}
 */
async function servePage(path, request, env, url) {
  const asset = PAGE_ROUTES[path];
  if (!asset) return null;

  const resp = await env.ASSETS.fetch(new Request(url.origin + '/' + asset, {
    headers: { 'X-Internal-Asset': '1' }
  }));

  if (!resp.ok) return resp;

  // 页面不缓存，确保改版后立即生效
  const headers = new Headers(resp.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.delete('Content-Length');

  return new Response(resp.body, { status: resp.status, headers });
}

// ========================================
// 主路由分发
// ========================================

/**
 * 处理所有 HTTP 请求
 * @param {Request} request
 * @param {object} env
 * @param {object} ctx
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env, ctx) {
  // 内部资产请求直接放行
  if (request.headers.get('X-Internal-Asset')) {
    return env.ASSETS.fetch(request);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // ---- 同源校验（防跨站盗用）----
  const origin = request.headers.get('Origin') || '';
  if (origin) {
    try {
      const originHost = new URL(origin).hostname;
      if (originHost && originHost !== url.hostname) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch { /* 非法 Origin 直接忽略 */ }
  }

  // ---- OPTIONS 预检 ----
  if (request.method === 'OPTIONS') {
    const preflight = new Headers({
      'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    return addSecurityHeaders(new Response(null, { status: 204, headers: preflight }));
  }

  const ip = getClientIP(request);

  // ---- 限流（仅作用于 API）----
  if (path.startsWith('/api/')) {
    const { limited, retryAfter } = applyRateLimit(path, ip);
    if (limited) {
      return addSecurityHeaders(json(
        { error: `请求过于频繁，请 ${retryAfter} 秒后重试` },
        429,
        { 'Retry-After': String(retryAfter) }
      ));
    }
  }

  // 仅允许 GET / HEAD / POST
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    return addSecurityHeaders(json({ error: '不支持的请求方法' }, 405));
  }

  // ---- 健康检查 ----
  if (path === '/api/health') {
    return addSecurityHeaders(json({ success: true, data: { status: 'ok', version: '5.0.8' } }));
  }

  // ---- 解析 API ----
  if (path === '/api/parse') {
    return addSecurityHeaders(await handleParse(request, url, env));
  }

  // ---- 媒体代理 API ----
  // /api/media 支持 mode=stream（内联播放）与 mode=download（附件下载），
  // 必须走 handleMedia 才能按 mode 分流；若直接交给 handleDownload，
  // 响应会带上 Content-Disposition: attachment，<video> 将拒绝播放并转为下载。
  if (path === '/api/media') {
    return addSecurityHeaders(await handleMedia(request, url));
  }

  if (path === '/api/download') {
    return addSecurityHeaders(await handleDownload(request, url));
  }

  if (path === '/api/proxy/image') {
    return addSecurityHeaders(await handleImageProxy(url));
  }

  if (path === '/api/stream') {
    return addSecurityHeaders(await handleStream(request, url));
  }

  // ---- 静态资源（CSS / JS / 字体 / 图片）----
  // 必须排在页面路由之前，否则 /assets/* 会落到 404
  try {
    const staticResp = await serveStatic(path, request, env, url);
    if (staticResp) return addSecurityHeaders(staticResp);
  } catch { /* 静态资源缺失时继续走页面路由 */ }

  // ---- 页面路由 ----
  if (path === '/favicon.ico') {
    return addSecurityHeaders(new Response(null, { status: 204 }));
  }

  try {
    const pageResp = await servePage(path, request, env, url);
    if (pageResp) return addSecurityHeaders(pageResp);
  } catch (e) {
    return addSecurityHeaders(new Response('页面加载失败: ' + e.message, { status: 500 }));
  }

  return addSecurityHeaders(new Response('Not Found', { status: 404 }));
}

export { PAGE_ROUTES, STATIC_PREFIXES, SECURITY_HEADERS };
