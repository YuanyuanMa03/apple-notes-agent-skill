import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { backendEntry, requireRuntime } from "./runtime.mjs";
import { RUNTIME, backendEnv, Failure, requireMac } from "./common.mjs";

export async function session(
  work,
  { runtime = RUNTIME, timeout = 15_000 } = {},
) {
  requireMac();
  if (runtime === RUNTIME) await requireRuntime();
  const { Client } = await import(
    pathToFileURL(
      join(
        runtime,
        "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
      ),
    ).href
  );
  const { StdioClientTransport } = await import(
    pathToFileURL(
      join(
        runtime,
        "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js",
      ),
    ).href
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [backendEntry(runtime)],
    env: backendEnv(),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  const client = new Client({
    name: "apple-notes-agent-skill",
    version: "0.1.0",
  });
  try {
    await client.connect(transport, { timeout });
    return await work(client);
  } catch (e) {
    if (e instanceof Failure) throw e;
    throw new Failure("mcp_error", e.message, { stderr, indeterminate: true });
  } finally {
    await client.close().catch(() => {});
  }
}
export function resultData(result) {
  if (result.structuredContent) return result.structuredContent;
  for (const block of result.content ?? []) {
    if (block.type !== "text") continue;
    try {
      return JSON.parse(block.text);
    } catch {
      const line = block.text
        .split("\n")
        .find((s) => s.startsWith("structuredContent: "));
      if (line) {
        try {
          return JSON.parse(line.slice(19));
        } catch {}
      }
    }
  }
  return undefined;
}
export async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 150_000,
  });
  return {
    ok: !result.isError,
    tool: name,
    data: resultData(result),
    content: result.content,
    ...(result.isError ? { isError: true } : {}),
  };
}
export async function invoke(name, args) {
  return session((c) => callTool(c, name, args));
}
