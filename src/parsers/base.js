// ========================================
// 解析器基类工具
// 功能: 所有平台解析器共享的工具函数
// ========================================

/**
 * 从 HTML 中提取 JSON 嵌入数据
 * @param {string} html
 * @param {RegExp} pattern
 * @returns {object|null}
 */
export function extractJsonFromHtml(html, pattern) {
  const match = html.match(pattern);
  if (!match) return null;
  try {
    let raw = match[1].replace(/undefined/g, 'null').replace(/;?\s*$/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 创建空的结果对象
 * @param {string} platform
 * @returns {object}
 */
export function createEmptyResult(platform) {
  return {
    platform,
    title: '',
    cover: '',
    author: '未知',
    authorId: '',
    avatar: '',
    type: 'video',
    videos: [],
    images: [],
    gifs: [],
    audio: '',
    downloads: []
  };
}

/**
 * 构建最终结果（填充 downloads、判定 type、兜底 cover）
 * @param {object} info
 * @returns {object}
 */
export function buildResult(info) {
  const result = { ...info, downloads: [] };

  if (result.videos?.length > 0) {
    for (const v of result.videos) {
      result.downloads.push({ url: v.url, label: '下载视频', quality: v.quality || '高清' });
    }
  }
  if (result.gifs?.length > 0) {
    for (const g of result.gifs) {
      result.downloads.push({ url: g.url, label: '下载动图', quality: '第' + g.index + '张' });
    }
  }
  if (result.images?.length > 0) {
    for (const p of result.images) {
      result.downloads.push({ url: p.url, label: '下载图片', quality: '第' + p.index + '张' });
    }
  }

  const hasVideo = result.videos.length > 0;
  const hasGif = result.gifs.length > 0;
  const hasImage = result.images.length > 0;

  if (hasVideo && hasGif && hasImage) result.type = 'mixed';
  else if (hasVideo && hasGif) result.type = 'video_gif';
  else if (hasVideo && hasImage) result.type = 'video_images';
  else if (hasGif && hasImage) result.type = 'gif_images';
  else if (hasVideo) result.type = 'video';
  else if (hasGif) result.type = 'gif';
  else if (hasImage) result.type = 'images';
  else result.type = 'mixed';

  if (!result.cover) {
    if (result.images.length > 0) result.cover = result.images[0].url;
    else if (result.gifs.length > 0) result.cover = result.gifs[0].url;
  }

  return result;
}

/**
 * 解析传入 URL 中的平台特定内容 ID
 * @param {string} url
 * @param {RegExp[]} patterns
 * @returns {string|null}
 */
export function extractId(url, patterns) {
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
