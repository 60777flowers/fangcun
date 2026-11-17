import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

/**
 * Minimal RFC 6455 server-side WebSocket.
 *
 * Deliberately dependency-free: the product treats third-party runtime code as a
 * supply-chain surface, and the Host only needs text frames with a hard size cap,
 * plus close/ping/pong. Fragmented messages, binary frames and extensions are
 * refused instead of partially supported.
 */

const ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_WS_MESSAGE_BYTES = 64 * 1024;

const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

export type WsCloseReason = "peer_closed" | "protocol_error" | "too_large" | "transport_error";

function acceptKey(clientKey: string): string {
  return createHash("sha1").update(clientKey + ACCEPT_GUID).digest("base64");
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

type ParsedFrame = Readonly<{ opcode: number; payload: Buffer; consumed: number }>;

function parseFrame(buffer: Buffer): ParsedFrame | null {
  if (buffer.length < 2) return null;
  const first = buffer[0]!;
  const second = buffer[1]!;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(MAX_WS_MESSAGE_BYTES)) {
      return Object.freeze({ opcode: -1, payload: Buffer.alloc(0), consumed: buffer.length });
    }
    length = Number(big);
    offset = 10;
  }
  if (!fin) return Object.freeze({ opcode: -2, payload: Buffer.alloc(0), consumed: buffer.length });
  if (!masked) return Object.freeze({ opcode: -2, payload: Buffer.alloc(0), consumed: buffer.length });
  if (length > MAX_WS_MESSAGE_BYTES) {
    return Object.freeze({ opcode: -1, payload: Buffer.alloc(0), consumed: buffer.length });
  }
  const total = offset + 4 + length;
  if (buffer.length < total) return null;
  const maskKey = buffer.subarray(offset, offset + 4);
  const raw = buffer.subarray(offset + 4, total);
  const payload = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = raw[index]! ^ maskKey[index % 4]!;
  }
  return Object.freeze({ opcode, payload, consumed: total });
}

export type WsConnectionHandlers = Readonly<{
  onMessage: (text: string) => void;
  onClose: (reason: WsCloseReason) => void;
}>;

export class WsConnection {
  readonly #socket: Duplex;
  #buffer: Buffer = Buffer.alloc(0);
  #closed = false;
  #handlers: WsConnectionHandlers | null = null;

  private constructor(socket: Duplex) {
    this.#socket = socket;
  }

  /** Completes the HTTP upgrade and returns the live connection. */
  static accept(request: { headers: Record<string, string | string[] | undefined> }, socket: Duplex, head: Buffer): WsConnection {
    const keyHeader = request.headers["sec-websocket-key"];
    const version = request.headers["sec-websocket-version"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (typeof key !== "string" || key.length < 16 || version !== "13") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      throw new Error("invalid websocket handshake");
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n"
      + "Upgrade: websocket\r\n"
      + "Connection: Upgrade\r\n"
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    const connection = new WsConnection(socket);
    if (head.length > 0) connection.#ingest(head);
    socket.on("data", (chunk: Buffer) => connection.#ingest(chunk));
    socket.on("close", () => connection.#finish("peer_closed"));
    socket.on("error", () => connection.#finish("transport_error"));
    return connection;
  }

  get closed(): boolean { return this.#closed; }

  attach(handlers: WsConnectionHandlers): void {
    this.#handlers = handlers;
  }

  sendText(text: string): boolean {
    if (this.#closed) return false;
    const payload = Buffer.from(text, "utf8");
    if (payload.length > MAX_WS_MESSAGE_BYTES) return false;
    this.#socket.write(encodeFrame(OPCODE_TEXT, payload));
    return true;
  }

  close(code = 1000): void {
    if (this.#closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.#socket.write(encodeFrame(OPCODE_CLOSE, payload));
    this.#finish("peer_closed");
    this.#socket.end();
  }

  #ingest(chunk: Buffer): void {
    if (this.#closed) return;
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const frame = parseFrame(this.#buffer);
      if (!frame) return;
      this.#buffer = this.#buffer.subarray(frame.consumed);
      if (frame.opcode === -1) {
        this.close(1009);
        this.#finish("too_large");
        return;
      }
      if (frame.opcode === -2) {
        this.close(1002);
        this.#finish("protocol_error");
        return;
      }
      if (frame.opcode === OPCODE_CLOSE) {
        this.#finish("peer_closed");
        this.#socket.end();
        return;
      }
      if (frame.opcode === OPCODE_PING) {
        this.#socket.write(encodeFrame(OPCODE_PONG, frame.payload));
        continue;
      }
      if (frame.opcode === OPCODE_PONG) continue;
      if (frame.opcode !== OPCODE_TEXT) {
        this.close(1003);
        this.#finish("protocol_error");
        return;
      }
      const text = frame.payload.toString("utf8");
      if (Buffer.byteLength(text, "utf8") !== frame.payload.length) {
        this.close(1007);
        this.#finish("protocol_error");
        return;
      }
      this.#handlers?.onMessage(text);
    }
  }

  #finish(reason: WsCloseReason): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#buffer = Buffer.alloc(0);
    this.#handlers?.onClose(reason);
  }
}
