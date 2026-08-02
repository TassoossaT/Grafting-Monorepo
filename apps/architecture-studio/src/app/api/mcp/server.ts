import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import graphData from "../../../../../../docs/generated/grafting.graph.json";
import type { GraphIrDocument } from "../../../presentation.ts";

/**
 * Minimal, real MCP server validating raw `@modelcontextprotocol/sdk` end to
 * end, per ADR-0016's license-risk policy (validate the raw SDK before
 * picking Mastra/VoltAgent). One tool, `list_architecture_entities`, queries
 * the same already-public, read-only Graph IR v1 artifact the explorer
 * surface renders -- no write/execute authority over any canonical source
 * is granted here.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "grafting-architecture-studio", version: "0.1.0" });

  server.registerTool(
    "list_architecture_entities",
    {
      title: "List architecture entities",
      description:
        "Lists nodes and/or edges from the repository's real Graph IR v1 artifact -- the same read-only data the Architecture Studio explorer surface already renders. Read-only; does not modify any canonical source.",
      inputSchema: {
        kind: z.enum(["node", "edge", "all"]).default("all").describe("Which entities to list"),
        limit: z.number().int().min(1).max(200).default(20).describe("Maximum number of entities to return per kind"),
      },
    },
    async ({ kind, limit }) => {
      const graph = graphData as GraphIrDocument;
      const nodes =
        kind === "edge"
          ? []
          : graph.nodes.slice(0, limit).map((node) => ({ id: node.id, kind: node.kind, label: node.label }));
      const edges =
        kind === "node"
          ? []
          : graph.edges
              .slice(0, limit)
              .map((edge) => ({ id: edge.id, kind: edge.kind, source: edge.source, target: edge.target }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                graphId: graph.graphId,
                sourceRevision: graph.sourceRevision,
                totalNodeCount: graph.nodes.length,
                totalEdgeCount: graph.edges.length,
                nodes,
                edges,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}
