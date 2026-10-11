// ========================================
// 快手解析器
// ========================================

import { UA_PC, UA_MOBILE } from '../config.js';
import { createEmptyResult, buildResult, extractJsonObject } from './base.js';

// 快手默认 Cookie
const KS_DEFAULT_COOKIES = 'kpf=PC_WEB; clientid=3; did=web_bfbcdb2f5b3dc663a745deabafcf61e6; kpn=KUAISHOU_VISION';

/**
 * 取快手 Cookie：优先环境变量 KUAISHOU_COOKIE，否则用内置默认值
 * @param {object} env
 * @returns {string}
 */
function resolveCookies(env) {
  const raw = (env && env.KUAISHOU_COOKIE) || '';
  if (!raw) return KS_DEFAULT_COOKIES;
  // 兼容 .env / Cloudflare 变量里的引号包裹
  const cleaned = String(raw).trim().replace(/^['"]|['"]$/g, '');
  return cleaned || KS_DEFAULT_COOKIES;
}

/** 标准化 URL：修复协议相对路径、JSON 转义、unicode 转义 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.replace(/\\u002F/g, '/');
  url = url.replace(/\\\//g, '/');
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http://')) return url.replace(/^http:/, 'https:');
  return url;
}

function extractPhotoId(url) {
  if (!url) return null;

  // 注意：不能笼统地匹配 "kuaishou.com/后面的任意串"。
  // 短链形式 v.kuaishou.com/JE4Gsx1p 里那串**不是** photoId，
  // 而是一个分享码，必须靠跟随重定向才能换到真正的 photoId。
  // 早期版本用 /kuaishou\.com\/(?:s\/)?([a-zA-Z0-9]{6,})/ 会把
  // JE4Gsx1p 当成 ID，导致后续所有直链路由都打空、只能走最慢的兜底。
  const patterns = [
    // 明确的 ID 路径
    /\/short-video\/([a-zA-Z0-9]{6,})/,
    /\/fw\/photo\/([a-zA-Z0-9]{6,})/,
    /\/profile\/([a-zA-Z0-9]{6,})/,
    /[?&]photoId=([a-zA-Z0-9]{6,})/,
    // 旧式 /s/xxx 与 /f/xxx
    /kuaishou\.com\/s\/([a-zA-Z0-9]{6,})/,
    /\/f\/([a-zA-Z0-9]{6,})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }

  // 真正的 photoId 形如 3x9iedxv93ib75s（约 15 位、含 x），
  // 短链分享码通常更短且不含该结构，故用长度阈值兜底。
  const loose = url.match(/\/([a-z0-9]{14,})(?:\?|$|\/)/i);
  return loose ? loose[1] : null;
}

/**
 * 从 INIT_STATE 或 __APOLLO_STATE__ 中提取 photo 数据
 */
function findPhotoData(data) {
  if (!data || typeof data !== 'object') return null;

  // 第1层: 直接包含 photo 字段的对象
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (!val || typeof val !== 'object') continue;

    if (val.atlas && val.photo) {
      return { type: 'atlas', data: val, photo: val.photo };
    }
    if (val.caption || val.photoUrl || val.mainMvUrls || val.coverUrl) {
      return { type: 'photo', data: val, photo: val };
    }
  }

  // 第2层: 嵌套搜索
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

  // 第3层: 更深搜索 (Apollo state 中 Photo:xxx 可能在第2层)
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (!val || typeof val !== 'object') continue;
    for (const k2 of Object.keys(val)) {
      const v2 = val[k2];
      if (!v2 || typeof v2 !== 'object') continue;
      for (const k3 of Object.keys(v2)) {
        const v3 = v2[k3];
        if (!v3 || typeof v3 !== 'object') continue;
        if (v3.caption || v3.photoUrl || v3.mainMvUrls) {
          return { type: 'photo', data: v3, photo: v3 };
        }
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

  // cdnList 元素可能是字符串，也可能是 { cdn: 'p23.a.yximgs.com' } 对象，
  // 直接 String() 会拼出 "https://[object Object]/..."，故需取出 cdn 字段。
  let cdn = '';
  if (Array.isArray(cdnList) && cdnList.length > 0) {
    const first = cdnList[0];
    cdn = typeof first === 'string' ? first : String((first && first.cdn) || '');
  }
  cdn = cdn.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'p23.a.yximgs.com';
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

  // 封面（标准化 URL，兼容对象和字符串两种格式）
  if (photo.coverUrl) {
    result.cover = normalizeUrl(typeof photo.coverUrl === 'string' ? photo.coverUrl : (photo.coverUrl.url || ''));
  }
  if (!result.cover && photo.cover) {
    result.cover = normalizeUrl(typeof photo.cover === 'string' ? photo.cover : (photo.cover.url || ''));
  }
  if (!result.cover && photo.poster) {
    result.cover = normalizeUrl(typeof photo.poster === 'string' ? photo.poster : (photo.poster.url || ''));
  }

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

  // 单图作品（photoType = SINGLE_PICTURE）
  //
  // 三类作品在快手页面里的区分（实测）：
  //   VIDEO             → mainMvUrls 有值（视频）
  //   HORIZONTAL_ATLAS  → 同级有 atlas.list（图集）
  //   SINGLE_PICTURE    → 两者皆无，媒体本体只在 coverUrls 里
  //
  // 此前只把 coverUrls 当"封面"，于是单图作品整个结果为空 ——
  // 表现为「有标题、无任何内容」。
  //
  // 实测该地址是**原图**（3072×4096、约 1.9 MB 的 JPEG），
  // 与 ext_params 声明的尺寸一致，并非缩略图，可直接作为图片直链。
  if (result.videos.length === 0
      && result.images.length === 0
      && result.gifs.length === 0) {
    const singleUrl = pickCoverUrl(photo);
    if (singleUrl) {
      if (singleUrl.toLowerCase().includes('.gif')) {
        result.gifs.push({ url: singleUrl, index: 1 });
      } else {
        result.images.push({ url: singleUrl, index: 1 });
      }
    }
  }

  return true;
}

/**
 * 从 photo 节点中挑选可用的图片直链
 *
 * 兼容三种下发形态：字符串、单个对象、对象数组。
 *
 * @param {object} photo
 * @returns {string}
 */
function pickCoverUrl(photo) {
  if (!photo) return '';

  const from = (node) => {
    if (!node) return '';
    if (typeof node === 'string') return normalizeUrl(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const u = from(item);
        if (u) return u;
      }
      return '';
    }
    if (typeof node === 'object') {
      return normalizeUrl(node.url || node.src || '');
    }
    return '';
  };

  // webpCoverUrls 常与 coverUrls 同源，coverUrls 优先
  return from(photo.coverUrls)
    || from(photo.coverUrl)
    || from(photo.webpCoverUrls)
    || from(photo.cover)
    || from(photo.poster)
    || '';
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

  const coverM = html.match(/"coverUrl"\s*:\s*"([^"]+?)"(?=[,\s\}])/);
  if (coverM) {
    result.cover = coverM[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    found = true;
  }
  if (!result.cover) {
    const coverAlt = html.match(/"cover"\s*:\s*"([^"]+)"/);
    if (coverAlt) {
      const val = coverAlt[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
      if (val.startsWith('http:') || val.startsWith('https:') || val.startsWith('//')) { result.cover = val; found = true; }
    }
  }
  if (!result.cover) {
    const posterM = html.match(/"poster"\s*:\s*"([^"]+)"/);
    if (posterM) {
      const val = posterM[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
      if (val.startsWith('http:') || val.startsWith('https:') || val.startsWith('//')) { result.cover = val; found = true; }
    }
  }

  const photoUrlM = html.match(/"photoUrl"\s*:\s*"([^"]+)"/);
  if (photoUrlM && result.videos.length === 0) {
    result.videos.push({ url: photoUrlM[1].replace(/\\u002F/g, '/'), quality: '高清' });
    found = true;
  }

  // 处理 /
  if (result.title) result.title = result.title.replace(/\\u002F/g, '/');
  if (result.author) result.author = result.author.replace(/\\u002F/g, '/');

  // 兜底：HTML 中直接搜 yximgs CDN 图片 URL（排除已用的头像）
  if (!result.cover) {
    const cdnUrls = html.match(/"https?:\/\/[^"]*?yximgs[^"]*?\.(?:jpg|jpeg|png|webp)"/gi);
    if (cdnUrls) {
      const avatarUrl = result.avatar || '';
      for (const matched of cdnUrls) {
        const url = matched.replace(/^"|"$/g, '').replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        if (url !== avatarUrl) {
          result.cover = url;
          found = true;
          break;
        }
      }
    }
  }
  if (!result.cover) {
    const cdnUrls = html.match(/"https?:\/\/[^"]*?wskwai[^"]*?\.(?:jpg|jpeg|png|webp)"/gi);
    if (cdnUrls) {
      for (const matched of cdnUrls) {
        const url = matched.replace(/^"|"$/g, '').replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        const avatarUrl = result.avatar || '';
        if (url !== avatarUrl) {
          result.cover = url;
          found = true;
          break;
        }
      }
    }
  }

  return found;
}

/**
 * 尝试用给定 URL + headers 抓取并提取数据
 * @returns {Promise<boolean>} 是否提取到可用媒体
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
    // 返回 JSON 说明请求未命中页面
    if (contentType.includes('json')) return false;

    const html = await resp.text();
    if (!html || html.length < 200) return false;

    // 先尝试嵌入数据，再用正则补齐缺失字段（如封面）
    const embeddedData = extractEmbeddedData(html);
    if (embeddedData) {
      try { extractFromEmbedded(embeddedData, result); } catch { /* 继续用正则 */ }
    }

    const regexOk = extractFromRegex(html, result);

    // 判定成功：至少要拿到视频或图片
    return regexOk && (result.videos.length > 0 || result.images.length > 0);
  } catch {
    return false;
  }
}

/**
 * GraphQL 官方接口兜底通道
 *
 * @param {string} photoId
 * @param {object} result
 * @returns {Promise<boolean>}
 */
async function tryGraphQLApi(photoId, result, cookies) {
  if (!photoId) return false;

  const query = `query visionVideoDetail($photoId: String, $type: String, $page: String, $webPageArea: String) {
  visionVideoDetail(photoId: $photoId, type: $type, page: $page, webPageArea: $webPageArea) {
    status
    type
    author { id name headerUrl }
    photo {
      id caption coverUrl photoUrl
      mainMvUrls { url }
      manifest { adaptationSet { representation { url backupUrl } } }
      atlas { cdn cdnList list }
    }
  }
}`;

  try {
    const resp = await fetch('https://www.kuaishou.com/graphql', {
      method: 'POST',
      headers: {
        'User-Agent': UA_MOBILE,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Origin': 'https://www.kuaishou.com',
        'Referer': `https://www.kuaishou.com/short-video/${photoId}`,
        'Cookie': cookies
      },
      body: JSON.stringify({
        operationName: 'visionVideoDetail',
        variables: { photoId, type: '1', page: 'detail', webPageArea: '' },
        query
      })
    });

    if (!resp.ok) return false;
    const json = await resp.json();
    const vd = json && json.data && json.data.visionVideoDetail;
    if (!vd || !vd.photo) return false;

    const photo = vd.photo;
    const author = vd.author || {};

    result.title = photo.caption || result.title;
    result.author = author.name || result.author;
    result.authorId = String(author.id || result.authorId || '').replace(/^Author:/, '');
    result.avatar = normalizeUrl(author.headerUrl || result.avatar);
    result.cover = normalizeUrl(photo.coverUrl || result.cover);

    // 视频：mainMvUrls 优先，其次 manifest 备用流
    if (Array.isArray(photo.mainMvUrls) && photo.mainMvUrls[0] && result.videos.length === 0) {
      const u = typeof photo.mainMvUrls[0] === 'string'
        ? photo.mainMvUrls[0]
        : photo.mainMvUrls[0].url;
      if (u) result.videos.push({ url: normalizeUrl(u), quality: '高清' });
    }
    if (result.videos.length === 0 && photo.photoUrl) {
      result.videos.push({ url: normalizeUrl(photo.photoUrl), quality: '高清' });
    }
    if (result.videos.length === 0 && photo.manifest && photo.manifest.adaptationSet) {
      for (const as of photo.manifest.adaptationSet) {
        for (const rep of (as.representation || [])) {
          const u = (rep.backupUrl && rep.backupUrl[0]) || rep.url;
          if (u) {
            result.videos.push({ url: normalizeUrl(u), quality: rep.qualityLabel || '高清' });
            break;
          }
        }
        if (result.videos.length > 0) break;
      }
    }

    // 图集（ATLAS）
    if (result.images.length === 0 && photo.atlas && Array.isArray(photo.atlas.list)) {
      const cdnList = photo.atlas.cdn || photo.atlas.cdnList || [];
      photo.atlas.list.forEach((item, i) => {
        const url = buildImageUrl(cdnList, item);
        if (!url) return;
        if (url.toLowerCase().includes('.gif')) result.gifs.push({ url, index: i + 1 });
        else result.images.push({ url, index: i + 1 });
      });
    }

    return result.videos.length > 0 || result.images.length > 0;
  } catch {
    return false;
  }
}

/**
 * 低成本解析短链，取出 photoId
 *
 * 直接 follow 并读取 body 会下载整个落地页（实测约 183 KB、耗时可达十余秒），
 * 而我们只需要重定向目标里的 photoId。改用 redirect:'manual' 只读 Location，
 * 可省掉整页下载。
 *
 * @param {string} url
 * @param {string} ua
 * @returns {Promise<string>} photoId，取不到则返回空串
 */
async function resolvePhotoIdFromShortLink(url, ua) {
  if (!url) return '';
  try {
    const resp = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });

    // 先看 Location，其次看已跟随后的最终 URL
    const candidates = [];
    const loc = resp.headers.get('location');
    if (loc) candidates.push(loc);
    if (resp.url) candidates.push(resp.url);

    for (const c of candidates) {
      const m = String(c).match(/\/fw\/photo\/([a-zA-Z0-9]+)/)
        || String(c).match(/[?&]photoId=([a-zA-Z0-9]+)/)
        || String(c).match(/\/short-video\/([a-zA-Z0-9]+)/);
      if (m) return m[1];
    }
  } catch { /* 取不到就按原流程走 */ }
  return '';
}

/**
 * 主入口
 *
 * 多路由降级策略：
 *   1. 原始落地页
 *   2. 移动端网关
 *   3. PC 直链
 *   4. GraphQL 官方接口
 */
export async function parseKuaishou(inputUrl, env) {
  const result = createEmptyResult('快手');

  try {
    const cookies = resolveCookies(env);

    // ---- 先尽量补出 photoId ----
    // 短链（v.kuaishou.com/xxx）自身不含 ID，需要解析重定向；
    // 用 manual 模式只读 Location，避免下载整页（这是主要延迟来源）。
    let photoId = extractPhotoId(inputUrl);
    if (!photoId && inputUrl) {
      photoId = await resolvePhotoIdFromShortLink(inputUrl, UA_MOBILE);
      if (!photoId) photoId = await resolvePhotoIdFromShortLink(inputUrl, UA_PC);
    }

    // ---- 构建候选路由 ----
    //
    // 顺序很关键：优先打"已知 photoId 的直连页"，最后才回到原始短链。
    // 短链落地页体积大（实测约 183 KB）、响应慢，只应作为兜底。
    const urls = [];

    if (photoId) {
      // 1) 移动端专用网关（通常最快，直接返回含 INIT_STATE 的页面）
      urls.push(`https://v.m.chenzhongtech.com/fw/photo/${photoId}`);
      // 2) PC 直链
      urls.push(`https://www.kuaishou.com/short-video/${photoId}`);
    }

    // 3) 用户原始 URL（含短链，让其自行 302）—— 兜底
    if (inputUrl && !urls.includes(inputUrl)) urls.push(inputUrl);

    // ---- 逐条尝试：每条路由先移动端 UA，再桌面端 UA ----
    for (const url of urls) {
      if (await tryFetchAndExtract(url, { 'User-Agent': UA_MOBILE, 'Cookie': cookies }, result)) {
        return buildResult(result);
      }
      if (await tryFetchAndExtract(url, { 'Cookie': cookies }, result)) {
        return buildResult(result);
      }
    }

    // ---- 兜底：GraphQL ----
    if (await tryGraphQLApi(photoId, result, cookies)) {
      return buildResult(result);
    }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
