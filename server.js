const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;

// Environment Variables (KEEP THESE SECRET ON RENDER)
const groqApiKey = process.env.GROQ_API_KEY || process.env["GROQ-API-KEY"];
const googleVisionKey = process.env.GOOGLE_VISION_API_KEY; 

const publicDir = __dirname;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

// MASSIVE UPGRADE: Increased limit to 50MB to handle multi-image chapter uploads!
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50_000_000) { 
        reject(new Error("Request body is too large. Image file size limit exceeded."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// --- GROQ TEXT & VISION AI HANDLER ---
async function handleGroqChat(req, res) {
  if (!groqApiKey) return sendJson(res, 500, { error: "Missing GROQ_API_KEY. Add it to Render settings." });

  try {
    const body = await readRequestBody(req);
    const { messages, model = "llama-3.3-70b-versatile", temperature = 0 } = JSON.parse(body || "{}");

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature, messages }),
    });

    const data = await groqResponse.json().catch(() => ({}));
    if (!groqResponse.ok) return sendJson(res, groqResponse.status, { error: data.error?.message || "Groq request failed." });

    return sendJson(res, 200, data);
  } catch (error) {
    return sendJson(res, 502, { error: error.message || "Groq unavailable." });
  }
}

// --- GOOGLE CLOUD VISION OCR HANDLER ---
async function handleGoogleVision(req, res) {
  if (!googleVisionKey) return sendJson(res, 500, { error: "Missing GOOGLE_VISION_API_KEY. Add it to Render settings." });

  try {
    const body = await readRequestBody(req);
    const { imageBase64 } = JSON.parse(body || "{}");
    if (!imageBase64) return sendJson(res, 400, { error: "No image provided." });

    // Clean the Base64 string for Google API
    const base64Data = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    // Using DOCUMENT_TEXT_DETECTION for highly accurate Math and Chapter reading
    const visionRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${googleVisionKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Data },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }] 
        }]
      })
    });

    const data = await visionRes.json();
    if (!visionRes.ok) return sendJson(res, visionRes.status, { error: data.error?.message || "Google Vision failed." });

    const text = data.responses[0]?.fullTextAnnotation?.text || "";
    return sendJson(res, 200, { text });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || "Google Vision unavailable." });
  }
}

// --- STATIC FILE SERVER (HTML, CSS, JS) ---
function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = path.join(publicDir, safePath === "/" ? "index.html" : safePath);
  const filePath = requestedPath.startsWith(publicDir) ? requestedPath : path.join(publicDir, "index.html");

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": contentTypes[".html"] }); res.end(fallbackData);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

// --- ROUTER ---
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/groq-chat") return handleGroqChat(req, res);
  if (req.method === "POST" && req.url === "/api/google-ocr") return handleGoogleVision(req, res);
  
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  
  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(port, () => console.log(`AI Pro Suite running on port ${port}`));
