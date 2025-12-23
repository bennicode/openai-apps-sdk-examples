/**
 * Kitchen Sink Lite MCP server (Node).
 * FINAL LEGACY MODE - FORCED FALLBACK
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// --- KONFIGURATION ---
const RENDER_PUBLIC_URL = "https://mcp-ujqs.onrender.com"; 
// ---------------------

type WidgetPayload = {
  message: string;
  accentColor?: string;
  details?: string;
  fromTool?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", ".."); 
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");

const TEMPLATE_URI = "ui://widget/kitchen-sink-lite.html";
const MIME_TYPE = "text/html+skybridge";

function readWidgetHtml(): string {
  let htmlContents: string | null = null;
  try {
      if (fs.existsSync(ASSETS_DIR)) {
        const directPath = path.join(ASSETS_DIR, "kitchen-sink-lite.html");
        if (fs.existsSync(directPath)) {
            htmlContents = fs.readFileSync(directPath, "utf8");
        } else {
            const candidates = fs.readdirSync(ASSETS_DIR)
            .filter(f => f.startsWith("kitchen-sink-lite") && f.endsWith(".html"))
            .sort();
            if (candidates.length > 0) {
                htmlContents = fs.readFileSync(path.join(ASSETS_DIR, candidates[candidates.length - 1]), "utf8");
            }
        }
      }
  } catch (e) {
      console.warn("Warning: Could not read assets directory.", e);
  }
  return htmlContents || "<div><h1>Widget Placeholder</h1><p>Please run pnpm build.</p></div>";
}

function toolDescriptorMeta() {
  return {
    "openai/outputTemplate": TEMPLATE_URI,
    "openai/toolInvocation/invoking": "Preparing the kitchen sink widget",
    "openai/toolInvocation/invoked": "Widget rendered",
    "openai/widgetAccessible": true,
  } as const;
}

function toolInvocationMeta(invocation: string) {
  return { ...toolDescriptorMeta(), invocation };
}

const widgetHtml = readWidgetHtml();

const toolInputSchema = {
  type: "object",
  properties: {
    message: { type: "string", description: "Message to render in the widget." },
    accentColor: { type: "string", description: "Optional accent color (hex)." },
    details: { type: "string", description: "Optional supporting copy." },
  },
  required: ["message"],
  additionalProperties: false,
} as const;

const refreshInputSchema = {
  type: "object",
  properties: {
    message: { type: "string", description: "Message to echo back." },
  },
  required: ["message"],
  additionalProperties: false,
} as const;

const showParser = z.object({
  message: z.string(),
  accentColor: z.string().optional(),
  details: z.string().optional(),
});

const refreshParser = z.object({
  message: z.string(),
});

const tools: Tool[] = [
  {
    name: "kitchen-sink-show",
    title: "Render kitchen sink widget",
    description: "Returns the widget template with the provided message.",
    inputSchema: toolInputSchema,
    _meta: toolDescriptorMeta(),
  },
  {
    name: "kitchen-sink-refresh",
    title: "Refresh from widget",
    description: "Lightweight echo tool called from the widget via callTool.",
    inputSchema: refreshInputSchema,
    _meta: toolDescriptorMeta(),
  },
];

const resources: Resource[] = [
  {
    name: "Kitchen sink widget",
    uri: TEMPLATE_URI,
    description: "Kitchen sink lite widget markup",
    mimeType: MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
];

const resourceTemplates: ResourceTemplate[] = [
  {
    name: "Kitchen sink widget template",
    uriTemplate: TEMPLATE_URI,
    description: "Kitchen sink lite widget markup",
    mimeType: MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
];

function createKitchenSinkServer(): Server {
  const server = new Server(
    { name: "kitchen-sink-node", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
  server.setRequestHandler(ReadResourceRequestSchema, async () => ({
    contents: [{ uri: TEMPLATE_URI, mimeType: MIME_TYPE, text: widgetHtml, _meta: toolDescriptorMeta() }],
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates }));

  // LOGGING WENN TOOLS ABGEFRAGT WERDEN
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.log("✅ Tools listed! (ChatGPT is asking for capabilities)");
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    console.log(`🔨 Tool called: ${request.params.name}`);
    if (request.params.name === "kitchen-sink-show") {
      const args = showParser.parse(request.params.arguments ?? {});
      const processedAt = new Date().toISOString();
      const echoed = args.message.toUpperCase();
      const payload: WidgetPayload = {
        message: args.message,
        accentColor: args.accentColor ?? "#2d6cdf",
        details: args.details ?? `Processed at ${processedAt}. Echo: ${echoed}.`,
        fromTool: "kitchen-sink-show",
      };
      return {
        content: [{ type: "text", text: `Widget ready: ${payload.message}` }],
        structuredContent: { ...payload, processedAt, echoed },
        _meta: toolInvocationMeta("kitchen-sink-show"),
      };
    }
    if (request.params.name === "kitchen-sink-refresh") {
      const args = refreshParser.parse(request.params.arguments ?? {});
      const payload: WidgetPayload = {
        message: args.message,
        accentColor: "#2d6cdf",
        details: "Echo from refresh.",
        fromTool: "kitchen-sink-refresh",
      };
      return {
        content: [{ type: "text", text: payload.message }],
        structuredContent: payload,
        _meta: toolInvocationMeta("kitchen-sink-refresh"),
      };
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}

type SessionRecord = { server: Server; transport: SSEServerTransport; };
const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  const transport = new SSEServerTransport(`${RENDER_PUBLIC_URL}${postPath}`, res);
  const sessionId = transport.sessionId;
  const server = createKitchenSinkServer();
  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };
  transport.onerror = (error) => console.error("SSE transport error", error);

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) res.writeHead(500).end("SSE Error");
  }
}

async function handlePostMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) { res.writeHead(400).end("Missing sessionId"); return; }
  const session = sessions.get(sessionId);
  if (!session) { res.writeHead(404).end("Unknown session"); return; }
  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) res.writeHead(500).end("Message Error");
  }
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const cleanPath = url.pathname.replace(/\/$/, ""); 

  // 1. CORS IMMER SENDEN (WICHTIG!)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  console.log(`📞 Incoming request: ${req.method} ${cleanPath}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // 2. Health Check
  if (cleanPath === "" || cleanPath === "/") {
    res.writeHead(200).end("Kitchen Sink MCP Server is online.");
    return;
  }

  // 3. SSE Connect (Der Fallback, den wir wollen!)
  if (req.method === "GET" && cleanPath === ssePath) {
    console.log("✅ SSE Connect received (Legacy Mode)");
    await handleSseRequest(res);
    return;
  }

  // 4. Messages (Wenn die Verbindung steht)
  if (req.method === "POST" && cleanPath === postPath) {
    console.log("✅ Message received");
    await handlePostMessage(req, res, url);
    return;
  }

  // 5. Streamable HTTP Probe ablehnen -> Zwingt ChatGPT zum SSE Fallback
  // Wenn wir hier 404/405 senden, probiert ChatGPT automatisch GET /mcp
  if (req.method === "POST" && cleanPath === ssePath) {
      console.log("⚠️ Rejecting POST probe to force SSE fallback (This is GOOD!)");
      res.writeHead(405).end("Use GET for SSE");
      return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`\n\n✅ KITCHEN SINK (LEGACY MODE) listening on port ${port}`);
  console.log(`👉 Your URL: ${RENDER_PUBLIC_URL}${ssePath}\n\n`);
});
