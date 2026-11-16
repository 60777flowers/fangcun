import puppeteer from 'puppeteer-core';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.png':'image/png', '.vrm':'application/octet-stream', '.glb':'application/octet-stream', '.json':'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'vrm-check.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(4322, '127.0.0.1', r));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-angle=d3d11','--enable-webgl'],
  defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0, 300)));
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 300)));

await page.goto('http://127.0.0.1:4322/vrm-check.html', { waitUntil: 'networkidle0', timeout: 90000 });
await new Promise(r => setTimeout(r, 9000));

const info = await page.evaluate(() => window.__VRM__ || null);
console.log('INFO', JSON.stringify(info));

const names = ['front','three-quarter','side','back'];
for (let i = 0; i < 4; i++) {
  await page.evaluate((idx) => window.__setView(idx), i);
  await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: path.join(ROOT, `vrm-${names[i]}.png`) });
  console.log('shot', names[i]);
}
await browser.close();
server.close();
