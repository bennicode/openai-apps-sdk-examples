
/**
 * Kitchen Sink Lite MCP server (Node).
 * VERSION: GOLDEN MASTER (Clean & Stable)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// --- DEINE RENDER URL ---
const RENDER_PUBLIC_URL = "https://mcp-ujqs.onrender.com";
// -----------------------

const tools: Tool[] = [
  {
    name: "kitchen-sink-show",
    title: "Render Widget",
    description: "Displays a message in a widget to the user.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The text to display" },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
];

function createServerInstance(): Server {
  const server = new Server(
    { name: "kitchen-sink-node", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    if (request.params.name === "kitchen-sink-show") {
       const args = request.params.arguments as { message: string };
       return {
        content: [
          {
            type: "text",
            text: `Widget displayed: "${args.message}"`,
          }
        ],
      };
    }
    throw new Error("Tool not found");
  });

  return server;
}

// Session Management
type SessionRecord = { server: Server; transport: SSEServerTransport; };
const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  console.log("🔌 SSE: New connection...");
  
  // Das SDK setzt die Header und managed den Stream
  const transport = new SSEServerTransport(`${RENDER_PUBLIC_URL}${postPath}`, res);
  const sessionId = transport.sessionId;
  const server = createServerInstance();
  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    console.log("🔌 SSE: Closed.");
    sessions.delete(sessionId);
    await server.close();
  };

  try {
    await server.connect(transport);
    console.log(`✅ SSE: Session ${sessionId} active.`);
  } catch (error) {
    console.error("❌ SSE Error:", error);
    sessions.delete(sessionId);
  }
}

async function handlePostMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId || !sessions.has(sessionId)) {
    res.writeHead(404).end("Session not found");
    return;
  }

  const session = sessions.get(sessionId);
  if (session) {
    // WICHTIG: Wir lesen den Body NICHT manuell.
    // Wir geben req & res direkt an das SDK weiter.
    // Das SDK liest, verarbeitet und antwortet automatisch.
    try {
      await session.transport.handlePostMessage(req, res);
      console.log("📨 Message handled by SDK");
    } catch (error) {
      console.error("❌ Message Error:", error);
    }
  }
}

const port = Number(process.env.PORT || 8000);
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host || "localhost"}`);
  const cleanPath = url.pathname.replace(/\/$/, "");

  // CORS - Immer gut
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if ((cleanPath === "" || cleanPath === "/") && req.method === "GET") {
    return res.writeHead(200).end("MCP Server Online");
  }

  // SSE Endpoint
  if (cleanPath === ssePath) {
    if (req.method === "GET") return handleSseRequest(res);
    // TRICK: POST hier ablehnen, damit ChatGPT den SSE-Weg nimmt
    if (req.method === "POST") return res.writeHead(405).end("Use GET");
  }

  // Message Endpoint
  if (cleanPath === postPath && req.method === "POST") {
    return handlePostMessage(req, res, url);
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`🚀 SERVER LISTENING on port ${port}`);
});
