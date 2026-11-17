# Local Companion Home Demo

The desktop **Shared Core Demo** connects the simulator UI to the in-memory `WorldAuthority` HTTP API. It displays the authoritative world, sends player place/break intents, asks the owner to approve a home candidate, then lets the companion tick submit a bounded 12-block starter home.

```powershell
npm run simulator
# Open http://127.0.0.1:4173/?mode=core
```

This demo runs only on loopback. The built-in demo API binds to `127.0.0.1`, validates same-origin mutations, caps JSON bodies, and labels tracking readiness as simulated. It is not a production Host, does not connect the Android tablet, and has no session auth, WSS, durable SQLite/WAL, cross-restart persistence, real DSH/MCP, or LLM. Restarting the server resets the demo world.

A one-shot CLI version is also available:

```powershell
npm run demo:companion
```

The CLI prompts for owner approval. The grant issuer and owner identity are seeded by local demo code; production must receive identity from an authenticated Host/session boundary.
