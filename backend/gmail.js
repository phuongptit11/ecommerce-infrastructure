// Gửi email qua Gmail API bằng OAuth refresh token (quyền gmail.send).
// Đi qua HTTPS cổng 443 nên chạy được cả trên Render gói Free (gói này chặn cổng SMTP 25/465/587).
// Lấy refresh token: node scripts/gmail-auth.js <file client_secret_xxx.json>
'use strict';

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
// gmail.send: chỉ được gửi thư, không đọc được hộp thư. openid + email: để biết địa chỉ Gmail đã cấp quyền.
const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'];

function configFromEnv(env) {
  const clientId = (env.GMAIL_CLIENT_ID || '').trim();
  const clientSecret = (env.GMAIL_CLIENT_SECRET || '').trim();
  const refreshToken = (env.GMAIL_REFRESH_TOKEN || '').trim();
  const count = [clientId, clientSecret, refreshToken].filter(Boolean).length;
  return { clientId, clientSecret, refreshToken, complete: count === 3, partial: count > 0 && count < 3 };
}

// Rút gọn lỗi của Google thành một dòng dễ đọc, ví dụ "Google OAuth 400: invalid_grant: Token has been expired or revoked."
async function googleError(response, what) {
  const body = (await response.text()).trim();
  let detail = body.slice(0, 300);
  try {
    const json = JSON.parse(body);
    if (typeof json.error === 'string') {
      detail = json.error_description ? `${json.error}: ${json.error_description}` : json.error;
    } else if (json.error && json.error.message) {
      const reason = json.error.status || (json.error.errors && json.error.errors[0] && json.error.errors[0].reason) || json.error.code;
      detail = `${reason}: ${json.error.message}`;
    }
  } catch {
    // giữ nguyên nội dung gốc
  }
  return new Error(`${what} ${response.status}: ${detail}`);
}

// Access token sống khoảng 1 giờ: giữ lại dùng chung, hết hạn mới xin lại bằng refresh token
let cachedToken = { value: null, expiresAt: 0, refreshToken: '' };

async function getAccessToken(cfg) {
  if (cachedToken.value && cachedToken.refreshToken === cfg.refreshToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw await googleError(response, 'Google OAuth');
  const data = await response.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000,
    refreshToken: cfg.refreshToken,
  };
  return data.access_token;
}

const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ').trim();

// Tiêu đề, tên người gửi có dấu tiếng Việt: mã hóa theo RFC 2047, mỗi đoạn tối đa 45 byte để không vượt 75 ký tự/đoạn
function encodeHeader(value) {
  const text = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const chunks = [];
  let current = '';
  for (const ch of text) {
    if (current && Buffer.byteLength(current + ch) > 45) {
      chunks.push(current);
      current = '';
    }
    current += ch;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`).join('\r\n ');
}

// "AuraMall <ban@gmail.com>" -> From hợp lệ; tên có dấu được mã hóa
function formatAddress(address) {
  const text = oneLine(address);
  const match = text.match(/^"?([^"<]*?)"?\s*<([^>\s]+)>$/);
  if (!match) return text;
  const name = match[1].trim();
  if (!name) return `<${match[2]}>`;
  const shownName = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeHeader(name);
  return `${shownName} <${match[2]}>`;
}

function base64Body(text) {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/.{76}(?=.)/g, '$&\r\n');
}

// Thư MIME gồm bản chữ thường và bản HTML (multipart/alternative), mã hóa base64 để giữ nguyên tiếng Việt
function buildMime({ from, to, subject, text, html }) {
  const headers = [`From: ${formatAddress(from)}`, `To: ${oneLine(to)}`, `Subject: ${encodeHeader(subject)}`, 'MIME-Version: 1.0'];
  const parts = [];
  if (text) parts.push(['text/plain', text]);
  if (html) parts.push(['text/html', html]);
  if (parts.length === 1) {
    headers.push(`Content-Type: ${parts[0][0]}; charset=UTF-8`, 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${base64Body(parts[0][1])}\r\n`;
  }
  const boundary = `auramall_${crypto.randomBytes(12).toString('hex')}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const body = parts
    .map(([type, content]) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Body(content)}\r\n`)
    .join('');
  return `${headers.join('\r\n')}\r\n\r\n${body}--${boundary}--\r\n`;
}

// Gửi thư, trả về id thư trong Gmail (xem lại trong mục Đã gửi của hộp thư)
async function send(cfg, message) {
  const accessToken = await getAccessToken(cfg);
  const raw = Buffer.from(buildMime(message), 'utf8').toString('base64url');
  const response = await fetch(SEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) cachedToken = { value: null, expiresAt: 0, refreshToken: '' };
  if (!response.ok) throw await googleError(response, 'Gmail API');
  const data = await response.json();
  return data.id || null;
}

module.exports = { SCOPES, TOKEN_URL, configFromEnv, getAccessToken, buildMime, send };
