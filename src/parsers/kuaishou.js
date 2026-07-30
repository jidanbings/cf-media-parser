// ========================================
// 快手解析器 v5 — 仿照 media-parser 策略
//
// 策略:
//   1. 始终先请求用户原始输入 URL
//   2. 带必要 Cookie + UA 轮换
//   3. 优先 __APOLLO_STATE__ (视频页), 其次 INIT_STATE (图文页)
//   4. 多候选 URL 兜底
// ========================================

import { UA_PC, UA_MOBILE } from '../config.js';
import { createEmptyResult, buildResult } from './base.js';

// media-parser 中的静态 Cookie (did/clientid/kpf 为关键字段)
const KS_COOKIES = 'kpf=PC_WEB; clientid=3; did=web_bfbcdb2f5b3dc663a745deabafcf61e6; kpn=KUAISHOU_VISION';

/** 标准化 URL：修复协议相对路径和 unicode 转义 */
function normalizeUrl(url) {
  if (!url) return '';
  url = url.replace(/\\u002F/g, '/');
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http://')) return url.replace(/^http:/, 'https:');
  return url;
}

function extractJsonObject(text, startPos) {
  if (startPos < 0 || !text) return null;
  let depth = 0, inStr = false, esc = false, quote = '';
  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.substring(startPos, i + 1); }
  }
  return null;
}

function extractPhotoId(url) {
  const patterns = [
    /(?:short-video|video)\/([a-zA-Z0-9]{6,})/,
    /f\/([a-zA-Z0-9]{6,})/,
    /kuaishou\.com\/(?:s\/)?([a-zA-Z0-9]{6,})/,
    /chenzhongtech\.com\/fw\/photo\/([a-zA-Z0-9]{6,})/,
    /([a-zA-Z0-9]{10,})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * 从 INIT_STATE 或 __APOLLO_STATE__ 中提取 photo 数据
 */
function findPhotoData(data) {
  if (!data || typeof data !== 'object') return null;

  // 直接包含 photo 字段的对象
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (!val || typeof val !== 'object') continue;

    // ATLAS 模式: 同时有 atlas + photo
    if (val.atlas && val.photo) {
      return { type: 'atlas', data: val, photo: val.photo };
    }

    // APOLLO 模式: photo 有 caption/photoUrl
    if (val.caption || val.photoUrl || val.mainMvUrls || val.coverUrl) {
      return { type: 'photo', data: val, photo: val };
    }
  }

  // 再搜一层（处理嵌套）
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (!val || typeof val !== 'object') continue;
    for (const k2 of Object.keys(val)) {
      const v2 = val[k2];
      if (!v2 || typeof v2 !== 'object') continue;
      if (v2.caption || v2.photoUrl || v2.mainMvUrls) {
        return { type: 'photo', data: v2, photo: v2 };
      }
    }
  }

  return null;
}

/**
 * 从 HTML 中提取嵌入数据 (__APOLLO_STATE__ 或 INIT_STATE)
 */
function extractEmbeddedData(html) {
  const markers = [
    'window.__APOLLO_STATE__',
    'window.INIT_STATE',
    'window.__INITIAL_STATE__'
  ];
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx < 0) continue;
    const start = html.indexOf('{', idx + marker.length);
    if (start < 0) continue;
    const jsonStr = extractJsonObject(html, start);
    if (!jsonStr) continue;
    try {
      const data = JSON.parse(jsonStr);
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        return data;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

function buildImageUrl(cdnList, item) {
  const path = typeof item === 'string' ? item : (item.path || '');
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('//')) return 'https:' + path;
  const cdn = Array.isArray(cdnList) && cdnList.length > 0
    ? String(cdnList[0]).replace(/^https?:\/\//, '')
    : 'p23.a.yximgs.com';
  return `https://${cdn}/${path.replace(/^\/+/, '')}`;
}

function extractFromEmbedded(data, result) {
  const found = findPhotoData(data);
  if (!found) return false;

  const { photo, type, data: parentData } = found;

  // 标题
  result.title = photo.caption || result.title;

  // 作者
  if (photo.userName) result.author = photo.userName;
  else if (photo.author?.name) result.author = photo.author.name;

  if (photo.userEid) result.authorId = String(photo.userEid);
  else if (photo.kwaiId) result.authorId = String(photo.kwaiId);
  else if (photo.author?.id) result.authorId = String(photo.author.id).replace(/^Author:/, '');

  if (photo.headUrl) {
    result.avatar = normalizeUrl(typeof photo.headUrl === 'string' ? photo.headUrl : photo.headUrl.url || '');
  } else if (Array.isArray(photo.headUrls) && photo.headUrls[0]) {
    result.avatar = normalizeUrl(photo.headUrls[0].url || photo.headUrls[0]);
  } else if (photo.author?.headerUrl) {
    result.avatar = normalizeUrl(photo.author.headerUrl);
  }

  // 封面（标准化 URL）
  result.cover = normalizeUrl(photo.coverUrl) || result.cover;

  // 视频
  if (photo.photoUrl && result.videos.length === 0) {
    result.videos.push({ url: normalizeUrl(photo.photoUrl), quality: '高清' });
  }
  if (result.videos.length === 0 && Array.isArray(photo.mainMvUrls) && photo.mainMvUrls[0]) {
    const url = typeof photo.mainMvUrls[0] === 'string'
      ? photo.mainMvUrls[0]
      : (photo.mainMvUrls[0].url || '');
    if (url) result.videos.push({ url: url.replace(/\\u002F/g, '/'), quality: '高清' });
  }

  // 图片 (atlas 模式)
  if (type === 'atlas' && parentData.atlas && Array.isArray(parentData.atlas.list)) {
    const cdnList = parentData.atlas.cdn || parentData.atlas.cdnList || [];
    parentData.atlas.list.forEach((item, i) => {
      const url = buildImageUrl(cdnList, item);
      if (!url) return;
      if (url.toLowerCase().includes('.gif')) result.gifs.push({ url, index: i + 1 });
      else result.images.push({ url, index: i + 1 });
    });
  }

  // Apollo 模式: 若有 manifest 取 video
  if (result.videos.length === 0 && photo.manifest?.adaptationSet) {
    for (const as of photo.manifest.adaptationSet) {
      for (const rep of as.representation || []) {
        const url = rep.backupUrl?.[0] || rep.url || '';
        if (url) {
          result.videos.push({ url: url.replace(/\\u002F/g, '/'), quality: rep.qualityLabel || '高清' });
          break;
        }
      }
      if (result.videos.length > 0) break;
    }
  }

  return true;
}

/**
 * 正则兜底提取
 */
function extractFromRegex(html, result) {
  if (!html || html.length < 200) return false;
  let found = false;

  const captionM = html.match(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (captionM) { result.title = captionM[1]; found = true; }

  const userNameM = html.match(/"userName"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (userNameM) { result.author = userNameM[1]; found = true; }

  const userEidM = html.match(/"userEid"\s*:\s*"([^"]+)"/);
  if (userEidM) { result.authorId = userEidM[1]; found = true; }

  const headUrlM = html.match(/"headUrl"\s*:\s*"([^"]+)"/);
  if (headUrlM) { result.avatar = headUrlM[1].replace(/\\u002F/g, '/'); found = true; }

  const coverM = html.match(/"coverUrl"\s*:\s*"([^"]+)"/);
  if (coverM) { result.cover = coverM[1].replace(/\\u002F/g, '/'); found = true; }

  const photoUrlM = html.match(/"photoUrl"\s*:\s*"([^"]+)"/);
  if (photoUrlM && result.videos.length === 0) {
    result.videos.push({ url: photoUrlM[1].replace(/\\u002F/g, '/'), quality: '高清' });
    found = true;
  }

  // 处理 /
  if (result.title) result.title = result.title.replace(/\\u002F/g, '/');
  if (result.author) result.author = result.author.replace(/\\u002F/g, '/');

  return found;
}

/**
 * 尝试用给定 URL + headers 抓取并提取数据
 */
async function tryFetchAndExtract(url, headersConfig, result) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': UA_PC,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.kuaishou.com/',
        ...headersConfig
      },
      redirect: 'follow'
    });

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('json')) return false; // 被风控

    const html = await resp.text();
    if (!html || html.length < 200) return false;

    // 先尝试嵌入数据
    const embeddedData = extractEmbeddedData(html);
    if (embeddedData && extractFromEmbedded(embeddedData, result)) return true;

    // 正则兜底
    return extractFromRegex(html, result);
  } catch (e) {
    return false;
  }
}

/**
 * 主入口
 */
export async function parseKuaishou(inputUrl) {
  const result = createEmptyResult('快手');

  try {
    const photoId = extractPhotoId(inputUrl);

    // 快速尝试路径：原始 URL → 构造 URL，每种只试 cookie + mobile UA
    const urls = [inputUrl];
    if (photoId) {
      const wwwUrl = `https://www.kuaishou.com/short-video/${photoId}`;
      if (!urls.includes(wwwUrl)) urls.push(wwwUrl);
    }

    for (const url of urls) {
      // 带 cookie
      if (await tryFetchAndExtract(url, { cookie: KS_COOKIES }, result)) return buildResult(result);
      // 带 cookie + 手机 UA
      if (await tryFetchAndExtract(url, { cookie: KS_COOKIES, 'User-Agent': UA_MOBILE }, result)) return buildResult(result);
    }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
