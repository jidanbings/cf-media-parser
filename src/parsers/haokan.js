// ========================================
// 好看视频解析器
// 策略: 从 __PRELOADED_STATE__ 提取视频元数据
// ========================================

import { createEmptyResult, buildResult, extractJsonFromHtml } from './base.js';
import { fetchHtml } from '../utils/fetcher.js';

/**
 * 解析好看视频分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseHaokan(inputUrl) {
  const result = createEmptyResult('好看视频');

  try {
    const html = await fetchHtml(inputUrl, {}, 'https://haokan.baidu.com/');
    if (!html) throw new Error('获取页面失败');

    const state = extractJsonFromHtml(html, /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\};)/);
    if (!state) return result;

    const meta = state.curVideoMeta || {};
    result.title = meta.title || '';
    result.cover = (meta.poster || '').replace(/\\\//g, '/');

    const authorNode = meta.mth || {};
    result.author = authorNode.author_name || '未知';
    result.authorId = String(authorNode.mthid || '');
    result.avatar = (authorNode.author_photo || '').replace(/\\\//g, '/');

    const clarityUrls = meta.clarityUrl || [];
    if (clarityUrls.length > 0) {
      const lastUrl = clarityUrls[clarityUrls.length - 1]?.url;
      if (lastUrl) {
        result.videos.push({ url: decodeURIComponent(lastUrl).replace(/\\\//g, '/'), quality: '高清' });
      }
    }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
