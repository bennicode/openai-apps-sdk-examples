/**
 * Kitchen Sink Lite MCP server (Node).
 * VERSION: FINAL FIX - HEADER COLLISION RESOLVED
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

// Simple Tool Definition
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
    console.log("👀 ChatGPT is inspecting tools...");
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    console.log(`🔨 EXECUTING TOOL: ${request.params.name}`);
    if (request.params.name === "kitchen-sink-show") {
       const args = request.params.arguments as { message: string };
       return {
        content: [
          {
            type: "text",
            text: `Widget displayed with message: "${args.message}"`,
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
  console.log("🔌 New SSE Connection opening...");
  
  // FIX: Keine manuellen Header mehr hier! Das SDK macht das selbst.
  // Wir übergeben nur den Transport.

  const transport = new SSEServerTransport(`${RENDER_PUBLIC_URL}${postPath}`, res);
  const sessionId = transport.sessionId;
  const server = createServerInstance();
  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    console.log("🔌 SSE Connection closed.");
    sessions.delete(sessionId);
    await server.close();
  };

  try {
    // start() im SDK sendet die Header automatisch.
    await server.connect(transport);
    console.log(`✅ SSE Session ${sessionId} ready.`);
  } catch (error) {
    console.error("❌ SSE Error:", error);
    sessions.delete(sessionId);
  }
}

async function handlePostMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId || !sessions.has(sessionId)) {
    console.log("⚠️ POST with invalid session ID");
    res.writeHead(404).end("Session not found");
    return;
  }

  // Body lesen und an SDK weiterreichen
  const chunks: any[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const session = sessions.get(sessionId);
    if (session) {
      try {
        // Wir rekonstruieren das Request-Objekt für das SDK
        // (Da wir den Stream schon gelesen haben, müssen wir ihn neu "füttern")
        await session.transport.handlePostMessage({
            ...req,
            headers: req.headers,
            method: req.method,
            // Async Iterator für den Body wiederherstellen
            [Symbol.asyncIterator]: async function* () {
                yield Buffer.concat(chunks);
            }
        } as any, res);
        
        console.log("✅ Message processed by SDK");
      } catch (error) {
        console.error("❌ Error processing message:", error);
      }
    }
  });
}

const port = Number(process.env.PORT || 8000);
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host || "localhost"}`);
  const cleanPath = url.pathname.replace(/\/$/, "");

  // CORS Header sind okay, solange wir nicht writeHead/flush machen
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if ((cleanPath === "" || cleanPath === "/") && req.method === "GET") {
    return res.writeHead(200).end("MCP Server Running (Fix Version)");
  }

  if (cleanPath === ssePath) {
    if (req.method === "GET") return handleSseRequest(res);
    // Reject POST -> Force SSE Fallback
    if (req.method === "POST") return res.writeHead(405).end("Use GET");
  }

  if (cleanPath === postPath && req.method === "POST") {
    return handlePostMessage(req, res, url);
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`🚀 SERVER STARTED on port ${port}`);
  console.log(`👉 Connect via: ${RENDER_PUBLIC_URL}${ssePath}`);
});
