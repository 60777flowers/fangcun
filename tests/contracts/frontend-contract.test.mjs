import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 4177;
const origin = `http://127.0.0.1:${port}`;

test("simulator serves required frontend assets and rejects unlisted files", async (t) => {
  const server = spawn(process.execPath, ["scripts/serve-simulator.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
    windowsHide: true,
  });
  t.after(() => server.kill());

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      ready = (await fetch(origin)).ok;
      if (ready) break;
    } catch {}
    await delay(100);
  }
  assert.equal(ready, true, "simulator server starts");

  const html = await fetch(origin);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type") ?? "", /text\/html/);
  const document = await html.text();
  for (const selector of ["id=\"world-canvas\"", "id=\"tile-grid\"", "id=\"place-button\"", "id=\"break-button\"", "id=\"proposal-panel\"", "id=\"shared-mode\""]) {
    assert.ok(document.includes(selector), `frontend document contains ${selector}`);
  }

  for (const [path, contentType] of [
    ["/apps/simulator/app.js", /javascript/],
    ["/apps/simulator/pet-panel.js", /javascript/],
    ["/apps/simulator/styles.css", /text\/css/],
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, `${path} is served`);
    assert.match(response.headers.get("content-type") ?? "", contentType);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }

  for (const path of ["/package.json", "/README.md", "/.git/config", "/apps/simulator/../index.html"]) {
    const response = await fetch(`${origin}${path}`);
    assert.ok([400, 403, 404].includes(response.status), `${path} is not exposed`);
  }

  const post = await fetch(origin, { method: "POST" });
  assert.equal(post.status, 405);
});
