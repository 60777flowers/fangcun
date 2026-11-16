const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const logs = [];
  page.on("console", m => logs.push(m.type() + ": " + m.text().slice(0, 160)));
  page.on("pageerror", e => logs.push("pageerror: " + e.message.slice(0, 160)));
  page.on("worker", w => logs.push("worker created: " + w.url().slice(-40)));
  await page.goto("http://127.0.0.1:3008/", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(15000);
  const probe = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    let nonSky = null;
    try {
      const tmp = document.createElement("canvas");
      tmp.width = c.width; tmp.height = c.height;
      const ctx2d = tmp.getContext("2d");
      ctx2d.drawImage(c, 0, 0);
      const d = ctx2d.getImageData(0, 0, tmp.width, tmp.height).data;
      let n = 0, tot = 0;
      for (let i = 0; i < d.length; i += 4 * 37) { tot++; if (Math.abs(d[i] - 163) + Math.abs(d[i + 1] - 212) + Math.abs(d[i + 2] - 232) > 40) n++; }
      nonSky = +(n / tot).toFixed(3);
    } catch (e) { nonSky = "err:" + e.message.slice(0, 60); }
    return {
      canvas: [c.width, c.height],
      renderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "n/a",
      nonSkyPixelRatio: nonSky,
    };
  });
  await page.screenshot({ path: "D:/研一上/AR_MC/_tmp/poc/viewer-mobile2.png" });
  console.log(JSON.stringify({ probe, logs: logs.slice(0, 25) }, null, 2));
  await browser.close();
})().catch(e => { console.log("FAIL", e.message); process.exit(1); });
