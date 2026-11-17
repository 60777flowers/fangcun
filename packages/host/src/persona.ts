/**
 * Companion persona — the single seam between Host speech and a real model.
 *
 * The demo runs offline: intents come from a small keyword table and every line is
 * picked deterministically, so demos and tests are reproducible without an LLM.
 * A future DSH/LLM persona replaces {@link composeCompanionReply} (and optionally the
 * idle lines) behind this same module; callers never talk to a model directly.
 * Persona text is untrusted display data: it can never influence world authority.
 */

export const CHAT_MAX_TEXT_LENGTH = 200;
export const COMPANION_SAY_MAX_TEXT_LENGTH = 80;

export type ChatRole = "user" | "companion";
export type ChatMessage = Readonly<{ role: ChatRole; text: string; atMs: number }>;
export type ChatIntent = "greeting" | "where_to_build" | "request_block" | "thanks" | "unknown";
export type ChatReply = Readonly<{ intent: ChatIntent; reply: string }>;

/** Ordered probes: the first match wins, so the order is part of the persona contract. */
const INTENT_PROBES: readonly Readonly<{ intent: ChatIntent; pattern: RegExp }>[] = Object.freeze([
  { intent: "greeting", pattern: /你好|您好|嗨|哈喽|早上好|晚上好|在吗|\b(hi|hello|hey)\b/i },
  { intent: "thanks", pattern: /谢谢|多谢|谢啦|辛苦|\b(thanks|thank you|thx)\b/i },
  { intent: "where_to_build", pattern: /在哪|哪里|哪儿|选址|盖在哪|建在哪|住哪|\bwhere\b/i },
  { intent: "request_block", pattern: /方块|木头|木板|玻璃|石头|材料|放一块|加一块|建一块|来块|\b(block|wood|glass)\b/i },
]);

/**
 * Variants are chosen by a hash of the user text, so the same prompt always gets
 * the same answer (deterministic) while different prompts still feel alive.
 */
const REPLY_LINES: Readonly<Record<ChatIntent, readonly string[]>> = Object.freeze({
  greeting: Object.freeze([
    "你好呀！我是住在这块小岛上的鱼～",
    "嗨！今天的方块闻起来甜甜的",
    "你来啦，我一直在这儿等你",
  ]),
  where_to_build: Object.freeze([
    "我想在岛中间找块平地，先搭个能看星星的小屋",
    "哪块地空空的又靠中间，我就搬过去",
    "等你点头，我就去挑一块晒得到太阳的地",
  ]),
  request_block: Object.freeze([
    "好呀好呀，木头和玻璃都给我留一点！",
    "收到！等我攒够材料就开工",
    "我要一块木头的，再来一块亮亮的玻璃",
  ]),
  thanks: Object.freeze([
    "嘿嘿，不客气，你对我最好啦",
    "被你夸得尾巴都翘起来了",
    "举手之劳！下次也叫上我",
  ]),
  unknown: Object.freeze([
    "唔…这个词我还没学会，不过我在认真听",
    "你说的话我都记在小本子上啦",
    "我先陪你待一会儿，想到什么再告诉我",
  ]),
});

const BUILD_LINES: readonly string[] = Object.freeze([
  "搭好啦！看看我的新家～",
  "又垒了一块，离屋顶更近了",
  "你放的那块刚好给我当台阶",
  "这块地很舒服，谢谢老板",
  "再攒点材料，我想开个窗",
]);

const IDLE_LINES: readonly string[] = Object.freeze([
  "我在看云，顺便想想窗户开在哪",
  "这块地好安静，适合发一会儿呆",
  "要不要给你留个能坐下来的台阶？",
  "我今天还没盖够，手有点痒",
]);

export const COMPANION_HOME_PROPOSAL_LINE = "我想住这块地，可以吗？";
export const COMPANION_HOME_GRANTED_LINE = "这块地归我啦！";
export const COMPANION_HOUSE_PROPOSAL_LINE = "我可以在这里盖个小房子吗？";
export const COMPANION_HOUSE_REJECTED_LINE = "好吧，那我再等等～";
export const COMPANION_HOUSE_START_LINE = "开工啦！一块一块慢慢来～";
export const COMPANION_HOUSE_DONE_LINE = "房子盖好啦，我坐这儿陪你～💤";
export const COMPANION_HOUSE_STOPPED_LINE = "这里好像放不下了，我先停一下。";
/** Scripted "懒懒小屋" demo lines (the first is the exact line required by the demo spec). */
export const COMPANION_LAZY_HOUSE_LINE = "房子盖好了，我先坐下休息会";
export const COMPANION_LAZY_HOUSE_DONE_LINE = "呼——真舒服";
/** Opening line when the lazy demo cancels a pending "认真盖房" proposal (exact demo string). */
export const COMPANION_LAZY_HOUSE_CHEEKY_LINE = "哼，你可管不到我~";

/** FNV-1a display hash: stable across runs and cheap enough for a chat turn. */
function stableIndex(seed: string, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return length > 0 ? (hash >>> 0) % length : 0;
}

/** Keeps every spoken line inside the wire contract (`companion_say` is ≤80 chars). */
function clampSay(text: string): string {
  return text.length <= COMPANION_SAY_MAX_TEXT_LENGTH
    ? text
    : `${text.slice(0, COMPANION_SAY_MAX_TEXT_LENGTH - 1)}…`;
}

export function detectChatIntent(rawText: string): ChatIntent {
  const text = rawText.trim();
  if (text.length === 0) return "unknown";
  for (const probe of INTENT_PROBES) {
    if (probe.pattern.test(text)) return probe.intent;
  }
  return "unknown";
}

/**
 * The one reply seam. Deterministic: the same text always yields the same line,
 * so tests and offline demos are stable. A real DSH/LLM reply only has to return
 * a Chinese, playful line of ≤80 chars from here.
 */
export function composeCompanionReply(rawText: string): ChatReply {
  const text = rawText.trim();
  const intent = detectChatIntent(text);
  const lines = REPLY_LINES[intent];
  return Object.freeze({ intent, reply: clampSay(lines[stableIndex(text, lines.length)]!) });
}

/** Build acknowledgement lines, rotated by the caller so repeats are avoided. */
export function buildLine(index: number): string {
  return clampSay(BUILD_LINES[Math.abs(index) % BUILD_LINES.length]!);
}

/** Idle chatter for the autonomy loop, rotated by the caller. */
export function idleLine(index: number): string {
  return clampSay(IDLE_LINES[Math.abs(index) % IDLE_LINES.length]!);
}
