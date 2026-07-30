// ========================================
// 抖音解析器 v6 — 官方 API + a_bogus 签名
// 仿照 ucrao/media-parser 实现
// ========================================

import { UA_PC } from '../config.js';
import { createEmptyResult, buildResult } from './base.js';
import { generate_a_bogus } from './a_bogus.js';

// ==========================================
// 工具函数
// ==========================================

function extractAwemeId(url) {
  const patterns = [
    /video\/(\d+)/, /note\/(\d+)/, /share\/video\/(\d+)/,
    /share\/slides\/(\d+)/, /slides\/(\d+)/,
    /aweme_id=(\d+)/, /item_id=(\d+)/, /(\d{17,21})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function resolveShortLink(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA_PC, 'Accept': 'text/html,*/*' },
      redirect: 'follow'
    });
    return { url: resp.url, awemeId: extractAwemeId(resp.url) };
  } catch {
    return { url, awemeId: null };
  }
}

/** 生成随机 msToken（107 位） */
function generateMsToken(length = 107) {
  const base = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += base[Math.floor(Math.random() * base.length)];
  }
  return result;
}

/** 获取 ttwid */
async function fetchTtwid() {
  try {
    const resp = await fetch('https://ttwid.bytedance.com/ttwid/union/register/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA_PC
      },
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
    const match = setCookie.match(/ttwid=([^;]+)/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

/** 从 API 返回的 video item 提取数据 */
function extractFromItem(item, result) {
  if (!item) return false;
  const author = item.author || item.user_info || {};
  const video = item.video || {};
  const music = item.music || {};

  result.title = item.desc || item.title || '';
  result.author = author.nickname || author.name || author.unique_id || '';
  result.authorId = author.unique_id || author.user_id || '';
  result.avatar = author.avatar_larger?.url_list?.[0]
    || author.avatar_thumb?.url_list?.[0] || '';
  result.cover = video.cover?.url_list?.[0]
    || video.origin_cover?.url_list?.[0] || video.poster_url || '';

  // 视频 — 优先 bit_rate 最高画质
  const bitRates = video.bit_rate || [];
  if (bitRates.length > 0) {
    const best = bitRates.reduce((a, b) => (a.bit_rate || 0) > (b.bit_rate || 0) ? a : b);
    const url = best.play_addr?.url_list?.[2] || best.play_addr?.url_list?.[0];
    if (url) result.videos.push({ url: url.replace('playwm', 'play'), quality: '高清' });
  }
  if (result.videos.length === 0 && video.play_addr?.url_list?.[0]) {
    result.videos.push({ url: video.play_addr.url_list[0].replace('playwm', 'play'), quality: '高清' });
  }
  if (result.videos.length === 0 && video.play_url?.url_list?.[0]) {
    result.videos.push({ url: video.play_url.url_list[0], quality: '高清' });
  }

  // 图片
  (item.images || item.image_list || []).forEach((img, i) => {
    const url = img.url_list?.[0] || img.url || '';
    if (url) {
      if (url.toLowerCase().includes('.gif')) result.gifs.push({ url, index: i + 1 });
      else result.images.push({ url, index: i + 1 });
    }
  });

  // 音频
  if (music.play_url?.url_list?.[0]) result.audio = music.play_url.url_list[0];
  else if (music.play_url) result.audio = typeof music.play_url === 'string' ? music.play_url : '';

  return result.videos.length > 0 || result.images.length > 0;
}

/** 调用抖音官方 API（带 a_bogus 签名） */
async function callDouyinApi(awemeId, msToken, ttwid) {
  const baseParams = `device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=${awemeId}&msToken=${msToken}`;
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

  // 生成 a_bogus 签名
  let signedParams = baseParams;
  try {
    const aBg = generate_a_bogus(baseParams, userAgent);
    signedParams = `${baseParams}&a_bogus=${aBg}`;
  } catch (e) { /* 签名失败, 用未签名版本 */ }

  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?${signedParams}`;

  try {
    const resp = await fetch(apiUrl, {
      headers: {
        'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        'Accept': 'application/json, text/plain, */*',
        'sec-ch-ua-mobile': '?0',
        'User-Agent': userAgent,
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': `https://www.douyin.com/video/${awemeId}`,
        'Cookie': ttwid ? `ttwid=${ttwid}` : ''
      }
    });
    if (resp.ok) return await resp.json();
  } catch (e) { /* fall through */ }

  return null;
}

// ==========================================
// 主入口
// ==========================================

export async function parseDouyin(inputUrl) {
  const result = createEmptyResult('抖音');

  // Step 1: 解析短链接 + 提取 awemeId
  const { url: resolvedUrl, awemeId } = await resolveShortLink(inputUrl);
  const videoId = awemeId || extractAwemeId(inputUrl) || extractAwemeId(resolvedUrl);
  if (!videoId) return result;

  // Step 2: 获取 ttwid + msToken
  const ttwid = await fetchTtwid();
  const msToken = generateMsToken();

  // Step 3: 调用官方 API（带 a_bogus 签名）
  const apiData = await callDouyinApi(videoId, msToken, ttwid);

  if (apiData) {
    if (extractFromItem(apiData.aweme_detail, result)
      || extractFromItem(apiData.data?.aweme_detail, result)
      || extractFromItem(apiData.data, result)) {
      return buildResult(result);
    }
  }

  // Step 4: 重试一次（新 ttwid + msToken）
  if (!result.videos.length) {
    const ttwid2 = await fetchTtwid();
    const msToken2 = generateMsToken();
    const retryData = await callDouyinApi(videoId, msToken2, ttwid2 || ttwid);
    if (retryData) {
      if (extractFromItem(retryData.aweme_detail, result)
        || extractFromItem(retryData.data?.aweme_detail, result)
        || extractFromItem(retryData.data, result)) {
        return buildResult(result);
      }
    }
  }

  // Step 5: HTML 兜底
  try {
    const resp = await fetch(resolvedUrl || inputUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,*/*'
      },
      redirect: 'follow'
    });
    const html = await resp.text();
    if (html?.length > 500) {
      const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/);
      const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/);
      if (ogTitle) result.title = ogTitle[1];
      if (ogImage) result.cover = ogImage[1];
    }
  } catch (e) { /* fall through */ }

  return result;
}
