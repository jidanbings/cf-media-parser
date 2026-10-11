// ========================================
// 哔哩哔哩（B站）解析器
// ========================================
//
// 双 API 联动：
//   ① 详情：x/web-interface/view 或 pgc/view/web/season  → 取 cid / 标题 / 封面 / UP主
//   ② 播放：x/player/playurl 或 pgc/player/web/playurl  → 取 durl[0].url
//
// 说明：
//   · 播放接口带 platform=html5，返回音视频合一的单文件 MP4
//   · 播放直链带 Referer: https://www.bilibili.com/
//   · 番剧/剧集走 PGC 接口
// ========================================

import { createEmptyResult, buildResult, ensureHttps } from './base.js';

const API_VIEW = 'https://api.bilibili.com/x/web-interface/view';
const API_PLAYURL = 'https://api.bilibili.com/x/player/playurl';
const API_PGC_PLAYURL = 'https://api.bilibili.com/pgc/player/web/playurl';
const API_SEASON_VIEW = 'https://api.bilibili.com/pgc/view/web/season';
const API_FINGER_SPI = 'https://api.bilibili.com/x/frontend/finger/spi';

/**
 * buvid 缓存（进程内）
 */
let BUVID_CACHE = null;

/** 环境变量中配置的 Cookie（可选） */
let ENV_COOKIE = '';

/**
 * 领取 buvid3 / buvid4
 * @returns {Promise<string>} Cookie 串（失败返回空串）
 */
async function fetchBuvidCookie() {
  const env = (ENV_COOKIE ? ENV_COOKIE + '; ' : '');
  if (BUVID_CACHE) return env + BUVID_CACHE;
  try {
    const resp = await fetch(API_FINGER_SPI, { headers: { 'User-Agent': UA_BROWSER, 'Referer': REFERER } });
    if (!resp.ok) return ENV_COOKIE;
    const json = await resp.json();
    const d = (json && json.data) || {};
    const parts = [];
    if (d.b_3) parts.push('buvid3=' + d.b_3);
    if (d.b_4) parts.push('buvid4=' + d.b_4);
    BUVID_CACHE = parts.join('; ');
    return env + BUVID_CACHE;
  } catch {
    return ENV_COOKIE;
  }
}

/** 浏览器标识 —— 用于播放接口 */
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 详情接口专用 UA */
const UA_CLIENT = 'okhttp/4.9.3';

const REFERER = 'https://www.bilibili.com/';

/** 详情接口请求头 */
const VIEW_HEADERS = { 'User-Agent': UA_CLIENT, 'Referer': REFERER };
/** 播放接口请求头 */
const PLAY_HEADERS = { 'User-Agent': UA_BROWSER, 'Referer': REFERER };

// ---------- ID 提取 ----------

/**
 * 提取 BV 号
 * @param {string} url
 * @returns {string}
 */
function extractBvid(url) {
  const m = url.match(/(BV[a-zA-Z0-9]+)/);
  return m ? m[1] : '';
}

/**
 * 提取番剧 EP 号
 * @param {string} url
 * @returns {string}
 */
function extractEpId(url) {
  const m = url.match(/(?:bangumi\/play\/ep|b23\.tv\/ep|ep_id=)(\d+)/);
  return m ? m[1] : '';
}

/**
 * 提取番剧 Season 号
 * @param {string} url
 * @returns {string}
 */
function extractSeasonId(url) {
  const m = url.match(/(?:bangumi\/play\/ss|season_id=)(\d+)/);
  return m ? m[1] : '';
}

/**
 * 提取 AV 号（旧格式）
 * @param {string} url
 * @returns {string}
 */
function extractAid(url) {
  const m = url.match(/(?:av|aid=)(\d+)/i);
  return m ? m[1] : '';
}

// ---------- 接口封装 ----------

/**
 * 请求并解包 B站统一响应格式 { code, message, data|result }
 *
 * @param {string} url
 * @param {object} headers
 * @returns {Promise<{ data: object|null, httpStatus: number, code: number }>}
 */
async function fetchUnwrapped(url, headers) {
  const buvid = await fetchBuvidCookie();
  const out = { data: null, httpStatus: 0, code: -1 };
  try {
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...headers,
        ...(buvid ? { 'Cookie': buvid } : {})
      },
      redirect: 'follow'
    });
    out.httpStatus = resp.status;
    if (!resp.ok) return out;

    const json = await resp.json();
    out.code = json.code;
    if (json.code !== 0) return out;
    out.data = json.data || json.result || null;
    return out;
  } catch {
    return out;
  }
}

/**
 * 获取番剧/剧集 Season 详情
 * @param {string} epId
 * @param {string} seasonId
 * @returns {Promise<object|null>}
 */
async function fetchSeasonInfo(epId, seasonId) {
  const params = epId ? `ep_id=${epId}` : `season_id=${seasonId}`;
  const r = await fetchUnwrapped(`${API_SEASON_VIEW}?${params}`, PLAY_HEADERS);
  return r.data;
}

/**
 * 获取常规视频详情
 * @param {string} bvid
 * @param {string} aid
 * @returns {Promise<object|null>}
 */
async function fetchVideoInfo(bvid, aid) {
  const params = bvid ? `bvid=${bvid}` : `aid=${aid}`;
  const r = await fetchUnwrapped(`${API_VIEW}?${params}`, VIEW_HEADERS);
  return r.data;
}

/**
 * 获取播放地址（单文件 MP4）
 *
 * platform=html5 是关键参数：B站据此返回 Progressive MP4（音视频已合并），
 * 而非 DASH 分离流。缺省 platform 时拿到的是两条独立的 m4s，下载后无声。
 *
 * @param {object} opts
 * @returns {Promise<{ url: string, quality: string, size: number, duration: number }>}
 */
async function fetchPlayUrl({ bvid, cid, epId, seasonId, isPgc }) {
  const empty = { url: '', quality: '', size: 0, duration: 0 };

  if (isPgc) {
    // 番剧 / 剧集
    const qs = new URLSearchParams({
      otype: 'json',
      qn: '80',
      fnval: '1',
      cid: String(cid)
    });
    if (epId) qs.set('ep_id', epId);
    if (bvid) qs.set('bvid', bvid);

    const rPgc = await fetchUnwrapped(`${API_PGC_PLAYURL}?${qs}`, PLAY_HEADERS);
    const data = rPgc.data;
    const durl = data && data.durl && data.durl[0];
    if (durl && durl.url) {
      return {
        url: ensureHttps(durl.url),
        quality: (data.quality && String(data.quality)) || '高清',
        size: durl.size || 0,
        duration: (data.timelength || 0) / 1000
      };
    }
    return empty;
  }

  // 常规 UGC 视频
  const qs = new URLSearchParams({
    otype: 'json',
    fnver: '0',
    fnval: '3',
    player: '3',
    qn: '112',
    platform: 'html5',      // ← 关键：强制单文件 MP4
    high_quality: '1',
    cid: String(cid)
  });
  if (bvid) qs.set('bvid', bvid);

  const rUgc = await fetchUnwrapped(`${API_PLAYURL}?${qs}`, PLAY_HEADERS);
  const data = rUgc.data;
  const durl = data && data.durl && data.durl[0];
  if (durl && durl.url) {
    return {
      url: ensureHttps(durl.url),
      quality: (data.quality && String(data.quality)) || '高清',
      size: durl.size || 0,
      duration: (data.timelength || 0) / 1000
    };
  }
  return empty;
}

/** 画质代码 → 可读标签 */
function qualityLabel(qn) {
  const map = {
    112: '1080P+', 80: '1080P', 74: '720P60', 64: '720P',
    32: '480P', 16: '360P', 6: '240P'
  };
  return map[qn] || '高清';
}

// ---------- 主入口 ----------

/**
 * 解析 B站分享链接
 * @param {string} inputUrl
 * @param {object} [env] - 预留（B站基础流免 Cookie）
 * @returns {Promise<object>}
 */
export async function parseBilibili(inputUrl, env) {
  const result = createEmptyResult('哔哩哔哩');

  // 记录可选的用户 Cookie（若有），供所有子请求复用
  ENV_COOKIE = String((env && env.BILIBILI_COOKIE) || '').trim().replace(/^['"]|['"]$/g, '');

  try {
    let bvid = extractBvid(inputUrl);
    let epId = extractEpId(inputUrl);
    let seasonId = extractSeasonId(inputUrl);
    const aid = extractAid(inputUrl);

    // ---- 番剧 / 剧集分支 ----
    if (epId || seasonId) {
      const season = await fetchSeasonInfo(epId, seasonId);
      if (season) {
        const allEps = [].concat(
          Array.isArray(season.episodes) ? season.episodes : [],
          ...(Array.isArray(season.section) ? season.section.map(s => s.episodes || []) : [])
        );

        // 指定 ep 优先，否则取第一集
        let ep = epId
          ? allEps.find(e => String(e.id) === String(epId))
          : allEps[0];
        if (!ep && allEps.length) ep = allEps[0];

        if (ep) {
          result.title = [season.title, ep.title, ep.long_title]
            .filter(Boolean).join(' ').trim();
          result.cover = ensureHttps(season.cover || ep.cover || '');
          bvid = ep.bvid || bvid;

          const play = await fetchPlayUrl({
            bvid: ep.bvid, cid: ep.cid, epId: ep.id, isPgc: true
          });
          if (play.url) {
            result.videos.push({ url: play.url, quality: '高清' });
            if (!result.title) result.title = '番剧视频';
            return buildResult(result);
          }
        }

        // 取到元信息但无播放地址（可能是付费/未开播）
        if (season.title) {
          result.title = season.title;
          result.cover = ensureHttps(season.cover || '');
          return buildResult(result);
        }
      }
      return buildResult(result);
    }

    // ---- 常规视频分支 ----
    if (!bvid && !aid) throw new Error('无法提取 BV 号或 AV 号');

    const info = await fetchVideoInfo(bvid, aid);
    if (!info) {
      // 接口异常：以 error 形式返回
      return {
        error: true,
        message: 'B站接口拒绝了本次请求，当前运行环境可能无法访问 B站。'
      };
    }

    bvid = info.bvid || bvid;

    result.title = info.title || '';
    result.cover = ensureHttps(info.pic || '');
    if (info.owner) {
      result.author = info.owner.name || '未知';
      result.authorId = String(info.owner.mid || '');
      result.avatar = ensureHttps(info.owner.face || '');
    }

    // 分P：优先第一P
    const pages = Array.isArray(info.pages) && info.pages.length
      ? info.pages
      : [{ cid: info.cid, page: 1, part: info.title }];

    for (const page of pages) {
      if (!page.cid) continue;
      const play = await fetchPlayUrl({ bvid, cid: page.cid, isPgc: false });
      if (play.url) {
        const suffix = pages.length > 1 ? ` P${page.page}` : '';
        result.videos.push({
          url: play.url,
          quality: (qualityLabel(play.quality) || '高清') + suffix
        });
        // 仅取第一P作为主视频，避免图文/视频列表过长
        break;
      }
    }

    if (!result.videos.length) {
      // 有元信息但无播放流（充电专属 / 地区限制 / 付费未购）。
      // 保留已取到的标题与封面，但不要把状态说明拼进标题污染数据。
      result.noPlayUrl = true;
    }

    return buildResult(result);
  } catch (e) {
    // 不再静默返回空结果（那会被前端当成「解析成功但没内容」）
    return { error: true, message: 'B站解析失败: ' + (e && e.message ? e.message : '未知错误') };
  }
}

export { extractBvid, extractEpId, qualityLabel };
