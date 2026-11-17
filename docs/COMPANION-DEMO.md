# Local Demo Entry Points

Three local demo surfaces exist. They are development tools, not the production Host:
each runs only on loopback and none of them implements LAN TLS, account auth or the
DSH/MCP adapter yet.

## 1. Desktop simulator (in-memory core)

The simulator UI talks to an in-process demo API and shows the whole companion loop:
server-authoritative world, player place/break intents, home candidate approval, and a
bounded 12-block starter home committed by the Companion.

```powershell
npm run simulator
# Open http://127.0.0.1:4173/?mode=core
```

State is in memory: restarting the server resets the world. The `local mode` tab keeps
the original browser-only sandbox.

## 2. Durable Host (`packages/host`)

A real Host process with SQLite persistence and a WebSocket replica protocol.

```powershell
npm run host
# Fangcun Host listening on http://127.0.0.1:8765
# pairing code (single use, 5 min): XXXXXXXX
```

Implemented:

- SQLite (WAL, `synchronous=FULL`) world snapshot + commit log written in one transaction.
  A snapshot whose revision disagrees with the commit log fails closed at startup.
- One-time pairing code → bearer token → WebSocket `hello`/`welcome`.
- `intent`/`ack`/`commit` replica protocol with broadcast to every authenticated session.
- `resync`, `ping`/`pong`.
- Companion `home` approval and AI tick endpoints; approved grants and AI commits are
  persisted, so the world and the granted home survive a Host restart.
- Sequence numbers are scoped to one live connection, so a reconnect starts at `seq = 1`.

Not implemented yet (do not claim these): LAN TLS with pinned fingerprints, QR pairing UI,
plan/approval leases, undo, multi-session quotas, the DSH/MCP tool adapter.

### Connecting the tablet over USB (development only)

The tablet is not on the LAN path yet. Use ADB reverse so the device reaches the Host's
loopback port:

```powershell
adb reverse tcp:8765 tcp:8765
adb shell curl -s http://127.0.0.1:8765/api/health
```

Then pair once from the device:

```powershell
curl -s -X POST -H "Content-Type: application/json" `
  -d '{"code":"<PAIRING_CODE>","clientId":"tablet-1"}' `
  http://127.0.0.1:8765/api/pair
```

The returned token is used as `Authorization: Bearer <token>` for HTTP, and as the
`credential` in the WebSocket `hello` frame. `adb reverse` disappears when the cable or
the device connection drops, so re-run it after reconnecting.

## 3. One-shot CLI

```powershell
npm run demo:companion
```

Prompts for owner approval in the terminal. Uses a fresh in-memory world each run.
