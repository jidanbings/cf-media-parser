// ========================================
// 皮皮虾解析器
// 策略: h5 API → 提取视频/图片/动图
// ========================================

import { createEmptyResult, buildResult } from './base.js';
import { fetchJson } from '../utils/fetcher.js';

/**
 * 解析皮皮虾分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parsePipixia(inputUrl) {
  const result = createEmptyResult('皮皮虾');

  try {
    let postId = '';
    const idMatch = inputUrl.match(/pipix\.com\/(?:item\/)?(\d+)/);
    if (idMatch) postId = idMatch[1];
    if (!postId) throw new Error('无法提取帖子ID');

    const apiData = await fetchJson(
      `https://h5.pipix.com/bds/api/feed/detail?item_id=${postId}`,
      { 'Referer': 'https://h5.pipix.com/' }
    );

    if (apiData?.data?.item) {
      const item = apiData.data.item;
      result.title = item.content || '';
      result.author = item.author?.name || '未知';
      result.authorId = String(item.author?.id || '');
      result.avatar = item.author?.avatar?.url || item.author?.avatar?.download_url || '';
      result.cover = item.cover?.url || item.video?.cover?.url || '';

      if (item.video?.video_list) {
        const videos = Object.values(item.video.video_list);
        if (videos.length > 0) {
          result.videos.push({ url: videos[0].download_url || videos[0].url, quality: '高清' });
        }
      }

      if (item.images) {
        item.images.forEach((img, i) => {
          const url = img.url || img.download_url || '';
          if (url) {
            const isGif = url.toLowerCase().includes('.gif');
            if (isGif) { result.gifs.push({ url, index: i + 1 }); }
            else { result.images.push({ url, index: i + 1 }); }
          }
        });
      }

      return buildResult(result);
    }

    return result;
  } catch (e) {
    return result;
  }
}
