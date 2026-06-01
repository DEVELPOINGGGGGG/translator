const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;

// Config: Your hierarchy of keys
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

// --- FAILOVER LOGIC ---
async function tryProviders(providers, requestFn) {
    let lastError;
    for (const p of providers) {
        try {
            return await requestFn(p);
        } catch (error) {
            console.log(`${p.type} failed. Trying next provider...`);
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
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
                        generationConfig: { temperature }
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Gemini Text failed");
                return data.candidates[0].content.parts[0].text;
            } else {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{role: "user", content: userPrompt}], temperature })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Groq Text failed");
                return data.choices[0].message.content;
            }
        });
        return sendJson(res, 200, { text: result });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleGeminiVision(req, res) {
    try {
        const { imageBase64, prompt, temperature = 0 } = JSON.parse(await readRequestBody(req));
        
        const result = await tryProviders(VISION_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }] }],
                        generationConfig: { temperature }
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Gemini Vision failed");
                return data.candidates[0].content.parts[0].text;
            } else {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        model: "llama-3.2-90b-vision-preview", 
                        messages: [{ role: "user", content: [{type: "text", text: prompt}, {type: "image_url", image_url: {url: imageBase64}}] }] 
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || "Groq Vision failed");
                return data.choices[0].message.content;
            }
        });
        return sendJson(res, 200, { text: result });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// --- UTILS ---
function sendJson(res, statusCode, payload) { res.writeHead(statusCode, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); }
function readRequestBody(req) { return new Promise((resolve) => { let body = ""; req.on("data", c => body += c); req.on("end", () => resolve(body)); }); }
function serveStatic(req, res) { /* Use your existing static file serving logic */ }

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/gemini-text") return handleGeminiText(req, res);
  if (req.method === "POST" && req.url === "/api/gemini-vision") return handleGeminiVision(req, res);
  serveStatic(req, res);
});

server.listen(port, () => console.log(`Triple-Failover Server running on ${port}`));
