// ========================================
// ParserFactory — 平台解析引擎
// 当前支持三个平台：抖音 / 快手 / 哔哩哔哩
// ========================================

import { DOMAIN_TO_NAME, PLATFORM_INFO, UA_PC } from '../config.js';
import { parseDouyin } from './douyin.js';
import { parseKuaishou } from './kuaishou.js';
import { parseBilibili } from './bilibili.js';

// ---------- 解析器注册表 ----------
const PARSER_REGISTRY = {
  '抖音':       parseDouyin,
  '快手':       parseKuaishou,
  '哔哩哔哩':   parseBilibili
};

// ---------- 短域名列表（需要跟随重定向） ----------
const SHORT_DOMAINS = ['v.douyin.com', 'v.kuaishou.com', 'b23.tv'];

/**
 * 解析短链接：跟随 HTTP 重定向，返回最终 URL
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
 * @param {object} [env] - Worker 环境变量（可选，用于平台 Cookie）
 * @returns {Promise<object>} 统一格式的解析结果
 */
export async function parseMedia(url, env) {
  // 先解析短链接（v.douyin.com / b23.tv 等）
  const resolvedUrl = await resolveRedirectUrl(url);
  if (resolvedUrl !== url) {
    const newPlatform = detectPlatform(resolvedUrl);
    if (newPlatform) {
      const parser = PARSER_REGISTRY[newPlatform];
      if (parser) return runParser(parser, resolvedUrl, newPlatform, env);
    }
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return {
      error: true,
      message: '暂不支持该链接。目前支持：抖音 / 快手 / 哔哩哔哩'
    };
  }

  const parser = PARSER_REGISTRY[platform];
  if (!parser) {
    return { error: true, message: '暂不支持解析 ' + platform };
  }

  return runParser(parser, url, platform, env);
}

/** 执行解析器并附加平台信息 */
async function runParser(parser, url, platform, env) {
  try {
    // 解析器可选接收 env（用于读取平台 Cookie）
    let result = await parser(url, env);
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
