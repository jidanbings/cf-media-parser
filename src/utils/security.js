// ========================================
// 安全控制模块
// 功能: 速率限制、URL/文件名/来源验证
// ========================================

import {
  MAX_ATTEMPTS, COOLDOWNS, RATE_MAP_MAX_ENTRIES,
  PARSE_CACHE_TTL, PARSE_CACHE_MAX_ENTRIES, CLEANUP_INTERVAL,
  ALLOWED_EXTENSIONS
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

  for (const [ip, entry] of rateMap) {
    const expire = Math.max(entry.firstAttempt, entry.lockedUntil || 0) + 3600000;
    if (now > expire) rateMap.delete(ip);
  }
  for (const [key, cached] of parseCache) {
    if (now - cached.time > PARSE_CACHE_TTL) parseCache.delete(key);
  }
}

function ensureRateMapCapacity() {
  if (rateMap.size >= RATE_MAP_MAX_ENTRIES) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, entry] of rateMap) {
      if (entry.firstAttempt < oldestTime) { oldestTime = entry.firstAttempt; oldestKey = key; }
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
 * 记录失败尝试
 * @param {string} ip
 * @returns {{ remaining: number, waitSeconds: number }}
 */
export function recordFailedAttempt(ip) {
  const now = Date.now();
  ensureRateMapCapacity();

  let entry = rateMap.get(ip);
  if (!entry) {
    entry = { ip, count: 1, firstAttempt: now, lockedUntil: 0, lockoutLevel: 0 };
  } else {
    if (entry.lockedUntil && now > entry.lockedUntil) {
      entry.count = 1; entry.lockedUntil = 0; entry.lockoutLevel = 0; entry.firstAttempt = now;
    } else {
      entry.count++;
    }
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const level = Math.min(entry.lockoutLevel, COOLDOWNS.length - 1);
    entry.lockedUntil = now + COOLDOWNS[level];
    entry.lockoutLevel = Math.min(entry.lockoutLevel + 1, COOLDOWNS.length);
    entry.count = 0;
  }

  rateMap.set(ip, entry);
  return {
    remaining: entry.lockedUntil ? 0 : Math.max(0, MAX_ATTEMPTS - entry.count),
    waitSeconds: entry.lockedUntil ? Math.ceil((entry.lockedUntil - now) / 1000) : 0
  };
}

/**
 * 清除速率限制（登录成功时调用）
 */
export function clearRateLimit(ip) {
  rateMap.delete(ip);
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

/**
 * 验证下载 URL（SSRF 防护）
 */
export function validateDownloadUrl(downloadUrl) {
  try {
    const url = new URL(downloadUrl);
    if (url.protocol !== 'https:') return { valid: false, error: '只支持HTTPS链接' };
    if (url.port && url.port !== '443') return { valid: false, error: '不允许指定端口' };
    return { valid: true };
  } catch {
    return { valid: false, error: '无效的URL格式' };
  }
}

/**
 * 验证文件名（路径遍历防护）
 */
export function validateFilename(filename) {
  if (!filename || filename.trim() === '') return { valid: false, error: '文件名为空' };
  const traversalPatterns = ['..', '/', '\\', ':'];
  for (const pattern of traversalPatterns) {
    if (filename.includes(pattern)) return { valid: false, error: '文件名包含非法字符' };
  }
  if (filename.length > 200) return { valid: false, error: '文件名过长' };
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.some(e => e === '.' + ext)) {
    return { valid: false, error: '不支持的文件扩展名' };
  }
  return { valid: true };
}

/**
 * 验证请求来源（CSRF 防护）
 */
export function validateRequestOrigin(request, allowedOrigins = []) {
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  if (!origin && !referer) return { valid: true };
  if (allowedOrigins.length > 0) {
    if (origin) {
      const originHost = new URL(origin).hostname;
      if (allowedOrigins.includes(originHost)) return { valid: true };
    }
    if (referer) {
      const refererHost = new URL(referer).hostname;
      if (allowedOrigins.includes(refererHost)) return { valid: true };
    }
    return { valid: false, error: '请求来源不被允许' };
  }
  return { valid: true };
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
