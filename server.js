const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto"); // Added for PTI Generation
const ytSearch = require('yt-search');
const Tesseract = require('tesseract.js'); 
const axios = require('axios');

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); 

const port = process.env.PORT || 10000;
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const cfApiKey = process.env.CLOUDFLARE_API_KEY || "";

// 🚨 PUT YOUR DEPLOYED GOOGLE APPS SCRIPT URL HERE 🚨
const GOOGLE_DATABASE_URL = "https://script.google.com/macros/s/AKfycbwuSwz8wvT24TUYq_eWy9Ak4Lj7CfWUXGiTsaFT9oGrBAvdN93X4sV6eJlMgRJbNbKjnA/exec";

// 🛑 GLOBAL AI INSTRUCTIONS 🛑
const MASTER_RULES = `\n\nSTRICT OUTPUT RULES:
1. NO FOREIGN GARBAGE: Never output Chinese, Japanese, Korean, or random unreadable symbols. If the image or text has illegible noise, completely ignore it.
2. BRAND NAMES IN ENGLISH and HINDI: When replying in Hindi, you MUST keep all company names, brand names, app names, and complex technical terms in pure English script (e.g., write "Crompton Greaves" not "क्रॉम्पटन" or "कrompton"). Translate them into Hindi and English both. Keep sentences natural but preserve both hindi and english nouns(eg. if you write windmill then you will write पवन चक्की(wind mill)).`;

// 🛑 STRICT MASTER WATERFALL HIERARCHY 🛑
const VISION_PROVIDERS = [
    { type: 'gemini', id: 'API 1', key: process.env.GEMINI_API_KEY_1, modelId: 'gemini-3.1-flash-lite' },
    { type: 'gemini', id: 'API 2', key: process.env.GEMINI_API_KEY_2, modelId: 'gemini-3.1-flash-lite' },
    { type: 'gemini', id: 'API 3', key: process.env.GEMINI_API_KEY_3, modelId: 'gemini-3.5-flash' },
    { type: 'gemini', id: 'API 4', key: process.env.GEMINI_API_KEY_4, modelId: 'gemini-3.5-flash' },
    { type: 'gemini', id: 'API 5', key: process.env.GEMINI_API_KEY_5, modelId: 'gemini-3.5-flash' },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId }, 
    { type: 'groq', key: process.env.GROQ_API_KEY }                  
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const TEXT_PROVIDERS = [
    { type: 'gemini', id: 'API 1', key: process.env.GEMINI_API_KEY_1, modelId: 'gemini-3.1-flash-lite' },
    { type: 'gemini', id: 'API 2', key: process.env.GEMINI_API_KEY_2, modelId: 'gemini-3.1-flash-lite' },
    { type: 'gemini', id: 'API 3', key: process.env.GEMINI_API_KEY_3, modelId: 'gemini-3.5-flash' },
    { type: 'gemini', id: 'API 4', key: process.env.GEMINI_API_KEY_4, modelId: 'gemini-3.5-flash' },
    { type: 'gemini', id: 'API 5', key: process.env.GEMINI_API_KEY_5, modelId: 'gemini-3.5-flash' },
    { type: 'cloudflare', key: cfApiKey, accountId: cfAccountId }, 
    { type: 'groq', key: process.env.GROQ_API_KEY }                  
].filter(p => p.type === 'cloudflare' ? (p.key && p.accountId) : p.key);

const SEARCH_PROVIDERS = [...TEXT_PROVIDERS];

const publicDir = __dirname;
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const apiUsageStats = {}; 

// ==========================================
// 1. CORE UTILITIES
// ==========================================
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
            console.log(`⚠️ [Engine Fail] ${p.type.toUpperCase()}${p.id ? ` (${p.id})` : ''} failed. Error: ${error.message}`); 
            await new Promise(resolve => setTimeout(resolve, 800));
        } 
    }
    throw lastError;
}

// ==========================================
// 2. NEW PTI SYNC AND DUAL SHARE ENGINE
// ==========================================
async function handlePtiSyncSave(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        let pti = body.pti;
        const interactions = body.interactions || [];

        if (!pti || pti === "null" || pti === "undefined") {
            pti = "pti_" + crypto.randomBytes(8).toString("hex");
        }

        const spaceEfficientInteractions = interactions.map(inter => ({ ...inter, images: [] }));

        const sessionPayload = {
            id: pti,
            type: 'search',
            title: body.title || "Shared PTI Session",
            interactions: spaceEfficientInteractions
        };

        const response = await fetch(GOOGLE_DATABASE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save", pti: pti, sessionData: sessionPayload })
        });

        const sheetData = await response.json();
        return sendJson(res, 200, { success: true, pti: pti, data: sessionPayload, sheetData: sheetData });
    } catch (e) {
        console.error("Save PTI Error:", e.message);
        return sendJson(res, 502, { error: e.message });
    }
}

async function handleGetPtiSync(req, res) {
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const pti = urlObj.searchParams.get("pti");
        
        console.log("DEBUG: GET Request received for PTI:", pti);

        if (!pti) return sendJson(res, 400, { error: "Missing token parameter." });

        const response = await fetch(`${GOOGLE_DATABASE_URL}?pti=${pti}`);
        const cloudData = await response.json();

        if (cloudData.error) {
            console.log("DEBUG: Google said Not Found for PTI:", pti);
            return sendJson(res, 404, cloudData);
        }
        
        console.log("DEBUG: Successfully fetched PTI:", pti);
        return sendJson(res, 200, cloudData);
    } catch (e) {
        console.error("CRITICAL GET PTI ERROR:", e.message);
        return sendJson(res, 502, { error: e.message });
    }
}

async function handleDualShare(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        let number = body.number.replace(/[^0-9]/g, '') + "@c.us";
        const idInstance = process.env.ID_INSTANCE || "";
        const apiToken = process.env.API_TOKEN || "";

        if (!idInstance || !apiToken) throw new Error("Green API credentials missing on server.");

        // Message 1: Text Notes
        await fetch(`https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: number, message: body.notesMessage })
        }).then(r => r.json());

        // Message 2: Button
        const data2 = await fetch(`https://api.green-api.com/waInstance${idInstance}/sendInteractiveButtons/${apiToken}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: number,
                body: "🔗 Click the action button below to instantly view the continuous live conversation loop:",
                buttons: [{ "type": "url", "buttonId": "view_conv_btn", "buttonText": "See conversation", "url": body.targetUrl }]
            })
        }).then(r => r.json());

        return sendJson(res, 200, { success: true, greenApiResponse: data2 });
    } catch (e) {
        return sendJson(res, 502, { error: e.message });
    }
}

// ==========================================
// 3. AI HANDLERS
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

       if (isCode) {
            orderedProviders = [p5, p4, p3, p2, p1, pCf, pGroq].filter(Boolean);
        } else {
            orderedProviders = [p1, p2, p3, p4, p5, pCf, pGroq].filter(Boolean);
        }

        const resultObj = await tryProviders(orderedProviders, async (p) => {
            if (imgBase64) {
                let rawBase64 = imgBase64.includes(',') ? imgBase64.substring(imgBase64.indexOf(',') + 1) : imgBase64;
                rawBase64 = (rawBase64 || "").replace(/\s+/g, '');
                let formattedBase64 = `data:image/jpeg;base64,${rawBase64}`;

                if (p.type === 'gemini') {
                    const payload = { contents: [{ parts: [{ text: userText + MASTER_RULES }, { inlineData: { mimeType: "image/jpeg", data: rawBase64 } }] }] };
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error?.message || "Gemini Vision failed");
                    if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no response.");
                    return data.candidates[0].content.parts[0].text;
                } else if (p.type === 'cloudflare') {
                    const imageBuffer = Buffer.from(rawBase64, 'base64');
                    const imageArray = Array.from(imageBuffer);
                    const cloudflarePrompt = "Do your best to read and solve it. " + userText + MASTER_RULES;
                    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`, {
                        method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt: cloudflarePrompt, image: imageArray })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.errors?.[0]?.message || "Cloudflare Vision failed");
                    return data.result?.response || data.result?.description || "No text detected.";
                } else {
                    const ocrResult = await Tesseract.recognize(formattedBase64, 'eng');
                    const extractedText = ocrResult.data.text || "No legible text found.";
                    const groqPrompt = `OCR extracted this text:\n"${extractedText}"\n\nUser Question: ${userText}\n${MASTER_RULES}`;
                    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: groqPrompt }] })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error?.message || "Groq (Tesseract) failed");
                    return data.choices[0].message.content;
                }
            } else {
                if (p.type === 'gemini') {
                    const payload = { contents: [{ role: "user", parts: [{ text: userText }] }] };
                    if (sysText) payload.systemInstruction = { parts: [{ text: sysText }] };
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error?.message || "Gemini Text failed");
                    if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no response.");
                    return data.candidates[0].content.parts[0].text;
                } else if (p.type === 'cloudflare') {
                    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [ { role: "system", content: sysText || "You are a helpful assistant." }, { role: "user", content: userText } ] }) });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.errors?.[0]?.message || "Cloudflare Text Engine failed");
                    return data.choices[0].message.content;
                } else if (p.type === 'groq') {
                    const messages = []; if (sysText) messages.push({ role: "system", content: sysText }); messages.push({ role: "user", content: userText });
                    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }) });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error?.message || "Groq Text failed");
                    return data.choices[0].message.content;
                }
            }
        }, override); 
        
        return sendJson(res, 200, resultObj);
    } catch (e) {
        return sendJson(res, 502, { error: e.message || "All fallback routing paths exhausted." });
    }
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
                if (!response.ok) throw new Error(data.error?.message || "Gemini Text failed"); 
                if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no response.");
                return data.candidates[0].content.parts[0].text;
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [ { role: "system", content: sysText || "You are a helpful assistant." }, { role: "user", content: userText } ] }) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.errors?.[0]?.message || "Cloudflare Text Engine failed"); 
                return data.choices[0].message.content;
            } else {
                const messages = []; if (sysText) messages.push({ role: "system", content: sysText }); messages.push({ role: "user", content: userText });
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Groq Text failed"); 
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
                if (!response.ok) throw new Error(data.error?.message || "Gemini Vision failed"); 
                if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no response.");
                return data.candidates[0].content.parts[0].text;
           } else if (p.type === 'cloudflare') {
                const imageBuffer = Buffer.from(rawBase64, 'base64');
                const imageArray = Array.from(imageBuffer);
                const cloudflarePrompt = "agree Do your best to read and solve it. " + userText + MASTER_RULES;
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`, {
                    method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: cloudflarePrompt, image: imageArray })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.errors?.[0]?.message || "Cloudflare Vision failed");
                return data.result?.response || data.result?.description || "No text detected.";
            } else {
                const ocrResult = await Tesseract.recognize(formattedBase64, 'eng');
                const extractedText = ocrResult.data.text || "No legible text found.";
                const groqPrompt = `OCR extracted this text:\n"${extractedText}"\n\nUser Question: ${userText}\n${MASTER_RULES}`;
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
                    method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, 
                    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: groqPrompt }] }) 
                });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Groq (Tesseract) failed"); 
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
                if (!response.ok) throw new Error(data.error?.message || "Groq Search failed"); 
                return data.choices[0].message.content;
            } else if (p.type === 'cloudflare') {
                const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "@cf/meta/llama-3.1-70b-instruct", messages: [{ role: "system", content: sysText }, { role: "user", content: userText }] }) });
                const data = await response.json(); 
                if (!response.ok) throw new Error("Cloudflare search backend failed"); 
                return data.choices[0].message.content;
            } else if (p.type === 'gemini') {
                const payload = { systemInstruction: { parts: [{ text: sysText }] }, contents: [{ role: "user", parts: [{ text: userText }] }] };
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.modelId}:generateContent?key=${p.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                const data = await response.json(); 
                if (!response.ok) throw new Error(data.error?.message || "Gemini Search failed"); 
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

async function handleSecureWhatsapp(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const number = body.number;
        const message = body.message;

        const AUTHORIZED_NUMBERS = (process.env.AUTHORIZED_NUMBERS || "").split(',').map(n => n.trim()).filter(n => n.length > 0);
        if (AUTHORIZED_NUMBERS.length > 0 && !AUTHORIZED_NUMBERS.includes(number)) {
            return sendJson(res, 403, { error: "ERROR - 324 (UNAUTHORIZED PROTECTION)" });
        }

        const idInstance = process.env.ID_INSTANCE || "";
        const apiToken = process.env.API_TOKEN || "";

        if (!idInstance || !apiToken) throw new Error("Green API credentials missing on server.");

        const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: number + "@c.us", message: message }) });
        const data = await response.json();
        
        return sendJson(res, 200, data);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
}

async function handleFeedbackRoute(req, res) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const message = body.message;
        if (!message) return sendJson(res, 400, { error: "Message payload is empty." });

        const devNumber = process.env.FEEDBACK_NUMBER;
        if (!devNumber) return sendJson(res, 500, { error: "Feedback destination not configured on server." });

        const idInstance = process.env.ID_INSTANCE || process.env.GREEN_API_ID || "";
        const apiToken = process.env.API_TOKEN || process.env.GREEN_API_TOKEN || "";
        if (!idInstance || !apiToken) return sendJson(res, 500, { error: "Green API credentials missing on server." });

        const cleanNumber = devNumber.replace(/[^0-9]/g, '');
        const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`;
        const payload = { chatId: `${cleanNumber}@c.us`, message: `⚠️ *DEEP AI PRO FEEDBACK*\n\n${message}` };

        const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
        return sendJson(res, 200, response.data);
    } catch (error) { return sendJson(res, 502, { error: "Failed to dispatch feedback." }); }
}

// Fallback stub if it was called in your original router but not defined
async function handleHFSearchImage(req, res) {
    return sendJson(res, 501, { error: "Endpoint not implemented yet." });
}

// ==========================================
// 4. STATIC FILE SERVER
// ==========================================
function serveStatic(req, res) {
    let safePath = path.normalize(decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)).replace(/^(\.\.[/\\])+/, "");
    if (safePath === "/" || safePath === "") safePath = "index.html";
    let filePath = path.join(publicDir, safePath); 
    if (!path.extname(filePath)) filePath += ".html";
    
    fs.readFile(filePath, (error, data) => {
        if (error) { 
            fs.readFile(path.join(publicDir, "index.html"), (err, fData) => { 
                if(err) { res.writeHead(404); return res.end("Not Found"); }
                res.writeHead(200, { "Content-Type": contentTypes[".html"] }); 
                res.end(fData); 
            }); 
            return; 
        }
        res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "text/plain" }); 
        res.end(data);
    });
}

// ==========================================
// 🚀 5. MASTER ROUTER (THE BULLETPROOF FIX)
// ==========================================
const server = http.createServer((req, res) => {
    
    // 1. Instantly process CORS
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        return res.end();
    }

    // 2. 🚨 THE GET ROUTE CATCHER (Fixes the 404!) 🚨
    if (req.method === "GET") {
        if (req.url.startsWith("/api/pti-get")) return handleGetPtiSync(req, res);
        if (req.url.startsWith("/api/usage")) return sendJson(res, 200, apiUsageStats);
        
        // If it's not an API GET request, it must be an HTML/CSS/JS file request
        return serveStatic(req, res);
    }

    // 3. THE POST ROUTE CATCHER
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
        
        // NEW PTI / DUAL SHARE ROUTES
        if (req.url === "/api/pti-save") return handlePtiSyncSave(req, res);
        if (req.url === "/api/send-dual-share") return handleDualShare(req, res);
        
        // If a POST route was sent to a URL that doesn't exist above
        return sendJson(res, 404, { error: "POST Route not found on server" });
    }
});

server.listen(port, '0.0.0.0', () => console.log(`🚀 Server running perfectly on port ${port}`));
