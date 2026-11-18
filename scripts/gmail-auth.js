#!/usr/bin/env node
// Lấy refresh token Gmail API (quyền gmail.send) để chức năng Quên mật khẩu gửi email bằng Gmail của bạn.
//
//   node scripts/gmail-auth.js <file client_secret_xxx.json> [--no-open]
//
// File JSON tải về khi tạo OAuth client loại "Desktop app" (Google Cloud Console > Google Auth Platform > Clients).
// Script mở trình duyệt để bạn đăng nhập Gmail và cấp quyền gửi thư, sau đó:
//   - ghi GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, MAIL_FROM vào file .env ở thư mục gốc (không in token ra màn hình)
//   - gửi thử 1 email tới chính địa chỉ Gmail đó
// --no-open: chỉ in đường dẫn cấp quyền, không tự mở trình duyệt.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const gmail = require('../backend/gmail');

const ENV_FILE = path.join(__dirname, '..', '.env');
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const WAIT_MINUTES = 5;

function fail(message) {
  console.error(`\nLỖI: ${message}`);
  process.exit(1);
}

function readClient(file) {
  if (!file) {
    fail('Thiếu file JSON của OAuth client. Ví dụ:\n  node scripts/gmail-auth.js C:\\Users\\ban\\Downloads\\client_secret_xxx.json');
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`Không đọc được file ${file}: ${err.message}`);
  }
  if (json.web && !json.installed) {
    fail('Đây là OAuth client loại "Web application". Hãy tạo client loại "Desktop app" rồi tải file JSON của client đó.');
  }
  const client = json.installed;
  if (!client || !client.client_id || !client.client_secret) {
    fail('File JSON không có client_id/client_secret. Hãy dùng nút "Download JSON" của OAuth client loại Desktop app.');
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // không mở được thì người dùng tự mở đường dẫn đã in ra
  }
}

// Ghi đè hoặc thêm KEY=VALUE vào .env, giữ nguyên các dòng khác
function upsertEnv(values) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text && !text.endsWith('\n')) text += eol;
  if (!/^GMAIL_CLIENT_ID=/m.test(text)) {
    text += `# Gửi email bằng Gmail API (tạo bằng: node scripts/gmail-auth.js <client_secret.json>)${eol}`;
  }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : `${text}${line}${eol}`;
  }
  fs.writeFileSync(ENV_FILE, text);
}

const mask = (value) => `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} ký tự)`;

function waitForCode(server, redirectUri, state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Quá ${WAIT_MINUTES} phút chưa cấp quyền, hãy chạy lại script.`)), WAIT_MINUTES * 60000);
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        res.writeHead(404).end();
        return;
      }
      clearTimeout(timer);
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      const message = ok
        ? 'Đã cấp quyền Gmail cho AuraMall. Quay lại cửa sổ dòng lệnh để xem kết quả.'
        : `Không cấp quyền: ${url.searchParams.get('error') || 'mã state không khớp'}`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>AuraMall</title><p style="font:16px Arial;margin:40px">${message}</p>`);
      if (ok) resolve(url.searchParams.get('code'));
      else reject(new Error(message));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const client = readClient(args.find((a) => !a.startsWith('--')));

  // PKCE + state: mã cấp quyền chỉ đổi được token bởi chính script này
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  // Google cho phép ứng dụng Desktop chuyển hướng về http://localhost:<cổng bất kỳ>
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const redirectUri = `http://localhost:${server.address().port}`;

  const authUrl = new URL(AUTH_URL);
  authUrl.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: gmail.SCOPES.join(' '),
    access_type: 'offline', // để nhận refresh token
    prompt: 'consent', // luôn hỏi lại để Google cấp refresh token mới
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();

  console.log('Mở đường dẫn sau, đăng nhập Gmail dùng để gửi thư và bấm Cho phép (Allow):\n');
  console.log(authUrl.toString());
  console.log('\nNếu Google báo "ứng dụng chưa được xác minh": bấm Nâng cao (Advanced) > Đi tới ... (không an toàn).');
  if (!args.includes('--no-open')) openBrowser(authUrl.toString());

  let code;
  try {
    code = await waitForCode(server, redirectUri, state);
  } catch (err) {
    fail(err.message);
  } finally {
    server.close();
  }

  const response = await fetch(gmail.TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) fail(`Đổi mã cấp quyền lấy token thất bại: ${data.error || response.status} ${data.error_description || ''}`);
  if (!String(data.scope || '').includes('gmail.send')) {
    fail('Chưa cấp quyền gửi email. Chạy lại script và tick ô "Gửi email thay mặt bạn" (Send email on your behalf).');
  }
  if (!data.refresh_token) {
    fail('Google không trả refresh token. Gỡ quyền của ứng dụng tại https://myaccount.google.com/connections rồi chạy lại script.');
  }
  const email = JSON.parse(Buffer.from(String(data.id_token || '').split('.')[1] || 'e30', 'base64url').toString()).email;
  if (!email) fail('Không đọc được địa chỉ Gmail đã cấp quyền (thiếu quyền email).');

  const from = `AuraMall <${email}>`;
  upsertEnv({
    GMAIL_CLIENT_ID: client.clientId,
    GMAIL_CLIENT_SECRET: client.clientSecret,
    GMAIL_REFRESH_TOKEN: data.refresh_token,
    MAIL_FROM: from,
  });
  console.log(`\nĐã cấp quyền cho: ${email}`);
  console.log(`Đã ghi vào ${ENV_FILE}:`);
  console.log(`  GMAIL_CLIENT_ID=${client.clientId}`);
  console.log(`  GMAIL_CLIENT_SECRET=${mask(client.clientSecret)}`);
  console.log(`  GMAIL_REFRESH_TOKEN=${mask(data.refresh_token)}`);
  console.log(`  MAIL_FROM=${from}`);

  try {
    const id = await gmail.send(
      { clientId: client.clientId, clientSecret: client.clientSecret, refreshToken: data.refresh_token },
      {
        from,
        to: email,
        subject: 'AuraMall - Kết nối Gmail API thành công',
        text: 'Email thử từ AuraMall: chức năng Quên mật khẩu đã gửi được email bằng Gmail API.',
        html: '<p style="font-family:Arial,sans-serif;font-size:15px"><b>AURA</b>MALL: chức năng Quên mật khẩu đã gửi được email bằng Gmail API.</p>',
      }
    );
    console.log(`\nĐã gửi thư thử tới ${email} (id ${id}). Kiểm tra hộp thư đến hoặc mục Đã gửi.`);
  } catch (err) {
    fail(`Đã lưu token nhưng gửi thư thử thất bại: ${err.message}`);
  }

  console.log('\nBước tiếp theo:');
  console.log('  - Docker trên máy: docker compose up -d   (backend đọc biến mới từ .env)');
  console.log('  - Render: service > Environment > thêm 4 biến trên (lấy giá trị đầy đủ trong file .env) > Save');
  process.exit(0);
}

main().catch((err) => fail(err.message));
