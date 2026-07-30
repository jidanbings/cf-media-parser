// ========================================
// TikTok 解析器
// 策略: tikwm.com API → 页面 HTML __UNIVERSAL_DATA_FOR_VIEWER__
// ========================================

import { UA_PC } from '../config.js';
import { createEmptyResult, buildResult, extractJsonFromHtml } from './base.js';
import { fetchHtml } from '../utils/fetcher.js';

/**
 * 解析 TikTok 分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseTiktok(inputUrl) {
  const result = createEmptyResult('TikTok');

  try {
    let videoId = '';
    const idMatch = inputUrl.match(/\/video\/(\d+)/);
    if (idMatch) videoId = idMatch[1];

    // tikwm.com API
    try {
      const apiResp = await fetch(
        'https://www.tikwm.com/api/?url=' + encodeURIComponent(inputUrl) + '&hd=1',
        { headers: { 'User-Agent': UA_PC, 'Accept': 'application/json, text/plain, */*' } }
      );
      const apiData = await apiResp.json();
      if (apiData?.code === 0 && apiData.data) {
        const d = apiData.data;
        result.title = d.title || '';
        result.author = d.author?.nickname || '未知';
        result.authorId = String(d.author?.unique_id || d.author?.id || '');
        let avatar = d.author?.avatar || '';
        if (avatar.startsWith('/')) avatar = 'https://www.tikwm.com' + avatar;
        result.avatar = avatar;
        let cover = d.cover || '';
        if (cover.startsWith('/')) cover = 'https://www.tikwm.com' + cover;
        result.cover = cover;
        let play = d.hdplay || d.play || '';
        if (play.startsWith('/')) play = 'https://www.tikwm.com' + play;
        if (play) result.videos.push({ url: play, quality: '高清' });
        if (d.images && Array.isArray(d.images)) {
          d.images.forEach((img, i) => { result.images.push({ url: img, index: i + 1 }); });
        }
        let music = d.music || '';
        if (music.startsWith('/')) music = 'https://www.tikwm.com' + music;
        if (music) result.audio = music;
        return buildResult(result);
      }
    } catch (e) { /* fall through */ }

    // HTML 页面解析
    if (videoId) {
      const html = await fetchHtml(inputUrl, {}, 'https://www.tiktok.com/');
      if (html) {
        const state = extractJsonFromHtml(html, /window\.__UNIVERSAL_DATA_FOR_VIEWER__\s*=\s*(\{[\s\S]*?\});/);
        if (state) {
          const videoData = state?.__DEFAULT_SCOPE__?.webapp?.videoDetail?.itemInfo?.itemStruct;
          if (videoData) {
            result.title = videoData.desc || '';
            result.author = videoData.author?.nickname || '未知';
            result.authorId = videoData.author?.uniqueId || '';
            result.avatar = videoData.author?.avatarLarger || videoData.author?.avatarMedium || '';
            result.cover = videoData.video?.cover || videoData.video?.originCover || '';
            const playAddr = videoData.video?.playAddr || videoData.video?.downloadAddr;
            if (playAddr) {
              const url = playAddr[0] || Object.values(playAddr)[0] || '';
              if (url) result.videos.push({ url, quality: '高清' });
            }
            if (videoData.imagePost) {
              videoData.imagePost.images?.forEach((img, i) => {
                const url = img.imageURL?.urlList?.[0] || '';
                if (url) result.images.push({ url, index: i + 1 });
              });
            }
            return buildResult(result);
          }
        }
      }
    }

    return result;
  } catch (e) {
    return result;
  }
}
