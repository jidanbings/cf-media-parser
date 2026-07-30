// ========================================
// 响应工具模块
// 功能: JSON响应、安全头、代理下载/流媒体
// ========================================

import { SECURITY_HEADERS, JSON_HEADERS, ALLOWED_EXTENSIONS, MAX_FILE_SIZE } from '../config.js';
import { validateDownloadUrl, validateFilename } from './security.js';

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
  if (filename.endsWith('.mp3')) return 'audio/mpeg';
  if (filename.endsWith('.m4a')) return 'audio/mp4';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.webp')) return 'image/webp';
  if (filename.endsWith('.gif')) return 'image/gif';
  if (filename.endsWith('.mp4')) return 'video/mp4';
  if (filename.endsWith('.zip')) return 'application/zip';
  return null;
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
export async function proxyDownload(request, { downloadUrl, filename, referers, defaultContentType }) {
  if (!downloadUrl) return json({ error: '缺少 url 参数' }, 400);

  const urlValidation = validateDownloadUrl(downloadUrl);
  if (!urlValidation.valid) return json({ error: urlValidation.error }, 403);

  const filenameValidation = validateFilename(filename);
  if (!filenameValidation.valid) return json({ error: filenameValidation.error }, 403);

  try {
    const isHeadRequest = request.method === 'HEAD';
    let resp = null;

    for (const referer of referers) {
      try {
        resp = await fetch(downloadUrl, {
          method: isHeadRequest ? 'HEAD' : 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': referer,
            'Origin': referer,
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache'
          },
          redirect: 'follow'
        });
        if (resp.ok || resp.status === 206) break;
      } catch (e) { /* continue */ }
    }

    if (!resp || (!resp.ok && resp.status !== 206)) {
      return json({ error: '下载失败: HTTP ' + (resp ? resp.status : 'unknown') }, 502);
    }

    const cl = resp.headers.get('content-length');
    if (cl && parseInt(cl) > MAX_FILE_SIZE) {
      return json({ error: '文件大小超过限制' }, 413);
    }

    const headers = new Headers();
    let contentType = resp.headers.get('content-type') || inferContentType(filename) || defaultContentType || 'video/mp4';
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
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
export async function proxyStream(request, { streamUrl, referers }) {
  if (!streamUrl) return json({ error: '缺少 url 参数' }, 400);

  const urlValidation = validateDownloadUrl(streamUrl);
  if (!urlValidation.valid) return json({ error: urlValidation.error }, 403);

  try {
    const rangeHeader = request.headers.get('Range') || '';
    let resp = null;

    for (const referer of referers) {
      try {
        const fetchHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': referer,
          'Origin': referer,
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache'
        };
        if (rangeHeader) fetchHeaders['Range'] = rangeHeader;

        resp = await fetch(streamUrl, {
          headers: fetchHeaders,
          cf: { cacheTtl: 300, cacheEverything: true },
          redirect: 'follow'
        });
        if (resp.ok || resp.status === 206) break;
      } catch (e) { /* continue */ }
    }

    if (!resp || (!resp.ok && resp.status !== 206)) {
      return json({ error: '流加载失败: HTTP ' + (resp ? resp.status : 'unknown') }, 502);
    }

    const headers = new Headers();
    const ct = resp.headers.get('content-type') || 'video/mp4';
    headers.set('Content-Type', ct);
    headers.set('Accept-Ranges', 'bytes');
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
