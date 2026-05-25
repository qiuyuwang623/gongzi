// 本地代理服务器 + 小说爬虫 GUI
// 用法: node proxy.js  然后浏览器打开 http://localhost:8765
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8765;

function httpGet(url, referer, cookie) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': referer || url.replace(/\?.*$/, ''),
    };
    if (cookie) headers['Cookie'] = cookie;
    const opts = { headers, timeout: 30000 };
    client.get(url, opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const cookies = res.headers['set-cookie'] || [];
        resolve({ buffer: Buffer.concat(chunks), cookies });
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function decodeBuffer(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch {}
  try { return new TextDecoder('gbk').decode(buffer); } catch {}
  return new TextDecoder('gb2312').decode(buffer);
}

function extractCookie(cookies) {
  return cookies.map(c => c.split(';')[0]).join('; ');
}

function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('file not found');
  }
}

const HTML_PATH = path.join(__dirname, 'novel-scraper.html');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = req.url.split('?')[0];

  // Serve HTML app
  if (urlPath === '/' || urlPath === '/index.html') {
    serveFile(res, HTML_PATH, 'text/html; charset=utf-8');
    return;
  }

  // Proxy fetch: /fetch?url=xxx
  if (urlPath === '/fetch') {
    const targetUrl = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('url');
    if (!targetUrl) { res.writeHead(400); res.end('missing url'); return; }

    try {
      const { buffer, cookies: pageCookies } = await httpGet(targetUrl);
      let html = decodeBuffer(buffer);
      const cookie = extractCookie(pageCookies);

      const ajaxMatch = html.match(/var\s+READ_AID\s*=\s*(\d+)[\s\S]*?var\s+READ_CID\s*=\s*(\d+)[\s\S]*?var\s+READ_BUCKET\s*=\s*(\d+)[\s\S]*?var\s+READ_SIGN\s*=\s*['"]([^'"]+)['"]/i);
      if (ajaxMatch) {
        const [, aid, cid, bk, sign] = ajaxMatch;
        const base = targetUrl.split('?')[0];
        const ajaxUrl = `${base}?ajax=1&aid=${aid}&cid=${cid}&bk=${bk}&sign=${sign}&_=${Date.now()}`;
        console.log('  AJAX fetch:', ajaxUrl.substring(0, 80) + '...');
        const { buffer: ajaxBuffer } = await httpGet(ajaxUrl, targetUrl, cookie);
        const realContent = decodeBuffer(ajaxBuffer);
        if (realContent && realContent.length > 10 && !realContent.startsWith('forbidden')) {
          html = html.replace(/(<div[^>]*id\s*=\s*["']content["'][^>]*>)[\s\S]*?(<\/div>)/i, `$1${realContent}$2`);
          console.log('  AJAX content injected:', realContent.length, 'chars');
        } else {
          console.log('  AJAX unavailable:', realContent.substring(0, 60));
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(502);
      res.end(`proxy error: ${err.message}`);
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`小说爬虫已启动: http://localhost:${PORT}`);
  console.log('在浏览器中打开上述地址即可使用');
});
