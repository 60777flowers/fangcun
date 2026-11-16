// POC v2: measure what a browser client actually receives from prismarine-viewer
const mineflayer = require("mineflayer");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
const { io } = require("socket.io-client");

const t0 = Date.now();
const log = [];
const bot = mineflayer.createBot({
  host: "127.0.0.1", port: 25565, username: "AI_Bot", version: "1.20.1", auth: "offline",
});

bot.once("spawn", async () => {
  log.push(`spawn @${Date.now() - t0}ms`);
  mineflayerViewer(bot, { port: 3007, firstPerson: true, viewDistance: 4 });
  log.push(`viewer up @${Date.now() - t0}ms`);

  const sock = io("http://127.0.0.1:3007", { transports: ["websocket"] });
  const stats = {};
  let totalBytes = 0, firstEventAt = null, events = 0;
  sock.onAny((name, ...args) => {
    events++;
    if (firstEventAt === null) firstEventAt = Date.now();
    stats[name] = (stats[name] || 0) + 1;
    try { totalBytes += JSON.stringify(args).length; } catch {}
  });
  sock.on("connect", () => log.push(`socket.io connected @${Date.now() - t0}ms id=${sock.id}`));

  // keep the bot busy so the viewer has something to stream
  setTimeout(() => { try { bot.setControlState("forward", true); } catch {} }, 1500);
  setTimeout(() => { try { bot.setControlState("forward", false); } catch {} }, 4000);

  setTimeout(() => {
    log.push(`events=${events} bytes=${(totalBytes / 1024).toFixed(1)}KiB firstEventLatency=${firstEventAt ? firstEventAt - (t0 + 1424) : "n/a"}ms`);
    log.push("event histogram: " + JSON.stringify(stats));
    const m = process.memoryUsage();
    log.push(`RSS=${(m.rss / 1048576).toFixed(1)}MB`);
    log.push(`bot health=${bot.health} food=${bot.food} pos=${bot.entity.position} time=${bot.time.timeOfDay}`);
    console.log(log.join("\n"));
    sock.close();
    bot.quit();
    setTimeout(() => process.exit(0), 800);
  }, 10000);
});

bot.on("error", e => { console.log("bot error", e.message); process.exit(1); });
bot.on("kicked", r => { console.log("kicked", r); process.exit(1); });
