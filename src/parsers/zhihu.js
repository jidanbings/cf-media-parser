// ========================================
// 知乎解析器
// 策略: 官方 API v4 → 视频子请求
// ========================================

import { UA_MOBILE } from '../config.js';
import { createEmptyResult, buildResult } from './base.js';
import { fetchJson } from '../utils/fetcher.js';

/**
 * 解析知乎分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseZhihu(inputUrl) {
  const result = createEmptyResult('知乎');

  try {
    let contentId = '';
    let isAnswer = false;
    let m = inputUrl.match(/zhihu\.com\/question\/(\d+)/);

    if (m) {
      contentId = m[1];
      const answerMatch = inputUrl.match(/answer\/(\d+)/);
      if (answerMatch) { contentId = answerMatch[1]; isAnswer = true; }
    }

    if (!contentId) {
      m = inputUrl.match(/zhuanlan\.zhihu\.com\/p\/(\d+)/);
      if (m) contentId = m[1];
    }
    if (!contentId) throw new Error('无法提取内容ID');

    const apiUrl = isAnswer
      ? `https://www.zhihu.com/api/v4/answers/${contentId}`
      : `https://www.zhihu.com/api/v4/questions/${contentId}`;

    const apiData = await fetchJson(apiUrl, {
      'User-Agent': UA_MOBILE,
      'Referer': 'https://www.zhihu.com/'
    });

    if (apiData) {
      if (isAnswer && apiData.content) {
        result.title = apiData.excerpt || '';
        result.author = apiData.author?.name || '未知';
        result.authorId = apiData.author?.url_token || '';
        result.avatar = apiData.author?.avatar_url || '';

        const videoMatch = apiData.content?.match(/data-lens-id="(\d+)"/);
        if (videoMatch) {
          const videoId = videoMatch[1];
          const videoData = await fetchJson(`https://www.zhihu.com/api/v4/videos/${videoId}`, {
            'Referer': 'https://www.zhihu.com/'
          });
          if (videoData?.playlist?.hd) {
            result.videos.push({ url: videoData.playlist.hd.play_url, quality: '高清' });
          } else if (videoData?.playlist?.sd) {
            result.videos.push({ url: videoData.playlist.sd.play_url, quality: '标清' });
          }
        }
      } else if (apiData.title) {
        result.title = apiData.title || '';
      }
    }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
