// ========================================
// JWT 工具模块
// 功能: base64url 编解码、JWT 签发与验证 (HS256)
// ========================================

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function hmacSign(data, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * 创建 JWT
 * @param {object} payload - JWT payload
 * @param {string} secret - 签名密钥
 * @returns {Promise<string>} JWT token
 */
export async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSign(headerB64 + '.' + payloadB64, secret);
  return headerB64 + '.' + payloadB64 + '.' + sig;
}

/**
 * 验证 JWT
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<object|null>} 解析后的 payload 或 null
 */
export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sig] = parts;
  const expectedSig = await hmacSign(headerB64 + '.' + payloadB64, secret);
  if (sig !== expectedSig) return null;
  try {
    const raw = base64UrlDecode(payloadB64);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
