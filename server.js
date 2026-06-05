const http = require("http");
const fs = require("fs");
const path = require("path");
const ytSearch = require('yt-search');

const port = process.env.PORT || 10000;

const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const cfApiKey = process.env.CLOUDFLARE_API_KEY || "";

// 🛑 THE MASTER WATERFALL HIERARCHY (GATLING GUN) 🛑
const VISION_PROVIDERS = [
    { type: 'gemini', key: process.env.GEMINI_API_KEY_1 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_2 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_3 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_4 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_5 },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId },
    { type: 'groq', key: process.env.GROQ_API_KEY } 
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const TEXT_PROVIDERS = [
    { type: 'gemini', key: process.env.GEMINI_API_KEY_1 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_2 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_3 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_4 },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_5 },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId },
    { type: 'groq', key: process.env.GROQ_API_KEY } 
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const SEARCH_PROVIDERS = [
    { type: 'groq', key: process.env.GROQ_API_KEY },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId },
    { type: 'gemini', key: process.env.GEMINI_API_KEY_1 }
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const publicDir = __dirname;
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function sendJson(res, statusCode, payload) { res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }

function readRequestBody(req) { 
    return new Promise((resolve, reject) => { 
        let body = ""; req.on("data", chunk => { body += chunk; if (body.length > 50_000_000) { reject(new Error("Payload too large")); req.destroy(); } }); 
        req.on("end", () => resolve(body)); req.on("error", reject);
    }); 
}

async function tryProviders(providers, requestFn, override = null) {
    let lastError;
    let targetProviders = providers;
    
    if (override) {
        targetProviders = providers.filter(p => p.type.toLowerCase() === override.toLowerCase());
        if(targetProviders.length === 0) throw new Error(`Model ${override} is not configured on the server.`);
    } else {
        if (providers.length === 0) throw new Error("No operational API keys found inside server config!");
    }
    
    for (const p of targetProviders) { 
        try { 
            const textResult = await requestFn(p);
            return { text: textResult, provider: p.type.toUpperCase() }; 
        } catch (error) { 
            lastError = error; 
            console.log(`[Engine Fail] ${p.type.toUpperCase()} failed. Error: ${error.message}`); 
        } 
    }
    throw lastError;
}

// ==========================================
// TEXT ENDPOINT
// ==========================================
async function handleGeminiText(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const userText = body.userPrompt || body.prompt || body.text || "Explain this."; 
        const sysText = body.systemPrompt || "";
        const override = body.providerOverride || null;

        const resultObj = await tryProviders(TEXT_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const payload = { contents: [{ role: "user", parts: [{ text: userText }] }] };
                if (sysText) payload.systemInstruction = { parts: [{ text: sysText }] };
                
                // 🛑 TARGET: Gemini 2.5 Flash 🛑
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Gemini Text failed"); return data.candidates[0].content.parts[0].text;
            
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [ { role: "system", content: sysText || "You are a helpful study assistant." }, { role: "user", content: userText } ] }) });
                const data = await response.json(); if (!response.ok) throw new Error(data.errors?.[0]?.message || "Cloudflare Text Engine failed"); return data.choices[0].message.content;
            
            } else {
                const messages = []; if (sysText) messages.push({ role: "system", content: sysText }); messages.push({ role: "user", content: userText });
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }) });
                const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Groq Text failed"); return data.choices[0].message.content;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// ==========================================
// VISION ENDPOINT (Perfect OCR)
// ==========================================
async function handleGeminiVision(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const img = body.imageBase64;
        const userText = body.userPrompt || body.prompt || body.text || "Solve this.";
        const override = body.providerOverride || null;
        
        if (!img || img === "data:,") return sendJson(res, 400, { error: "No image provided." });
        let rawBase64 = img.includes(',') ? img.substring(img.indexOf(',') + 1) : img; rawBase64 = rawBase64.replace(/\s+/g, ''); let formattedBase64 = `data:image/jpeg;base64,${rawBase64}`;
        
        const resultObj = await tryProviders(VISION_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const payload = { contents: [{ parts: [{ text: userText }, { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }] }] };
                
                // 🛑 TARGET: Gemini 2.5 Flash 🛑
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Gemini Vision failed"); return data.candidates[0].content.parts[0].text;
            
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.2-11b-vision-instruct", messages: [{ role: "user", content: [{ type: "text", text: userText }, { type: "image_url", image_url: { url: formattedBase64 } }] }] }) });
                const data = await response.json(); if (!response.ok) throw new Error("Cloudflare Vision failed"); return data.choices[0].message.content;
            
            } else {
                let response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "meta-llama/llama-4-scout-17b-16e-instruct", messages: [{ role: "user", content: [{type: "text", text: userText}, {type: "image_url", image_url: {url: formattedBase64}}] }] }) });
                let data = await response.json(); 
                if (!response.ok) { response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.2-11b-vision-preview", messages: [{ role: "user", content: [{type: "text", text: userText}, {type: "image_url", image_url: {url: formattedBase64}}] }] }) }); data = await response.json(); }
                if (!response.ok) throw new Error(data.error?.message || "Groq Vision failed"); return data.choices[0].message.content;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// ==========================================
// SEARCH ENDPOINT
// ==========================================
async function handleGroqSearch(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const userText = body.userPrompt || body.prompt || body.text || "Search";
        const override = body.providerOverride || null;
        const sysText = "You are an advanced Internet Search Engine. Search your knowledge base to provide factual, comprehensive, and up-to-date web search results.";

        const resultObj = await tryProviders(SEARCH_PROVIDERS, async (p) => {
            if (p.type === 'groq') {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: sysText }, { role: "user", content: userText }] }) });
                const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Groq Search failed"); return data.choices[0].message.content;
            
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [{ role: "system", content: sysText }, { role: "user", content: userText }] }) });
                const data = await response.json(); if (!response.ok) throw new Error("Cloudflare search backend failed"); return data.choices[0].message.content;
            
            } else if (p.type === 'gemini') {
                const payload = { systemInstruction: { parts: [{ text: sysText }] }, contents: [{ role: "user", parts: [{ text: userText }] }] };
                
                // 🛑 TARGET: Gemini 2.5 Flash 🛑
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Gemini Search failed"); return data.candidates[0].content.parts[0].text;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// ==========================================
// YOUTUBE SEARCH ENDPOINT (Gemini -> yt-search)
// ==========================================
async function handleYoutubeSearch(req, res) {
  try {
    const body = JSON.parse(await readRequestBody(req));
    const topic = (body.topic || body.query || '').trim();
    if (!topic) return sendJson(res, 400, { error: "Missing topic" });

    // Ask TEXT_PROVIDERS (Gemini preferred) to refine the search query
    const refined = await tryProviders(TEXT_PROVIDERS, async (p) => {
      if (p.type === 'gemini') {
        const payload = {
          contents: [
            { role: "user", parts: [{ text: `Give me a concise, search-ready YouTube query (India-focused) for: ${topic}` }] }
          ]
        };
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${p.key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Gemini failed");
        // Gemini returns text; keep it short
        return data.candidates[0].content.parts[0].text;
      } else if (p.type === 'cloudflare') {
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-70b-instruct",
            messages: [
              { role: "system", content: "Refine the user topic into a short, India-focused YouTube search query." },
              { role: "user", content: topic }
            ]
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error("Cloudflare refine failed");
        return data.choices[0].message.content;
      } else {
        // fallback to provider text
        const messages = [{ role: "user", content: `Refine this into a short India-focused YouTube search query: ${topic}` }];
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Groq refine failed");
        return data.choices[0].message.content;
      }
    });

    const query = (typeof refined === 'string' && refined.trim().length > 0) ? refined.trim() : topic;

    // Use yt-search to get top results
    const search = await ytSearch(query + " India");
    const videos = (search && search.videos) ? search.videos.slice(0, 6) : [];

    if (!videos || videos.length === 0) {
      return sendJson(res, 404, { error: "No videos found" });
    }

    // Map to a compact shape for the frontend
    const results = videos.map(v => ({
      title: v.title,
      url: v.url,
      videoId: v.videoId,
      thumbnail: v.thumbnail,
      author: { name: v.author.name || v.author },
      timestamp: v.timestamp || v.duration
    }));

    return sendJson(res, 200, { results });
  } catch (e) {
    console.error("YouTube search error:", e);
    return sendJson(res, 502, { error: e.message || "YouTube search failed" });
  }
}

function serveStatic(req, res) {
    let safePath = path.normalize(decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)).replace(/^(\.\.[/\\])+/, "");
    if (safePath === "/" || safePath === "") safePath = "index.html";
    let filePath = path.join(publicDir, safePath); if (!path.extname(filePath)) filePath += ".html";
    fs.readFile(filePath, (error, data) => {
        if (error) { fs.readFile(path.join(publicDir, "index.html"), (err, fData) => { res.writeHead(200, { "Content-Type": contentTypes[".html"] }); res.end(fData); }); return; }
        res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "text/plain" }); res.end(data);
    });
}

const server = http.createServer((req, res) => {
    if (req.method === "POST") {
        if (req.url === "/api/gemini-text") return handleGeminiText(req, res);
        if (req.url === "/api/gemini-vision") return handleGeminiVision(req, res);
        if (req.url === "/api/groq-search") return handleGroqSearch(req, res);
        if (req.url === "/api/youtube-search") return handleYoutubeSearch(req, res);
    }
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => console.log(`Server running on ${port}`));
