// ========================================
// YouTube 解析器
// 策略: oEmbed API → Invidious API
// ========================================

import { createEmptyResult, buildResult } from './base.js';
import { fetchJson } from '../utils/fetcher.js';

/**
 * 解析 YouTube 分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseYoutube(inputUrl) {
  const result = createEmptyResult('YouTube');

  try {
    let videoId = '';
    let m = inputUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (!m) m = inputUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (!m) m = inputUrl.match(/embed\/([a-zA-Z0-9_-]{11})/);
    if (m) videoId = m[1];
    if (!videoId) throw new Error('无法提取YouTube视频ID');

    // oEmbed API
    const oembedData = await fetchJson(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (oembedData) {
      result.title = oembedData.title || '';
      result.author = oembedData.author_name || '未知';
      result.cover = oembedData.thumbnail_url || '';
    }

    // Invidious API (获取视频流)
    try {
      const invidiousData = await fetchJson(`https://invidious.snopyta.org/api/v1/videos/${videoId}`);
      if (invidiousData?.formatStreams) {
        for (const stream of invidiousData.formatStreams) {
          if (stream.url) {
            result.videos.push({ url: stream.url, quality: stream.qualityLabel || stream.quality || '高清' });
          }
        }
        if (result.videos.length === 0 && invidiousData.adaptiveFormats) {
          for (const af of invidiousData.adaptiveFormats) {
            if (af.type?.startsWith('video') && af.url) {
              result.videos.push({ url: af.url, quality: af.qualityLabel || af.quality || '高清' });
            }
            if (af.type?.startsWith('audio') && af.url && !result.audio) {
              result.audio = af.url;
            }
          }
        }
      }
    } catch (e) { /* fall through */ }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
