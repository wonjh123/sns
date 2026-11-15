// Vercel 함수: 환경변수의 Supabase URL·publishable 키를 브라우저용 config.js 로 내려준다.
// (로컬에서는 server.js 가 같은 역할을 한다)
module.exports = (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!url || !key || /^sb_secret_/.test(key)) {
    res.statusCode = 500;
    res.end("console.error('Vercel 환경변수 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY(publishable 키)를 설정하세요.');\n");
    return;
  }
  res.end(`window.SUPABASE_CONFIG = ${JSON.stringify({ url, key })};\n`);
};
