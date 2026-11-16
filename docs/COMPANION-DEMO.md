# Local Companion Home Demo

This command demonstrates one in-memory core flow: the companion proposes a home plot, the local owner approves it, then `WorldAuthority` validates and atomically commits a bounded starter-home plan.

```powershell
npm run demo:companion
```

The demo pauses at the home proposal. Enter `y` to approve; any other response declines without changing the world.

Expected approved result includes a 12-block AI commit at revision 1 and a seeded world block count of 796.

This is a local logic demo, not a connected product workflow. It does not use the Android app, Host/WSS, session credentials, durable storage/WAL, undo UI, real DSH/MCP, LLM, or cross-restart persistence. The app creates a fresh in-memory world each run. The grant issuer and owner identity are seeded by the local script; production must obtain those identities through an authenticated local Host/session boundary.
