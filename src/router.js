// ========================================
// 路由层 — 请求分发与处理
// ========================================

import {
  COOKIE_NAME, COOKIE_MAX_AGE, COOKIE_REGEX, JWT_SECRET, setJwtSecret
} from './config.js';
import { createJWT, verifyJWT } from './utils/jwt.js';
import { json, addSecurityHeaders, proxyDownload, proxyStream } from './utils/response.js';
import { SimpleZip } from './utils/zip.js';
import {
  recordFailedAttempt, clearRateLimit, getClientIP, getParseCache, setParseCache
} from './utils/security.js';
import {
  parseMedia
} from './parsers/factory.js';
import { parseMusic } from './parsers/music.js';

// 快速哈希（用于 token 绑定，非加密用途）
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

// Set-Cookie 统一生成
function makeCookie(token) {
  return `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax; Secure`;
}

// ========================================
// 授权检查
// ========================================
async function isAuth(request, ip) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(COOKIE_REGEX);
  if (!match) return false;
  const token = decodeURIComponent(match[1]);
  const payload = await verifyJWT(token, JWT_SECRET);
  if (!payload) return false;
  if (Date.now() / 1000 > payload.exp) return false;
  // UA 绑定校验（仅检查浏览器，不绑 IP，避免 WiFi/数据切换影响体验）
  if (payload.ua) {
    const currentUaHash = simpleHash(request.headers.get('User-Agent') || '');
    if (payload.ua !== currentUaHash) return false;
  }
  return true;
}

// ========================================
// 路由处理器
// ========================================

/** POST /api/verify — 登录验证 */
async function handleVerify(request, env, ip) {
  let inputKey = '';
  let isForm = false;

  // 支持 JSON 和表单两种提交方式
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: '请求格式错误' }, 400);
    inputKey = (body.key || '').trim();
  } else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    isForm = true;
    const formData = await request.formData().catch(() => null);
    if (!formData) return json({ error: '请求格式错误' }, 400);
    inputKey = (formData.get('key') || '').trim();
  } else {
    return json({ error: '不支持的 Content-Type' }, 400);
  }

  if (!inputKey) {
    if (isForm) return new Response(null, { status: 302, headers: { 'Location': '/?error=' + encodeURIComponent('请输入密钥') } });
    return json({ error: '请输入密钥' }, 400);
  }

  if (inputKey === env.SECRET_KEY) {
    clearRateLimit(ip);
    const now = Math.floor(Date.now() / 1000);
    const uaHash = simpleHash(request.headers.get('User-Agent') || '');
    const payload = { exp: now + COOKIE_MAX_AGE, iat: now, ua: uaHash };
    let token;
    try {
      token = await createJWT(payload, JWT_SECRET);
    } catch (e) {
      if (isForm) return new Response(null, { status: 302, headers: { 'Location': '/?error=' + encodeURIComponent('令牌生成失败: ' + e.message) } });
      return json({ error: '令牌生成失败', detail: e.message }, 500);
    }
    const cookie = makeCookie(token);
    if (isForm) {
      return new Response(null, { status: 302, headers: { 'Location': '/option', 'Set-Cookie': cookie } });
    }
    return json({ success: true }, 200, { 'Set-Cookie': cookie });
  }

  const result = recordFailedAttempt(ip);
  const uaHash = simpleHash(request.headers.get('User-Agent') || '');

  // 不透露剩余次数，只告诉是否被锁
  let errMsg = result.waitSeconds > 0
    ? `尝试次数过多，请等待 ${result.waitSeconds} 秒`
    : '密钥错误';

  if (isForm) return new Response(null, { status: 302, headers: { 'Location': '/?error=' + encodeURIComponent(errMsg) } });
  if (result.waitSeconds > 0) {
    return json({ error: errMsg, waitSeconds: result.waitSeconds, remaining: 0 }, 429);
  }
  return json({ error: errMsg }, 403);
}

/** POST /api/logout — 退出登录（仅允许 POST 防 CSRF） */
function handleLogout() {
  return new Response('', {
    status: 302,
    headers: {
      'Location': '/',
      'Set-Cookie': `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`
    }
  });
}

/** GET|POST /api/parse — 统一解析入口 */
async function handleParse(request, url) {
  let parseUrl = url.searchParams.get('url') || '';
  if (!parseUrl && request.method === 'POST') {
    try { const body = await request.json(); parseUrl = body.url || ''; } catch (e) { /* ignore */ }
  }
  if (!parseUrl) return json({ error: '缺少 url 参数' }, 400);

  try {
    const parseResult = await parseMedia(parseUrl);
    if (parseResult && !parseResult.error) {
      return json({ success: true, data: parseResult });
    }
    return json({ error: parseResult?.message || '解析失败' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

/** GET /api/proxy/image — 代理 CDN 防盗链图片（根据域名自动匹配 Referer） */
function getRefererForUrl(imgUrl) {
  try {
    const host = new URL(imgUrl).hostname;
    if (host.includes('yximgs') || host.includes('kuaishou')) return 'https://www.kuaishou.com/';
    if (host.includes('douyin') || host.includes('pstatp') || host.includes('toutiao')) return 'https://www.douyin.com/';
    if (host.includes('xiaohongshu')) return 'https://www.xiaohongshu.com/';
    if (host.includes('weibo') || host.includes('sinaimg')) return 'https://weibo.com/';
    if (host.includes('tiktok')) return 'https://www.tiktok.com/';
    if (host.includes('ixigua')) return 'https://www.ixigua.com/';
    if (host.includes('acfun')) return 'https://www.acfun.cn/';
    return 'https://www.douyin.com/';
  } catch { return 'https://www.douyin.com/'; }
}

async function handleImageProxy(url) {
  const imgUrl = url.searchParams.get('url');
  if (!imgUrl) return json({ error: '缺少 url 参数' }, 400);

  try {
    const resp = await fetch(imgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': getRefererForUrl(imgUrl),
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      cf: { cacheTtl: 86400, cacheEverything: true }
    });
    if (!resp.ok) return json({ error: '图片加载失败' }, resp.status);

    const headers = new Headers();
    headers.set('Content-Type', resp.headers.get('content-type') || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(resp.body, { headers });
  } catch (e) {
    return json({ error: '图片代理失败: ' + e.message }, 502);
  }
}

/** GET /api/music — 汽水音乐解析 */
async function handleMusicApi(request, url) {
  const musicUrl = url.searchParams.get('url');
  if (!musicUrl) return json({ error: '缺少 url 参数' }, 400);

  const cacheKey = 'music|' + musicUrl;
  const cached = getParseCache(cacheKey);
  if (cached) return json({ success: true, data: cached });

  try {
    const result = await parseMusic(musicUrl);
    if (result) {
      setParseCache(cacheKey, result);
      return json({ success: true, data: result });
    }
    return json({ error: '无法解析该音乐' }, 404);
  } catch (e) {
    return json({ error: '解析失败: ' + e.message, detail: '请确保链接格式正确' }, 500);
  }
}

/** GET /api/download — 代理下载 */
async function handleDownload(request, url) {
  const downloadUrl = url.searchParams.get('url');
  const filename = url.searchParams.get('filename') || 'download.mp4';
  return proxyDownload(request, {
    downloadUrl, filename,
    referers: ['https://www.douyin.com/'],
    defaultContentType: 'video/mp4'
  });
}

/** POST /api/download/zip — ZIP 打包下载 */
async function handleDownloadZip(request) {
  try {
    const body = await request.json();
    const files = body.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return json({ error: '缺少文件列表' }, 400);
    }

    const zip = new SimpleZip();
    const ts = body.ts || Date.now().toString();
    const pn = body.pn || 'douyin';

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      const fileUrl = item.url;
      const ext = item.ext || 'jpg';
      const index = item.index || (i + 1);

      try {
        const referers = ['https://www.douyin.com/', 'https://douyin.com/', 'https://v.douyin.com/'];
        let resp = null;
        for (const referer of referers) {
          try {
            resp = await fetch(fileUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': referer, 'Origin': referer, 'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9', 'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache'
              },
              redirect: 'follow'
            });
            if (resp.ok) break;
          } catch (e) { /* continue */ }
        }
        if (resp?.ok) {
          const buffer = await resp.arrayBuffer();
          zip.addFile(`${ts}_${pn}_image${index}.${ext}`, new Uint8Array(buffer));
        }
      } catch (e) { /* skip file */ }
    }

    const zipBuffer = zip.generate();
    const headers = new Headers();
    headers.set('Content-Type', 'application/zip');
    headers.set('Content-Disposition', `attachment; filename="${ts}_${pn}_images.zip"`);
    headers.set('Content-Length', zipBuffer.length.toString());
    headers.set('Cache-Control', 'no-cache');
    return new Response(zipBuffer, { headers });
  } catch (e) {
    return json({ error: '打包失败: ' + e.message }, 502);
  }
}

/** GET /api/stream — 代理流媒体 */
async function handleStream(request, url) {
  const streamUrl = url.searchParams.get('url');
  return proxyStream(request, {
    streamUrl,
    referers: ['https://www.douyin.com/']
  });
}

// ========================================
// Admin 路由
// ========================================

async function handleAdmin(request, path, url) {
  if (path === '/admin/video') {
    const downloadUrl = url.searchParams.get('url');
    const filename = url.searchParams.get('filename') || 'video.mp4';
    return proxyDownload(request, {
      downloadUrl, filename,
      referers: [
        'https://www.douyin.com/', 'https://douyin.com/', 'https://v.douyin.com/'
      ],
      defaultContentType: 'video/mp4'
    });
  }

  if (path === '/admin/music') {
    const downloadUrl = url.searchParams.get('url');
    const filename = url.searchParams.get('filename') || 'audio.mp3';
    return proxyDownload(request, {
      downloadUrl, filename,
      referers: ['https://music.douyin.com/', 'https://qishui.douyin.com/', 'https://www.douyin.com/'],
      defaultContentType: 'audio/mpeg'
    });
  }

  if (path === '/admin/download') {
    const downloadUrl = url.searchParams.get('url');
    const filename = url.searchParams.get('filename') || 'download.mp4';
    return proxyDownload(request, {
      downloadUrl, filename,
      referers: [
        'https://www.douyin.com/', 'https://douyin.com/', 'https://v.douyin.com/',
        'https://music.douyin.com/'
      ],
      defaultContentType: 'video/mp4'
    });
  }

  if (path === '/admin/stream') {
    const streamUrl = url.searchParams.get('url');
    return proxyStream(request, {
      streamUrl,
      referers: [
        'https://www.douyin.com/', 'https://douyin.com/', 'https://v.douyin.com/'
      ]
    });
  }

  if (path === '/admin/info') {
    return json({
      success: true,
      data: { loginExpiry: COOKIE_MAX_AGE, maxAttempts: 3 }
    });
  }

  return null; // 404
}

// ========================================
// 页面路由
// ========================================

async function servePage(path, request, env, url, ip, authed) {
  // 登录页
  if (path === '/' || path === '/index.html') {
    if (authed) {
      return new Response('', { status: 302, headers: { 'Location': '/option', 'Cache-Control': 'no-store' } });
    }
    return env.ASSETS.fetch(new Request(url.origin + '/index.html', {
      headers: { 'X-Internal-Asset': '1' }
    }));
  }

  // 受保护页面：需要登录
  if (!authed) {
    if (path === '/video' || path === '/video.html' || path === '/music' || path === '/option') {
      return new Response('', { status: 302, headers: { 'Location': '/' } });
    }
    return null;
  }

  if (path === '/video.html' || path === '/video') {
    const resp = await env.ASSETS.fetch(new Request(url.origin + '/video.html', {
      headers: { 'X-Internal-Asset': '1' }
    }));
    const newResp = new Response(resp.body, {
      status: resp.status,
      headers: {
        ...Object.fromEntries(resp.headers),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return newResp;
  }

  if (path === '/option') {
    return env.ASSETS.fetch(new Request(url.origin + '/option.html', {
      headers: { 'X-Internal-Asset': '1' }
    }));
  }

  if (path === '/music') {
    return env.ASSETS.fetch(new Request(url.origin + '/music.html', {
      headers: { 'X-Internal-Asset': '1' }
    }));
  }

  return null;
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
  // 运行时初始化
  setJwtSecret(env.JWT_SECRET || env.SECRET_KEY);

  // 内部资产请求直接放行（Worker 内部 env.ASSETS.fetch 用）
  if (request.headers.get('X-Internal-Asset')) {
    return env.ASSETS.fetch(request);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // ========================================
  // 环境变量检查 — 任一缺失即拒绝所有操作
  // ========================================
  const missingVars = [];
  if (!env.SECRET_KEY) missingVars.push('SECRET_KEY');
  if (!env.JWT_SECRET) missingVars.push('JWT_SECRET');
  if (missingVars.length > 0) {
    const msg = missingVars.join('、');
    const isApi = path.startsWith('/api/');
    // API 请求返回 JSON，页面请求返回 HTML
    if (isApi) {
      const jsonStr = JSON.stringify({
        error: '环境变量未配置: ' + msg + '。请在 Cloudflare Pages 控制台 → 项目设置 → 环境变量中添加。',
        code: 'ENV_MISSING',
        missing: missingVars
      });
      return new Response(jsonStr, {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>配置错误 - Media Parser</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:560px;width:100%;padding:40px;text-align:center}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:22px;color:#1a1a1a;margin-bottom:8px}
.desc{font-size:14px;color:#666;line-height:1.6;margin-bottom:24px}
.missing{background:#fff3f3;border:1px solid #ffd7d7;border-radius:8px;padding:16px;margin-bottom:24px;text-align:left}
.missing-label{font-size:12px;color:#999;margin-bottom:6px}
.missing-item{font-size:15px;font-weight:600;color:#e53935;font-family:monospace}
.steps{text-align:left;background:#f8f9ff;border:1px solid #e0e3f0;border-radius:8px;padding:16px;margin-bottom:24px}
.steps h3{font-size:14px;color:#333;margin-bottom:10px}
.steps ol{margin-left:18px;font-size:13px;color:#555;line-height:1.8}
.steps code{background:#e8eaf6;padding:2px 6px;border-radius:3px;font-size:12px;color:#3949ab}
.footer{font-size:12px;color:#bbb}
</style>
</head>
<body>
<div class="card">
<div class="icon">⚠️</div>
<h1>环境变量未配置</h1>
<p class="desc">缺少必要配置项，服务无法启动</p>
<div class="missing">
<div class="missing-label">缺失的变量</div>
<div class="missing-item">${msg}</div>
</div>
<div class="steps">
<h3>配置方法</h3>
<ol>
<li>登录 <a href="https://dash.cloudflare.com">Cloudflare Dashboard</a></li>
<li>进入 Workers 和 Pages → 你的项目 → 设置 → 环境变量</li>
<li>添加以下变量（<code>SECRET_KEY</code> 和 <code>JWT_SECRET</code>）</li>
<li>添加后重新部署项目</li>
</ol>
</div>
<div class="footer">Media Parser Worker · Cloudflare Pages</div>
</div>
</body>
</html>`;
    return new Response(html, {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  // 跨域防护
  const origin = request.headers.get('Origin') || '';
  if (origin) {
    try {
      const originHost = new URL(origin).hostname;
      if (originHost && originHost !== url.hostname) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch (e) { /* ignore */ }
  }

  // OPTIONS 预检
  if (request.method === 'OPTIONS') {
    return addSecurityHeaders(new Response(null, { status: 204 }));
  }

  const ip = getClientIP(request);

  // ---- API 路由（无需授权）----
  if (path === '/api/verify' && request.method === 'POST') {
    const resp = await handleVerify(request, env, ip);
    return addSecurityHeaders(resp);
  }

  if (path === '/api/logout' && request.method === 'POST') {
    return handleLogout();
  }

  // ---- API 路由（需要授权）----
  const authed = await isAuth(request, ip);

  if (path === '/api/parse') {
    if (!authed) return addSecurityHeaders(json({ error: '未授权' }, 403));
    const resp = await handleParse(request, url);
    return addSecurityHeaders(resp);
  }

  if (path === '/api/music') {
    if (!authed) return addSecurityHeaders(json({ error: '未授权' }, 403));
    const resp = await handleMusicApi(request, url);
    return addSecurityHeaders(resp);
  }

  if (path === '/api/download') {
    if (!authed) return addSecurityHeaders(json({ error: '未授权' }, 403));
    const resp = await handleDownload(request, url);
    return addSecurityHeaders(resp);
  }

  if (path === '/api/download/zip') {
    if (!authed) return addSecurityHeaders(json({ error: '未授权' }, 403));
    const resp = await handleDownloadZip(request);
    return addSecurityHeaders(resp);
  }

  if (path === '/api/proxy/image') {
    if (!authed) return addSecurityHeaders(json({ error: '未授权' }, 403));
    const resp = await handleImageProxy(url);
    return addSecurityHeaders(resp);
  }

  if (path === '/api/stream') {
    if (!authed) return addSecurityHeaders(json({ error: '未授权' }, 403));
    const resp = await handleStream(request, url);
    return addSecurityHeaders(resp);
  }

  // ---- Admin 路由 ----
  if (path.startsWith('/admin')) {
    if (!authed) return addSecurityHeaders(new Response('Unauthorized', { status: 403 }));
    const resp = await handleAdmin(request, path, url);
    if (resp) return addSecurityHeaders(resp);
    return addSecurityHeaders(new Response('Admin Not Found', { status: 404 }));
  }

  // ---- 页面路由 ----
  const pageResp = await servePage(path, request, env, url, ip, authed);
  if (pageResp) return addSecurityHeaders(pageResp);

  // 404
  if (path === '/favicon.ico') {
    return addSecurityHeaders(new Response(null, { status: 204 }));
  }

  return addSecurityHeaders(new Response('Not Found', { status: 404 }));
}
