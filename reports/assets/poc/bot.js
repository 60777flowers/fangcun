// POC: mineflayer bot + prismarine-viewer first-person web stream
// Measures: spawn time, viewer HTTP availability, RSS, socket.io handshake, chunk payload size
const mineflayer = require("mineflayer");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
const t0 = Date.now();
const events = [];

const bot = mineflayer.createBot({
  host: "127.0.0.1",
  port: 25565,
  username: "AI_Bot",
  version: "1.20.1",
  auth: "offline",
});

bot.on("login", () => events.push(`login @${Date.now() - t0}ms`));
bot.on("spawn", async () => {
  events.push(`spawn @${Date.now() - t0}ms pos=${bot.entity.position}`);
  try {
    mineflayerViewer(bot, { port: 3007, firstPerson: true, viewDistance: 4 });
    events.push(`viewer started @${Date.now() - t0}ms`);
  } catch (e) {
    events.push("viewer FAILED: " + e.message);
  }
  setTimeout(async () => {
    try {
      const r = await fetch("http://127.0.0.1:3007/");
      const html = await r.text();
      events.push(`HTTP GET / -> ${r.status}, ${html.length} bytes, hasCanvas=${/canvas|three/i.test(html)}`);
      const s = await fetch("http://127.0.0.1:3007/socket.io/?EIO=4&transport=polling");
      const st = await s.text();
      events.push(`socket.io handshake -> ${s.status}, ${st.slice(0, 120)}`);
    } catch (e) {
      events.push("HTTP probe FAILED: " + e.message);
    }
    const m = process.memoryUsage();
    events.push(`RSS=${(m.rss / 1048576).toFixed(1)}MB heapUsed=${(m.heapUsed / 1048576).toFixed(1)}MB`);
    events.push(`bot pos=${bot.entity && bot.entity.position} chunks=${Object.keys(bot.world.columns || {}).length}`);
    console.log("=== EVENTS ===");
    for (const e of events) console.log(e);
    process.exit(0);
  }, 8000);
});

bot.on("error", (e) => { events.push("bot error: " + e.message); console.log(events.join("\n")); process.exit(1); });
bot.on("kicked", (r) => { events.push("kicked: " + r); console.log(events.join("\n")); process.exit(1); });

setTimeout(() => { console.log("TIMEOUT"); console.log(events.join("\n")); process.exit(2); }, 45000);
