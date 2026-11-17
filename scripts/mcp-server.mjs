import { runStdioServer } from "@fangcun/mcp";

// stdout is the MCP transport, so diagnostics are written to stderr only.
console.error("fangcun mcp: stdio server ready");

try {
  await runStdioServer();
} catch (error) {
  console.error(`fangcun mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
