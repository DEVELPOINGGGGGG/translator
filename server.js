const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;

// Pulling BOTH of your Gemini API Keys from Render
const geminiVisionKey = process.env.GEMINI_API_KEY_VISION;
const geminiTextKey = process.env.GEMINI_API_KEY_TEXT;

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

// 50MB limit to handle high-res photos
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

// --- GEMINI TEXT ROUTE (Math Solving, Translation, Chat) ---
// THIS USES KEY 2 (TEXT KEY)
async function handleGeminiText(req, res) {
  if (!geminiTextKey) return sendJson(res, 500, { error: "Missing GEMINI_API_KEY_TEXT in Render." });

  try {
    const { systemPrompt, userPrompt, temperature = 0 } = JSON.parse(await readRequestBody(req));

    const payload = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: temperature }
    };

    if (systemPrompt) {
        payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiTextKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini text request failed.");

    return sendJson(res, 200, { text: data.candidates[0].content.parts[0].text });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || "Gemini text service unavailable." });
  }
}

// --- GEMINI VISION ROUTE (Image OCR, Multi-page reading) ---
// THIS USES KEY 1 (VISION KEY)
async function handleGeminiVision(req, res) {
  if (!geminiVisionKey) return sendJson(res, 500, { error: "Missing GEMINI_API_KEY_VISION in Render." });

  try {
    const { imageBase64, prompt, temperature = 0 } = JSON.parse(await readRequestBody(req));
    if (!imageBase64) return sendJson(res, 400, { error: "No image provided." });

    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

    const payload = {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }
            ]
        }],
        generationConfig: { temperature: temperature }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiVisionKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini Vision request failed.");

    return sendJson(res, 200, { text: data.candidates[0].content.parts[0].text });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || "Gemini Vision service unavailable." });
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
  if (req.method === "POST" && req.url === "/api/gemini-text") return handleGeminiText(req, res);
  if (req.method === "POST" && req.url === "/api/gemini-vision") return handleGeminiVision(req, res);
  
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  
  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(port, () => console.log(`AI Pro Suite running on port ${port} with Dual Gemini Keys`));
