// ========================================
// 响应工具模块
// 功能: JSON响应、安全头(含 CSP nonce)、代理下载/流媒体/图片
// ========================================

import {
  SECURITY_HEADERS, JSON_HEADERS, MAX_FILE_SIZE
} from '../config.js';
import { validateProxyUrl, validateFilename, sanitizeFilename } from './security.js';

/**
 * 统一 JSON 响应
 * @param {any} data - 响应数据
 * @param {number} status - HTTP状态码
 * @param {object} extraHeaders - 额外响应头
 * @returns {Response}
 */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

/**
 * 添加安全响应头
 * @param {Response} response
 * @returns {Response}
 */
export function addSecurityHeaders(response) {
  // 重定向响应：直接返回，不重构 body 流避免丢失 Location 头
  if (response.status >= 301 && response.status <= 308) {
    return response;
  }
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * 根据文件名推断 Content-Type
 */
function inferContentType(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.zip')) return 'application/zip';
  return null;
}

/**
 * 构造安全的 Content-Disposition（RFC 5987 双写，杜绝头注入）
 * @param {string} filename
 * @returns {string}
 */
function buildContentDisposition(filename) {
  const safe = sanitizeFilename(filename, 'download.bin');
  // ASCII 回退：非 ASCII 字符替换为下划线
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/**
 * 按 Referer 列表依次尝试抓取上游资源
 * @param {string} targetUrl
 * @param {object} opts
 * @returns {Promise<Response|null>}
 */
async function fetchUpstream(targetUrl, {
  referers = [], method = 'GET', rangeHeader = '', extraHeaders = {}, cf = null
} = {}) {
  const attempts = referers.length > 0 ? referers : [''];
  let lastResponse = null;

  for (const referer of attempts) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      ...extraHeaders
    };
    if (referer) {
      headers['Referer'] = referer;
      headers['Origin'] = referer;
    }
    if (rangeHeader) headers['Range'] = rangeHeader;

    // 部分 CDN 对 br 压缩支持不佳，交由 Cloudflare 自动协商
    delete headers['Accept-Encoding'];

    try {
      const init = { method, headers, redirect: 'follow' };
      if (cf) init.cf = cf;
      const resp = await fetch(targetUrl, init);
      lastResponse = resp;
      if (resp.ok || resp.status === 206) return resp;
    } catch (e) { /* 尝试下一个 Referer */ }
  }
  return lastResponse;
}

/**
 * 统一代理下载（支持 HEAD 请求）
 * @param {Request} request
 * @param {object} opts
 * @param {string} opts.downloadUrl
 * @param {string} opts.filename
 * @param {string[]} opts.referers
 * @param {string} opts.defaultContentType
 * @returns {Promise<Response>}
 */
export async function proxyDownload(request, { downloadUrl, filename, referers = [], defaultContentType }) {
  if (!downloadUrl) return json({ error: '缺少 url 参数' }, 400);

  const urlValidation = validateProxyUrl(downloadUrl);
  if (!urlValidation.valid) return json({ error: urlValidation.error }, 403);

  const safeName = sanitizeFilename(filename, 'download.mp4');

  try {
    const isHeadRequest = request.method === 'HEAD';
    const resp = await fetchUpstream(downloadUrl, {
      referers,
      method: isHeadRequest ? 'HEAD' : 'GET'
    });

    if (!resp || (!resp.ok && resp.status !== 206)) {
      return json({ error: '下载失败: HTTP ' + (resp ? resp.status : 'unknown') }, 502);
    }

    const cl = resp.headers.get('content-length');
    if (cl && parseInt(cl, 10) > MAX_FILE_SIZE) {
      return json({ error: '文件大小超过限制' }, 413);
    }

    const headers = new Headers();
    headers.set('Content-Type',
      resp.headers.get('content-type') || inferContentType(safeName) || defaultContentType || 'application/octet-stream');
    headers.set('Content-Disposition', buildContentDisposition(safeName));
    if (cl) headers.set('Content-Length', cl);
    headers.set('Cache-Control', 'public, max-age=3600');

    if (isHeadRequest) return new Response(null, { status: resp.status, headers });
    return new Response(resp.body, { status: resp.status, headers });
  } catch (e) {
    return json({ error: '下载失败: ' + e.message }, 502);
  }
}

/**
 * 统一代理流媒体（支持 Range 请求）
 * @param {Request} request
 * @param {object} opts
 * @param {string} opts.streamUrl
 * @param {string[]} opts.referers
 * @returns {Promise<Response>}
 */
export async function proxyStream(request, { streamUrl, referers = [] }) {
  if (!streamUrl) return json({ error: '缺少 url 参数' }, 400);

  const urlValidation = validateProxyUrl(streamUrl);
  if (!urlValidation.valid) return json({ error: urlValidation.error }, 403);

  try {
    const rangeHeader = request.headers.get('Range') || '';
    // 带 Range 的请求绝不能被 Cloudflare 缓存：206 分片一旦入缓存，
    // 后续整段请求可能拿到残缺字节，表现为视频只播开头几秒。
    const resp = await fetchUpstream(streamUrl, {
      referers,
      rangeHeader,
      cf: rangeHeader ? undefined : { cacheTtl: 300, cacheEverything: true }
    });

    if (!resp || (!resp.ok && resp.status !== 206)) {
      return json({ error: '流加载失败: HTTP ' + (resp ? resp.status : 'unknown') }, 502);
    }

    const headers = new Headers();
    headers.set('Content-Type', resp.headers.get('content-type') || 'video/mp4');
    headers.set('Accept-Ranges', resp.headers.get('accept-ranges') || 'bytes');
    headers.set('Cache-Control', 'public, max-age=3600');
    const cl = resp.headers.get('content-length');
    if (cl) headers.set('Content-Length', cl);
    const cr = resp.headers.get('content-range');
    if (cr) headers.set('Content-Range', cr);
    return new Response(resp.body, { status: resp.status, headers });
  } catch (e) {
    return json({ error: '流加载失败: ' + e.message }, 502);
  }
}

/**
 * 代理 CDN 图片
 * @param {string} imgUrl
 * @param {string} referer
 * @returns {Promise<Response>}
 */
export async function proxyImage(imgUrl, referer) {
  if (!imgUrl) return json({ error: '缺少 url 参数' }, 400);

  const urlValidation = validateProxyUrl(imgUrl);
  if (!urlValidation.valid) return json({ error: urlValidation.error }, 403);

  try {
    const resp = await fetchUpstream(imgUrl, {
      referers: referer ? [referer] : [],
      extraHeaders: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      cf: { cacheTtl: 86400, cacheEverything: true }
    });
    if (!resp || !resp.ok) return json({ error: '图片加载失败' }, resp ? resp.status : 502);

    const contentType = resp.headers.get('content-type') || '';

    // 图片代理只服务图片；视频/音频流应走 /api/media?mode=stream。
    // 动图（如抖音 LivePhoto）常是无扩展名的 MP4，很容易被误送到这里，
    // 因此把错误信息写清楚，便于定位是调用方路由错了。
    if (!contentType.startsWith('image/')) {
      const kind = contentType.startsWith('video/') ? '视频'
        : contentType.startsWith('audio/') ? '音频'
          : '非图片资源';
      return json({
        error: `目标不是图片资源（实际为${kind}${contentType ? '：' + contentType : ''}）`,
        hint: '视频/动图请改用 /api/media?mode=stream'
      }, 415);
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(resp.body, { headers });
  } catch (e) {
    return json({ error: '图片代理失败: ' + e.message }, 502);
  }
}

export { buildContentDisposition, inferContentType };
