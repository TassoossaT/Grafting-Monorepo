"use client";

import { useEffect, useState } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** The SDK's own `callTool` generic return type resolves to `unknown` for the client's default result-schema type parameter; assert the documented real content-block shape instead of fighting the overload. */
interface ToolTextContent {
  readonly type: "text";
  readonly text: string;
}

type Status = "loading" | "ok" | "error";

export default function AgentsClient() {
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const client = new Client({ name: "architecture-studio-agents-page", version: "0.1.0" });
        const transport = new StreamableHTTPClientTransport(new URL("/api/mcp", window.location.origin));
        await client.connect(transport);

        const response = await client.callTool({
          name: "list_architecture_entities",
          arguments: { kind: "node", limit: 5 },
        });
        const content = (response as { content?: readonly ToolTextContent[] }).content;
        const text = content?.[0]?.type === "text" ? content[0].text : undefined;
        if (cancelled) return;

        setResult(typeof text === "string" ? text : JSON.stringify(response, null, 2));
        setStatus("ok");
        await client.close();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif", maxWidth: 720 }}>
      <h1>Agent-orchestration surface — raw MCP SDK validation</h1>
      <p>
        Calls the real <code>list_architecture_entities</code> tool on <code>/api/mcp</code> using
        the MCP SDK&apos;s own <code>Client</code> + <code>StreamableHTTPClientTransport</code> — no
        framework (Mastra/VoltAgent) is used here, per ADR-0016&apos;s policy to validate the raw SDK
        first.
      </p>
      <p data-testid="agents-status" data-status={status}>
        {status === "loading" && "Calling the MCP tool…"}
        {status === "error" && `Error: ${error}`}
        {status === "ok" && "Real tool-call round-trip succeeded."}
      </p>
      {result !== null && (
        <pre
          data-testid="agents-result"
          style={{ background: "#f7f9fc", padding: 12, borderRadius: 8, overflow: "auto" }}
        >
          {result}
        </pre>
      )}
    </div>
  );
}
