import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { coordToIndex } from "@fangcun/world-schema";
import { createSeedWorld } from "@fangcun/voxel-core";

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
  console.log(`Local UI smoke passed: seed 784 blocks → place/break → preview ${proposed} cells → explicit commit.`);

  const corePage = await browser.newPage();
  const coreErrors = [];
  const intents = [];
  corePage.on("pageerror", (error) => coreErrors.push(error.message));
  let coreWorld = createSeedWorld("core-seq-test");
  await corePage.setRequestInterception(true);
  corePage.on("request", async (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/core/")) {
      await request.continue();
      return;
    }
    if (path === "/api/core/state" && request.method() === "GET") {
      await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ world: coreWorld, ownerUserId: "browser-test-owner", companion: { companionId: "fish-test", state: "idle", autonomyEnabled: true } }) });
      return;
    }
    if (path === "/api/core/intent" && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}");
      intents.push(body);
      if (body.seq === 1) {
        await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ decision: { ack: { accepted: false, seq: 1, reason: "stale_revision", committedRev: 0 } }, world: coreWorld }) });
        return;
      }
      const blocks = [...coreWorld.blocks];
      blocks[coordToIndex(body.operation.at)] = body.operation.type === "place" ? body.operation.blockId : null;
      coreWorld = Object.freeze({ ...coreWorld, rev: coreWorld.rev + 1, blocks: Object.freeze(blocks) });
      await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ decision: { ack: { accepted: true, seq: body.seq, committedRev: coreWorld.rev } }, world: coreWorld }) });
      return;
    }
    if (path === "/api/core/companion/tick" && request.method() === "POST") {
      await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { status: "paused", intents: [], reason: "test_complete" }, world: coreWorld }) });
      return;
    }
    if (path === "/api/core/home/approve" && request.method() === "POST") {
      await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ approved: true, world: coreWorld }) });
      return;
    }
    await request.respond({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
  });

  await corePage.goto(`${url}?mode=core`, { waitUntil: "networkidle0" });
  await corePage.waitForFunction(() => document.querySelector("#core-state")?.textContent.includes("Connected"));
  assert.equal(await corePage.$eval("#shared-mode", (button) => button.getAttribute("aria-pressed")), "true", "query mode enters Shared Core on first load");
  assert.equal(await corePage.$eval("#world-id", (node) => node.textContent), "core-seq-test");
  await corePage.click('#tile-grid .tile[data-x="0"][data-z="0"]');
  await corePage.click("#place-button");
  await corePage.waitForFunction(() => document.querySelector("#runtime-error")?.textContent.includes("stale revision"));
  assert.equal(await corePage.evaluate(() => sessionStorage.getItem("simulator-client-seq")), "1", "a definitive rejection consumes and persists its sequence");
  await corePage.click('#tile-grid .tile[data-x="1"][data-z="0"]');
  await corePage.click("#place-button");
  await corePage.waitForFunction(() => document.querySelector("#world-rev")?.textContent === "01");
  assert.deepEqual(intents.map((intent) => intent.seq), [1, 2], "the next intent uses a fresh sequence after stale_revision");
  assert.deepEqual(coreErrors, [], `Shared Core browser mode has no page errors: ${coreErrors.join(" | ")}`);
  await corePage.close();
  console.log("Shared Core smoke passed: ?mode=core → stale seq 1 → accepted seq 2; no browser errors.");
} finally {
  await browser?.close();
  server.kill();
}
