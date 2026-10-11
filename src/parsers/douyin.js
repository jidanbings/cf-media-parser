// ========================================
// 抖音解析器
// ========================================
//
// 多接口容灾：
//   常规视频 → ① 移动端 Feed API
//             ② 移动端分享页 SSR
//             ③ PC Web 详情 API
//
//   图文/实况 → ① PC Web 详情 API
//              ② 分享页 SSR
//
// 说明：
//   · 画质仲裁：H.264 优先 → 分辨率 → 码率 → 体积
//   · playwm → play，ratio=720p → 1080p
//   · 图集取 url_list 末项
// ========================================

import { UA_PC, UA_MOBILE } from '../config.js';
import { createEmptyResult, buildResult, extractJsonObject } from './base.js';
import { generate_a_bogus } from './a_bogus.js';

// ---------- 常量 ----------

/** 移动端 Feed 节点 */
const MOBILE_FEED_UA = 'com.ss.android.ugc.aweme/220201 (Linux; U; Android 11; zh_CN; '
  + 'Pixel 4; Build/RQ3A.211001.001; Cronet/58.0.2991.0)';

/**
 * Feed 接口的 aid（应用标识）
 *
 * 这个参数不是可选的细节：**它对返回结果起决定作用**。
 * 实测同一个 aweme_id：
 *   aid=1128（抖音极速版）→ 图文作品会被替换成一条毫不相干的推荐视频，
 *                          响应里根本没有 images 数组
 *   aid=6383（抖音主端）  → 正常返回该作品，含 images[] / media_type=2
 * 因此图文作品必须用 6383 请求，否则会解析出「别人的视频」。
 */
const AID_MAIN = '6383';    // 抖音主端，图文/幻灯片必需
const AID_LITE = '1128';    // 极速版，常规视频同样可用

const MOBILE_FEED_ENDPOINTS = [
  'https://api5-normal-c-hl.amemv.com/aweme/v1/feed/',
  'https://aweme.snssdk.com/aweme/v1/feed/'
];

/** PC Web API 使用的 UA */
const WEB_API_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

/** ttwid 进程内缓存 */
let TTWID_CACHE = null;

// ---------- ID 与链接 ----------

/**
 * 从链接中提取作品 ID
 * @param {string} url
 * @returns {string}
 */
function extractAwemeId(url) {
  const patterns = [
    /\/video\/(\d+)/, /\/note\/(\d+)/, /\/slides\/(\d+)/,
    /share\/video\/(\d+)/, /share\/slides\/(\d+)/, /share\/note\/(\d+)/,
    /modal_id=(\d+)/, /aweme_id=(\d+)/, /item_id=(\d+)/,
    /(\d{17,21})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return '';
}

/** 判断链接是否为图文作品 */
function isImagePost(inputUrl) {
  return /\/note\/|\/slides\/|share\/note|share\/slides/.test(inputUrl);
}

/** 跟随短链重定向，返回最终 URL */
async function resolveShortLink(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA_PC, 'Accept': 'text/html,*/*' },
      redirect: 'follow'
    });
    return resp.url || url;
  } catch {
    return url;
  }
}

// ---------- 通用工具 ----------

/** 生成随机 msToken（107 位） */
function generateMsToken(length = 107) {
  const base = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=';
  let out = '';
  for (let i = 0; i < length; i++) out += base[Math.floor(Math.random() * base.length)];
  return out;
}

/** 取嵌套结构中的首个 URL */
function firstUrl(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const item of node) {
      const u = firstUrl(item);
      if (u) return u;
    }
    return '';
  }
  if (typeof node === 'object') {
    if (Array.isArray(node.url_list)) {
      for (const item of node.url_list) {
        const u = firstUrl(item);
        if (u) return u;
      }
    }
    for (const key of ['url', 'uri', 'src']) {
      if (typeof node[key] === 'string' && node[key]) return node[key];
    }
  }
  return '';
}

/**
 * 播放端点处理
 *   /playwm/ → /play/
 *   ratio=720p → 1080p
 * @param {string} url
 * @returns {string}
 */
function cleanPlayUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let u = url.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  u = u.replace('/playwm/', '/play/');
  u = u.replace(/([?&])ratio=720p\b/, '$1ratio=1080p');
  return u;
}

/** 依据 uri 构造播放端点 */
function buildPlayEndpoint(uri, ratio = '1080p') {
  if (!uri) return '';
  return `https://www.iesdouyin.com/aweme/v1/play/?video_id=${uri}&ratio=${ratio}&line=0`;
}

/**
 * 抖音 gear_name → 可读画质标签
 *
 * 抖音下发的是 `540_2_1` / `1080_1_1` 这类内部档位名，
 * 直接展示给用户毫无意义，这里还原成 `540P` 之类。
 *
 * @param {string} gear
 * @returns {string}
 */
function douyinQualityLabel(gear) {
  const s = String(gear || '');
  if (!s) return '';
  const m = s.match(/(\d{3,4})/);
  if (m) return m[1] + 'P';
  return s;
}

// ---------- ttwid ----------

/**
 * 获取 ttwid（带进程内缓存）
 * @param {boolean} forceRefresh
 * @returns {Promise<string|null>}
 */
async function fetchTtwid(forceRefresh = false) {
  if (!forceRefresh && TTWID_CACHE) return TTWID_CACHE;

  try {
    const resp = await fetch('https://ttwid.bytedance.com/ttwid/union/register/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': WEB_API_UA },
      body: JSON.stringify({
        region: 'cn',
        aid: 6383,
        need_t: 1,
        service: 'www.douyin.com',
        migrate_priority: 0,
        cb_url_protocol: 'https',
        domain: '.douyin.com'
      })
    });
    const setCookie = resp.headers.get('Set-Cookie') || '';
    const m = setCookie.match(/ttwid=([^;]+)/);
    TTWID_CACHE = m ? m[1] : null;
    return TTWID_CACHE;
  } catch {
    return null;
  }
}

// ---------- 画质仲裁 ----------

/**
 * 从 bit_rate 列表中选出最佳视频流
 *
 * 仲裁维度依次为：编码（H.264 优先）→ 分辨面积 → 码率 → 体积
 * H.265 在浏览器 <video> 中常出现「有声音无画面」，故降级处理。
 *
 * @param {object[]} bitRates
 * @returns {{ url: string, quality: string }}
 */
function pickBestBitrate(bitRates) {
  if (!Array.isArray(bitRates) || !bitRates.length) return { url: '', quality: '' };

  const candidates = bitRates.map(b => {
    // url_list[2] 通常是源站节点，质量最好；为空则取首个
    const list = (b.play_addr && b.play_addr.url_list) || [];
    const url = cleanPlayUrl(list[2] || list[0] || '');
    const codec = String(b.codec_type || '').toLowerCase();
    const isH265 = b.is_h265 === 1 || b.is_h265 === true
      || codec.includes('h265') || codec.includes('hevc');

    return {
      url,
      quality: b.gear_name || b.quality_type || '',
      h264: !isH265,
      area: (parseInt(b.width, 10) || 0) * (parseInt(b.height, 10) || 0),
      bitrate: parseInt(b.bit_rate, 10) || 0,
      size: parseInt(b.data_size, 10) || 0
    };
  }).filter(c => c.url);

  if (!candidates.length) return { url: '', quality: '', h265: false };

  candidates.sort((a, b) => {
    if (a.h264 !== b.h264) return a.h264 ? -1 : 1;   // H.264 优先
    if (a.area !== b.area) return b.area - a.area;   // 分辨率
    if (a.bitrate !== b.bitrate) return b.bitrate - a.bitrate;
    return b.size - a.size;
  });

  // h265 标记供上层判断：若 bit_rate 里全是 H.265，需要另找 H.264 单流
  return {
    url: candidates[0].url,
    quality: candidates[0].quality || '高清',
    h265: !candidates[0].h264
  };
}

/** 从 url_list 取最佳节点（源站优先，缺失则取首个） */
function pickUrlList(node) {
  if (!node) return '';
  const list = Array.isArray(node.url_list) ? node.url_list : [];
  return cleanPlayUrl(list[2] || list[0] || '');
}

/**
 * 判断一个播放节点是否为 H.265（bytevc1 / HEVC）
 *
 * 编码信息不在 URL 里，而在 `url_key` 中，形如：
 *   v0300fg…_bytevc1_540p_622189   → H.265
 *   v0300fg…_h264_540p_1358948     → H.264
 * 也有只给 `uri` 不给 `url_key` 的情况，此时退回看 is_h265 / 编码字段。
 *
 * @param {object} node - play_addr 之类的节点
 * @param {object} [entry] - 对应的 bit_rate 条目（可含 is_h265）
 * @returns {boolean}
 */
function isH265Node(node, entry) {
  if (entry && (entry.is_h265 === 1 || entry.is_h265 === true)) return true;

  const key = String((node && node.url_key) || '').toLowerCase();
  if (key.includes('bytevc1') || key.includes('h265') || key.includes('hevc')) return true;
  if (key.includes('h264') || key.includes('avc')) return false;

  const uri = String((node && node.uri) || '').toLowerCase();
  if (uri.includes('bytevc1') || uri.includes('h265') || uri.includes('hevc')) return true;

  const codec = String((entry && entry.codec_type) || '').toLowerCase();
  if (codec.includes('265') || codec.includes('hevc') || codec.includes('bytevc1')) return true;

  return false;
}

/**
 * 判断一个 media 节点是否真的是视频
 *
 * 图文作品的 `video` 节点是个空壳：`bit_rate` 为 null、`duration` 为 0，
 * 而 `play_addr` 指向的是**该作品的背景音乐 mp3**。若不拦住，
 * 会把一首 mp3 当成"视频"塞进结果里，前端 <video> 自然播不出来。
 *
 * @param {object} node - play_addr 之类的节点
 * @returns {boolean}
 */
function isVideoNode(node) {
  if (!node) return false;
  const url = pickUrlList(node);
  if (!url) return false;
  // 只要落在音频扩展名上就不是视频
  return !/\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(url);
}

/**
 * 判断一个 aweme 是否真的含视频
 *
 * 抖音的图文作品（`media_type === 2`）会下发一个空壳 `video` 节点：
 * `bit_rate` 为 `null`、`duration` 为 `0`，而 `play_addr` 与
 * `music.play_url` **完全同一个 URL**（就是背景音乐）。
 *
 * 这个 BGM 地址常常没有 `.mp3` 后缀（形如
 * `https://sf6-cdn-tos.douyinstatic.com/obj/tos-cn-ve-2774/oYCe…`），
 * 所以只靠扩展名判断会漏掉，必须比对 music 节点 + media_type。
 *
 * @param {object} item - aweme 对象
 * @returns {boolean}
 */
function hasRealVideo(item) {
  if (!item || typeof item !== 'object') return false;

  // 明确的图文标识
  if (item.media_type === 2) return false;

  const video = item.video || {};
  const playAddr = video.play_addr || {};
  const musicUrl = firstUrl((item.music || {}).play_url);

  const videoUrl = pickUrlList(video.play_addr_h264)
    || pickUrlList(video.play_addr)
    || '';

  // play_addr 与背景音乐是同一个地址 → 这个"视频"就是 BGM
  if (videoUrl && musicUrl && videoUrl === musicUrl) return false;

  // bit_rate 为 null 且 duration 为 0，同时没有实况视频流 → 视作图文
  const hasBitRate = Array.isArray(video.bit_rate) && video.bit_rate.length > 0;
  if (!hasBitRate && !video.duration) {
    // 仍可能存在真正的高清单流，用 uri 兜底判断
    return isVideoNode(video.play_addr_h264) && !!(video.play_addr_h264 || {}).uri;
  }

  return true;
}

/**
 * 取 H.264 单流地址（浏览器兼容性兜底）
 *
 * 抖音的 bit_rate 数组并非总含 H.264：不少作品的 bit_rate 只有 bytevc1(H.265)，
 * 而顶层 play_addr_h264 仍是 H.264 单流。多数浏览器无法解码 H.265，
 * 表现为「点了播放没反应」或只有声音没有画面。
 *
 * 注意：编码标识只在 url_key 里，URL 本身看不出编码，不能靠正则匹配 URL。
 *
 * @param {object} video
 * @returns {string}
 */
function bestH264FromVideo(video) {
  if (!video || typeof video !== 'object') return '';
  const nodes = [
    video.play_addr_h264, video.play_addr, video.play_addr_lowbr, video.download_addr
  ];
  for (const node of nodes) {
    // 只接受能确认是 H.264 的视频节点：url_key 含 h264，或未标注编码（视为兼容）
    if (isVideoNode(node) && !isH265Node(node)) return pickUrlList(node);
  }
  return '';
}

/**
 * 从 video 节点取最佳播放地址（无 bit_rate 时的兜底）
 * @param {object} video
 * @returns {string}
 */
function bestFromPlayAddr(video) {
  if (!video || typeof video !== 'object') return '';

  const pickup = (node) => {
    if (!node) return '';
    // 图文作品的 play_addr 是背景音乐 mp3，不能当视频
    if (!isVideoNode(node)) return '';
    if (Array.isArray(node.url_list)) {
      for (const u of node.url_list) {
        const s = cleanPlayUrl(typeof u === 'string' ? u : (u && u.url));
        if (s && !/\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(s)) return s;
      }
    }
    if (node.uri) return buildPlayEndpoint(node.uri, '1080p');
    return '';
  };

  return pickup(video.play_addr_h264)
    || pickup(video.play_addr)
    || pickup(video.play_addr_lowbr)
    || pickup(video.download_addr)
    || '';
}

/**
 * 从一个 video 节点取出最佳可播地址（综合三条来源）
 *
 * 抖音的 video 节点并不保证哪一层有地址：
 *   · 顶层 play_addr_h264 / play_addr  ← 动图、实况、多数常规视频
 *   · bit_rate[] 里的 play_addr        ← 部分常规视频
 * 因此依次尝试「H.264 单流 → 码率仲裁 → 通用兜底」，任一命中即返回。
 *
 * @param {object} videoNode
 * @returns {{ url: string, quality: string }}
 */
function bestVideoUrl(videoNode) {
  if (!videoNode || typeof videoNode !== 'object') return { url: '', quality: '' };

  // 1) bit_rate 码率仲裁优先
  //
  // 注意顺序很重要：顶层 play_addr_h264 往往只是某一档（常见 540p），
  // 而 bit_rate 里可能同时存在更高分辨率的 H.264。
  // 若先取顶层单流，就会把 1080p 降级成 540p。
  const best = pickBestBitrate(videoNode.bit_rate);
  if (best.url && !best.h265) {
    return { url: best.url, quality: douyinQualityLabel(best.quality) || '高清' };
  }

  // 2) bit_rate 全为 H.265（或没有 bit_rate）→ 用顶层 H.264 单流
  const h264 = bestH264FromVideo(videoNode);
  if (h264) {
    // bit_rate 里有 H.265 更高清时，也已确认浏览器解不了，故仍用 H.264
    return { url: h264, quality: douyinQualityLabel(best.quality) || 'H.264 高清' };
  }

  // 3) 实在只有 H.265，只能用它
  if (best.url) {
    return { url: best.url, quality: douyinQualityLabel(best.quality) || '高清' };
  }

  // 4) 通用兜底
  const anyUrl = bestFromPlayAddr(videoNode);
  if (anyUrl) return { url: anyUrl, quality: '高清' };

  return { url: '', quality: '' };
}

// ---------- 字段提取 ----------

/**
 * 从 aweme 对象填充结果
 * @param {object} item
 * @param {object} result
 * @returns {boolean}
 */
function extractFromAweme(item, result) {
  if (!item || typeof item !== 'object') return false;

  const author = item.author || {};
  const video = item.video || {};
  const music = item.music || {};

  // ---- 基础信息 ----
  result.title = item.desc || item.title || result.title;
  result.author = author.nickname || author.name || author.unique_id || result.author;
  result.authorId = author.unique_id || author.short_id || author.uid || result.authorId;
  result.avatar = firstUrl(author.avatar_larger)
    || firstUrl(author.avatar_thumb)
    || firstUrl(author.avatar_medium)
    || result.avatar;

  // ---- 封面：origin_cover 优先（原图未裁剪），dynamic_cover 仅兜底 ----
  result.cover = firstUrl(video.origin_cover)
    || firstUrl(video.cover)
    || firstUrl(video.dynamic_cover)
    || result.cover;

  // ---- 视频流：码率仲裁 ----
  // 图文作品（media_type=2）的 video 是空壳，见 isVideoNode 注释。
  if (!result.videos.length && hasRealVideo(item)) {
    const pick = bestVideoUrl(video);
    if (pick.url) result.videos.push({ url: pick.url, quality: pick.quality });
  }

  // ---- 图集（兼容新旧结构）----
  const posters = (item.image_post_info
    && (item.image_post_info.images || item.image_post_info.image_list))
    || item.images || item.image_list || item.image_infos || item.original_images || [];

  if (Array.isArray(posters) && posters.length && result.images.length === 0) {
    posters.forEach((img, i) => {
      // 原图在 url_list 末项
      const list = img.url_list || [];
      const url = cleanPlayUrl(list[list.length - 1] || list[0] || img.url || '');

      if (url) {
        if (url.toLowerCase().includes('.gif')) result.gifs.push({ url, index: i + 1 });
        else result.images.push({ url, index: i + 1 });
      }

      // 动图 / 实况照片（LivePhoto）
      //
      // 抖音用 images[i].live_photo_type === 1 表示"动图"，
      // 此时 images[i] 里那张图只是**封面**，真正的画面是 images[i].video
      // （实测为真 MP4：content-type=video/mp4、ftyp 头、37 万字节）。
      //
      // 这类作品本质是"一张会动的图"，不是"视频 + 图片"。
      // 若把 video 塞进 result.videos，整体会被判定成 video_images，
      // 前端就会出现「一张图 + 一段视频」的重复展示。
      // 因此统一归入 gifs，并把该图从 images 中移除，避免重复。
      if (img.video) {
        const livePick = bestVideoUrl(img.video);
        const liveUrl = livePick.url;
        if (liveUrl) {
          const isLive = Number(img.live_photo_type) === 1;
          if (isLive) {
            // 从 images 里摘掉这张封面，只保留动图本体
            const at = result.images.findIndex(x => x.url === url);
            if (at >= 0) result.images.splice(at, 1);
            result.gifs.push({ url: liveUrl, index: i + 1, animated: true });
          } else if (!result.videos.some(v => v.url === liveUrl)) {
            result.videos.push({ url: liveUrl, quality: '实况' });
          }
        }
      }
    });
  }

  // ---- 音频 ----
  const musicUrl = firstUrl(music.play_url) || '';
  if (musicUrl) result.audio = cleanPlayUrl(musicUrl);

  return !!(result.videos.length || result.images.length || result.title);
}

/**
 * 递归查找 aweme 详情节点
 *
 * 抖音在不同载体下的包装结构并不统一，需逐一兼容：
 *   · API 响应：{ aweme_detail: {...} }
 *   · 分享页 SSR：loaderData[*].videoInfoRes.item_list[0]（无包装，直接是 aweme）
 *   · 流式 SSR：self.__pace_f 片段的 defaultAwemeInfo
 *
 * @param {object} node
 * @param {number} [depth]
 * @returns {object|null}
 */
function findAwemeDetail(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return null;

  // 1) 显式包装
  if (node.aweme_detail && typeof node.aweme_detail === 'object') return node.aweme_detail;
  if (node.awemeDetail && typeof node.awemeDetail === 'object') return node.awemeDetail;
  if (node.defaultAwemeInfo && typeof node.defaultAwemeInfo === 'object') return node.defaultAwemeInfo;

  // 2) videoInfoRes.item_list[0]（分享页 SSR 主结构）
  if (Array.isArray(node.item_list) && node.item_list.length
      && isAwemeShape(node.item_list[0])) {
    return node.item_list[0];
  }

  // 3) 自身就是 aweme 形态（含 aweme_id + video/desc）
  if (isAwemeShape(node)) return node;

  // 4) 深度遍历
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') {
      const found = findAwemeDetail(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 判断对象是否为 aweme 形态
 * @param {any} obj
 * @returns {boolean}
 */
function isAwemeShape(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  // 强特征：aweme_id / 或同时具备 desc 与 video
  if (obj.aweme_id || obj.awemeId) return true;
  if (obj.desc !== undefined && (obj.video || obj.image_post_info || obj.images)) return true;
  return false;
}

/**
 * 判断是否为不可恢复的终态（已删除/私密/仅自己可见）
 * @param {object} data
 * @returns {string} 终态原因，非终态返回空串
 */
function terminalReason(data) {
  if (!data || typeof data !== 'object') return '';
  const fd = data.filter_detail;
  if (!fd) return '';
  if (fd.filter_reason) return String(fd.filter_reason);
  if (fd.detail_msg) return String(fd.detail_msg);
  if (fd.status_code) return '作品不可访问（可能已删除或设为私密）';
  return '';
}

/** 从 SSR HTML 文本中识别终态提示 */
function terminalReasonFromHtml(html) {
  if (!html) return '';
  if (/作品不存在|已被删除|内容不存在/.test(html)) return '作品不存在或已被删除';
  if (/仅自己可见|私密/.test(html)) return '该作品仅作者自己可见';
  return '';
}

// ---------- Cookie ----------

/**
 * 组装 Cookie 请求头（过滤部分字段）
 *
 * @param {object} env
 * @param {string} [ttwid]
 * @returns {string}
 */
function buildCookieHeader(env, ttwid) {
  const parts = [];
  if (ttwid) parts.push(`ttwid=${ttwid}`);

  const raw = (env && env.DOUYIN_COOKIE) || '';
  if (raw) {
    // 兼容 .env / Cloudflare 变量里的引号包裹
    const cleaned = String(raw).trim().replace(/^['"]|['"]$/g, '');
    const POISON = /^(bd_ticket_guard_|__security_|fpk|_bd_ticket_crypt_cookie|x_tt_token|sdk_source_info)/i;

    for (const seg of cleaned.split(';')) {
      const kv = seg.trim();
      if (!kv) continue;
      const name = kv.split('=')[0].trim();
      if (POISON.test(name)) continue;
      if (ttwid && name.toLowerCase() === 'ttwid') continue;
      parts.push(kv);
    }
  }

  return parts.join('; ');
}

/** 从 Cookie 中提取 UIFID */
function extractUifid(env) {
  const raw = (env && env.DOUYIN_COOKIE) || '';
  const m = String(raw).match(/UIFID=([^;'"]+)/i);
  return m ? m[1].trim() : '';
}

// ---------- 数据通道 ----------

/**
 * ① 移动端 Feed API（常规视频主路径）
 *
 * 注意：`aid` 会改变返回内容 —— 图文作品必须用主端 aid（6383）。
 *
 * @param {string} awemeId
 * @param {string} [aid] - 应用标识
 * @returns {Promise<object|null>}
 */
async function fetchViaMobileFeed(awemeId, aid = AID_LITE) {
  if (!awemeId) return null;

  for (const endpoint of MOBILE_FEED_ENDPOINTS) {
    try {
      const url = `${endpoint}?aweme_id=${encodeURIComponent(awemeId)}&aid=${aid}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': MOBILE_FEED_UA,
          'Accept': 'application/json, text/plain, */*'
        }
      });
      if (!resp.ok) continue;

      const data = await resp.json();
      const list = data.aweme_list || [];
      // 必须校验 ID 命中：Feed 在未收录该作品时会回退成推荐流，
      // 直接取 list[0] 会解析出完全不相干的视频。
      const matched = list.find(x => String(x.aweme_id || x.id || '') === String(awemeId));
      if (matched) return matched;
    } catch { /* 尝试下一个节点 */ }
  }
  return null;
}

/**
 * ② 移动端分享页 SSR
 *
 * iesdouyin 分享页在移动 UA 下完整输出 _ROUTER_DATA。
 *
 * @param {string} awemeId
 * @param {object} env
 * @returns {Promise<{ aweme: object|null, html: string, reason: string }>}
 */
async function fetchViaShareSsr(awemeId, env) {
  const out = { aweme: null, html: '', reason: '' };
  if (!awemeId) return out;

  const candidates = [
    `https://www.iesdouyin.com/share/video/${awemeId}/`,
    `https://www.iesdouyin.com/share/note/${awemeId}/`
  ];

  for (const target of candidates) {
    try {
      const resp = await fetch(target, {
        headers: {
          'User-Agent': UA_MOBILE,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Cookie': buildCookieHeader(env)
        },
        redirect: 'follow'
      });
      const html = await resp.text();
      if (!html || html.length < 200) continue;
      out.html = html;

      // 花括号平衡提取 _ROUTER_DATA / _SSR_DATA / __INIT_PROPS__
      for (const marker of ['window._ROUTER_DATA', 'window._SSR_DATA', 'window.__INIT_PROPS__']) {
        const idx = html.indexOf(marker);
        if (idx < 0) continue;
        const braceStart = html.indexOf('{', idx);
        if (braceStart < 0) continue;
        const jsonStr = extractJsonObject(html, braceStart);
        if (!jsonStr) continue;
        try {
          const aweme = findAwemeDetail(JSON.parse(jsonStr));
          if (aweme) { out.aweme = aweme; return out; }
        } catch { /* 尝试下一个标记 */ }
      }

      // 兜底：RENDER_DATA / UNIVERSAL_DATA
      for (const id of ['RENDER_DATA', '__UNIVERSAL_DATA_FOR_REHYDRATION__']) {
        const re = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
        const m = html.match(re);
        if (!m) continue;
        let raw = m[1].trim();
        try { raw = decodeURIComponent(raw); } catch { /* 保持原样 */ }
        try {
          const aweme = findAwemeDetail(JSON.parse(raw));
          if (aweme) { out.aweme = aweme; return out; }
        } catch { /* 继续 */ }
      }

      const reason = terminalReasonFromHtml(html);
      if (reason) out.reason = reason;
    } catch { /* 尝试下一个候选 */ }
  }

  return out;
}

/**
 * ③ PC Web 详情 API
 *
 * 图文/实况的完整来源。
 *
 * @param {string} awemeId
 * @param {object} env
 * @param {boolean} isNote
 * @returns {Promise<{ aweme: object|null, reason: string }>}
 */
async function fetchViaWebApi(awemeId, env, isNote) {
  const out = { aweme: null, reason: '' };
  if (!awemeId) return out;

  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ttwid = await fetchTtwid(attempt > 1);
      const msToken = generateMsToken();
      const baseParams = 'device_platform=webapp&aid=6383&channel=channel_pc_web'
        + `&aweme_id=${awemeId}&msToken=${msToken}`;

      let signedParams = baseParams;
      try {
        signedParams = `${baseParams}&a_bogus=${generate_a_bogus(baseParams, WEB_API_UA)}`;
      } catch { /* 降级为无签名请求 */ }

      const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?${signedParams}`;
      const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': WEB_API_UA,
        'Referer': isNote
          ? `https://www.douyin.com/note/${awemeId}`
          : `https://www.douyin.com/video/${awemeId}`,
        'Cookie': buildCookieHeader(env, ttwid)
      };

      // 配置 Cookie 时带上 uifid 头
      const uifid = extractUifid(env);
      if (uifid) headers['uifid'] = uifid;

      const resp = await fetch(apiUrl, { headers });
      if (!resp.ok) continue;   // 403/500 属瞬时抖动，值得再试一次

      const data = await resp.json();

      // 终态立即短路，不做无谓重试
      const reason = terminalReason(data);
      if (reason) { out.reason = reason; return out; }

      const aweme = data.aweme_detail
        || (data.data && data.data.aweme_detail)
        || (data.data && data.data.awemeDetail);
      if (aweme) { out.aweme = aweme; return out; }

      // 200 但无 aweme_detail：ttwid 可能失效，刷新后再试一次
      if (attempt === 1) { TTWID_CACHE = null; }
    } catch { /* 尝试下一次 */ }
  }

  return out;
}

// ---------- 主入口 ----------

/**
 * 解析抖音分享链接
 * @param {string} inputUrl
 * @param {object} [env] - Worker 环境变量（可选，用于 Cookie）
 * @returns {Promise<object>}
 */
export async function parseDouyin(inputUrl, env) {
  const result = createEmptyResult('抖音');

  try {
    // ---- 短链解析 + ID 提取 ----
    const resolved = await resolveShortLink(inputUrl);
    const awemeId = extractAwemeId(resolved) || extractAwemeId(inputUrl);
    if (!awemeId) return result;

    const note = isImagePost(resolved) || isImagePost(inputUrl);

    // ---- 图文/实况：Web API 优先（唯一含实况视频流）----
    if (note) {
      const web = await fetchViaWebApi(awemeId, env, true);
      if (web.aweme && extractFromAweme(web.aweme, result)) return buildResult(result);
      if (web.reason) { result.title = web.reason; return buildResult(result); }

      // 降级到分享页 SSR（仅静态图）
      const ssr = await fetchViaShareSsr(awemeId, env);
      if (ssr.aweme && extractFromAweme(ssr.aweme, result)) return buildResult(result);
      if (ssr.reason) result.title = ssr.reason;

      // 再降级：主端 Feed（aid=6383）
      const feedMain = await fetchViaMobileFeed(awemeId, AID_MAIN);
      if (feedMain && extractFromAweme(feedMain, result)) return buildResult(result);
      return buildResult(result);
    }

    // ---- 常规视频：移动端 Feed 优先 ----
    //
    // 先试极速版 aid；未收录时再试主端 aid。后者除了常规视频，
    // 还能返回"以 /share/video/ 形式分享的图文作品"——这类链接的 URL
    // 里看不出是图文，只能靠换 aid 命中。
    let feed = await fetchViaMobileFeed(awemeId, AID_LITE);
    if (!feed) feed = await fetchViaMobileFeed(awemeId, AID_MAIN);
    if (feed && extractFromAweme(feed, result)) return buildResult(result);

    // ---- 降级 1：分享页 SSR ----
    const ssr = await fetchViaShareSsr(awemeId, env);
    if (ssr.aweme && extractFromAweme(ssr.aweme, result)) return buildResult(result);
    if (ssr.reason) { result.title = ssr.reason; return buildResult(result); }

    // ---- 降级 2：Web API ----
    const web = await fetchViaWebApi(awemeId, env, false);
    if (web.aweme && extractFromAweme(web.aweme, result)) return buildResult(result);
    if (web.reason) result.title = web.reason;

    return buildResult(result);
  } catch (e) {
    return result;
  }
}

export { cleanPlayUrl, pickBestBitrate, extractAwemeId };
