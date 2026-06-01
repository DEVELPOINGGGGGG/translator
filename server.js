const http = require("http");
const fs = require("fs");
const path = require("path");

// Render prefers port 10000
const port = process.env.PORT || 10000;

// Config: Your hierarchy of keys from Render Environment Variables
const VISION_PROVIDERS = [
    { type: 'gemini', key: process.env.GEMINI_API_KEY_VISION_1 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_VISION_2 },
    { type: 'groq', key: process.env.GROQ_API_KEY }
].filter(p => p.key);

const TEXT_PROVIDERS = [
    { type: 'gemini', key: process.env.GEMINI_API_KEY_TEXT_1 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_TEXT_2 },
    { type: 'groq', key: process.env.GROQ_API_KEY }
].filter(p => p.key);

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

// --- UTILS ---
function sendJson(res, statusCode, payload) { 
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" }); 
    res.end(JSON.stringify(payload)); 
}

function readRequestBody(req) { 
    return new Promise((resolve, reject) => { 
        let body = ""; 
        req.on("data", chunk => {
            body += chunk;
            // 50MB Limit
            if (body.length > 50_000_000) { 
                reject(new Error("Request body is too large."));
                req.destroy();
            }
        }); 
        req.on("end", () => resolve(body)); 
        req.on("error", reject);
    }); 
}

// --- TRIPLE-FAILOVER LOGIC ---
async function tryProviders(providers, requestFn) {
    let lastError;
    if (providers.length === 0) throw new Error("No API keys found in Render Environment Variables!");
    
    for (const p of providers) {
        try {
            return await requestFn(p);
        } catch (error) {
            console.error(`[${p.type.toUpperCase()}] API failed. Trying next... Error: ${error.message}`);
            lastError = error;
        }
    }
    throw lastError;
}

// --- API HANDLERS ---
async function handleGeminiText(req, res) {
    try {
        const { systemPrompt, userPrompt, temperature = 0 } = JSON.parse(await readRequestBody(req));
        
        const result = await tryProviders(TEXT_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const payload = {
                    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                    generationConfig: { temperature }
                };
                if (systemPrompt) payload.systemInstruction = { parts: [{ text: systemPrompt }] };

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Gemini Text failed");
                if (!data.candidates || data.candidates.length === 0) throw new Error("Empty response from Gemini.");
                
                return data.candidates[0].content.parts[0].text;
            } else {
                // Groq Fallback
                const messages = [];
                if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
                messages.push({ role: "user", content: userPrompt });

                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature })
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Groq Text failed");
                return data.choices[0].message.content;
            }
        });
        return sendJson(res, 200, { text: result });
    } catch (e) { 
        return sendJson(res, 502, { error: e.message || "All Text APIs failed." }); 
    }
}

async function handleGeminiVision(req, res) {
    try {
        const { imageBase64, prompt, temperature = 0 } = JSON.parse(await readRequestBody(req));
        if (!imageBase64) return sendJson(res, 400, { error: "No image provided." });
        
        const result = await tryProviders(VISION_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
                const payload = {
                    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }] }],
                    generationConfig: { temperature }
                };

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Gemini Vision failed");
                if (!data.candidates || data.candidates.length === 0) throw new Error("Empty response from Gemini.");
                return data.candidates[0].content.parts[0].text;
            } else {
                // Groq Vision Fallback
                let formattedBase64 = imageBase64;
                if (!formattedBase64.startsWith("data:image")) formattedBase64 = `data:image/jpeg;base64,${formattedBase64}`;
                
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        model: "llama-3.2-90b-vision-preview", // Supported Groq Vision Model
                        messages: [{ role: "user", content: [{type: "text", text: prompt}, {type: "image_url", image_url: {url: formattedBase64}}] }],
                        temperature
                    })
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Groq Vision failed");
                return data.choices[0].message.content;
            }
        });
        return sendJson(res, 200, { text: result });
    } catch (e) { 
        return sendJson(res, 502, { error: e.message || "All Vision APIs failed." }); 
    }
}

async function handleGroqSearch(req, res) {
    try {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) return sendJson(res, 500, { error: "Missing GROQ_API_KEY in Render." });

        const body = await readRequestBody(req);
        const { prompt, temperature = 0.5 } = JSON.parse(body);

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ 
                model: "llama-3.3-70b-versatile", // Lightning fast search model
                messages: [
                    { role: "system", content: "You are a highly intelligent, direct study assistant. Answer the user's questions clearly, accurately, and concisely. Use markdown for structuring." },
                    { role: "user", content: prompt }
                ],
                temperature 
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Groq search failed");

        return sendJson(res, 200, { text: data.choices[0].message.content });
    } catch (e) {
        return sendJson(res, 502, { error: e.message });
    }
}

// --- STATIC FILE SERVER (Multi-Page Router) ---
function serveStatic(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    let safePath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, "");
    
    // Default to index.html for root
    if (safePath === "/" || safePath === "") safePath = "index.html";
    
    let filePath = path.join(publicDir, safePath);

    // If it's a clean URL without an extension (like /maths), append .html
    if (!path.extname(filePath)) filePath += ".html";

    fs.readFile(filePath, (error, data) => {
        if (error) {
            // If file not found, redirect to index.html gracefully
            fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallbackData) => {
                if (fallbackError) { res.writeHead(404); res.end("404 Not Found"); return; }
                res.writeHead(200, { "Content-Type": contentTypes[".html"] }); res.end(fallbackData);
            });
            return;
        }
        
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
        res.end(data);
    });
}

// --- ROUTER & LISTENER ---
const server = http.createServer((req, res) => {
    // Intercept API routes first
    if (req.method === "POST") {
        if (req.url === "/api/gemini-text") return handleGeminiText(req, res);
        if (req.url === "/api/gemini-vision") return handleGeminiVision(req, res);
        if (req.url === "/api/groq-search") return handleGroqSearch(req, res);
    }
  
    // Serve HTML, CSS, JS
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  
    sendJson(res, 405, { error: "Method not allowed." });
});

// CRITICAL FOR RENDER: Bind to 0.0.0.0
server.listen(port, '0.0.0.0', () => {
    console.log(`AI Pro Suite Multi-Page Server running on port ${port}`);
});
