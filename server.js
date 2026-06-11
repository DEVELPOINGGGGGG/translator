const http = require("http");
const fs = require("fs");
const path = require("path");
const ytSearch = require('yt-search');
const Tesseract = require('tesseract.js'); 
const port = process.env.PORT || 10000;

const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const cfApiKey = process.env.CLOUDFLARE_API_KEY || "";

// 🛑 GLOBAL AI INSTRUCTIONS (FIXES CHINESE/JAPANESE BUGS & HINDI BRAND NAMES) 🛑
const MASTER_RULES = `\n\nSTRICT OUTPUT RULES:
1. NO FOREIGN GARBAGE: Never output Chinese, Japanese, Korean, or random unreadable symbols. If the image or text has illegible noise, completely ignore it.
2. BRAND NAMES IN ENGLISH: When replying in Hindi, you MUST keep all company names, brand names, app names, and complex technical terms in pure English script (e.g., write "Crompton Greaves" not "क्रॉम्पटन" or "कrompton"). Do NOT transliterate them into Hindi. Keep sentences natural but preserve English nouns.`;

// 🛑 STRICT MASTER WATERFALL HIERARCHY (GEMINI -> CLOUDFLARE -> GROQ) 🛑
const VISION_PROVIDERS = [
    { type: 'gemini', id: 'API 1', key: process.env.GEMINI_API_KEY_1 },
    { type: 'gemini', id: 'API 2', key: process.env.GEMINI_API_KEY_2 },
    { type: 'gemini', id: 'API 3', key: process.env.GEMINI_API_KEY_3 },
    { type: 'gemini', id: 'API 4', key: process.env.GEMINI_API_KEY_4 },
    { type: 'gemini', id: 'API 5', key: process.env.GEMINI_API_KEY_5 },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId }, 
    { type: 'groq', key: process.env.GROQ_API_KEY }                  
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const TEXT_PROVIDERS = [
    { type: 'gemini', id: 'API 1', key: process.env.GEMINI_API_KEY_1 },
    { type: 'gemini', id: 'API 2', key: process.env.GEMINI_API_KEY_2 },
    { type: 'gemini', id: 'API 3', key: process.env.GEMINI_API_KEY_3 },
    { type: 'gemini', id: 'API 4', key: process.env.GEMINI_API_KEY_4 },
    { type: 'gemini', id: 'API 5', key: process.env.GEMINI_API_KEY_5 },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId }, 
    { type: 'groq', key: process.env.GROQ_API_KEY }                  
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const SEARCH_PROVIDERS = [
    { type: 'gemini', id: 'API 1', key: process.env.GEMINI_API_KEY_1 },
    { type: 'gemini', id: 'API 2', key: process.env.GEMINI_API_KEY_2 },
    { type: 'gemini', id: 'API 3', key: process.env.GEMINI_API_KEY_3 },
    { type: 'gemini', id: 'API 4', key: process.env.GEMINI_API_KEY_4 },
    { type: 'gemini', id: 'API 5', key: process.env.GEMINI_API_KEY_5 },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId }, 
    { type: 'groq', key: process.env.GROQ_API_KEY }                  
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const publicDir = __dirname;
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function sendJson(res, statusCode, payload) { 
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" }); 
    res.end(JSON.stringify(payload)); 
}

function readRequestBody(req) { 
    return new Promise((resolve, reject) => { 
        let body = ""; 
        req.on("data", chunk => { 
            body += chunk; 
            if (body.length > 50_000_000) { reject(new Error("Payload too large")); req.destroy(); } 
        }); 
        req.on("end", () => resolve(body)); 
        req.on("error", reject);
    }); 
}

const apiUsageStats = {}; 

async function tryProviders(providers, requestFn, override = null) {
    let lastError;
    let targetProviders = [...providers]; 
    
    if (override) {
        targetProviders.sort((a, b) => {
            const isA = a.type.toLowerCase() === override.toLowerCase();
            const isB = b.type.toLowerCase() === override.toLowerCase();
            if (isA && !isB) return -1;
            if (!isA && isB) return 1;
            return 0;
        });
    } else {
        if (targetProviders.length === 0) throw new Error("No operational API keys found inside server config!");
    }

    for (const p of targetProviders) { 
        try { 
            const textResult = await requestFn(p);
            const providerName = p.type.toUpperCase() + (p.id ? ` (${p.id})` : "");
            
            apiUsageStats[providerName] = (apiUsageStats[providerName] || 0) + 1;
            console.log(`✅ [SUCCESS] Request handled by ${providerName}`);
            return { text: textResult, provider: providerName }; 
        } catch (error) { 
            lastError = error; 
            console.log(`⚠️ [Engine Fail] ${p.type.toUpperCase()} failed. Moving to next... Error: ${error.message}`); 
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
        // 🚀 INJECTED RULES HERE
        const sysText = (body.systemPrompt || "") + MASTER_RULES;
        const override = body.providerOverride || body.model || null;

        const resultObj = await tryProviders(TEXT_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const payload = { contents: [{ role: "user", parts: [{ text: userText }] }] };
                if (sysText) payload.systemInstruction = { parts: [{ text: sysText }] };
                
                // UPDATED MODEL ENDPOINT HERE
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Gemini Text failed"); 
                
                if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no response.");
                if (data.candidates[0].finishReason === 'SAFETY') throw new Error("Gemini blocked the request due to safety filters.");
                if (!data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0].text) throw new Error("Gemini returned an empty text body.");
                
                return data.candidates[0].content.parts[0].text;
            
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [ { role: "system", content: sysText || "You are a helpful assistant." }, { role: "user", content: userText } ] }) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.errors?.[0]?.message || "Cloudflare Text Engine failed"); 
                if (!data.choices || !data.choices[0] || !data.choices[0].message) throw new Error("Cloudflare returned invalid format.");
                return data.choices[0].message.content;
            
            } else {
                const messages = []; if (sysText) messages.push({ role: "system", content: sysText }); messages.push({ role: "user", content: userText });
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Groq Text failed"); 
                if (!data.choices || !data.choices[0] || !data.choices[0].message) throw new Error("Groq returned invalid format.");
                return data.choices[0].message.content;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// ==========================================
// VISION ENDPOINT
// ==========================================
async function handleGeminiVision(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const img = body.imageBase64;
        const userText = body.userPrompt || body.prompt || body.text || "Solve this.";
        const override = body.providerOverride || body.model || null;
        
        if (!img || img === "data:,") return sendJson(res, 400, { error: "No image provided." });
        
        let rawBase64 = img.includes(',') ? img.substring(img.indexOf(',') + 1) : img; 
        rawBase64 = (rawBase64 || "").replace(/\s+/g, ''); 
        let formattedBase64 = `data:image/jpeg;base64,${rawBase64}`;
        
        const resultObj = await tryProviders(VISION_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                // 🚀 INJECTED RULES HERE
                const payload = { contents: [{ parts: [{ text: userText + MASTER_RULES }, { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }] }] };
                
                // UPDATED MODEL ENDPOINT HERE
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Gemini Vision failed"); 
                if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no response.");
                if (data.candidates[0].finishReason === 'SAFETY') throw new Error("Gemini blocked the image due to safety filters.");
                if (!data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0].text) throw new Error("Gemini returned an empty text body.");
                return data.candidates[0].content.parts[0].text;
            
           } else if (p.type === 'cloudflare') {
                const imageBuffer = Buffer.from(rawBase64, 'base64');
                const imageArray = Array.from(imageBuffer);
                // 🚀 INJECTED RULES HERE
                const cloudflarePrompt = "agree Do your best to read and solve it. " + userText + MASTER_RULES;
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`, {
                    method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: cloudflarePrompt, image: imageArray })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.errors?.[0]?.message || "Cloudflare Vision failed");
                return data.result?.response || data.result?.description || "No text detected.";

            } else {
                console.log("🔍 Running Tesseract OCR for Groq fallback...");
                const ocrResult = await Tesseract.recognize(formattedBase64, 'eng');
                const extractedText = ocrResult.data.text || "No legible text found.";
                
                // 🚀 INJECTED RULES HERE
                const groqPrompt = `OCR extracted this text:\n"${extractedText}"\n\nUser Question: ${userText}\n${MASTER_RULES}`;
                
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
                    method: "POST", 
                    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, 
                    body: JSON.stringify({ 
                        model: "llama-3.3-70b-versatile", 
                        messages: [{ role: "user", content: groqPrompt }] 
                    }) 
                });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Groq (Tesseract) failed"); 
                if (!data.choices || !data.choices[0] || !data.choices[0].message) throw new Error("Groq returned invalid format.");
                return data.choices[0].message.content;
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
        const override = body.providerOverride || body.model || null;
        // 🚀 INJECTED RULES HERE
        const sysText = "You are an advanced Internet Search Engine. Search your knowledge base to provide factual, comprehensive, and up-to-date web search results." + MASTER_RULES;

        const resultObj = await tryProviders(SEARCH_PROVIDERS, async (p) => {
            if (p.type === 'groq') {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: sysText }, { role: "user", content: userText }] }) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Groq Search failed"); 
                return data.choices[0].message.content;
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [{ role: "system", content: sysText }, { role: "user", content: userText }] }) });
                const data = await response.json(); 
                if (!response.ok) throw new Error("Cloudflare search backend failed"); 
                return data.choices[0].message.content;
            } else if (p.type === 'gemini') {
                const payload = { systemInstruction: { parts: [{ text: sysText }] }, contents: [{ role: "user", parts: [{ text: userText }] }] };
                
                // UPDATED MODEL ENDPOINT HERE
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Gemini Search failed"); 
                return data.candidates[0].content.parts[0].text;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// ==========================================
// YOUTUBE SEARCH ENDPOINT
// ==========================================
async function handleYoutubeSearch(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.topic) return sendJson(res, 400, { error: "Topic is required" });
        const results = await ytSearch(body.topic);
        const videos = results.videos.slice(0, 45).map(v => ({ videoId: v.videoId, title: v.title, url: v.url, thumbnail: v.thumbnail, author: v.author, timestamp: v.timestamp }));
        return sendJson(res, 200, { results: videos });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// ==========================================
// CLOUDFLARE IMAGE GENERATION ENDPOINT
// ==========================================
async function handleCloudflareImage(req, res) {
    try {
        if (!cfAccountId || !cfApiKey) return sendJson(res, 503, { error: "Cloudflare image generation is not configured." });
        const body = JSON.parse(await readRequestBody(req));
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return sendJson(res, 400, { error: "Prompt is required." });

        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
            method: "POST", headers: { Authorization: `Bearer ${cfApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, num_steps: 4 })
        });
        const data = await response.json();
        if (!response.ok || data.success === false) throw new Error(data.errors?.[0]?.message || "Cloudflare image failed");
        
        const base64 = data.result?.image || data.result?.data?.[0]?.b64_json || data.image;
        apiUsageStats["CLOUDFLARE (IMAGE)"] = (apiUsageStats["CLOUDFLARE (IMAGE)"] || 0) + 1;
        return sendJson(res, 200, { base64, image: `data:image/png;base64,${base64}`, provider: "CLOUDFLARE (IMAGE)" });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// ==========================================
// 🛡️ SECURE WHATSAPP ENDPOINT (GREEN API) 🛡️
// ==========================================
const AUTHORIZED_NUMBERS = (process.env.AUTHORIZED_NUMBERS || "")
    .split(',')
    .map(num => num.trim())
    .filter(num => num.length > 0);

async function handleSecureWhatsapp(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const number = body.number;
        const message = body.message;

        if (!AUTHORIZED_NUMBERS.includes(number)) {
            return sendJson(res, 403, { error: "ERROR - 324 (UNAUTHORIZED PROTECTION)" });
        }

        const idInstance = process.env.ID_INSTANCE || "";
        const apiToken = process.env.API_TOKEN || "";

        if (!idInstance || !apiToken) {
            throw new Error("Green API credentials missing on server.");
        }

        const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: number + "@c.us",
                message: message
            })
        });

        const data = await response.json();
        return sendJson(res, 200, data);
    } catch (e) {
        return sendJson(res, 502, { error: e.message });
    }
}

// ==========================================
// STATIC FILE SERVER
// ==========================================
function serveStatic(req, res) {
    let safePath = path.normalize(decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)).replace(/^(\.\.[/\\])+/, "");
    if (safePath === "/" || safePath === "") safePath = "index.html";
    let filePath = path.join(publicDir, safePath); if (!path.extname(filePath)) filePath += ".html";
    fs.readFile(filePath, (error, data) => {
        if (error) { fs.readFile(path.join(publicDir, "index.html"), (err, fData) => { res.writeHead(200, { "Content-Type": contentTypes[".html"] }); res.end(fData); }); return; }
        res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "text/plain" }); res.end(data);
    });
}

// ==========================================
// MASTER ROUTER
// ==========================================
const server = http.createServer((req, res) => {
    if (req.method === "POST") {
        if (req.url === "/api/gemini-text") return handleGeminiText(req, res);
        if (req.url === "/api/gemini-vision") return handleGeminiVision(req, res);
        if (req.url === "/api/groq-search") return handleGroqSearch(req, res);
        if (req.url === "/api/cloudflare-image") return handleCloudflareImage(req, res);
        if (req.url === "/api/youtube-search") return handleYoutubeSearch(req, res);
        if (req.url === "/api/secure-whatsapp") return handleSecureWhatsapp(req, res);
    }
    
    if (req.method === "GET" && req.url === "/api/usage") return sendJson(res, 200, apiUsageStats);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => console.log(`Server running on ${port}`));
