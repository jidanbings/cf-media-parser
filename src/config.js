// ========================================
// 全局配置常量
// ========================================

// ---------- UA 池 ----------
export const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
export const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// ---------- 平台域名映射（仅支持三平台） ----------
/** @type {Record<string, string>} */
export const DOMAIN_TO_NAME = {
  // 抖音
  'www.douyin.com': '抖音',
  'www.iesdouyin.com': '抖音',
  'v.douyin.com': '抖音',
  // 快手
  'www.kuaishou.com': '快手',
  'v.kuaishou.com': '快手',
  'm.kuaishou.com': '快手',
  'v.m.chenzhongtech.com': '快手',
  // 哔哩哔哩
  'www.bilibili.com': '哔哩哔哩',
  'm.bilibili.com': '哔哩哔哩',
  'b23.tv': '哔哩哔哩',
  'bili2233.cn': '哔哩哔哩'
};

/** @type {Record<string, { icon: string, color: string }>} */
export const PLATFORM_INFO = {
  '抖音':       { icon: '🎵', color: '#FE2C55' },
  '快手':       { icon: '🎬', color: '#FF6F00' },
  '哔哩哔哩':   { icon: '📺', color: '#00A1D6' }
};

/** 平台 → 独立入口页路径 */
export const PLATFORM_ROUTES = {
  '抖音':     '/douyin',
  '快手':     '/kuaishou',
  '哔哩哔哩': '/bilibili'
};

// ---------- 安全常量 ----------
/** 解析结果缓存 TTL（毫秒） */
export const PARSE_CACHE_TTL = 300000;             // 5 分钟
export const PARSE_CACHE_MAX_ENTRIES = 50;
/** 内存限流表容量上限 */
export const RATE_MAP_MAX_ENTRIES = 500;
/** 过期条目清理间隔（秒） */
export const CLEANUP_INTERVAL = 900;               // 15 分钟
/** 单个文件代理上限（2 GB，Cloudflare Workers 内存约束下的实用上限） */
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * 公开接口速率限制规则
 * key 为路径前缀，命中第一个匹配项
 * @type {Record<string, { limit: number, windowMs: number }>}
 */
export const RATE_LIMIT_RULES = {
  '/api/parse':        { limit: 20, windowMs: 60000 },
  '/api/music':        { limit: 20, windowMs: 60000 },
  '/api/proxy/image':  { limit: 120, windowMs: 60000 },
  '/api/stream':       { limit: 60, windowMs: 60000 },
  '/api/download':     { limit: 60, windowMs: 60000 },
  '/api/media':        { limit: 60, windowMs: 60000 }
};

/**
 * SSRF 黑名单域名（云元数据端点等）
 * @type {string[]}
 */
export const BLOCKED_HOST_PATTERNS = [
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
  '100.100.100.200'
];

// ---------- 安全响应头 ----------
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // 页面只加载 /assets/warmth.js 与 /assets/parse.js，但页面内仍有内联
  // <script> 配置块（如 window.PLATFORM_CONFIG），故 script-src 保留
  // 'unsafe-inline'；inline 事件属性已全部移除（由 check.mjs [2b] 把关）。
  // 字体为系统栈，无需放行任何外部字体源。
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src * data: blob:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ') + ';',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Embedder-Policy': 'unsafe-none'
};

// 允许的文件扩展名
export const ALLOWED_EXTENSIONS = ['.mp4', '.mp3', '.m4a', '.aac', '.jpg', '.jpeg', '.png', '.webp', '.gif'];

// JSON 响应头
export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};
