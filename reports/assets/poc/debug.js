const mineflayer = require("mineflayer");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");
const { io } = require("socket.io-client");
const bot = mineflayer.createBot({ host: "127.0.0.1", port: 25565, username: "AI_Bot2", version: "1.20.1", auth: "offline" });

bot.once("spawn", () => {
  mineflayerViewer(bot, { port: 3008, firstPerson: true, viewDistance: 6 });
  setTimeout(() => {
    const pos = bot.entity.position;
    const below = bot.blockAt(pos.offset(0, -1, 0));
    const cols = typeof bot.world.getColumns === "function" ? bot.world.getColumns().length : "n/a";
    const colKeys = bot.world.columns ? Object.keys(bot.world.columns).length : "n/a";
    console.log("PROBE", JSON.stringify({
      pos: [pos.x, pos.y, pos.z], belowBlock: below && below.name, columns: cols, columnsProp: colKeys,
      loadedChunkCount: bot.world.columnCount ?? "n/a",
    }));
    const sock = io("http://127.0.0.1:3008", { transports: ["websocket"] });
    const hist = {}; let bytes = 0;
    sock.onAny((n, ...a) => { hist[n] = (hist[n] || 0) + 1; try { bytes += JSON.stringify(a).length; } catch {} });
    sock.on("connect", () => console.log("SOCKET connected", sock.id));
    setTimeout(() => { console.log("SOCKET hist", JSON.stringify(hist), "bytes", (bytes / 1024).toFixed(0) + "KiB"); process.exit(0); }, 6000);
  }, 4000);
});
bot.on("error", e => { console.log("err", e.message); process.exit(1); });
setTimeout(() => process.exit(2), 30000);
