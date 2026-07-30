// ========================================
// HTTP 请求工具模块
// 功能: 带 UA 轮换的页面抓取、JSON 请求
// ========================================

import { UA_PC, UA_MOBILE, UA_ANDROID, UA_GOOGLEBOT } from '../config.js';

/**
 * 通用 HTML 页面获取（带 UA 轮换和反爬检测）
 * @param {string} url
 * @param {string} referer
 * @returns {Promise<string>}
 */
export async function fetchPage(url, referer = '') {
  const uas = [UA_MOBILE, UA_GOOGLEBOT, UA_PC, UA_ANDROID];
  let lastError = '';
  let firstPageText = '';

  for (let i = 0; i < uas.length; i++) {
    try {
      const fetchOpts = {
        headers: {
          'User-Agent': uas[i],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...(referer ? { 'Referer': referer } : {})
        }
      };
      // 首次请求额外头
      if (i === 0) {
        fetchOpts.headers['Sec-Fetch-Dest'] = 'document';
        fetchOpts.headers['Sec-Fetch-Mode'] = 'navigate';
        fetchOpts.headers['Sec-Fetch-Site'] = 'none';
        fetchOpts.headers['Sec-Fetch-User'] = '?1';
        fetchOpts.headers['Upgrade-Insecure-Requests'] = '1';
      }

      const resp = await fetch(url, fetchOpts);
      const text = await resp.text();
      if (!firstPageText) firstPageText = text;

      const isChallenge = text.includes('_$jsvmprt') || text.includes('challenge') || text.length < 100;
      const hasDouyinData = text.includes('aweme_id') || text.includes('"desc"') ||
        text.includes('"nickname"') || text.includes('play_addr') ||
        text.includes('_ROUTER_DATA') || text.includes('__INITIAL_STATE__');

      if (hasDouyinData) return text;
      if (!isChallenge) return text;
      lastError = `UA=${i} 挑战页`;
    } catch (e) {
      lastError = `UA=${i} 错误: ${e.message}`;
    }
  }
  return firstPageText || '';
}

/**
 * 获取 JSON 数据
 * @param {string} url
 * @param {object} headers
 * @returns {Promise<object|null>}
 */
export async function fetchJson(url, headers = {}) {
  const fetchHeaders = {
    'User-Agent': UA_PC,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...headers
  };
  try {
    const resp = await fetch(url, { headers: fetchHeaders });
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * 获取页面 HTML（简单版，用于非抖音平台）
 * @param {string} url
 * @param {object} headers
 * @param {string} referer
 * @returns {Promise<string>}
 */
export async function fetchHtml(url, headers = {}, referer = '') {
  const fetchHeaders = {
    'User-Agent': UA_PC,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(referer ? { 'Referer': referer } : {}),
    ...headers
  };
  try {
    const resp = await fetch(url, { headers: fetchHeaders, redirect: 'follow' });
    return await resp.text();
  } catch {
    return '';
  }
}
