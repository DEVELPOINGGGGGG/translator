const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ytSearch = require('yt-search');
const Tesseract = require('tesseract.js'); 
const axios = require('axios');
const { chromium } = require("playwright"); // Playwright Chromium Core
const { createClient } = require("@supabase/supabase-js"); // Supabase client initialization

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); 

const port = process.env.PORT || 10000;
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const cfApiKey = process.env.CLOUDFLARE_API_KEY || "";

// ==================== SUPABASE & SESSION CONFIGURATION ====================
const SUPABASE_URL = "https://cnexypomeopydsvhmpzv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNuZXh5cG9tZW9weWRzdmhtcHp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDgzMTQsImV4cCI6MjA5ODE4NDMxNH0.WwxIuUMFR6PQTkNhjN8TYtFFz5nR-AmSebzkB-Rf2G0";
const BUCKET_NAME = "whatsapp-session";
const SESSION_DIR = path.join(__dirname, "user_data");
global.WebSocket = require('ws');

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper to reconstruct browser login profile folders instantly on Render containers
async function downloadSessionFromCloud() {
    console.log("☁️ Downloading WhatsApp tokens from Supabase Storage...");
    try {
        const leveldbDir = path.join(SESSION_DIR, "Default", "Local Storage", "leveldb");
        const defaultDir = path.join(SESSION_DIR, "Default");
        
        fs.mkdirSync(leveldbDir, { recursive: true });

        // 1. Download rolling log file payload
        const { data: logData, error: logErr } = await supabaseClient.storage.from(BUCKET_NAME).download("000004.log");
        if (logErr) throw logErr;
        fs.writeFileSync(path.join(leveldbDir, "000004.log"), Buffer.from(await logData.arrayBuffer()));

        // 2. Download raw rolling state Cookies database file
        const { data: cookieData, error: cookieErr } = await supabaseClient.storage.from(BUCKET_NAME).download("Cookies");
        if (cookieErr) throw cookieErr;
        fs.writeFileSync(path.join(defaultDir, "Cookies"), Buffer.from(await cookieData.arrayBuffer()));

        console.log("✅ Session structured correctly inside render container!");
        return true;
    } catch (err) {
        console.log("❌ Cloud Sync Failed: ", err.message);
        return false;
    }
}
// ==========================================================================

const GOOGLE_DATABASE_URL = "https://script.google.com/macros/s/AKfycbwuSwz8wvT24TUYq_eWy9Ak4Lj7CfWUXGiTsaFT9oGrBAvdN93X4sV6eJlMgRJbNbKjnA/exec";

const MASTER_RULES = `\n\nSTRICT OUTPUT RULES:
1. NO FOREIGN GARBAGE: Never output Chinese, Japanese, Korean, or random unreadable symbols. If the image or text has illegible noise, completely ignore it.
2. BRAND NAMES IN ENGLISH and HINDI: When replying in Hindi, you MUST keep all company names, brand names, app names, and complex technical terms in pure English script (e.g., write "Crompton Greaves" not "क्रॉम्पटन" or "कrompton"). Translate them into Hindi and English both. Keep sentences natural but preserve both hindi and english nouns(eg. if you write windmill then you will write पवन चक्की(wind mill)).`;

const VISION_PROVIDERS = [
    { type: 'gemini', id: 'API 1', key: process.env.GEMINI_API_KEY_1, modelId: 'gemini-3.1-flash-lite' },
    { type: 'gemini', id: 'API 2', key: process.env.GEMINI_API_KEY_2, modelId: 'gemini-3.1-flash-lite' },
    { type: 'gemini', id: 'API 3', key: process.env.GEMINI_API_KEY_3, modelId: 'gemini-3.5-flash' },
    { type: 'gemini', id: 'API 4', key: process.env.GEMINI_API_KEY_4, modelId: 'gemini-3.5-flash' },
    { type: 'gemini', id: 'API 5', key: process.env.GEMINI_API_KEY_5, modelId: 'gemini-3.5-flash' },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId }, 
    { type: 'groq', key: process.env.GROQ_API_KEY }                  
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const TEXT_PROVIDERS = [...VISION_PROVIDERS];
const SEARCH_PROVIDERS = [...TEXT_PROVIDERS];

const publicDir = __dirname;
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function sendJson(res, statusCode, payload) { 
    res.writeHead(statusCode, { 
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type"
    }); 
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
    if (override && override !== "auto") {
        targetProviders.sort((a, b) => {
            const isA = a.type.toLowerCase() === override.toLowerCase() || (a.id && a.id.replace(/\s+/g, '').toLowerCase() === override.replace(/\s+/g, '').toLowerCase());
            const isB = b.type.toLowerCase() === override.toLowerCase() || (b.id && b.id.replace(/\s+/g, '').toLowerCase() === override.replace(/\s+/g, '').toLowerCase());
            if (isA && !isB) return -1;
            if (!isA && isB) return 1;
            return 0;
        });
    }
    for (const p of targetProviders) { 
        try { 
            const textResult = await requestFn(p);
            const providerName = p.type.toUpperCase() + (p.id ? ` (${p.id})` : "");
            apiUsageStats[providerName] = (apiUsageStats[providerName] || 0) + 1;
            return { text: textResult, provider: providerName }; 
        } catch (error) { 
            lastError = error; 
            await new Promise(resolve => setTimeout(resolve, 800));
        } 
    }
    throw lastError;
}

// ==========================================
// SMART SEARCH ROUTERS
// ==========================================
async function handleSmartSearch(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const userText = body.userPrompt || body.prompt || body.text || "Solve this.";
        const sysText = (body.systemPrompt || "") + MASTER_RULES;
        const isCode = body.isCode === true;
        const imgBase64 = body.imageBase64 || null;
        const override = body.providerOverride || null;
        const providersList = imgBase64 ? VISION_PROVIDERS : TEXT_PROVIDERS;

        let orderedProviders = [];
        const p1 = providersList.find(p => p.id && p.id.includes('API 1'));
        const p2 = providersList.find(p => p.id && p.id.includes('API 2'));
        const p3 = providersList.find(p => p.id && p.id.includes('API 3'));
        const p4 = providersList.find(p => p.id && p.id.includes('API 4'));
        const p5 = providersList.find(p => p.id && p.id.includes('API 5'));
        const pCf = providersList.find(p => p.type === 'cloudflare');
        const pGroq = providersList.find(p => p.type === 'groq');

        if (isCode) { orderedProviders = [p5, p4, p3, p2, p1, pCf, pGroq].filter(Boolean); } 
        else { orderedProviders = [p1, p2, p3, p4, p5, pCf, pGroq].filter(Boolean); }

        const resultObj = await tryProviders(orderedProviders, async (p) => {
            if (imgBase64) {
                let rawBase64 = imgBase64.includes(',') ? imgBase64.substring(imgBase64.indexOf(',') + 1) : imgBase64;
                rawBase64 = (rawBase64 || "").replace(/\s+/g, '');
                let formattedBase64 = `data:image/jpeg;base64,${rawBase64}`;

                if (p.type === 'gemini') {
                    const payload = { contents: [{ parts: [{ text: userText + MASTER_RULES }, { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }] }] };
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    const data = await response.json();
                    return data.candidates[0].content.parts[0].text;
                } else if (p.type === 'cloudflare') {
                    const imageBuffer = Buffer.from(rawBase64, 'base64');
                    const imageArray = Array.from(imageBuffer);
                    const cloudflarePrompt = "Do your best to read and solve it. " + userText + MASTER_RULES;
                    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: cloudflarePrompt, image: imageArray }) });
                    const data = await response.json();
                    return data.result?.response || "No text detected.";
                } else {
                    const ocrResult = await Tesseract.recognize(formattedBase64, 'eng');
                    const extractedText = ocrResult.data.text || "No legible text found.";
                    const groqPrompt = `OCR extracted this text:\n"${extractedText}"\n\nUser Question: ${userText}\n${MASTER_RULES}`;
                    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: groqPrompt }] }) });
                    const data = await response.json();
                    return data.choices[0].message.content;
                }
            } else {
                if (p.type === 'gemini') {
                    const payload = { contents: [{ role: "user", parts: [{ text: userText }] }] };
                    if (sysText) payload.systemInstruction = { parts: [{ text: sysText }] };
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    const data = await response.json();
                    return data.candidates[0].content.parts[0].text;
                } else if (p.type === 'cloudflare') {
                    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [ { role: "system", content: sysText || "You are a helpful assistant." }, { role: "user", content: userText } ] }) });
                    const data = await response.json();
                    return data.choices[0].message.content;
                } else if (p.type === 'groq') {
                    const messages = []; if (sysText) messages.push({ role: "system", content: sysText }); messages.push({ role: "user", content: userText });
                    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }) });
                    const data = await response.json();
                    return data.choices[0].message.content;
                }
            }
        }, override); 
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleGeminiText(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const userText = body.userPrompt || body.prompt || body.text || "Explain this."; 
        const sysText = (body.systemPrompt || "") + MASTER_RULES;
        const override = body.providerOverride || body.model || null;

        const resultObj = await tryProviders(TEXT_PROVIDERS, async (p) => {
            if (p.type === 'gemini') {
                const payload = { contents: [{ role: "user", parts: [{ text: userText }] }] };
                if (sysText) payload.systemInstruction = { parts: [{ text: sysText }] };
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); 
                return data.candidates[0].content.parts[0].text;
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [ { role: "system", content: sysText || "You are a helpful assistant." }, { role: "user", content: userText } ] }) });
                const data = await response.json(); 
                return data.choices[0].message.content;
            } else {
                const messages = []; if (sysText) messages.push({ role: "system", content: sysText }); messages.push({ role: "user", content: userText });
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }) });
                const data = await response.json(); 
                return data.choices[0].message.content;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

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
                const payload = { contents: [{ parts: [{ text: userText + MASTER_RULES }, { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }] }] };
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); 
                return data.candidates[0].content.parts[0].text;
           } else if (p.type === 'cloudflare', accountId) {
                const imageBuffer = Buffer.from(rawBase64, 'base64');
                const imageArray = Array.from(imageBuffer);
                const cloudflarePrompt = "agree Do your best to read and solve it. " + userText + MASTER_RULES;
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: cloudflarePrompt, image: imageArray }) });
                const data = await response.json();
                return data.result?.response || "No text detected.";
            } else {
                const ocrResult = await Tesseract.recognize(formattedBase64, 'eng');
                const extractedText = ocrResult.data.text || "No legible text found.";
                const groqPrompt = `OCR extracted this text:\n"${extractedText}"\n\nUser Question: ${userText}\n${MASTER_RULES}`;
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: groqPrompt }] }) });
                const data = await response.json(); 
                return data.choices[0].message.content;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleGroqSearch(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const userText = body.userPrompt || body.prompt || body.text || "Search";
        const override = body.providerOverride || body.model || null;
        const sysText = "You are an advanced Internet Search Engine. Search your knowledge base to provide factual, comprehensive, and up-to-date web search results." + MASTER_RULES;

        const resultObj = await tryProviders(SEARCH_PROVIDERS, async (p) => {
            if (p.type === 'groq') {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: sysText }, { role: "user", content: userText }] }) });
                const data = await response.json(); 
                return data.choices[0].message.content;
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [{ role: "system", content: sysText }, { role: "user", content: userText }] }) });
                const data = await response.json(); 
                return data.choices[0].message.content;
            } else if (p.type === 'gemini') {
                const payload = { systemInstruction: { parts: [{ text: sysText }] }, contents: [{ role: "user", parts: [{ text: userText }] }] };
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); 
                return data.candidates[0].content.parts[0].text;
            }
        }, override);
        return sendJson(res, 200, resultObj);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleYoutubeSearch(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        if (!body.topic) return sendJson(res, 400, { error: "Topic is required" });
        const results = await ytSearch(body.topic);
        const videos = results.videos.slice(0, 45).map(v => ({ videoId: v.videoId, title: v.title, url: v.url, thumbnail: v.thumbnail, author: v.author, timestamp: v.timestamp }));
        return sendJson(res, 200, { results: videos });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleCloudflareImage(req, res) {
    try {
        if (!cfAccountId || !cfApiKey) return sendJson(res, 503, { error: "Cloudflare image generation is not configured." });
        const body = JSON.parse(await readRequestBody(req));
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return sendJson(res, 400, { error: "Prompt is required." });

        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, { method: "POST", headers: { Authorization: `Bearer ${cfApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt, num_steps: 4 }) });
        const data = await response.json();
        const base64 = data.result?.image || data.result?.data?.[0]?.b64_json || data.image;
        return sendJson(res, 200, { base64, image: `data:image/png;base64,${base64}`, provider: "CLOUDFLARE (IMAGE)" });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

// =========================================================================
// 🛡️ NATIVE PLAYWRIGHT CHROMIUM CONTROLLER (REPLACES BROKEN GREEN API) 🛡️
// =========================================================================
async function handleSecureWhatsapp(req, res) {
    let browserContext;
    try {
        const body = JSON.parse(await readRequestBody(req));
        let number = String(body.number || body.phone || "").trim().replace(/\+/g, '').replace(/\s/g, '');
        const message = body.message;

        if (!number || !message) {
            return sendJson(res, 400, { error: "Missing required payload parameters" });
        }

        // Auto-prepend 91 if it's a standard 10-digit mobile layout number
        if (number.length === 10 && /^\d+$/.test(number)) {
            number = "91" + number;
        }

        // Sync fresh credential context tokens down to the local file layout
        await downloadSessionFromCloud();

        console.log(`🌐 Deploying secure browser channel for recipient: ${number}`);
        browserContext = await chromium.launchPersistentContext(SESSION_DIR, {
            headless: true, // Required for invisible background operation on Render
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        });

        const page = await browserContext.newPage();
        const url = `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(message)}`;
        await page.goto(url);

        console.log("⏳ Syncing browser page state...");
        await page.waitForTimeout(8000); // Buffer connection block hold

        const selectors = [
            'span[data-testid="send"]',
            'button[data-testid="compose-btn-send"]',
            'span[data-icon="send"]'
        ];

        let sent = false;
        for (const selector of selectors) {
            try {
                if (await page.$(selector)) {
                    await page.click(selector);
                    sent = true;
                    console.log("✅ Selector Hit! Message dispatched over layout.");
                    break;
                }
            } catch (e) {}
        }

        if (!sent) {
            console.log("⌨️ Selector missed. Forcing physical keyboard Enter execution.");
            await page.keyboard.press("Enter");
        }

        await page.waitForTimeout(4000); // Hold channel open briefly for transmission dispatch
        return sendJson(res, 200, { success: true, message: "Dispatched over custom cloud automation engine" });

    } catch (e) {
        console.error("❌ Cloud Automation Failure:", e.message);
        return sendJson(res, 502, { error: e.message });
    } finally {
        if (browserContext) await browserContext.close();
    }
}

// ==========================================
// PTI RECSYNC DATA CORE
// ==========================================
async function handlePtiSyncSave(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        let pti = body.pti;
        if (!pti || pti === "null" || pti === "undefined") {
            pti = "pti_" + crypto.randomBytes(8).toString("hex");
        }
        const response = await fetch(GOOGLE_DATABASE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", pti: pti, title: body.title || "Book Deep Study Session", htmlPayload: body.htmlPayload || "", metaSettings: body.metaSettings || {}, sessionData: body.interactions ? body : null }) });
        const sheetResponse = await response.json();
        return sendJson(res, 200, { success: true, pti: pti, sheetResponse });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleGetPtiSync(req, res) {
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const pti = urlObj.searchParams.get("pti");
        if (!pti) return sendJson(res, 400, { error: "Missing active context reference key matching parameter." });
        const response = await fetch(`${GOOGLE_DATABASE_URL}?pti=${pti}`);
        const cloudData = await response.json();
        return sendJson(res, 200, cloudData);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleDualShare(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        let number = body.number.replace(/[^0-9]/g, '');
        if(!number.startsWith('91') && number.length === 10) number = '91' + number;
        
        const messageContent = body.notesMessage || body.message || "Deep Study Notes Dispatch";
        const customUrlLink = `🔗 *Live Conversation Synchronization Link:*\n${body.targetUrl}`;

        console.log(`[Dual Sync] Redirecting payloads straight into the unified cloud browser pipeline...`);
        
        // Pass packet 1 recursively into our custom controller pipeline
        await new Promise((resolve) => {
            const mockRes = { writeHead: () => {}, end: () => resolve() };
            const fakeReq = { on: (ev, cb) => { if(ev === 'data') cb(JSON.stringify({ number, message: messageContent })); if(ev === 'end') cb(); } };
            handleSecureWhatsapp(fakeReq, mockRes);
        });

        // Pass packet 2 recursively into our custom controller pipeline
        await new Promise((resolve) => {
            const mockRes = { writeHead: () => {}, end: () => resolve() };
            const fakeReq = { on: (ev, cb) => { if(ev === 'data') cb(JSON.stringify({ number, message: customUrlLink })); if(ev === 'end') cb(); } };
            handleSecureWhatsapp(fakeReq, mockRes);
        });

        return sendJson(res, 200, { success: true, detail: "Dual share mapped to browser session flow successfully" });
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleHFSearchImage(req, res) { return sendJson(res, 501, { error: "Not Implemented" }); }

async function handleFeedbackRoute(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const message = body.message;
        const devNumber = process.env.FEEDBACK_NUMBER;
        if (!message || !devNumber) return sendJson(res, 400, { error: "Missing required payload parameters" });

        const cleanNumber = devNumber.replace(/[^0-9]/g, '');
        const payloadText = `⚠️ *DEEP AI PRO FEEDBACK*\n\n${message}`;

        const fakeReq = { on: (ev, cb) => { if(ev === 'data') cb(JSON.stringify({ number: cleanNumber, message: payloadText })); if(ev === 'end') cb(); } };
        return handleSecureWhatsapp(fakeReq, res);
    } catch (error) { return sendJson(res, 502, { error: "Failed to dispatch feedback route stack." }); }
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
    if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "OPTIONS, POST, GET", "Access-Control-Allow-Headers": "Content-Type" });
        return res.end();
    }
    if (req.method === "GET") {
        if (req.url.startsWith("/api/pti-get")) return handleGetPtiSync(req, res);
        if (req.url === "/api/usage") return sendJson(res, 200, apiUsageStats);
        return serveStatic(req, res);
    }
    if (req.method === "POST") {
        if (req.url === "/api/smart-search") return handleSmartSearch(req, res);
        if (req.url === "/api/gemini-text") return handleGeminiText(req, res);
        if (req.url === "/api/gemini-vision") return handleGeminiVision(req, res);
        if (req.url === "/api/groq-search") return handleGroqSearch(req, res);
        if (req.url === "/api/cloudflare-image") return handleCloudflareImage(req, res);
        if (req.url === "/api/youtube-search") return handleYoutubeSearch(req, res);
        if (req.url === "/api/secure-whatsapp") return handleSecureWhatsapp(req, res);
        if (req.url === "/api/feedback") return handleFeedbackRoute(req, res);
        if (req.url === "/api/hf-search-image") return handleHFSearchImage(req, res); 
        if (req.url === "/api/pti-save") return handlePtiSyncSave(req, res);
        if (req.url === "/api/send-dual-share") return handleDualShare(req, res);
        return sendJson(res, 404, { error: "POST Route not found on server" });
    }
    if (req.method === "HEAD") return serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => console.log(`Server running perfectly on ${port}`));
