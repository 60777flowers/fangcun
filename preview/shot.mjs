import puppeteer from 'puppeteer-core';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.mjs': 'text/javascript' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'm0.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(4321, '127.0.0.1', r));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-webgl'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', m => console.log('[' + m.type() + ']', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4321/m0.html', { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 7000));

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return { ready: window.__M0_READY__ || null, canvas: c ? [c.width, c.height] : null,
           renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : (gl ? 'ok' : 'NO WEBGL') };
});
console.log('INFO', JSON.stringify(info));

await page.screenshot({ path: path.join(ROOT, 'm0.png') });
console.log('saved m0.png');
await browser.close();
server.close();
