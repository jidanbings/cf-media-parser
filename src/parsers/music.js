// ========================================
// 汽水音乐解析器
// 策略: 解析短链接 → 抖音音乐 API → HTML 正则降级
// ========================================

import { UA_MOBILE, UA_PC } from '../config.js';
import { createEmptyResult } from './base.js';
import { fetchHtml } from '../utils/fetcher.js';

/**
 * 解析汽水音乐分享链接
 * @param {string} inputUrl
 * @returns {Promise<object>}
 */
export async function parseMusic(inputUrl) {
  let finalUrl = inputUrl;
  let musicId = '';

  // 0. 从文本中提取纯 URL
  const urlPatterns = [
    /https?:\/\/[^\s"']+/,
    /https?:\/\/[^，。！？、；：\s"']+/,
    /https?:\/\/[a-zA-Z0-9][^\s"']*/
  ];
  for (const pattern of urlPatterns) {
    const urlMatch = inputUrl.match(pattern);
    if (urlMatch && urlMatch[0].includes('.')) {
      finalUrl = urlMatch[0];
      break;
    }
  }
  finalUrl = finalUrl.replace(/[，。！？、；："']+$/, '');

  // 1. 解析短链接
  if (finalUrl.includes('music.douyin.com') || finalUrl.includes('qscmusic.com') || finalUrl.includes('qishui.douyin.com')) {
    try {
      const resp = await fetch(finalUrl, {
        method: 'GET', redirect: 'follow',
        headers: { 'User-Agent': UA_MOBILE, 'Accept': 'text/html,*/*' }
      });
      if (resp.url) finalUrl = resp.url;
    } catch (e) { /* ignore */ }
  }

  // 2. 提取音乐 ID
  const idPatterns = [
    /song\/(\d+)/i,
    /songId=(\d+)/i,
    /music_id=(\d+)/i,
    /id=(\d+)/i,
    /\/s\/([a-zA-Z0-9_-]+)/i
  ];

  for (const pattern of idPatterns) {
    const match = finalUrl.match(pattern);
    if (match) {
      const extractedId = match[1];
      if (/^\d+$/.test(extractedId)) {
        musicId = extractedId;
        break;
      } else {
        // 短链接码，先解析
        try {
          const resp = await fetch(finalUrl, {
            method: 'GET', redirect: 'follow',
            headers: { 'User-Agent': UA_MOBILE, 'Accept': 'text/html,*/*' }
          });
          if (resp.url) {
            finalUrl = resp.url;
            for (const p of idPatterns) {
              const m = finalUrl.match(p);
              if (m && /^\d+$/.test(m[1])) { musicId = m[1]; break; }
            }
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  if (!musicId) {
    // 从 HTML 中提取
    try {
      const html = await fetchHtml(finalUrl, {}, 'https://music.douyin.com/');
      const idMatch = html.match(/"songId"\s*:\s*"(\d+)"/i);
      if (idMatch) musicId = idMatch[1];
    } catch (e) { /* ignore */ }
  }

  if (!musicId || !/^\d+$/.test(musicId)) {
    throw new Error('音乐ID格式不正确');
  }

  // 3. 获取音乐详情
  try {
    const apiUrl = `https://www.douyin.com/music/api/music/detail?id=${musicId}`;
    const resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': UA_PC,
        'Referer': 'https://music.douyin.com/',
        'Origin': 'https://music.douyin.com'
      }
    });

    if (!resp.ok) throw new Error('获取音乐信息失败');
    const data = await resp.json();

    let playUrl = null;
    let musicInfo = null;

    if (data.data?.play_url) { playUrl = data.data.play_url; musicInfo = data.data; }
    else if (data.data?.music?.play_url) {
      const pu = data.data.music.play_url;
      playUrl = typeof pu === 'string' ? pu : (pu.url_list?.[0] || null);
      musicInfo = data.data.music;
    } else if (data.play_url) { playUrl = data.play_url; musicInfo = data; }

    if (!playUrl) throw new Error('未找到音频资源');

    const result = {
      title: musicInfo.name || musicInfo.songName || '未知歌曲',
      author: musicInfo.singer || musicInfo.artist || musicInfo.singerName || '未知歌手',
      cover: musicInfo.cover_url || musicInfo.cover || musicInfo.coverUrl || '',
      audio: playUrl,
      type: 'audio',
      downloads: [],
      videos: [],
      images: [],
      gifs: []
    };

    if (result.audio) {
      const filename = `${result.author} - ${result.title}.mp3`;
      result.downloads.push({ url: result.audio, label: '下载音频', quality: '高品质' });
      result.audio = '/admin/music?url=' + encodeURIComponent(result.audio) + '&filename=' + encodeURIComponent(filename);
    }

    return result;
  } catch (e) {
    // 降级：HTML 提取
    try {
      const html = await fetchHtml(finalUrl, {}, 'https://music.douyin.com/');
      const audioMatch = html.match(/"play_url"\s*:\s*"([^"]+)"/i);
      const titleMatch = html.match(/"songName"\s*:\s*"([^"]+)"/i);
      const artistMatch = html.match(/"singerName"\s*:\s*"([^"]+)"/i);
      const coverMatch = html.match(/"coverUrl"\s*:\s*"([^"]+)"/i);

      if (!audioMatch) throw new Error('未找到音频资源');

      const result = {
        title: titleMatch ? titleMatch[1] : '未知歌曲',
        author: artistMatch ? artistMatch[1] : '未知歌手',
        cover: coverMatch ? coverMatch[1] : '',
        audio: audioMatch[1],
        type: 'audio',
        downloads: [],
        videos: [],
        images: [],
        gifs: []
      };

      if (result.audio) {
        const filename = `${result.author} - ${result.title}.mp3`;
        result.downloads.push({ url: result.audio, label: '下载音频', quality: '高品质' });
        result.audio = '/admin/music?url=' + encodeURIComponent(result.audio) + '&filename=' + encodeURIComponent(filename);
      }

      return result;
    } catch (fallbackError) {
      throw new Error('解析失败: ' + fallbackError.message);
    }
  }
}
