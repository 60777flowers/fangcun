// Keeps a bot + viewer alive so a browser can attach
const mineflayer = require("mineflayer");
const { mineflayer: mineflayerViewer } = require("prismarine-viewer");

const bot = mineflayer.createBot({
  host: "127.0.0.1", port: 25565, username: "AI_Bot", version: "1.20.1", auth: "offline",
});

bot.once("spawn", () => {
  mineflayerViewer(bot, { port: 3008, firstPerson: true, viewDistance: 5 });
  bot.chat("hello from the bot");
  // walk around a little and look around so the frame is not blank
  let i = 0;
  const t = setInterval(() => {
    i++;
    try {
      bot.setControlState("forward", i % 4 !== 0);
      bot.look((i * 0.7) % (Math.PI * 2), 0.1, true);
    } catch (e) {}
    if (i > 60) clearInterval(t);
  }, 700);
  console.log("BOT_READY");
});

bot.on("error", e => console.log("bot error", e.message));
process.on("SIGINT", () => process.exit(0));
setTimeout(() => { try { bot.quit(); } catch {} process.exit(0); }, 240000);

