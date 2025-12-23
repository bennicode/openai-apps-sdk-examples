/**
 * Kitchen Sink Lite MCP server (Node).
 * FIXED VERSION FOR RENDER DEPLOYMENT
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

// --- KONFIGURATION FÜR RENDER ---
const RENDER_PUBLIC_URL = "https://mcp-ujqs.onrender.com"; // Deine echte URL
// --------------------------------

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
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`
    );
  }

  const directPath = path.join(ASSETS_DIR, "kitchen-sink-lite.html");
  let htmlContents: string | null = null;

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(
        (file) =>
          file.startsWith("kitchen-sink-lite-") && file.endsWith(".html")
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "kitchen-sink-lite" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
    );
  }

  return htmlContents;
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
  return {
    ...toolDescriptorMeta(),
    invocation,
  };
}

const widgetHtml = readWidgetHtml();

const toolInputSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Message to render in the widget.",
    },
    accentColor: {
      type: "string",
      description: "Optional accent color (hex).",
    },
    details: {
      type: "string",
      description: "Optional supporting copy to show under the headline.",
    },
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
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "kitchen-sink-refresh",
    title: "Refresh from widget",
    description: "Lightweight echo tool called from the widget via callTool.",
    inputSchema: refreshInputSchema,
    _meta: toolDescriptorMeta(),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
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
    {
      name: "kitchen-sink-node",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request: ListResourcesRequest) => ({
      resources,
    })
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (_request: ReadResourceRequest) => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: MIME_TYPE,
          text: widgetHtml,
          _meta: toolDescriptorMeta(),
        },
      ],
    })
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_request: ListResourceTemplatesRequest) => ({
      resourceTemplates,
    })
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request: ListToolsRequest) => ({
      tools,
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      if (request.params.name === "kitchen-sink-show") {
        const args = showParser.parse(request.params.arguments ?? {});
        const processedAt = new Date().toISOString();
        const echoed = args.message.toUpperCase();
        const payload: WidgetPayload = {
          message: args.message,
          accentColor: args.accentColor ?? "#2d6cdf",
          details:
            args.details ??
            `Processed at ${processedAt}. Echo (uppercased): ${echoed}.`,
          fromTool: "kitchen-sink-show",
        };
        // Demonstrate a tool transforming input before returning structured content.
        return {
          content: [
            {
              type: "text",
              text: `Widget ready with message: ${payload.message} (processed ${processedAt})`,
            },
          ],
          structuredContent: { ...payload, processedAt, echoed },
          _meta: toolInvocationMeta("kitchen-sink-show"),
        };
      }

      if (request.params.name === "kitchen-sink-refresh") {
        const args = refreshParser.parse(request.params.arguments ?? {});
        const payload: WidgetPayload = {
          message: args.message,
          accentColor: "#2d6cdf",
          details: "Response returned from window.openai.callTool.",
          fromTool: "kitchen-sink-refresh",
        };
        return {
          content: [{ type: "text", text: payload.message }],
          structuredContent: payload,
          _meta: toolInvocationMeta("kitchen-sink-refresh"),
        };
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    }
  );

  return server;
}

type SessionRecord = {
  server: Server;
  transport: SSEServerTransport;
};

const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createKitchenSinkServer();
  
  // FIX 1: HIER NUTZEN WIR JETZT DIE ECHTE RENDER-URL STATT NUR DEM PFAD
  const transport = new SSEServerTransport(`${RENDER_PUBLIC_URL}${postPath}`, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;


// --- AB HIER ERSETZEN ---

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    // URL normalisieren
    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    const cleanPath = url.pathname.replace(/\/$/, ""); // Slash am Ende entfernen

    // LOGGING: Wir wollen alles sehen
    console.log(`📞 Incoming request: ${req.method} ${cleanPath}`);

    // 1. CORS & OPTIONS (Wichtig für ChatGPT)
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      });
      res.end();
      return;
    }

    // 2. SSE STREAM (Das Herzstück)
    if (req.method === "GET" && cleanPath === ssePath) {
      console.log("✅ SSE Connection established!");
      await handleSseRequest(res);
      return;
    }

    // 3. MESSAGES (Die normalen Nachrichten)
    if (req.method === "POST" && cleanPath === postPath) {
      console.log("✅ Message received (endpoint)!");
      await handlePostMessage(req, res, url);
      return;
    }

    // 4. DER FIX: POST auf /mcp auch erlauben!
    // ChatGPT probiert das manchmal als Test oder Fallback.
    if (req.method === "POST" && cleanPath === ssePath) {
        if (url.searchParams.has("sessionId")) {
            console.log("✅ Message received (via base path)!");
            await handlePostMessage(req, res, url);
        } else {
            console.log("✅ Probe/Ping received -> Sending 200 OK");
            res.writeHead(200).end("OK");
        }
        return;
    }

    // 5. Alles andere ist wirklich ein 404
    console.log(`❌ 404 Not Found: ${cleanPath}`);
    res.writeHead(404).end("Not Found");
  }
);

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`\n\n✅ KITCHEN SINK LITE (FINAL FIX) listening on port ${port}`);
  console.log(`👉 SSE URL: ${RENDER_PUBLIC_URL}${ssePath}`);
  console.log(`\n\n`);
});
