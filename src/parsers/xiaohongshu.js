// ========================================
// 小红书解析器
// 策略: 从 __INITIAL_STATE__ 提取笔记数据（需要 Cookie）
// ========================================

import { createEmptyResult, buildResult, extractJsonFromHtml } from './base.js';
import { fetchHtml } from '../utils/fetcher.js';

/**
 * 解析小红书分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseXiaohongshu(inputUrl) {
  const result = createEmptyResult('小红书');

  try {
    const html = await fetchHtml(inputUrl, { 'Cookie': '' }, 'https://www.xiaohongshu.com/');
    if (!html) throw new Error('获取页面失败');

    const state = extractJsonFromHtml(html, /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (!state) return result;

    const noteId = state.note?.firstNoteId;
    const noteData = noteId ? state.note?.noteDetailMap?.[noteId]?.note : null;
    if (!noteData) return result;

    result.title = ((noteData.title || '') + '\n' + (noteData.desc || '')).trim();
    result.author = noteData.user?.nickname || '未知';
    result.authorId = noteData.user?.userId || '';
    result.avatar = noteData.user?.avatar || '';

    // 视频
    if (noteData.video?.media?.stream?.h264) {
      const masterUrl = noteData.video.media.stream.h264[0]?.masterUrl;
      if (masterUrl) result.videos.push({ url: masterUrl.replace(/\\u002F/g, '/'), quality: '高清' });
    }

    // 图片
    if (noteData.imageList) {
      noteData.imageList.forEach((img, i) => {
        const url = (img.urlDefault || '').replace(/\\u002F/g, '/');
        if (url) {
          const isGif = url.toLowerCase().includes('.gif');
          if (isGif) { result.gifs.push({ url, index: i + 1 }); }
          else { result.images.push({ url, index: i + 1 }); }
        }
      });
    }

    if (noteData.imageList?.length > 0) {
      result.cover = (noteData.imageList[0].urlDefault || '').replace(/\\u002F/g, '/');
    }

    return buildResult(result);
  } catch (e) {
    return result;
  }
}
