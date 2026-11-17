import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FangcunHost } from "@fangcun/host";

const dataDir = process.env.FANGCUN_DATA ?? join(homedir(), ".fangcun");
mkdirSync(dataDir, { recursive: true });

const host = new FangcunHost({
  worldId: process.env.FANGCUN_WORLD ?? "fangcun-local",
  port: Number(process.env.PORT ?? 8765),
  dbPath: join(dataDir, "world.sqlite"),
  ownerUserId: process.env.FANGCUN_OWNER ?? "local-user",
});

const address = await host.start();
const pairing = host.issuePairingCode();

console.log(`Fangcun Host listening on http://${address.host}:${address.port}`);
console.log(`world: ${address.worldId}   revision: ${host.revision}   data: ${dataDir}`);
console.log(`pairing code (single use, 5 min): ${pairing.code}`);
console.log("");
console.log("Android over USB (development only):");
console.log(`  adb reverse tcp:${address.port} tcp:${address.port}`);
console.log("Then point the client at ws://127.0.0.1:" + address.port + "/api/ws");
console.log("");
console.log("Press Ctrl+C to stop.");

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await host.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
