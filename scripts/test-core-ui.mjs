import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";

const chromePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}; set CHROME_PATH to a Chromium executable.`);
const port = 4176;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-simulator.mjs"], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "ignore", windowsHide: true,
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { ready = (await fetch(origin)).ok; if (ready) break; } catch {}
    await delay(100);
  }
  assert.equal(ready, true, "shared-core simulator server starts");
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], defaultViewport: { width: 1440, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?mode=core`, { waitUntil: "networkidle0" });
  const textOf = (selector) => page.$eval(selector, (element) => element.textContent.trim());
  await page.waitForFunction(() => document.querySelector("#core-state")?.textContent.includes("Connected"));
  assert.equal(await textOf("#world-rev"), "00");
  assert.equal(await textOf("#block-count"), "196");
  assert.equal((await textOf("#core-owner")), "simulator-owner");

  await page.click('#tile-grid .tile[data-x="0"][data-z="0"]');
  await page.click("#place-button");
  await page.waitForFunction(() => document.querySelector("#world-rev")?.textContent === "01");
  assert.equal(await textOf("#block-count"), "197");
  await page.click("#break-button");
  await page.waitForFunction(() => document.querySelector("#world-rev")?.textContent === "02");
  assert.equal(await textOf("#block-count"), "196");

  await page.click("#build-tick");
  await page.waitForFunction(() => !document.querySelector("#candidate-panel")?.hidden);
  assert.ok(await textOf("#candidate-select"));
  await page.click("#approve-candidate");
  await page.waitForFunction(() => document.querySelector("#world-rev")?.textContent === "03");
  assert.equal(await textOf("#block-count"), "208");
  assert.equal(await page.$eval("#candidate-panel", (element) => element.hidden), true);
  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  console.log("Shared Core UI smoke passed: server state → player place/break → owner home approval → 12-block companion commit; rev=3.");
} finally {
  await browser?.close();
  server.kill();
}
