// 로컬 개발 서버 (Node 표준 모듈만 사용)
// - .env 의 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 를 읽어 /config.js 로 브라우저에 전달한다.
// - 공개 파일 목록(PUBLIC_FILES)에 있는 파일만 서빙한다. (.env, server.js, PRD.md 등은 노출되지 않음)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const PUBLIC_FILES = {
  '/index.html': 'text/html; charset=utf-8',
  '/style.css': 'text/css; charset=utf-8',
  '/app.js': 'text/javascript; charset=utf-8',
};

function loadEnv() {
  const env = {};
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('.env 에 SUPABASE_URL 과 SUPABASE_PUBLISHABLE_KEY 를 설정하세요.');
  process.exit(1);
}
if (/^sb_secret_/.test(SUPABASE_KEY)) {
  console.error('SUPABASE_PUBLISHABLE_KEY 에 secret 키가 들어 있습니다. publishable 키를 쓰세요.');
  process.exit(1);
}

const configJs = `window.SUPABASE_CONFIG = ${JSON.stringify({ url: SUPABASE_URL, key: SUPABASE_KEY })};\n`;

http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }
    if (pathname === '/') pathname = '/index.html';

    if (pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(configJs);
      return;
    }

    const type = PUBLIC_FILES[pathname];
    if (!type) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    fs.readFile(path.join(ROOT, pathname), (err, data) => {
      if (err) {
        res.writeHead(500).end('Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`학교 SNS: http://localhost:${PORT}`));
