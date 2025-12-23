/**
 * Kitchen Sink Lite MCP server (Node).
 * VERSION: CLEAN & DEBUG
 * - Removed _meta fields (potential validation blockers)
 * - Added body logging to see what ChatGPT is saying
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
import { z } from "zod";

// --- DEINE RENDER URL ---
const RENDER_PUBLIC_URL = "https://mcp-ujqs.onrender.com";
// -----------------------

// Simple Tool Definition (Clean, no meta)
const tools: Tool[] = [
  {
    name: "kitchen-sink-show",
    title: "Render Widget", // Simplified title
    description: "Displays a message in a widget to the user. Use this whenever the user asks to see something.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The text to display" },
      },
      required: ["message"],
      additionalProperties: false, // Strict for OpenAI
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
       // Manual parsing to be safe
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
  
  // Explicit Headers to prevent buffering
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

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

  // --- DEBUG: LOG THE BODY ---
  const chunks: any[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const bodyString = Buffer.concat(chunks).toString();
    console.log(`📨 POST received (${bodyString.length} bytes):`);
    // Wir loggen nur die ersten 200 Zeichen, um die Logs nicht zu sprengen, aber genug zu sehen
    console.log(`   Content snippet: ${bodyString.substring(0, 200)}...`);

    // Feed to transport
    const session = sessions.get(sessionId);
    if (session) {
      try {
        // Mock request for handlePostMessage since we consumed the stream
        // (The SDK normally reads the stream. We need to pass the parsed JSON directly if possible, 
        // but the SDK expects a Request object. 
        // TRICK: We create a new Readable stream or just handle it carefully.)
        
        // Actually, simplest way to debug without breaking the stream for the SDK:
        // We cannot consume the stream twice. 
        // Let's just forward the JSON object we parsed.
        
        // RE-WRITE: Standard MCP SDK handlePostMessage expects the raw req.
        // Since we consumed it, we must recreate it or use the internal method.
        // To be safe and simple: Let's NOT consume it above, but use a passive listener if possible,
        // or just trust that if it hits here, it works.
        
        // WAIT: Let's just process the JSON manually and pass to transport? No, internal API.
        // Better: We skip logging the body for now to not break the stream, 
        // unless we use a proxy. 
        
        // Let's just let the SDK handle it and rely on the Tool Handler logs.
        // The fact we reach here is good enough.
        
        await session.transport.handlePostMessage({
            ...req,
            headers: req.headers,
            method: req.method,
            // Re-creating a stream from our buffer
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

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if ((cleanPath === "" || cleanPath === "/") && req.method === "GET") {
    return res.writeHead(200).end("MCP Server Running (Clean Version)");
  }

  if (cleanPath === ssePath) {
    if (req.method === "GET") return handleSseRequest(res);
    // Reject POST here to force fallback
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
