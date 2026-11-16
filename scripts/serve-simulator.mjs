import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootReal = await realpath(root);
const port = Number(process.env.PORT ?? 4173);
const host = "127.0.0.1";
const allowedPaths = new Set([
  "/apps/simulator/index.html",
  "/apps/simulator/app.js",
  "/apps/simulator/styles.css",
  "/packages/protocol/dist/index.js",
  "/packages/voxel-core/dist/index.js",
  "/packages/world-schema/dist/index.js",
]);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new TypeError("PORT must be an integer from 1 to 65535");
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}:${port}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname.includes("\\") || pathname.includes("\0")) {
    response.writeHead(400).end("Bad request");
    return;
  }

  const routePath = pathname === "/" ? "/apps/simulator/index.html" : pathname;
  if (!allowedPaths.has(routePath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const filePath = resolve(rootReal, routePath.slice(1));
  if (filePath !== rootReal && !filePath.startsWith(`${rootReal}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileReal = await realpath(filePath);
    if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const fileStat = await stat(fileReal);
    if (!fileStat.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(fileReal).toLowerCase()) ?? "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(fileReal).on("error", () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Voxel sandbox: http://${host}:${port}/`);
  console.log("Press Ctrl+C to stop.");
});
