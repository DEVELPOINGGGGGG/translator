const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 10000;

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
            if (body.length > 50_000_000) { 
                reject(new Error("Too large")); 
                req.destroy(); 
            } 
        }); 
        req.on("end", () => resolve(body)); 
        req.on("error", reject);
    }); 
}

async function tryProviders(providers, requestFn) {
    let lastError;
    if (providers.length === 0) throw new Error("No API keys found!");
    for (const p of providers) { 
        try { 
            return await requestFn(p); 
        } catch (error) { 
            lastError = error; 
        } 
    }
    throw lastError;
}

// --- BULLETPROOF API HANDLERS ---
async function handleGeminiText(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const userText = body.userPrompt || body.prompt || body.text || "Explain this."; 
        const sysText = body.systemPrompt || "";

        const result = await tryProviders(TEXT_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const payload = { contents: [{ role: "user", parts: [{ text: userText }] }] };
                if (sysText) payload.systemInstruction = { parts: [{ text: sysText }] };
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${p.key}`, { 
                    method: "POST", 
                    headers: { "Content-Type": "application/json" }, 
                    body: JSON.stringify(payload) 
                });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Gemini Text failed"); 
                return data.candidates[0].content.parts[0].text;
            } else {
                const messages = [];
                if (sysText) messages.push({ role: "system", content: sysText });
                messages.push({ role: "user", content: userText });
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
                    method: "POST", 
                    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, 
                    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }) 
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
        const body = JSON.parse(await readRequestBody(req));
        const img = body.imageBase64;
        const userText = body.userPrompt || body.prompt || body.text || "Solve this.";
        if (!img) return sendJson(res, 400, { error: "No image." });
        
        const result = await tryProviders(VISION_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const cleanBase64 = img.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
                const payload = { contents: [{ parts: [{ text: userText }, { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } }] }] };
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${p.key}`, { 
                    method: "POST", 
                    headers: { "Content-Type": "application/json" }, 
                    body: JSON.stringify(payload) 
                });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Gemini Vision failed"); 
                return data.candidates[0].content.parts[0].text;
            } else {
                let formattedBase64 = img.startsWith("data:image") ? img : `data:image/jpeg;base64,${img}`;
                
                // 🛑 FIXED: Changed to the active Llama 4 Scout Multimodal Vision Model 🛑
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
                    method: "POST", 
                    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, 
                    body: JSON.stringify({ 
                        model: "meta-llama/llama-4-scout-17b-16e-instruct", 
                        messages: [{ 
                            role: "user", 
                            content: [
                                {type: "text", text: userText}, 
                                {type: "image_url", image_url: {url: formattedBase64}}
                            ] 
                        }] 
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

async function handleGroqSearch(req, res) {
    try {
        const groqKey = process.env.GROQ_API_KEY; 
        if (!groqKey) return sendJson(res, 500, { error: "Missing GROQ key." });
        const body = JSON.parse(await readRequestBody(req));
        const userText = body.userPrompt || body.prompt || body.text || "Search";
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
            method: "POST", 
            headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" }, 
            body: JSON.stringify({ 
                model: "llama-3.3-70b-versatile", 
                messages: [{ role: "system", content: "Direct study assistant." }, { role: "user", content: userText }] 
            }) 
        });
        const data = await response.json(); 
        if (!response.ok) throw new Error(data.error?.message || "Search failed"); 
        return sendJson(res, 200, { text: data.choices[0].message.content });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

function serveStatic(req, res) {
    let safePath = path.normalize(decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)).replace(/^(\.\.[/\\])+/, "");
    if (safePath === "/" || safePath === "") safePath = "index.html";
    let filePath = path.join(publicDir, safePath);
    if (!path.extname(filePath)) filePath += ".html";
    
    fs.readFile(filePath, (error, data) => {
        if (error) { 
            fs.readFile(path.join(publicDir, "index.html"), (err, fData) => { 
                res.writeHead(200, { "Content-Type": contentTypes[".html"] }); 
                res.end(fData); 
            }); 
            return; 
        }
        res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "text/plain" }); 
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    if (req.method === "POST") {
        if (req.url === "/api/gemini-text") return handleGeminiText(req, res);
        if (req.url === "/api/gemini-vision") return handleGeminiVision(req, res);
        if (req.url === "/api/groq-search") return handleGroqSearch(req, res);
    }
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => console.log(`Server running on ${port}`));
