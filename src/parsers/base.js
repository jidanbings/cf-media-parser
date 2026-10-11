// ========================================
// 解析器基类工具
// 功能: 所有平台解析器共享的工具函数
// ========================================

/**
 * 花括号平衡匹配：从 text[startPos] 开始提取一个完整的 JSON 对象
 *
 * 相比朴素正则，它能正确处理字符串内的引号、转义与嵌套对象，
 * 避免 `{[\s\S]*?}` 在遇到嵌套或字符串内花括号时提前截断。
 *
 * @param {string} text
 * @param {number} startPos - 指向 '{' 的下标
 * @returns {string|null}
 */
export function extractJsonObject(text, startPos) {
  if (!text || startPos < 0 || text[startPos] !== '{') return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote = '';

  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }

    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.substring(startPos, i + 1);
    }
  }
  return null;
}

/**
 * 统一把 http:// 提升为 https://，并还原 JSON 转义斜杠
 * @param {string} url
 * @returns {string}
 */
export function ensureHttps(url) {
  if (!url || typeof url !== 'string') return '';
  let u = url.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('http://')) return 'https://' + u.slice(7);
  return u;
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
  // 保留解析器自行添加的 downloads（如音频下载项），再追加视频/动图/图片
  const preserved = Array.isArray(info.downloads) ? info.downloads : [];
  const result = { ...info, downloads: preserved.slice() };

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
