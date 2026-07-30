// ========================================
// 全局配置常量
// ========================================

// ---------- UA 池 ----------
export const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
export const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
export const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.146 Mobile Safari/537.36';
export const UA_GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.3 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// ---------- 平台域名映射 ----------
/** @type {Record<string, string>} */
export const DOMAIN_TO_NAME = {
  'www.douyin.com': '抖音',
  'www.iesdouyin.com': '抖音',
  'v.douyin.com': '抖音',
  'www.kuaishou.com': '快手',
  'v.kuaishou.com': '快手',
  'm.kuaishou.com': '快手',
  'www.xiaohongshu.com': '小红书',
  'haokan.baidu.com': '好看视频',
  'haokan.hao123.com': '好看视频',
  'www.ixigua.com': '西瓜视频',
  'v.ixigua.com': '西瓜视频',
  'm.ixigua.com': '西瓜视频',
  'weibo.com': '微博',
  'm.weibo.cn': '微博',
  'www.tiktok.com': 'TikTok',
  'vt.tiktok.com': 'TikTok',
  'vm.tiktok.com': 'TikTok',
  'www.youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'm.youtube.com': 'YouTube',
  'www.zhihu.com': '知乎',
  'zhuanlan.zhihu.com': '知乎',
  'h5.pipix.com': '皮皮虾',
  'pipix.com': '皮皮虾',
  'kg.qq.com': '全民K歌',
  'www.acfun.cn': 'AcFun',
  'm.acfun.cn': 'AcFun'
};

/** @type {Record<string, { icon: string, color: string }>} */
export const PLATFORM_INFO = {
  '抖音':     { icon: '🎵', color: '#333333' },
  '快手':     { icon: '🎬', color: '#FF6F00' },
  '小红书':   { icon: '📕', color: '#FF2442' },
  '好看视频': { icon: '🎥', color: '#4E9EFF' },
  '西瓜视频': { icon: '🍉', color: '#FF6B35' },
  '微博':     { icon: '📱', color: '#E6162D' },
  'TikTok':   { icon: '🎵', color: '#000000' },
  'YouTube':  { icon: '▶️', color: '#FF0000' },
  '知乎':     { icon: '💡', color: '#0066FF' },
  '皮皮虾':   { icon: '🦐', color: '#FF6B35' },
  '全民K歌':  { icon: '🎤', color: '#FF0000' },
  'AcFun':    { icon: '🔴', color: '#FD4C5F' }
};

// ---------- 安全常量 ----------
export const COOKIE_NAME = 'vd_token';
export const COOKIE_MAX_AGE = 12 * 3600;          // 12 小时
// JWT 密钥（运行时从 env.JWT_SECRET 获取，无默认值）
export let JWT_SECRET = '';
export function setJwtSecret(secret) { JWT_SECRET = secret; }
export const MAX_ATTEMPTS = 3;
export const CLEANUP_INTERVAL = 900;               // 秒
export const COOLDOWNS = [3600000];                // 1 小时
export const RATE_MAP_MAX_ENTRIES = 500;
export const PARSE_CACHE_TTL = 300000;             // 5 分钟
export const PARSE_CACHE_MAX_ENTRIES = 30;
export const MAX_FILE_SIZE = 1024 * 1024 * 1024 * 1024; // 1TB

// ---------- 安全响应头 ----------
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src * data: blob:; connect-src 'self' https://cdnjs.cloudflare.com; media-src 'self'; font-src 'self' data:; frame-src 'none';",
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

// Cookie 正则缓存
export const COOKIE_REGEX = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`);
