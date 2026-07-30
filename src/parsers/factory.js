// ========================================
// ParserFactory — 多平台解析引擎
// 借鉴自 ucrao/media-parser 的工厂模式
// ========================================

import { DOMAIN_TO_NAME, PLATFORM_INFO, UA_PC } from '../config.js';
import { parseDouyin } from './douyin.js';
import { parseKuaishou } from './kuaishou.js';
import { parseXiaohongshu } from './xiaohongshu.js';
import { parseWeibo } from './weibo.js';
import { parseTiktok } from './tiktok.js';
import { parseYoutube } from './youtube.js';
import { parseXigua } from './xigua.js';
import { parseHaokan } from './haokan.js';
import { parseZhihu } from './zhihu.js';
import { parsePipixia } from './pipixia.js';
import { parseQuanminkge } from './quanminkge.js';
import { parseAcfun } from './acfun.js';

// ---------- 解析器注册表 ----------
const PARSER_REGISTRY = {
  '抖音':     parseDouyin,
  '快手':     parseKuaishou,
  '小红书':   parseXiaohongshu,
  '微博':     parseWeibo,
  'TikTok':   parseTiktok,
  'YouTube':  parseYoutube,
  '西瓜视频': parseXigua,
  '好看视频': parseHaokan,
  '知乎':     parseZhihu,
  '皮皮虾':   parsePipixia,
  '全民K歌':  parseQuanminkge,
  'AcFun':    parseAcfun
};

// ---------- 短域名列表（需要跟随重定向） ----------
const SHORT_DOMAINS = ['v.douyin.com', 'vt.tiktok.com', 'vm.tiktok.com', 'youtu.be'];

/**
 * 解析短链接：跟随 HTTP 重定向，返回最终 URL
 * 参考自 ucmao/media-parser 的 WebFetcher.fetch_redirect_url
 */
async function resolveRedirectUrl(url) {
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA_PC,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    if (resp.url && resp.url !== url) return resp.url;

    // 如果 redirect:follow 没变化，尝试手动读 Location
    const manual = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': UA_PC,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    if (manual.status >= 300 && manual.status < 400) {
      const loc = manual.headers.get('Location');
      if (loc) return new URL(loc, url).href;
    }
  } catch (e) {
    // 不阻塞，返回原 URL
  }
  return url;
}

// ---------- 平台检测 ----------

/**
 * 从 URL 检测所属平台
 * @param {string} url
 * @returns {string|null} 平台名称
 */
export function detectPlatform(url) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname.toLowerCase();

    // 优先精确匹配
    if (hostname.startsWith('www.')) {
      if (DOMAIN_TO_NAME[hostname]) return DOMAIN_TO_NAME[hostname];
    }
    if (DOMAIN_TO_NAME[hostname]) return DOMAIN_TO_NAME[hostname];

    // 模糊匹配
    for (const [domain, name] of Object.entries(DOMAIN_TO_NAME)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return name;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 获取平台展示信息
 * @param {string} platform
 * @returns {{ icon: string, color: string }}
 */
export function getPlatformInfo(platform) {
  return PLATFORM_INFO[platform] || { icon: '🔗', color: '#666666' };
}

// ---------- 主解析入口 ----------

/**
 * 统一解析入口 — 解析短链接 → 检测平台 → 分发解析器 → 附加平台信息
 * @param {string} url
 * @returns {Promise<object>} 统一格式的解析结果
 */
export async function parseMedia(url) {
  // B站永久屏蔽 — 反爬过于激进，本项目放弃支持
  if (url.includes('bilibili.com') || url.includes('b23.tv') || url.includes('hdslb.com')) {
    return {
      error: true,
      message: '本项目不支持解析B站链接。B站的反爬机制过于激进，永久放弃支持。B站太恶心了。'
    };
  }

  // 先解析短链接（v.douyin.com 等）
  const resolvedUrl = await resolveRedirectUrl(url);
  if (resolvedUrl !== url) {
    const newPlatform = detectPlatform(resolvedUrl);
    if (newPlatform) {
      const parser = PARSER_REGISTRY[newPlatform];
      if (parser) return runParser(parser, resolvedUrl, newPlatform);
    }
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return { error: true, message: '不支持的链接或无法识别平台' };
  }

  const parser = PARSER_REGISTRY[platform];
  if (!parser) {
    return { error: true, message: '暂不支持解析 ' + platform };
  }

  return runParser(parser, url, platform);
}

/** 执行解析器并附加平台信息 */
async function runParser(parser, url, platform) {
  try {
    let result = await parser(url);
    result.platform = platform;
    const info = getPlatformInfo(platform);
    result.platformIcon = info.icon;
    result.platformColor = info.color;
    return result;
  } catch (e) {
    return {
      error: true,
      message: '解析失败: ' + (e.message || '未知错误'),
      platform
    };
  }
}
