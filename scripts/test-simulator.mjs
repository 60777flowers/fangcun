import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";

const chromePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}; set CHROME_PATH to a Chromium executable.`);
const port = 4174;
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, ["scripts/serve-simulator.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
  windowsHide: true,
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      ready = response.ok;
      if (ready) break;
    } catch {}
    await delay(100);
  }
  assert.equal(ready, true, "simulator server starts on the expected local route");

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle0" });
  await delay(1000);
  const tileCount = await page.$$eval("#tile-grid .tile", (tiles) => tiles.length);
  assert.equal(tileCount, 196, `simulator should render 196 selectable tiles; browser errors: ${errors.join(" | ")}`);
  const textOf = (selector) => page.$eval(selector, (element) => element.textContent.trim());
  assert.equal(await textOf("#world-rev"), "00");
  assert.equal(await textOf("#block-count"), "784");
  assert.equal((await textOf(".preview-label")).includes("DESKTOP PREVIEW"), true);

  await page.click('#tile-grid .tile[data-x="0"][data-z="0"]');
  await page.click("#place-button");
  assert.equal(await textOf("#world-rev"), "01");
  assert.equal(await textOf("#block-count"), "785");
  await page.click("#break-button");
  assert.equal(await textOf("#world-rev"), "02");
  assert.equal(await textOf("#block-count"), "784");

  await page.click("#proposal-prompt", { clickCount: 3 });
  await page.type("#proposal-prompt", "bridge");
  await page.click(".generate-button");
  await page.waitForFunction(() => !document.querySelector("#proposal-panel").hidden);
  const proposed = Number(await textOf("#proposal-count"));
  assert.ok(proposed > 0, "proposal displays preview cells");
  assert.equal(await textOf("#world-rev"), "02", "proposal generation does not mutate state");
  await page.click("#confirm-proposal");
  assert.equal(await textOf("#world-rev"), "03", "explicit confirmation commits a single transaction");
  assert.equal(await textOf("#block-count"), String(784 + proposed));
  assert.equal(await page.$eval("#proposal-panel", (element) => element.hidden), true);

  await page.click(".generate-button");
  await page.waitForFunction(() => !document.querySelector("#proposal-panel").hidden);
  assert.equal(await textOf("#world-rev"), "03");
  await page.click('#tile-grid .tile[data-x="1"][data-z="1"]');
  await page.click("#place-button");
  assert.equal(await textOf("#world-rev"), "04");
  assert.equal(await page.$eval("#proposal-stale", (element) => element.hidden), false, "world changes invalidate the pending preview");
  assert.equal(await page.$eval("#confirm-proposal", (element) => element.disabled), true, "stale preview cannot be committed");
  await page.click("#cancel-proposal");
  assert.equal(await page.$eval("#proposal-panel", (element) => element.hidden), true);

  const forbidden = await fetch(`${url}README.md`);
  assert.equal(forbidden.status, 404, "preview server does not expose unrelated repository files");
  assert.deepEqual(errors, [], "browser console has no page errors");
  console.log(`UI smoke passed: seed 784 blocks → place/break → preview ${proposed} cells → explicit commit; no browser errors.`);
} finally {
  await browser?.close();
  server.kill();
}
