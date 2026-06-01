const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;

// ONLY ONE KEY NEEDED NOW!
const groqApiKey = process.env.GROQ_API_KEY || process.env["GROQ-API-KEY"];

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

// 50MB limit to handle multiple high-res math/textbook photos
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50_000_000) { 
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// --- GROQ AI CHAT & SOLVER ROUTE ---
async function handleGroqChat(req, res) {
  if (!groqApiKey) return sendJson(res, 500, { error: "Missing GROQ_API_KEY." });

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

// --- GROQ VISION OCR ROUTE (REPLACES GOOGLE) ---
async function handleGroqVision(req, res) {
  if (!groqApiKey) return sendJson(res, 500, { error: "Missing GROQ_API_KEY." });

  try {
    const body = await readRequestBody(req);
    const { imageBase64 } = JSON.parse(body || "{}");
    if (!imageBase64) return sendJson(res, 400, { error: "No image provided." });

    // Ensure the image has the correct prefix for the API
    let formattedBase64 = imageBase64;
    if (!formattedBase64.startsWith("data:image")) {
        formattedBase64 = `data:image/jpeg;base64,${formattedBase64}`;
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ 
        model: "llama-3.2-90b-vision-preview", // Groq's high-power vision model
        temperature: 0,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "Extract all the text and math from this image exactly as written. Return ONLY the raw text, with no introductory words or explanations." },
                    { type: "image_url", image_url: { url: formattedBase64 } }
                ]
            }
        ]
      })
    });

    const data = await groqResponse.json();
    if (!groqResponse.ok) return sendJson(res, groqResponse.status, { error: data.error?.message || "Groq Vision failed." });

    const text = data.choices[0]?.message?.content || "";
    return sendJson(res, 200, { text });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || "Groq Vision unavailable." });
  }
}

// --- STATIC FILE SERVER ---
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
  // NEW ENDPOINT POINTING TO GROQ VISION
  if (req.method === "POST" && req.url === "/api/groq-ocr") return handleGroqVision(req, res);
  
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  
  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(port, () => console.log(`AI Pro Suite running on port ${port}`));
