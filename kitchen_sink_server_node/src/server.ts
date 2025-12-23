/**
 * Kitchen Sink Lite MCP server (Node).
 * VERSION: CONNECTED + WIDGET ENABLED
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ReadResourceRequest,
  type Tool,
  type Resource,
} from "@modelcontextprotocol/sdk/types.js";

// --- DEINE RENDER URL ---
const RENDER_PUBLIC_URL = "https://mcp-ujqs.onrender.com";
// -----------------------

// 1. DAS HTML DIREKT IM CODE (Damit keine Datei-Fehler passieren)
const WIDGET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f0f0f0; }
    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #2d6cdf; margin-top: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Kitchen Sink Widget</h1>
    <p id="message">Waiting for data...</p>
    <p><small>Rendered via MCP</small></p>
  </div>
  <script>
    // OpenAI sendet Daten hierhin
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.message) {
        document.getElementById('message').textContent = data.message;
      }
    });
  </script>
</body>
</html>
`;

const WIDGET_URI = "ui://widget/kitchen-sink.html";

// 2. TOOL DEFINITION MIT META-DATEN (WICHTIG FÜR UI!)
const tools: Tool[] = [
  {
    name: "kitchen-sink-show",
    title: "Render Widget",
    description: "Displays a message in a graphical widget.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The text to display" },
      },
      required: ["message"],
      additionalProperties: false,
    },
    // Das hier sagt ChatGPT: "Benutze das Widget!"
    _meta: {
      "openai/outputTemplate": WIDGET_URI,
      "openai/widgetAccessible": true,
    },
  },
];

const resources: Resource[] = [
  {
    name: "Widget Template",
    uri: WIDGET_URI,
    mimeType: "text/html",
  },
];

function createServerInstance(): Server {
  const server = new Server(
    { name: "kitchen-sink-node", version: "0.2.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // Tools auflisten
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  // Ressourcen auflisten (Wichtig damit ChatGPT das HTML findet)
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));

  // Ressource lesen (Hier geben wir das HTML zurück)
  server.setRequestHandler(ReadResourceRequestSchema, async (req: ReadResourceRequest) => {
    if (req.params.uri === WIDGET_URI) {
      return {
        contents: [{ uri: WIDGET_URI, mimeType: "text/html", text: WIDGET_HTML }],
      };
    }
    throw new Error("Resource not found");
  });

  // Tool ausführen
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    if (request.params.name === "kitchen-sink-show") {
       const args = request.params.arguments as { message: string };
       return {
        content: [
          { type: "text", text: `Widget prepared with: "${args.message}"` }
        ],
        // Daten für das Widget
        structuredContent: {
            message: args.message
        },
        // Meta-Daten für die Anzeige
        _meta: {
            "openai/outputTemplate": WIDGET_URI,
            "openai/widgetAccessible": true
        }
      };
    }
    throw new Error("Tool not found");
  });

  return server;
}

// --- NETZWERK CODE (UNVERÄNDERT STABIL) ---
type SessionRecord = { server: Server; transport: SSEServerTransport; };
const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  console.log("🔌 SSE: New connection...");
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

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if ((cleanPath === "" || cleanPath === "/") && req.method === "GET") return res.writeHead(200).end("MCP Server Online");

  if (cleanPath === ssePath) {
    if (req.method === "GET") return handleSseRequest(res);
    if (req.method === "POST") return res.writeHead(405).end("Use GET");
  }

  if (cleanPath === postPath && req.method === "POST") {
    return handlePostMessage(req, res, url);
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`🚀 SERVER LISTENING on port ${port}`);
});
