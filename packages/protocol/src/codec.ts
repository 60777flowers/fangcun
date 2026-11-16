import {
  MAX_CLIENT_FRAME_BYTES,
  MAX_SERVER_FRAME_BYTES,
  validateClientIntent,
  validateServerAck,
  validateClientMessage,
  validateServerMessage,
  validateCommitMessage,
  type ClientIntent,
  type ClientMessage,
  type ServerMessage,
  type CommitMessage,
  type ValidationResult,
} from "./index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type Frame = string | Uint8Array | ArrayBuffer;

function toBytes(frame: Frame): Uint8Array {
  if (typeof frame === "string") return encoder.encode(frame);
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  return frame;
}

export function decodeClientMessageFrame(frame: Frame): ValidationResult<ClientMessage> {
  let bytes: Uint8Array;
  try { bytes = toBytes(frame); } catch { return { ok: false, error: "invalid_frame" }; }
  if (bytes.byteLength > MAX_CLIENT_FRAME_BYTES) return { ok: false, error: "frame_too_large" };
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(bytes)); } catch { return { ok: false, error: "invalid_json_or_utf8" }; }
  return validateClientMessage(parsed);
}

export function encodeClientMessageFrame(message: ClientMessage): ValidationResult<Uint8Array> {
  const validated = validateClientMessage(message);
  if (!validated.ok) return validated;
  const bytes = encoder.encode(JSON.stringify(validated.value));
  return bytes.byteLength > MAX_CLIENT_FRAME_BYTES ? { ok: false, error: "frame_too_large" } : { ok: true, value: bytes };
}

export function decodeClientIntentFrame(frame: Frame): ValidationResult<ClientIntent> {
  let bytes: Uint8Array;
  try {
    bytes = toBytes(frame);
  } catch {
    return { ok: false, error: "invalid_frame" };
  }
  if (bytes.byteLength > MAX_CLIENT_FRAME_BYTES) return { ok: false, error: "frame_too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return { ok: false, error: "invalid_json_or_utf8" };
  }
  return validateClientIntent(parsed);
}

export function encodeClientIntentFrame(intent: ClientIntent): ValidationResult<Uint8Array> {
  const validated = validateClientIntent(intent);
  if (!validated.ok) return validated;
  const bytes = encoder.encode(JSON.stringify(validated.value));
  if (bytes.byteLength > MAX_CLIENT_FRAME_BYTES) return { ok: false, error: "frame_too_large" };
  return { ok: true, value: bytes };
}

export function decodeServerMessageFrame(frame: Frame): ValidationResult<ServerMessage> {
  let bytes: Uint8Array;
  try { bytes = toBytes(frame); } catch { return { ok: false, error: "invalid_frame" }; }
  if (bytes.byteLength > MAX_SERVER_FRAME_BYTES) return { ok: false, error: "frame_too_large" };
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(bytes)); } catch { return { ok: false, error: "invalid_json_or_utf8" }; }
  return validateServerMessage(parsed);
}

export function encodeServerMessageFrame(message: ServerMessage): ValidationResult<Uint8Array> {
  const validated = validateServerMessage(message);
  if (!validated.ok) return validated;
  const bytes = encoder.encode(JSON.stringify(validated.value));
  return bytes.byteLength > MAX_SERVER_FRAME_BYTES ? { ok: false, error: "frame_too_large" } : { ok: true, value: bytes };
}

export function decodeCommitFrame(frame: Frame): ValidationResult<CommitMessage> {
  let bytes: Uint8Array;
  try {
    bytes = toBytes(frame);
  } catch {
    return { ok: false, error: "invalid_frame" };
  }
  if (bytes.byteLength > MAX_SERVER_FRAME_BYTES) return { ok: false, error: "frame_too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return { ok: false, error: "invalid_json_or_utf8" };
  }
  return validateCommitMessage(parsed);
}

export function encodeCommitFrame(commit: CommitMessage): ValidationResult<Uint8Array> {
  const validated = validateCommitMessage(commit);
  if (!validated.ok) return validated;
  const bytes = encoder.encode(JSON.stringify(validated.value));
  if (bytes.byteLength > MAX_SERVER_FRAME_BYTES) return { ok: false, error: "frame_too_large" };
  return { ok: true, value: bytes };
}
