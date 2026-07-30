// ========================================
// 西瓜视频解析器
// 策略: 移动端页面 _ROUTER_DATA → _SSR_HYDRATED_DATA 降级
// ========================================

import { UA_MOBILE } from '../config.js';
import { createEmptyResult, buildResult, extractJsonFromHtml } from './base.js';
import { fetchHtml } from '../utils/fetcher.js';

/**
 * 解析西瓜视频分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseXigua(inputUrl) {
  const result = createEmptyResult('西瓜视频');

  try {
    let videoId = '';
    const idMatch = inputUrl.match(/ixigua\.com\/(?:video\/)?(\d+)/);
    if (idMatch) videoId = idMatch[1];
    if (!videoId) throw new Error('无法提取视频ID');

    const html = await fetchHtml(
      `https://m.ixigua.com/douyin/share/video/${videoId}?aweme_type=107&schema_type=1&utm_source=copy`,
      { 'User-Agent': UA_MOBILE },
      'https://www.ixigua.com/'
    );
    if (!html) throw new Error('获取页面失败');

    // _ROUTER_DATA
    const routerData = extractJsonFromHtml(html, /window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});\s*<\//);
    if (routerData) {
      const loaderData = routerData.loaderData || {};
      const pageKey = Object.keys(loaderData).find(k => k.includes('video'));
      if (pageKey) {
        const videoInfo = loaderData[pageKey]?.videoInfoRes;
        const item = videoInfo?.item_list?.[0];
        if (item) {
          result.title = item.desc || item.title || '';
          result.author = item.author?.nickname || item.user_info?.nickname || '未知';
          result.authorId = item.author?.unique_id || item.user_info?.user_id || '';
          result.avatar = item.author?.avatar_thumb?.url_list?.[0] || item.user_info?.avatar_url || '';
          const playAddr = item.video?.play_addr;
          if (playAddr?.url_list) {
            result.videos.push({ url: playAddr.url_list[0].replace('playwm', 'play'), quality: '高清' });
          }
          result.cover = item.video?.cover?.url_list?.[0] || item.video?.poster_url || '';
          return buildResult(result);
        }
      }
    }

    // _SSR_HYDRATED_DATA 降级
    const ssrData = extractJsonFromHtml(html, /window\._SSR_HYDRATED_DATA\s*=\s*(\{[\s\S]*?\});/);
    if (ssrData) {
      const itemInfo = (ssrData.anyVideo || {}).item_info || {};
      result.title = itemInfo.desc || itemInfo.title || '';
      result.author = itemInfo.author?.nickname || '未知';
      result.cover = itemInfo.video?.poster_url || itemInfo.video?.cover?.url_list?.[0] || '';
      const videoList = itemInfo.video?.video_list || {};
      const resolutions = ['video_4', 'video_3', 'video_2', 'video_1'];
      for (const res of resolutions) {
        if (videoList[res]?.main_url) {
          try { result.videos.push({ url: atob(videoList[res].main_url), quality: res }); break; } catch (e) { /* ignore */ }
        }
      }
      return buildResult(result);
    }

    return result;
  } catch (e) {
    return result;
  }
}
