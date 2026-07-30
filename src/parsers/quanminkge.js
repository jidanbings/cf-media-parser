// ========================================
// 全民K歌解析器
// 策略: HTML 正则提取音频/封面/作者
// ========================================

import { createEmptyResult, buildResult } from './base.js';
import { fetchHtml } from '../utils/fetcher.js';

/**
 * 解析全民K歌分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseQuanminkge(inputUrl) {
  const result = createEmptyResult('全民K歌');

  try {
    let shareCode = '';
    const codeMatch = inputUrl.match(/kg\.qq\.com\/node\/play\?s=([a-zA-Z0-9_-]+)/);
    if (codeMatch) shareCode = codeMatch[1];
    if (!shareCode) {
      const m = inputUrl.match(/s=([a-zA-Z0-9_-]+)/);
      if (m) shareCode = m[1];
    }
    if (!shareCode) throw new Error('无法提取分享码');

    const html = await fetchHtml(inputUrl, {}, 'https://kg.qq.com/');
    if (!html) throw new Error('获取页面失败');

    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) result.title = titleMatch[1].replace(/ - 全民K歌$/, '');

    const nameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
    if (nameMatch) result.author = nameMatch[1];

    const audioMatch = html.match(/play_url["']?\s*:\s*["']([^"']+)["']/);
    if (audioMatch) result.audio = audioMatch[1].replace(/\\u002F/g, '/');

    const coverMatch = html.match(/cover["']?\s*:\s*["']([^"']+)["']/);
    if (coverMatch) result.cover = coverMatch[1].replace(/\\u002F/g, '/');

    if (result.audio) {
      result.downloads.push({ url: result.audio, label: '下载音频', quality: '高品质' });
    }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
