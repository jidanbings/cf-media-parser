// ========================================
// AcFun 解析器
// 策略: 官方 API video/info
// ========================================

import { createEmptyResult, buildResult } from './base.js';
import { fetchJson } from '../utils/fetcher.js';

/**
 * 解析 AcFun 分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseAcfun(inputUrl) {
  const result = createEmptyResult('AcFun');

  try {
    let videoId = '';
    const idMatch = inputUrl.match(/acfun\.cn\/v\/([a-zA-Z0-9]+)/);
    if (idMatch) videoId = idMatch[1];
    if (!videoId) throw new Error('无法提取视频ID');

    const apiData = await fetchJson(
      `https://www.acfun.cn/rest/pc-direct/video/info?videoId=${videoId}`,
      { 'Referer': 'https://www.acfun.cn/' }
    );

    if (apiData?.data) {
      const d = apiData.data;
      result.title = d.title || '';
      result.cover = d.coverUrl || '';
      result.author = d.user?.name || '未知';
      result.authorId = String(d.user?.id || '');
      result.avatar = d.user?.avatar || '';

      const streams = d.videoInfo?.streams || [];
      if (streams.length > 0) {
        const stream = streams[0];
        if (stream.playUrls?.length > 0) {
          result.videos.push({ url: stream.playUrls[0], quality: stream.qualityLabel || '高清' });
        }
      }

      return buildResult(result);
    }

    return result;
  } catch (e) {
    return result;
  }
}
