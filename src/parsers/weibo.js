// ========================================
// 微博解析器
// 策略: Mobile API → PC API → HTML $render_data 降级
// ========================================

import { UA_PC, UA_MOBILE } from '../config.js';
import { createEmptyResult, buildResult } from './base.js';
import { fetchHtml, fetchJson } from '../utils/fetcher.js';

// ---------- base62 / mid 转换 ----------
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function base62Decode(s) {
  let res = 0n;
  for (const char of s) res = res * 62n + BigInt(ALPHABET.indexOf(char));
  return res.toString();
}
function midToId(mid) {
  mid = mid.split('').reverse().join('');
  const size = mid.length % 4 === 0 ? mid.length / 4 : Math.floor(mid.length / 4) + 1;
  const res = [];
  for (let i = 0; i < size; i++) {
    let s = mid.substring(i * 4, (i + 1) * 4).split('').reverse().join('');
    let part = base62Decode(s);
    if (i !== size - 1) part = part.padStart(7, '0');
    res.push(part);
  }
  return res.reverse().join('');
}

function extractNumericId(url) {
  let m = url.match(/weibo\.com\/\d+\/([a-zA-Z0-9]+)/);
  if (m) return midToId(m[1]);
  m = url.match(/weibo\.cn\/(?:status\/|detail\/|statuses\/show\?id=)(\d+)/);
  if (m) return m[1];
  m = url.match(/id=(\d+)/);
  if (m) return m[1];
  m = url.match(/id=([a-zA-Z0-9]+)/);
  if (m) return midToId(m[1]);
  m = url.match(/\/([a-zA-Z0-9]{9})\b/);
  if (m) return midToId(m[1]);
  return null;
}

/**
 * 解析微博分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseWeibo(inputUrl) {
  const result = createEmptyResult('微博');

  try {
    const numericId = extractNumericId(inputUrl);
    if (!numericId) throw new Error('无法提取微博ID');

    let postData = null;

    // 1. Mobile API
    try {
      const apiData = await fetchJson(
        'https://m.weibo.cn/statuses/show?id=' + numericId,
        {
          'User-Agent': UA_MOBILE,
          'Accept': 'application/json, text/plain, */*',
          'MWeibo-Pwa': '1',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://m.weibo.cn/detail/' + numericId
        }
      );
      if (apiData?.ok === 1 && apiData.data) postData = apiData.data;
    } catch (e) { /* fall through */ }

    // 2. PC API
    if (!postData) {
      try {
        postData = await fetchJson(
          'https://weibo.com/ajax/statuses/show?id=' + numericId,
          { 'User-Agent': UA_PC, 'Referer': 'https://weibo.com/' }
        );
      } catch (e) { /* fall through */ }
    }

    // 3. HTML $render_data 降级
    if (!postData) {
      const html = await fetchHtml('https://m.weibo.cn/detail/' + numericId, { 'User-Agent': UA_MOBILE });
      const renderMatch = html.match(/\$render_data\s*=\s*\[(.*?)\]\[0\]\s*\|\|/);
      if (renderMatch) {
        try { const j = JSON.parse(renderMatch[1]); postData = j.status || j; } catch (e) { /* ignore */ }
      }
    }

    if (!postData) throw new Error('获取微博数据失败');

    result.title = (postData.text_raw || postData.text || '').replace(/<[^>]+>/g, '');
    if (postData.user) {
      result.author = postData.user.screen_name || '未知';
      result.authorId = String(postData.user.id || '');
      result.avatar = postData.user.avatar_hd || postData.user.profile_image_url || '';
    }

    const pageInfo = postData.page_info || {};
    const mediaInfo = pageInfo.media_info || {};
    const videoUrl = mediaInfo.mp4_hd_url || mediaInfo.mp4_sd_url || mediaInfo.stream_url_hd || mediaInfo.stream_url;
    if (videoUrl) result.videos.push({ url: videoUrl, quality: '高清' });
    if (pageInfo.page_pic?.url) result.cover = pageInfo.page_pic.url;

    if (postData.pics) {
      postData.pics.forEach((p, i) => {
        const url = p.large?.url || p.url || '';
        if (url) {
          const isGif = url.toLowerCase().includes('.gif');
          if (isGif) { result.gifs.push({ url, index: i + 1 }); }
          else { result.images.push({ url, index: i + 1 }); }
        }
      });
    }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
