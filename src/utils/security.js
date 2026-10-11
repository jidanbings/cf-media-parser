// ========================================
// 安全控制模块
// 功能: 速率限制、SSRF 防护、文件名校验、解析缓存
// 说明: 本版本已移除登录鉴权，模块只保留公开接口所需的安全能力
// ========================================

import {
  RATE_MAP_MAX_ENTRIES, PARSE_CACHE_TTL, PARSE_CACHE_MAX_ENTRIES,
  CLEANUP_INTERVAL, ALLOWED_EXTENSIONS, RATE_LIMIT_RULES,
  BLOCKED_HOST_PATTERNS
} from '../config.js';

// 在模块作用域保持状态（Worker 全局有效）
export const rateMap = new Map();
export const parseCache = new Map();
let lastCleanup = Date.now();

/**
 * 定期清理过期条目
 */
export function cleanupRateMap(now) {
  if (now - lastCleanup < CLEANUP_INTERVAL * 1000) return;
  lastCleanup = now;

  for (const [key, entry] of rateMap) {
    if (now - entry.windowStart > entry.windowMs * 2) rateMap.delete(key);
  }
  for (const [key, cached] of parseCache) {
    if (now - cached.time > PARSE_CACHE_TTL) parseCache.delete(key);
  }
}

function ensureRateMapCapacity() {
  if (rateMap.size >= RATE_MAP_MAX_ENTRIES) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, entry] of rateMap) {
      if (entry.windowStart < oldestTime) { oldestTime = entry.windowStart; oldestKey = key; }
    }
    if (oldestKey) rateMap.delete(oldestKey);
  }
}

function ensureParseCacheCapacity() {
  if (parseCache.size >= PARSE_CACHE_MAX_ENTRIES) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, cached] of parseCache) {
      if (cached.time < oldestTime) { oldestTime = cached.time; oldestKey = key; }
    }
    if (oldestKey) parseCache.delete(oldestKey);
  }
}

/**
 * 滑动窗口速率限制
 * @param {string} bucket - 限流维度键（如 `parse:1.2.3.4`）
 * @param {{ limit: number, windowMs: number }} rule
 * @returns {{ allowed: boolean, retryAfter: number }}
 */
export function checkRateLimit(bucket, rule) {
  const now = Date.now();
  ensureRateMapCapacity();

  let entry = rateMap.get(bucket);
  if (!entry || now - entry.windowStart > rule.windowMs) {
    entry = { windowStart: now, windowMs: rule.windowMs, count: 1 };
    rateMap.set(bucket, entry);
    return { allowed: true, retryAfter: 0 };
  }

  entry.count++;
  if (entry.count > rule.limit) {
    return { allowed: false, retryAfter: Math.ceil((entry.windowStart + rule.windowMs - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * 按路由规则执行限流
 * @param {string} path - 请求路径
 * @param {string} ip - 客户端 IP
 * @returns {{ limited: boolean, retryAfter: number }}
 */
export function applyRateLimit(path, ip) {
  for (const [prefix, rule] of Object.entries(RATE_LIMIT_RULES)) {
    if (path.startsWith(prefix)) {
      const { allowed, retryAfter } = checkRateLimit(`${prefix}:${ip}`, rule);
      if (!allowed) return { limited: true, retryAfter };
      return { limited: false, retryAfter: 0 };
    }
  }
  return { limited: false, retryAfter: 0 };
}

/**
 * 获取客户端 IP
 */
export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Real-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

// ========================================
// SSRF 防护
// ========================================

/** IPv4 私有 / 保留网段判断 */
function isBlockedIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;              // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true;                        // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;               // 172.16/12
  if (a === 192 && b === 168) return true;                        // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;              // CGNAT 100.64/10
  if (a >= 224) return true;                                      // 组播 / 保留
  return false;
}

/** IPv6 私有 / 回环判断 */
function isBlockedIPv6(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true; // link-local / ULA
  // IPv4-mapped: ::ffff:127.0.0.1
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

/**
 * 校验出站代理 URL（SSRF 防护）
 *
 * 规则：
 *  1. 必须是 http/https
 *  2. 不允许显式非标准端口（仅允许 80 / 443 或缺省）
 *  3. 不允许携带用户名密码
 *  4. 拒绝 localhost、内网 IP、云元数据域名与非公网 TLD
 *
 * @param {string} target
 * @returns {{ valid: boolean, error?: string, url?: URL }}
 */
export function validateProxyUrl(target) {
  if (!target || typeof target !== 'string') return { valid: false, error: '缺少 url 参数' };

  let url;
  try {
    url = new URL(target);
  } catch {
    return { valid: false, error: '无效的URL格式' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { valid: false, error: '只支持 HTTP/HTTPS 链接' };
  }
  if (url.username || url.password) {
    return { valid: false, error: 'URL 不允许携带认证信息' };
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return { valid: false, error: '不允许指定非标准端口' };
  }

  const host = url.hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    return { valid: false, error: '禁止访问内网地址' };
  }

  for (const bad of BLOCKED_HOST_PATTERNS) {
    if (host === bad || host.endsWith('.' + bad)) {
      return { valid: false, error: '禁止访问该域名' };
    }
  }

  if (host.includes(':')) {
    if (isBlockedIPv6(host)) return { valid: false, error: '禁止访问内网地址' };
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isBlockedIPv4(host)) return { valid: false, error: '禁止访问内网地址' };
  }

  return { valid: true, url };
}

/**
 * 验证文件名（路径遍历 / 头注入防护）
 */
export function validateFilename(filename) {
  if (!filename || String(filename).trim() === '') return { valid: false, error: '文件名为空' };

  const name = String(filename);

  // 控制字符会破坏 Content-Disposition 头
  if (/[\x00-\x1f\x7f]/.test(name)) return { valid: false, error: '文件名包含控制字符' };

  for (const pattern of ['..', '/', '\\', ':', '"', '<', '>', '|', '?', '*']) {
    if (name.includes(pattern)) return { valid: false, error: '文件名包含非法字符' };
  }
  if (name.length > 200) return { valid: false, error: '文件名过长' };

  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { valid: false, error: '文件名缺少扩展名' };
  const ext = name.slice(dot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: '不支持的文件扩展名' };
  }
  return { valid: true, name };
}

/**
 * 从任意字符串中清洗出安全的下载文件名（失败时回退到 fallback）
 * @param {string} raw
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeFilename(raw, fallback = 'media.bin') {
  const cleaned = String(raw || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.\./g, '_')
    .trim()
    .slice(0, 120);
  const result = validateFilename(cleaned);
  if (result.valid) return result.name;
  const fb = validateFilename(fallback);
  return fb.valid ? fb.name : 'media.bin';
}

/**
 * 获取解析缓存结果
 */
export function getParseCache(key) {
  const cached = parseCache.get(key);
  if (cached && Date.now() - cached.time < PARSE_CACHE_TTL) return cached.data;
  return null;
}

/**
 * 设置解析缓存
 */
export function setParseCache(key, data) {
  ensureParseCacheCapacity();
  parseCache.set(key, { data, time: Date.now() });
}
