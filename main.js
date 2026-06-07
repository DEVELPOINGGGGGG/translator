/* =======================================================
   AI PRO SUITE - THE ULTIMATE BUILD (V62 - MASTER EDITION)
   Includes Synchronized Video Typewriter, Deep Search, Context Memory & PDF Support
======================================================= */

let appHistory = [];
try { appHistory = JSON.parse(localStorage.getItem('aiHistory') || '[]'); } catch(e) { appHistory = []; }

let visionReqs = parseInt(localStorage.getItem('visionReqs') || '0'), textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false, capturedImage = null, currentMode = "", qaImages = [], transImages = [], qaContextText = "", isFlashOn = true;
window.latestMathSolution = "";
let availableVoices = [];
window.hasResetToday = false;

// 🛑 ABORT & CANCEL ENGINE 🛑
window.currentAbortController = null;
window.currentTypingTimer = null;

window.toggleChatButton = function(isCancel) {
    const btnIds = ['sendMathBtn', 'sendSearchBtn', 'sendImageTransBtn'];
    let activeBtn = null;
    for (let id of btnIds) {
        const btn = document.getElementById(id);
        if (btn) activeBtn = btn;
    }
    if (!activeBtn) return;
    
    if (isCancel) {
        activeBtn.dataset.originalHtml = activeBtn.innerHTML;
        activeBtn.innerHTML = '⏹️'; 
        activeBtn.classList.add('cancel-mode');
        activeBtn.classList.remove('send');
        activeBtn.dataset.originalOnclick = activeBtn.getAttribute('onclick');
        activeBtn.setAttribute('onclick', 'cancelActiveRequest()');
    } else {
        if(activeBtn.dataset.originalHtml) activeBtn.innerHTML = activeBtn.dataset.originalHtml;
        activeBtn.classList.remove('cancel-mode');
        activeBtn.classList.add('send');
        if (activeBtn.dataset.originalOnclick) {
            activeBtn.setAttribute('onclick', activeBtn.dataset.originalOnclick);
        }
    }
};

window.cancelActiveRequest = function() {
    if (window.currentAbortController) {
        window.currentAbortController.abort(); 
        window.currentAbortController = null;
    }
    if (window.currentTypingTimer) {
        clearInterval(window.currentTypingTimer);
        window.currentTypingTimer = null;
    }
    isProcessing = false;
    window.toggleChatButton(false); 
    showToast("⚠️ Generation Stopped");
};

// 🛑 YOUR GOOGLE SHEETS WEBHOOK 🛑
const GOOGLE_SHEETS_WEBHOOK = "https://script.google.com/macros/s/AKfycbz1_gv9M2QYJcWkkUQMlDtpBXajrV0psXXc9q68LZLJkZ0b_rokKsz6fyKcYzJ8R6Dsnw/exec";

// 🛑 SESSION CACHE & RETRY ENGINE 🛑
window.requestCache = {};
let sessionCache = { math: null, search: null, translation: null, image_translation: null, qa: null };

// 🛑 CONTINUOUS CONTEXT MEMORY ENGINE 🛑
function getLastContextImage(type) {
    let sessionId = sessionCache[type];
    if (!sessionId) return null;
    let session = appHistory.find(i => i.id === sessionId);
    if (!session || !session.interactions) return null;
    for (let i = session.interactions.length - 1; i >= 0; i--) {
        if (session.interactions[i].image) return session.interactions[i].image;
    }
    return null;
}

function getSessionContext(type) {
    let sessionId = sessionCache[type];
    if (!sessionId) return "";
    let session = appHistory.find(i => i.id === sessionId);
    if (!session || !session.interactions) return "";
    
    let ctx = "\n--- PREVIOUS CHAT HISTORY FOR CONTEXT ---\n";
    let recent = session.interactions.slice(-3); 
    recent.forEach(inter => {
        let cleanAns = inter.answer.replace(/<[^>]*>?/gm, '');
        ctx += `User asked: ${inter.question}\nYou answered: ${cleanAns}\n\n`;
    });
    return ctx + "--- CURRENT NEW QUESTION ---\n";
}

// 🛑 THE MILITARY-GRADE OCR PROMPT 🛑
const MASTER_OCR_PROMPT = `You are an expert Optical Character Recognition (OCR) scanner.
CRITICAL INSTRUCTIONS:
1. Extract ALL text from the image EXACTLY as it is written in its original language.
2. DO NOT describe the image visually.
3. DO NOT translate the text. Keep it strictly in the original language.
4. DO NOT fix spelling or grammar mistakes.
5. DO NOT add conversational filler.
6. Output ONLY the raw transcribed text. If no text is visible, output exactly "NO_TEXT_FOUND".`;

// Video Player Variables
let videoSpeed = 0.75, isVideoPaused = false, currentVideoVolume = 1.0;
let videoElapsed = 0, videoTotalEst = 0, videoTickInterval, hideControlsTimer, videoLineIndex = 0, activeVideoUtterance = null, videoRunToken = 0;

function loadVoices() { availableVoices = window.speechSynthesis.getVoices(); }
window.speechSynthesis.onvoiceschanged = loadVoices;

document.addEventListener("DOMContentLoaded", () => {
    loadVoices();
    
    // 🛑 INJECT TTS MINI PLAYER
    const ttsDiv = document.createElement('div');
    ttsDiv.id = 'ttsMiniPlayer';
    ttsDiv.className = 'tts-mini-player';
    ttsDiv.innerHTML = `
        <div style="font-size: 18px; filter: drop-shadow(0 0 5px #38bdf8);">🎧</div>
        <div class="tts-wave" id="ttsWave">
            <div class="tts-bar"></div><div class="tts-bar"></div><div class="tts-bar"></div><div class="tts-bar"></div>
        </div>
        <button class="tts-btn play-pause" id="ttsPlayPauseBtn" onclick="toggleTtsPause()">⏸️</button>
        <button class="tts-btn stop" onclick="closeTtsPlayer()">⏹️</button>
    `;
    document.body.appendChild(ttsDiv);

    const tracker = document.querySelector('.apiTracker');
    if (tracker) {
        tracker.innerHTML = `
            <div>⏱️ PT: <span id="apiTimer" class="api-val timer">--:--:--</span></div>
            <div style="color: #f59e0b;">📊 Tot: <span id="apiTotal" class="api-val" style="color: #f59e0b;">0</span></div>
            <div>🖼️ <span id="apiVision" class="api-val vision">0</span></div>
            <div>📝 <span id="apiText" class="api-val text">0</span></div>
        `;
    }

    // PACIFIC TIME & GOOGLE SHEETS RESET ENGINE
// 🛑 BULLETPROOF PACIFIC TIME & GOOGLE SHEETS RESET ENGINE 🛑
    setInterval(() => {
        const now = new Date();
        const laTimeStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
        const laTime = new Date(laTimeStr);
        
        // 1. Get the current calendar date in PT (e.g., "6/6/2026")
        const currentPtDate = laTime.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
        // 2. Check the last recorded reset date
        const lastResetDate = localStorage.getItem('lastApiResetDatePT');
        
        // Calculate time until next PT Midnight for the UI timer
        const nextMidnight = new Date(laTime);
        nextMidnight.setHours(24, 0, 0, 0);
        
        let diffMs = nextMidnight - laTime;
        let h = Math.floor(diffMs / (1000 * 60 * 60));
        let m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        let s = Math.floor((diffMs % (1000 * 60)) / 1000);
        const pad = (num) => num.toString().padStart(2, '0');
        
        // 3. THE TRIGGER: If the PT date has changed, FIRE THE RESET!
        if (currentPtDate !== lastResetDate) { 
            console.log("🕛 Pacific Time Midnight Hit! Wiping Database...");
            
            // Reset local quotas
            visionReqs = 0; textReqs = 0; 
            localStorage.setItem('visionReqs', '0'); 
            localStorage.setItem('textReqs', '0'); 
            
            // Save the new date so it doesn't loop
            localStorage.setItem('lastApiResetDatePT', currentPtDate); 
            
            // Nuke the Google Sheet
            fetch(GOOGLE_SHEETS_WEBHOOK, {
                method: "POST", mode: "no-cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ action: "reset" })
            }).catch(e => console.log("Failed to wipe DB", e));
        }
        
        // 4. Update the UI trackers perfectly in sync
        const t = document.getElementById('apiTimer'); if(t) t.innerText = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
        
        const total = visionReqs + textReqs;
        const elTotal = document.getElementById('apiTotal'); if(elTotal) elTotal.innerText = total;
        const elVis = document.getElementById('apiVision'); if(elVis) elVis.innerText = visionReqs;
        const elTxt = document.getElementById('apiText'); if(elTxt) elTxt.innerText = textReqs;
        
        const txtInput = document.getElementById('inputText');
        if(txtInput && document.getElementById('charCount')) document.getElementById('charCount').innerText = txtInput.value.length + " chars";
    }, 1000);
    
    const inputs = [{id:"searchInput", fn:runGroqSearch}, {id:"mathInstructionInput", fn:executeMathFlow}];
    inputs.forEach(i => { const el = document.getElementById(i.id); if(el) el.addEventListener("keypress", (e) => { if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); i.fn(); } }); });
    
    const buttons = [ {id: "sendMathBtn", fn: executeMathFlow}, {id: "sendSearchBtn", fn: runGroqSearch} ];
    buttons.forEach(b => { const btn = document.getElementById(b.id); if(btn) btn.onclick = b.fn; });

    if (document.getElementById('historyList')) renderHistory();

    const urlParams = new URLSearchParams(window.location.search);
    const restoreId = urlParams.get('restore');
    if (restoreId) {
        setTimeout(() => restoreSession(null, restoreId), 400);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

// --- UI FEATURES ---
function showToast(msg) {
    let t = document.createElement('div'); t.innerText = msg;
    t.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:linear-gradient(135deg, #3b82f6, #8b5cf6); color:white; padding:12px 25px; border-radius:30px; box-shadow:0 10px 25px rgba(0,0,0,0.5); z-index:10000; font-weight:600; font-size: 14px; text-align:center; animation:fadeInOut 3s forwards; letter-spacing: 0.5px;";
    document.body.appendChild(t);
    if(!document.getElementById('toastStyles')) {
        let s = document.createElement('style'); s.id = 'toastStyles';
        s.innerHTML = "@keyframes fadeInOut { 0%{opacity:0; bottom:10px;} 10%{opacity:1; bottom:30px;} 90%{opacity:1; bottom:30px;} 100%{opacity:0; bottom:10px;} }";
        document.head.appendChild(s);
    }
    setTimeout(() => t.remove(), 3000);
}

function copyToClipboard(textId) { navigator.clipboard.writeText(document.getElementById(textId).innerText).then(() => showToast("✅ Copied to clipboard!")); }
function viewPhotoFullscreen(src) { const viewer = document.getElementById('photoViewer'); const img = document.getElementById('previewImage'); if(viewer && img) { img.src = src; viewer.classList.add('active'); } }
function getActiveChatContainer(defaultId) { let c = document.getElementById(defaultId); if (!c) c = document.getElementById("mathsChatHistory"); if (!c) c = document.getElementById("chatHistory"); if (!c) c = document.querySelector(".chat-scroll-area"); return c; }
function track(type) { if(type==='v'){ visionReqs++; localStorage.setItem('visionReqs', visionReqs); } else { textReqs++; localStorage.setItem('textReqs', textReqs); } }
function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("overlay");
    if (!sidebar || !overlay) return;
    const active = !sidebar.classList.contains("active");
    sidebar.classList.toggle("active", active);
    overlay.classList.toggle("active", active);
    document.body.classList.toggle("sidebar-open", active);
}
if(document.getElementById("overlay")) document.getElementById("overlay").onclick = toggleSidebar;
function setStatusLoading(id, txt) { const el = document.getElementById(id); if(el) { el.innerHTML = `<div class="spinner"></div> ${txt}`; el.style.display = "flex"; } }

function scrollToBottom(aid, force = true) {
    const selectors = [aid, "mathScrollArea", "searchChatHistory", "imageScrollArea"];
    const scrollTargets = [];
    selectors.forEach(id => {
        if (!id) return;
        const el = document.getElementById(id);
        if (el && !scrollTargets.includes(el)) scrollTargets.push(el);
    });
    document.querySelectorAll(".chat-scroll-area, .page.active").forEach(el => {
        if (!scrollTargets.includes(el)) scrollTargets.push(el);
    });
    const run = () => scrollTargets.forEach(a => {
        if (!a) return;
        a.scrollTop = a.scrollHeight;
        if (force && a.scrollTo) a.scrollTo({ top: a.scrollHeight, behavior: "auto" });
    });
    requestAnimationFrame(run);
    setTimeout(run, 40);
    setTimeout(run, 160);
}

function appendUserBubble(txt, img, cid) {
    const c = getActiveChatContainer(cid); if(!c) return;
    let iH = img ? `<img src="${img}" class="bubble-img" onclick="viewPhotoFullscreen(this.src)" title="Click to expand">` : '';
    let tH = txt ? `<div>${txt.replace(/\n/g, '<br>')}</div>` : '';
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-user"><div class="bubble">${iH}${tH}</div></div>`);
    scrollToBottom(cid.replace('ChatHistory', 'ScrollArea'));
}

function appendAiLoading(cid) {
    const c = getActiveChatContainer(cid); if(!c) return null;
    const id = "loading_" + Date.now();
    
    c.insertAdjacentHTML('beforeend', `
        <div class="chat-msg chat-ai" id="${id}">
            <div class="bubble" style="display:flex; align-items:center; gap:12px;">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
                <span style="color:var(--muted); font-size:14px; font-weight:600; letter-spacing:0.5px;">AI is thinking...</span>
            </div>
        </div>
    `);
    
    scrollToBottom(cid.replace('ChatHistory', 'ScrollArea')); 
    return id;
}

function getRetryButtonsHtml(lId) {
    return `
    <div style="display:flex; gap:8px; flex-wrap:wrap; background:rgba(0,0,0,0.2); padding:8px; border-radius:15px; border:1px solid rgba(255,255,255,0.05); width:100%; align-items:center; justify-content:flex-start;">
        <span style="font-size:11px; color:var(--muted);">Retry Model:</span>
        <button style="background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid #3b82f6; padding:6px 12px; border-radius:12px; font-size:11px; cursor:pointer;" onclick="retryRequest('${lId}', 'gemini')">Gemini</button>
        <button style="background:rgba(245,158,11,0.1); color:#f59e0b; border:1px solid #f59e0b; padding:6px 12px; border-radius:12px; font-size:11px; cursor:pointer;" onclick="retryRequest('${lId}', 'cloudflare')">Cloudflare</button>
        <button style="background:rgba(16,185,129,0.1); color:#10b981; border:1px solid #10b981; padding:6px 12px; border-radius:12px; font-size:11px; cursor:pointer;" onclick="retryRequest('${lId}', 'groq')">Groq</button>
    </div>`;
}

// 🛑 THE DYNAMIC SPEED TYPEWRITER ENGINE 🛑
function typeWriteResponse(containerEl, rawText, provider, contentId, buttonsHtml, isMath, onComplete) {
    containerEl.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div id="${contentId}" style="margin-top:10px;"></div>`;
    const txtEl = document.getElementById(contentId);
    
    const chars = rawText.length || 1;
    let tickRate = Math.floor(10000 / chars);
    let charsPerTick = 1;
    
    if (tickRate > 35) { tickRate = 35; } 
    else if (tickRate < 20) { tickRate = 20; charsPerTick = Math.ceil(chars / (10000 / 20)); }
    
    let i = 0; 
    window.currentTypingTimer = setInterval(() => {
        if (i < rawText.length) {
            let chunk = rawText.substr(i, charsPerTick);
            for(let c of chunk) { if (c === '\n') txtEl.appendChild(document.createElement('br')); else txtEl.appendChild(document.createTextNode(c)); }
            i += charsPerTick;
        } else {
            clearInterval(window.currentTypingTimer);
            window.currentTypingTimer = null;
            if (isMath && window.MathJax) { MathJax.typesetClear([containerEl]); MathJax.typesetPromise([containerEl]); }
            containerEl.insertAdjacentHTML('beforeend', buttonsHtml);
            if (onComplete) onComplete();
            
            window.toggleChatButton(false); // Done typing, revert button
        }
    }, tickRate);
}

function updateAiBubble(lId, answer, provider = "AI", useTyping = true) {
    const loadingBubble = document.getElementById(lId);
    if (!loadingBubble) return;
    const bbl = loadingBubble.querySelector('.bubble');
    window.latestMathSolution = answer; 
    
    const buttons = `
        <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
            <div style="display:flex; gap:10px; width:100%;">
                <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('text_${lId}')">🔊 Listen</button>
                <button class="btn blue" style="padding:10px; flex:1; font-size:13px; border-radius:20px; background:linear-gradient(135deg, #f43f5e, #be123c);" onclick="initVideoGui()">▶️ Tutor</button>
                <button class="btn" style="padding:10px; flex:0.5; font-size:13px; border-radius:20px; background:#475569; color:white;" onclick="copyToClipboard('text_${lId}')">📋</button>
            </div>
            ${getRetryButtonsHtml(lId)}
        </div>
    `;
    
    if (useTyping) { typeWriteResponse(bbl, answer, provider, `text_${lId}`, buttons, true); } 
    else {
        bbl.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div id="text_${lId}" style="margin-top:10px;">${answer.replace(/\n/g, '<br>')}</div>${buttons}`;
        if (window.MathJax) { MathJax.typesetClear([bbl]); MathJax.typesetPromise([bbl]); }
        window.toggleChatButton(false); // Ensure button resets if no typing animation
    }
}

// --- 🛑 SAFE API FETCHERS WITH ABORT CONTROLLER 🛑 ---
async function checkHtmlError(r) {
    const contentType = r.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
        throw new Error("⚠️ Server Connection Error: Your backend server is either asleep or restarting. Please wait 30 seconds for it to wake up, then try again!");
    }
    return await r.json();
}

async function callGeminiText(sysText, usrText, override = null) {
  if (isProcessing) throw new Error("Processing..."); isProcessing = true; track('t');
  window.currentAbortController = new AbortController();
  try { 
      const r = await fetch("/api/gemini-text", { 
          method: "POST", headers: {"Content-Type":"application/json"}, 
          body: JSON.stringify({ systemPrompt: sysText, userPrompt: usrText, providerOverride: override }),
          signal: window.currentAbortController.signal
      }); 
      const d = await checkHtmlError(r); if(!r.ok) throw new Error(d.error); 
      isProcessing = false; window.currentAbortController = null; return d; 
  } catch(e) { isProcessing = false; window.currentAbortController = null; throw e; }
}

async function callGeminiVision(imgData, aiQuery, override = null) {
  if (isProcessing) throw new Error("Processing..."); isProcessing = true; track('v');
  window.currentAbortController = new AbortController();
  try { 
      const r = await fetch("/api/gemini-vision", { 
          method: "POST", headers: {"Content-Type":"application/json"}, 
          body: JSON.stringify({ imageBase64: imgData, userPrompt: aiQuery, providerOverride: override }),
          signal: window.currentAbortController.signal
      }); 
      const d = await checkHtmlError(r); if(!r.ok) throw new Error(d.error); 
      isProcessing = false; window.currentAbortController = null; return d; 
  } catch(e) { isProcessing = false; window.currentAbortController = null; throw e; }
}

function formatHindiSpeechText(text) {
    return String(text || "")
        .replace(/\\text\{([^}]+)\}/g, " $1 ")
        .replace(/\\quad/g, " ").replace(/\\qquad/g, " ").replace(/\\,/g, " ").replace(/\\;/g, " ")
        .replace(/\\Rightarrow/g, " iska matlab hai ").replace(/\\rightarrow/g, " iska matlab hai ")
        .replace(/\\approx/g, " lagbhag barabar ")
        .replace(/\\left/g, " ").replace(/\\right/g, " ")
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, " $1 batta $2 ")
        .replace(/\\sqrt\{([^}]+)\}/g, " root $1 ")
        .replace(/\^\{([^}]+)\}/g, " ki power $1 ").replace(/\^([0-9a-zA-Z])/g, " ki power $1 ")
        .replace(/_\{([^}]+)\}/g, " base $1 ").replace(/_([0-9a-zA-Z])/g, " base $1 ")
        .replace(/\\times/gi, " guna ").replace(/ X /g, " guna ").replace(/ x /g, " guna ")
        .replace(/:-/g, " bhag ").replace(/÷/g, " bhag ").replace(/=/g, " barabar ")
        .replace(/-/g, " minus ").replace(/\+/g, " plus ").replace(/%/g, " percent ")
        .replace(/\(/g, " bracket ").replace(/\)/g, " bracket ")
        .replace(/\{/g, " ").replace(/\}/g, " ").replace(/\[/g, " ").replace(/\]/g, " ")
        .replace(/\//g, " batta ")
        .replace(/[\$\\]/g, " ")
        .replace(/\./g, ". , , ").replace(/\|/g, " , , ")
        .replace(/\s+/g, " ").trim();
}

function speakAndHighlight(elId) {
    const el = document.getElementById(elId); if (!el) return;
    if (!('speechSynthesis' in window)) { alert("Your browser does not support text-to-speech!"); return; }
    
    window.speechSynthesis.cancel(); 
    const player = document.getElementById('ttsMiniPlayer');
    if (player) {
        player.classList.add('active');
        player.classList.remove('paused');
        document.getElementById('ttsPlayPauseBtn').innerText = '⏸️';
    }

    const cleanSpeech = formatHindiSpeechText(el.innerText);
    const utterance = new SpeechSynthesisUtterance(cleanSpeech);
    utterance.lang = 'hi-IN';
    if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
    const hindiVoice = availableVoices.find(v => v.name.includes('Google') && v.lang.includes('hi')) || availableVoices.find(v => v.name.includes('हिन्दी')) || availableVoices.find(v => v.lang.includes('hi')) || availableVoices[0];

    if (hindiVoice) { utterance.voice = hindiVoice; }
    utterance.pitch = 1.0; utterance.rate = 0.9;  
    
    utterance.onend = () => { closeTtsPlayer(); };
    utterance.onerror = () => { closeTtsPlayer(); };
    window.speechSynthesis.speak(utterance);
}

window.toggleTtsPause = function() {
    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        document.getElementById('ttsPlayPauseBtn').innerText = '⏸️';
        document.getElementById('ttsMiniPlayer').classList.remove('paused');
    } else if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        document.getElementById('ttsPlayPauseBtn').innerText = '▶️';
        document.getElementById('ttsMiniPlayer').classList.add('paused');
    }
};

window.closeTtsPlayer = function() {
    window.speechSynthesis.cancel();
    const player = document.getElementById('ttsMiniPlayer');
    if (player) player.classList.remove('active');
};

async function retryRequest(lId, targetProvider) {
    const req = window.requestCache[lId];
    if(!req) return showToast("Request data expired.");
    
    let container;
    if (req.type === 'qa') {
         container = document.getElementById("qaAnswerBox");
         document.getElementById("qaStatusText").innerText = `Retrying with ${targetProvider.toUpperCase()}...`;
         document.getElementById("qaProgressBar").style.width = "85%";
    } else { container = document.getElementById(lId)?.querySelector('.bubble'); }
    
    if(!container) return;
    container.innerHTML = `<div class="spinner"></div> Retrying with ${targetProvider.toUpperCase()}...`;
    window.toggleChatButton(true);
    
    try {
        if (req.type === 'math') {
            let resObj = req.image ? await callGeminiVision(req.image, req.prompt, targetProvider) : await callGeminiText(req.sysPrompt, req.prompt, targetProvider);
            let cleanSol = resObj.text.replace(/[\*&#_]/g, '');
            saveToHistory('math', req.prompt.substring(0, 100) + " (Retry)", cleanSol, req.image, resObj.provider);
            updateAiBubble(lId, cleanSol, resObj.provider, true);
        }
        else if (req.type === 'search') {
            let resObj;
            if (req.image) { resObj = await callGeminiVision(req.image, req.prompt, targetProvider); } 
            else { 
                track('t'); window.currentAbortController = new AbortController();
                if(targetProvider === "gemini") {
                     resObj = await callGeminiText("Act as an Internet Search Engine.", req.prompt, "gemini");
                } else {
                     const res = await fetch("/api/groq-search", { 
                         method: "POST", headers: {"Content-Type":"application/json"}, 
                         body: JSON.stringify({ prompt: req.originalSearch, providerOverride: targetProvider }),
                         signal: window.currentAbortController.signal
                     });
                     resObj = await checkHtmlError(res); if(!resObj.text) throw new Error(resObj.error || "Search failed");
                     window.currentAbortController = null;
                }
            }
            let ans = resObj.text.replace(/[\*&#_]/g, '');
            saveToHistory('search', req.originalSearch + " (Retry)", ans, req.image, resObj.provider || targetProvider);
            const buttons = `
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                    <div style="display:flex; gap:10px; width:100%;">
                        <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button>
                        <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('search_${lId}')">📋 Copy</button>
                    </div>
                    ${getRetryButtonsHtml(lId)}
                </div>
            `;
            typeWriteResponse(container, ans, resObj.provider || targetProvider, `search_${lId}`, buttons, false);
        }
        else if (req.type === 'image_trans') {
            let resObj = await callGeminiText("You are a strict translator.", req.prompt, targetProvider); 
            let parts = resObj.text.split('|||'); let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed."; let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found.";
            saveToHistory('image_translation', `Translate to ${req.targetLang} (Retry)`, cleanText + "\n\nHard Words:\n" + hardWordsText, null, resObj.provider);
            container.innerHTML = `
                <div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${resObj.provider}</div>
                <div style="margin-top:10px; font-size:12px; color:#cbd5e1; margin-bottom:5px; font-weight:600;">📄 Extracted Text:</div>
                <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; max-height:150px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1);">${req.extractedText.replace(/\n/g, '<br>')}</div>
                <div style="font-size:12px; color:#3b82f6; margin-bottom:5px; font-weight:600;">🌍 Translated to ${req.targetLang}:</div>
                <div id="trans_${lId}" style="font-size:15px;">${cleanText.replace(/\n/g, '<br>')}</div>
                <div style="font-size:12px; color:#a855f7; margin-top:15px; margin-bottom:5px; font-weight:600;">📖 Hard Words Dictionary:</div>
                <div style="background:rgba(168,85,247,0.1); padding:10px; border-radius:8px; font-size:14px; border:1px solid rgba(168,85,247,0.3);">${hardWordsText.replace(/\n/g, '<br>')}</div>
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                    <div style="display:flex; gap:10px; width:100%;">
                        <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('trans_${lId}')">🔊 Listen</button>
                        <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('trans_${lId}')">📋 Copy</button>
                    </div>
                    ${getRetryButtonsHtml(lId)}
                </div>
            `;
            window.toggleChatButton(false);
        }
        else if (req.type === 'qa') {
            let ansObj = await callGeminiText("You are a helpful document assistant.", req.prompt, targetProvider);
            let cleanAns = ansObj.text.replace(/[\*&#_]/g, ''); document.getElementById("qaProgressBar").style.width = "100%"; document.getElementById("qaStatusText").innerText = "✅ Done!";
            saveToHistory('qa', req.finalQuestion + " (Retry)", cleanAns, null, ansObj.provider);
            container.innerHTML = `
                <div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${ansObj.provider}</div>
                <div style="margin-top:10px; font-size:13px; color:#93c5fd; margin-bottom:5px; font-weight:600;">Your Question:</div>
                <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; border:1px solid rgba(255,255,255,0.05);">${req.finalQuestion.replace(/\n/g, '<br>')}</div>
                <div style="font-size:13px; color:#22c55e; margin-bottom:5px; font-weight:600;">Answer:</div>
                <div id="${lId}" style="font-size:15px;">${cleanAns.replace(/\n/g, '<br>')}</div>
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                    <div style="display:flex; gap:10px; width:100%;">
                        <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${lId}')">🔊 Listen</button>
                        <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${lId}')">📋 Copy</button>
                    </div>
                    ${getRetryButtonsHtml(lId)}
                </div>
            `;
            if (window.MathJax) { MathJax.typesetClear([container]); MathJax.typesetPromise([container]); }
            window.toggleChatButton(false);
        }
    } catch(e) { 
        window.toggleChatButton(false);
        if(req.type === 'qa') { document.getElementById("qaStatusText").innerText = "❌ Error Occurred"; document.getElementById("qaProgressBar").style.background = "var(--red)"; container.innerHTML = "Error: " + e.message; } 
        else { container.innerText = "❌ Error: " + e.message; }
    }
}

function clearMathImage(e) { if(e) e.stopPropagation(); capturedImage = null; const chip = document.getElementById("mathPreviewChip"); if(chip) chip.style.display = "none"; }
// 🛑 इस फ़ंक्शन को अपने main.js के executeMathFlow फ़ंक्शन से बदलें
async function executeMathFlow() {
    const inp = document.getElementById("mathInstructionInput"); if(!inp) return;
    const instruction = inp.value.trim(); if (!capturedImage && !instruction) return;
    
    let uiImage = capturedImage;
    appendUserBubble(instruction || "Solve this", uiImage, "mathChatHistory");
    inp.value = ""; 
    let lId = appendAiLoading("mathChatHistory");

    window.toggleChatButton(true);

    let activeImage = uiImage || getLastContextImage('math');
    let memoryContext = getSessionContext('math');

    // 🚀 STRICT FORMATTING PROMPT FOR GEMINI
    const sysPrompt = `You are an expert math tutor. STRICT RULES:

1. NON-MATH/GREETINGS: If the user says "hi", "hello", or asks a non-math question, reply normally in Hindi. DO NOT use the math format. DO NOT write "प्रश्न:".

2. MATH QUESTIONS ONLY: You MUST format your answer EXACTLY like this template. Do NOT deviate. EVERYTHING must be in Hindi except numbers and math symbols:

प्रश्न: [Write the exact question here]

SOLUTION:-
[Step-by-step math solution using $ for math notation. Keep it direct.]

EXPLANATION-
[Keep this extremely short! Max 2 to 3 lines explaining the core concept in Hindi.]`;
    
    let finalPrompt = `${sysPrompt}\n\n${memoryContext}User: ${instruction || "Solve this image."}`;
    window.requestCache[lId] = { type: 'math', sysPrompt, prompt: finalPrompt, image: activeImage };

    try {
        let resObj = activeImage ? await callGeminiVision(activeImage, finalPrompt) : await callGeminiText(sysPrompt, finalPrompt);
        let cleanSol = resObj.text.replace(/[\*&#_]/g, ''); 
        
        saveToHistory('math', instruction || "Solve this image", cleanSol, uiImage, resObj.provider); 
        
        // 🚀 UI LAYOUT ENGINE FOR MATH & PAPERS
        const loadingBubble = document.getElementById(lId);
        if (loadingBubble) {
            const bbl = loadingBubble.querySelector('.bubble');
            window.latestMathSolution = cleanSol;
            
            const buttons = `
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                    <div style="display:flex; gap:10px; width:100%;">
                        <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('text_${lId}')">🔊 Listen</button>
                        <button class="btn blue" style="padding:10px; flex:1; font-size:13px; border-radius:20px; background:linear-gradient(135deg, #f43f5e, #be123c);" onclick="initVideoGui()">▶️ Tutor</button>
                        <button class="btn" style="padding:10px; flex:0.5; font-size:13px; border-radius:20px; background:#475569; color:white;" onclick="copyToClipboard('text_${lId}')">📋</button>
                    </div>
                    ${getRetryButtonsHtml(lId)}
                </div>`;

            // Display text solution first
            bbl.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${resObj.provider}</div><div id="text_${lId}" style="margin-top:10px;">${cleanSol.replace(/\n/g, '<br>')}</div>${buttons}`;
            if (window.MathJax) { MathJax.typesetClear([bbl]); MathJax.typesetPromise([bbl]); }
            window.toggleChatButton(false);

            // 🚀 RENDER THE DIGITAL PAPER ONLY IF IT IS A MATH SOLUTION
            if (cleanSol.includes("SOLUTION:-")) {
                try {
                    let parts = cleanSol.split("SOLUTION:-")[1];
                    let mathTextOnly = parts.split("EXPLANATION-")[0].trim();

                    if (mathTextOnly.length > 5) {
                        // Clean LaTeX tags for Handwriting rendering
                        mathTextOnly = mathTextOnly.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1/$2)')
                            .replace(/\\sqrt\{([^}]+)\}/g, '√$1')
                            .replace(/\^\{([^}]+)\}/g, '^$1')
                            .replace(/_\{([^}]+)\}/g, '_$1')
                            .replace(/\\text\{([^}]+)\}/g, '$1')
                            .replace(/\\times/gi, '×')
                            .replace(/\\div/gi, '÷')
                            .replace(/\\cdot/gi, '·')
                            .replace(/\\Rightarrow/gi, '⇒')
                            .replace(/\\rightarrow/gi, '→')
                            .replace(/\\approx/gi, '≈')
                            .replace(/\\quad/g, '  ')
                            .replace(/[\$\\]/g, '');

                        const historyDiv = document.getElementById("mathChatHistory");
                        historyDiv.insertAdjacentHTML('beforeend', `
                            <div class="chat-msg chat-ai" style="animation: slideUp 0.3s ease-out; width: 100%; display: flex;">
                                <div class="bubble" style="display: flex; flex-direction: column; width: fit-content; max-width: 95%; box-sizing: border-box; padding-top: 20px;">
                                    <p style="color: #94a3b8; font-size: 13px; margin-bottom: 5px; font-weight: 600;">📝 IMAGE OF SOLUTION----</p>
                                    <div class="digital-paper-container">
                                        <div class="digital-paper">${mathTextOnly}</div>
                                    </div>
                                </div>
                            </div>
                        `);
                    }
                } catch(err) { console.log("Paper render crashed", err); }
            }
        }
        clearMathImage();
        scrollToBottom("mathScrollArea");
    } catch(e) { 
        window.toggleChatButton(false);
        const el = document.getElementById(lId); 
        if(el) el.querySelector('.bubble').innerText = "❌ Error: " + e.message; 
    }
}

async function runGroqSearch() {
    const inp = document.getElementById("searchInput"); if(!inp) return;
    const q = inp.value.trim(); 
    
    if(!q && !capturedImage && !window.attachedPdfText) return;
    
    let uiImage = capturedImage;
    
    let displayQ = q || (window.attachedPdfText ? "Analyze this document." : "Analyze this image.");
    if(window.attachedPdfText) displayQ = "📄 [PDF Attached]\n" + displayQ;
    
    appendUserBubble(displayQ, uiImage, "searchChatHistory"); 
    inp.value = ""; let lId = appendAiLoading("searchChatHistory");
    
    window.toggleChatButton(true);
    
    let activeImage = uiImage || getLastContextImage('search');
    let memoryContext = getSessionContext('search');
    
    let sysPrompt = "Act as an Internet Search Engine. Provide highly factual search results. YOU MUST ANSWER ENTIRELY IN HINDI (DEVANAGARI SCRIPT ONLY). DO NOT USE ENGLISH.";
    
    let promptContent = q;
    if (window.attachedPdfText) {
        promptContent = `Here is the extracted text from an attached PDF document:\n\n${window.attachedPdfText}\n\nBased ONLY on this document, please answer the user query: ${q || 'Please summarize this document.'}`;
    }
    
    let finalPrompt = `${memoryContext}User: ${promptContent}`;
    
    window.requestCache[lId] = { type: 'search', originalSearch: q, prompt: finalPrompt, image: activeImage };

    try {
        let ans = ""; let provider = "";
        
        if (activeImage) {
            let resObj = await callGeminiVision(activeImage, `${sysPrompt}\n\n${finalPrompt}`);
            ans = resObj.text; provider = resObj.provider;
        } else {
            let resObj = await callGeminiText(sysPrompt, finalPrompt, "gemini");
            ans = resObj.text; provider = resObj.provider;
        }
        
        ans = ans.replace(/[\*&#_]/g, '');
        saveToHistory('search', q || "PDF Analysis", ans, uiImage, provider); 
        
        const bbl = document.getElementById(lId);
        if (bbl) {
            const bubbleEl = bbl.querySelector('.bubble');
            const buttons = `
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                    <div style="display:flex; gap:10px; width:100%;">
                        <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button>
                        <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('search_${lId}')">📋 Copy</button>
                    </div>
                    ${getRetryButtonsHtml(lId)}
                </div>`;
            typeWriteResponse(bubbleEl, ans, provider, `search_${lId}`, buttons, false);
        }
        
        clearMathImage();
        if(window.clearPdfFile) window.clearPdfFile();
        
    } catch(e) { 
        window.toggleChatButton(false);
        const el = document.getElementById(lId); 
        if(el) {
             if (e.name === 'AbortError') el.querySelector('.bubble').innerText = "⚠️ Stopped by user.";
             else el.querySelector('.bubble').innerText = "❌ Error: " + e.message; 
        }
    }
}

function formatTime(sec) { let m = Math.floor(sec / 60); let s = Math.floor(sec % 60); return (m < 10 ? '0'+m : m) + ':' + (s < 10 ? '0'+s : s); }

function startVideoTimer(totalChars) {
    clearInterval(videoTickInterval); 
    videoTotalEst = Math.max(5, Math.floor(totalChars / (14 * videoSpeed))); 
    document.getElementById('vTimeDisplay').innerText = `${formatTime(videoElapsed)} / ${formatTime(videoTotalEst)}`;
    
    videoTickInterval = setInterval(() => {
        if(!isVideoPaused && window.speechSynthesis.speaking) {
            videoElapsed += 1; 
            let displayTotal = videoTotalEst; 
            if(videoElapsed > videoTotalEst) displayTotal = videoElapsed; 
            document.getElementById('vTimeDisplay').innerText = `${formatTime(videoElapsed)} / ${formatTime(displayTotal)}`;
        }
    }, 1000);
}

function resetVideoActivity() {
    const top = document.getElementById('vTopBar'); const bot = document.getElementById('vControlsContainer'); const ov = document.getElementById('videoGuiOverlay');
    if(top) top.style.opacity = '1'; if(bot) bot.style.opacity = '1'; if(ov) ov.style.cursor = 'default';
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => { if(!isVideoPaused) { if(top) top.style.opacity = '0'; if(bot) bot.style.opacity = '0'; if(ov) ov.style.cursor = 'none'; } }, 3000);
}

function toggleVideoFullscreen() { 
    const ov = document.getElementById('videoGuiOverlay'); 
    if (!document.fullscreenElement) { 
        if(ov.requestFullscreen) ov.requestFullscreen().catch(()=>{});
        if(screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{});
    } else { 
        document.exitFullscreen().catch(()=>{}); 
        if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } 
}

function updateVideoVolume(val) { currentVideoVolume = parseFloat(val); if (activeVideoUtterance) activeVideoUtterance.volume = currentVideoVolume; resetVideoActivity(); }

function initVideoGui() {
    if(!window.latestMathSolution) return;
    
    videoElapsed = 0; isVideoPaused = false; 
    const ov = document.createElement('div'); ov.id = 'videoGuiOverlay';
    ov.style.cssText = "position:fixed; inset:0; background:radial-gradient(circle, #1e293b 0%, #000000 100%); z-index:9999; display:flex; flex-direction:column; font-family:'Poppins', sans-serif; touch-action:none;";
    ov.innerHTML = `
        <div id="vTopBar" style="position:absolute; top:0; left:0; right:0; padding:20px; background:linear-gradient(rgba(0,0,0,0.9), transparent); display:flex; justify-content:space-between; transition: opacity 0.3s; z-index:100;">
            <div style="color:white; font-weight:bold; font-size:18px;">🔴 AI TUTOR LIVE</div>
            <button onclick="exitVideoGui()" style="background:rgba(239, 68, 68, 0.2); border:1px solid var(--red); color:white; padding:5px 15px; border-radius:5px; cursor:pointer;">Exit</button>
        </div>
        
        <div style="position:absolute; left:0; top:60px; bottom:100px; width:40%; z-index:50;" onclick="handleVideoTap(event, -1)"></div>
        <div style="position:absolute; right:0; top:60px; bottom:100px; width:40%; z-index:50;" onclick="handleVideoTap(event, 1)"></div>
        
        <div id="skipIndLeft" style="position:absolute; left:10%; top:50%; transform:translateY(-50%); font-size:40px; color:white; opacity:0; z-index:51; pointer-events:none; transition:0.2s; background:rgba(0,0,0,0.5); padding:20px; border-radius:50%;">⏪</div>
        <div id="skipIndRight" style="position:absolute; right:10%; top:50%; transform:translateY(-50%); font-size:40px; color:white; opacity:0; z-index:51; pointer-events:none; transition:0.2s; background:rgba(0,0,0,0.5); padding:20px; border-radius:50%;">⏩</div>

        <div id="videoDisplayArea" style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:60px 20px; overflow-y:auto; padding-bottom:100px; position:relative; z-index:10;">
            <div id="videoContent" style="font-size: 36px; font-weight: 700; color: #fff; line-height: 1.8; max-width: 900px; width:100%; text-align:left; background:rgba(0,0,0,0.4); padding:40px; border-radius:20px; border:1px solid rgba(255,255,255,0.1); box-shadow:0 10px 40px rgba(0,0,0,0.5);"></div>
        </div>

        <div id="vControlsContainer" style="position:absolute; bottom:0; left:0; right:0; padding:20px; background:linear-gradient(transparent, rgba(0,0,0,0.95)); transition: opacity 0.3s; z-index:100;">
           <div style="width:100%; height:20px; cursor:pointer; display:flex; align-items:center;" onclick="seekVideo(event)">
               <div style="width:100%; height:5px; background:rgba(255,255,255,0.2); border-radius:3px; position:relative;" id="vProgressBarBg">
                   <div style="height:100%; width:0%; background:#3b82f6; border-radius:3px; transition: width 0.1s linear;" id="vProgressBar"></div>
               </div>
           </div>

           <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:5px;">
               <div style="display:flex; align-items:center; gap:20px;">
                   <button id="vPlayBtn" onclick="toggleVideoPause()" style="background:none; border:none; color:white; font-size:26px; cursor:pointer;">⏸️</button>
                   <span id="vTimeDisplay" style="color:#cbd5e1; font-size:14px; font-weight:500; font-family:monospace;">00:00 / 00:00</span>
               </div>
               <div style="display:flex; align-items:center; gap:20px;">
                   <div style="display:flex; align-items:center; gap:5px;"><span style="color:white; font-size:16px;">🔊</span><input type="range" id="vVolumeSlider" min="0" max="1" step="0.1" value="${currentVideoVolume}" onchange="updateVideoVolume(this.value)" style="width:70px; accent-color:#3b82f6; cursor:pointer;"></div>
                   <button onclick="cycleVideoSpeed()" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; font-size:14px; font-weight:bold; cursor:pointer; border-radius:10px; padding:5px 12px;" id="vSpeedTxt">${videoSpeed}x</button>
                   <button onclick="toggleVideoFullscreen()" style="background:none; border:none; color:white; font-size:22px; cursor:pointer;" title="Fullscreen">🔲</button>
               </div>
           </div>
        </div>
    `;
    document.body.appendChild(ov); 
    
    if(ov.requestFullscreen) ov.requestFullscreen().catch(()=>{});
    if(screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{});

    ov.addEventListener('mousemove', resetVideoActivity); ov.addEventListener('touchstart', resetVideoActivity);
    resetVideoActivity(); playFractionVideo(0);
}

window.handleVideoTap = function(e, dir) {
    const now = Date.now();
    if (now - (e.target.lastTap || 0) < 300) { skipVideo(dir); e.target.lastTap = 0; } 
    else { e.target.lastTap = now; resetVideoActivity(); }
};

window.skipVideo = function(dir) {
    const ind = document.getElementById(dir === 1 ? 'skipIndRight' : 'skipIndLeft');
    if(ind) { ind.style.opacity = '1'; setTimeout(()=>ind.style.opacity='0', 400); }
    
    window.speechSynthesis.cancel();
    const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== '');
    let target = videoLineIndex + dir;
    if(target < 0) target = 0;
    if(target >= lines.length) target = lines.length - 1;
    
    videoElapsed = Math.floor((target / lines.length) * videoTotalEst);
    playFractionVideo(target, false, isVideoPaused);
};

window.seekVideo = function(e) {
    const barBg = document.getElementById('vProgressBarBg');
    const rect = barBg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    
    const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== '');
    let targetLine = Math.floor(percent * lines.length);
    if(targetLine >= lines.length) targetLine = lines.length - 1;

    window.speechSynthesis.cancel();
    videoElapsed = Math.floor((targetLine / lines.length) * videoTotalEst);
    playFractionVideo(targetLine, false, isVideoPaused);
};

function exitVideoGui() { 
    window.speechSynthesis.cancel(); clearInterval(videoTickInterval); clearTimeout(hideControlsTimer);
    const ov = document.getElementById('videoGuiOverlay'); 
    if(ov) { if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.remove(); }
    if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); 
}

function cycleVideoSpeed() { 
    videoSpeed = videoSpeed === 0.75 ? 1.0 : (videoSpeed === 1.0 ? 1.5 : (videoSpeed === 1.5 ? 2.0 : 0.75)); 
    document.getElementById('vSpeedTxt').innerText = videoSpeed + 'x'; 
    const wasPaused = isVideoPaused; window.speechSynthesis.cancel(); resetVideoActivity();
    playFractionVideo(videoLineIndex, true, wasPaused);
}

function toggleVideoPause() { 
    const btn = document.getElementById('vPlayBtn'); 
    if (isVideoPaused) { isVideoPaused = false; window.speechSynthesis.resume(); if(btn) btn.innerHTML = "⏸️"; } 
    else { isVideoPaused = true; window.speechSynthesis.pause(); if(btn) btn.innerHTML = "▶️"; } 
    resetVideoActivity();
}

function replayVideo() { 
    window.speechSynthesis.cancel(); videoLineIndex = 0; videoElapsed = 0; isVideoPaused = false; 
    document.getElementById('vPlayBtn').innerHTML = "⏸️"; playFractionVideo(0); 
}

async function playFractionVideo(startIndex = 0, preserveContent = false, pauseAfterStart = false) {
    const token = ++videoRunToken;
    const content = document.getElementById("videoContent");
    if (!content) return;
    const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== '');
    videoLineIndex = Math.min(startIndex, Math.max(lines.length - 1, 0));
    
    if (!preserveContent) {
        content.innerHTML = "";
        for(let i=0; i<videoLineIndex; i++) {
            let div = document.createElement("div");
            div.dataset.videoLine = i; div.className = "video-line-card"; div.innerHTML = lines[i];
            content.appendChild(div);
            if (window.MathJax) MathJax.typesetPromise([div]);
        }
    }
    
    startVideoTimer(window.latestMathSolution.length);
    const pBar = document.getElementById('vProgressBar');

    for(let i=videoLineIndex; i<lines.length; i++) {
        if(token !== videoRunToken || !document.getElementById('videoGuiOverlay')) return;
        videoLineIndex = i;
        if(pBar) pBar.style.width = ((i / lines.length) * 100) + '%';
        
        const lineText = lines[i];
        const cleanSpeech = formatHindiSpeechText(lineText);
        const u = new SpeechSynthesisUtterance(cleanSpeech);
        activeVideoUtterance = u;
        if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
        let premium = availableVoices.find(v => v.name === 'Google हिन्दी' || v.name === 'Google Hindi' || (v.name.includes('Google') && v.lang.includes('hi')));
        if (premium) u.voice = premium;
        u.lang = 'hi-IN'; u.rate = videoSpeed; u.volume = currentVideoVolume;

        let lineDiv = document.querySelector(`[data-video-line="${i}"]`);
        if (!lineDiv) {
            lineDiv = document.createElement("div");
            lineDiv.dataset.videoLine = i; lineDiv.className = "video-line-card"; 
            content.appendChild(lineDiv);
        }
        
        lineDiv.innerHTML = lineText; lineDiv.classList.add("active");

        if (window.MathJax && !lineDiv.hasAttribute('data-math-done')) { 
            MathJax.typesetClear([lineDiv]); await MathJax.typesetPromise([lineDiv]); lineDiv.setAttribute('data-math-done', 'true');
        }

        setTimeout(() => { if(content.parentElement) content.parentElement.scrollTo({ top: content.parentElement.scrollHeight, behavior: "smooth" }); }, 10);

        window.speechSynthesis.speak(u);
        if (pauseAfterStart) {
            window.speechSynthesis.pause(); isVideoPaused = true;
            const playBtn = document.getElementById('vPlayBtn'); if(playBtn) playBtn.innerHTML = "▶️";
            pauseAfterStart = false;
        }

        let estimatedDurationMs = (cleanSpeech.length / 13.5) * 1000 / videoSpeed; 
        let startTime = Date.now();

        let waitInterval = setInterval(() => {
            if (isVideoPaused) startTime += 50; 
            let elapsed = Date.now() - startTime;
            if (elapsed >= estimatedDurationMs) clearInterval(waitInterval);
        }, 50);

        await new Promise(r => { u.onend = r; u.onerror = r; setTimeout(r, Math.max(estimatedDurationMs + 500, 2000)); });
        
        lineDiv.classList.remove("active");
        if(token !== videoRunToken) return;
    }
    
    if(pBar) pBar.style.width = '100%'; clearInterval(videoTickInterval);
    const playBtn = document.getElementById('vPlayBtn'); if(playBtn) playBtn.innerHTML = "🔄";
    resetVideoActivity();
}

const langMap = { "Hindi": "hi-IN", "English": "en-US", "French": "fr-FR", "Spanish": "es-ES", "German": "de-DE", "Japanese": "ja-JP" };

let recognition; let isRecording = false;

function getActiveTextInput() {
    return document.getElementById("searchInput") || document.getElementById("inputText") || document.getElementById("mathInstructionInput") || document.getElementById("qaQuestionInput");
}

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) { 
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition; 
    recognition = new SpeechRec(); recognition.continuous = false; recognition.interimResults = true; 
    
    recognition.onstart = () => { 
        isRecording = true; 
        const mic = document.getElementById("micBtn"); 
        if(mic) { mic.classList.add("recording"); mic.style.background = "rgba(239, 68, 68, 0.8)"; mic.style.boxShadow = "0 0 15px rgba(239, 68, 68, 0.8)"; } 
    }; 
    
    recognition.onresult = (e) => { 
        let tr = ""; for (let i = 0; i < e.results.length; i++) tr += e.results[i][0].transcript; 
        const inp = getActiveTextInput(); if(inp) inp.value = tr; 
    }; 
    
    recognition.onerror = () => stopRecording(); 
    recognition.onend = () => stopRecording(); 
}

window.toggleRecording = function() { 
    if (!recognition) return showToast("⚠️ Microphone not supported on this browser."); 
    if (isRecording) { recognition.stop(); } 
    else { 
        const langEl = document.getElementById("voiceSourceLang");
        recognition.lang = langEl ? langEl.value : "hi-IN"; 
        const inp = getActiveTextInput(); if(inp) inp.value = "Listening..."; 
        recognition.start(); 
    } 
};

window.stopRecording = function() { 
    isRecording = false; 
    const mic = document.getElementById("micBtn"); 
    if(mic) { mic.classList.remove("recording"); mic.style.background = "rgba(255, 255, 255, 0.08)"; mic.style.boxShadow = "none"; } 
    const inp = getActiveTextInput();
    if(inp && inp.value === "Listening...") inp.value = ""; 
};

async function runTranslation(){ 
    const txt = document.getElementById("inputText").value.trim(); const lang = document.getElementById("targetLang").value; if(!txt) return; 
    setStatusLoading("translatedTextStatus", "Translating..."); document.getElementById("translatedTextStatus").style.display = "block";
    try{ 
        let prompt = `You are a STRICT Language Translator.
        RULE 1: DO NOT answer any questions found in the text. DO NOT summarize.
        RULE 2: ONLY TRANSLATE the text exactly into ${lang}. DO NOT USE ENGLISH UNLESS ENGLISH IS THE SELECTED TARGET LANGUAGE.
        RULE 3: After your translation, write the exact symbol "|||" on a new line.
        RULE 4: Below "|||", extract 3 to 5 difficult words from the ORIGINAL text.
        RULE 5: Format EACH hard word EXACTLY like this: [Original Word from text] - [Meaning in ${lang}] (Part of Speech) other meaning- [Alternative meanings].
        Text to translate:\n${txt}`;
        
        let resObj = await callGeminiText("You are a strict translator.", prompt); 
        
        let parts = resObj.text.split('|||');
        let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed.";
        let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found.";
        let provider = resObj.provider;
        
        const tId = "trans_" + Date.now();
        const transBox = document.getElementById("translatedText"); transBox.style.position = "relative";
        transBox.innerHTML = `
            <div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div>
            <div id="${tId}" style="margin-top:10px;">${cleanText}</div>
            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; gap:10px; width:100%;">
                <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${tId}')">🔊 Listen</button>
                <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${tId}')">📋 Copy</button>
            </div>`; 
        document.getElementById("translatedTextStatus").style.display = "none"; 
        
        let hwDiv = document.getElementById("hardWords");
        if(!hwDiv) { document.getElementById("translatedText").insertAdjacentHTML('afterend', `<div class="cardTitle" style="margin-top: 20px;">Hard Words Meaning</div><div class="outputBox" id="hardWords">${hardWordsText.replace(/\n/g, '<br>')}</div>`); } 
        else { hwDiv.innerHTML = hardWordsText.replace(/\n/g, '<br>'); }
        saveToHistory('translation', txt, cleanText + "\n\nHard Words:\n" + hardWordsText, null, provider);
    }catch(e){ document.getElementById("translatedTextStatus").style.display = "none"; document.getElementById("translatedText").innerText = "❌ " + e.message; } 
}

function renderTransImagePreviews() {
    const container = document.getElementById("imagePreviewContainer"); if (!container) return;
    if (transImages.length === 0) { container.style.display = "none"; return; }
    container.style.display = "flex";
    container.innerHTML = transImages.map((img, index) => `
        <div class="image-preview-chip" style="display:block; position:relative; width:60px; height:60px; background-image:url(${img}); background-size:cover; border-radius:8px; flex-shrink:0;">
            <div class="image-preview-close" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; cursor:pointer; font-size:12px; line-height:20px; box-shadow:0 2px 5px rgba(0,0,0,0.5);" onclick="removeTransImage(${index}, event)">✕</div>
        </div>
    `).join('');
}

function removeTransImage(index, event) { if(event) event.stopPropagation(); transImages.splice(index, 1); renderTransImagePreviews(); }

async function executeImageTransFlow() {
    if (transImages.length === 0) return showToast("Please click ➕ to attach at least 1 image!");
    const targetLang = document.getElementById("chatTargetLang").value;
    
    const c = getActiveChatContainer("imageChatHistory");
    let imgsHtml = transImages.map(img => `<img src="${img}" class="bubble-img" onclick="viewPhotoFullscreen(this.src)" style="width:70px; height:70px; object-fit:cover; display:inline-block; margin-right:5px; border-radius:8px;">`).join('');
    
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-user"><div class="bubble">${imgsHtml}<div style="margin-top:8px;">Translate to <b>${targetLang}</b></div></div></div>`);
    scrollToBottom("imageScrollArea");
    
    let lId = appendAiLoading("imageChatHistory");
    window.toggleChatButton(true);

    let imagesToProcess = [...transImages];
    transImages = []; renderTransImagePreviews();
    
    try {
        let combinedText = "";
        for (let i = 0; i < imagesToProcess.length; i++) {
            const rObj = await callGeminiVision(imagesToProcess[i], MASTER_OCR_PROMPT);
            combinedText += rObj.text.replace(/[\*&#_]/g, '') + "\n\n";
        }
        combinedText = combinedText.trim();
        if (!combinedText || combinedText.toLowerCase().includes("no text found") || combinedText === "NO_TEXT_FOUND") throw new Error("Could not detect any text in the images.");

        let prompt = `You are a STRICT Language Translator.
        RULE 1: DO NOT answer any questions found in the text.
        RULE 2: ONLY TRANSLATE the text exactly into ${targetLang}. DO NOT USE ENGLISH UNLESS ENGLISH IS THE SELECTED TARGET LANGUAGE.
        RULE 3: After your translation, write the exact symbol "|||" on a new line.
        RULE 4: Below "|||", extract 3 to 5 difficult words from the ORIGINAL text.
        RULE 5: Format EACH hard word EXACTLY like this: [Original Word from text] - [Meaning in ${targetLang}] (Part of Speech) other meaning- [Alternative meanings].
        Text to translate:\n${combinedText}`;
        
        window.requestCache[lId] = { type: 'image_trans', prompt: prompt, extractedText: combinedText, targetLang: targetLang };

        let resObj = await callGeminiText("You are a strict translator.", prompt); 
        let parts = resObj.text.split('|||');
        let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed.";
        let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found.";
        let provider = resObj.provider;
        
        let finalHtml = `
            <div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div>
            <div style="margin-top:10px; font-size:12px; color:#cbd5e1; margin-bottom:5px; font-weight:600;">📄 Extracted Text:</div>
            <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; max-height:150px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1);">${combinedText.replace(/\n/g, '<br>')}</div>
            <div style="font-size:12px; color:#3b82f6; margin-bottom:5px; font-weight:600;">🌍 Translated to ${targetLang}:</div>
            <div id="trans_${lId}" style="font-size:15px;">${cleanText.replace(/\n/g, '<br>')}</div>
            <div style="font-size:12px; color:#a855f7; margin-top:15px; margin-bottom:5px; font-weight:600;">📖 Hard Words Dictionary:</div>
            <div style="background:rgba(168,85,247,0.1); padding:10px; border-radius:8px; font-size:14px; border:1px solid rgba(168,85,247,0.3);">${hardWordsText.replace(/\n/g, '<br>')}</div>
            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                <div style="display:flex; gap:10px; width:100%;">
                    <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('trans_${lId}')">🔊 Listen</button>
                    <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('trans_${lId}')">📋 Copy</button>
                </div>
                ${getRetryButtonsHtml(lId)}
            </div>
        `;
        
        const loadingBubble = document.getElementById(lId);
        if (loadingBubble) { loadingBubble.querySelector('.bubble').innerHTML = finalHtml; }
        saveToHistory('image_translation', `Translate to ${targetLang}:\n${combinedText}`, finalHtml, imagesToProcess[0], provider); 
        window.toggleChatButton(false);
        
    } catch(e) { 
        window.toggleChatButton(false);
        const el = document.getElementById(lId); 
        if(el) {
             if (e.name === 'AbortError') el.querySelector('.bubble').innerText = "⚠️ Stopped by user.";
             else el.querySelector('.bubble').innerText = "❌ Error: " + e.message; 
        }
    }
}

let qaSourceImages = []; let qaQuestionImage = null;

function renderQaSourcePreviews() {
    const count = document.getElementById("qaSourceCount"); if(count) count.innerText = qaSourceImages.length;
    const container = document.getElementById("qaSourcePreviews"); if(!container) return;
    container.innerHTML = qaSourceImages.map((img, i) => `
        <div class="image-preview-chip" style="display:block; position:relative; width:60px; height:60px; background-image:url(${img}); background-size:cover; border-radius:8px; flex-shrink:0;">
            <div class="image-preview-close" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; cursor:pointer; font-size:12px; line-height:20px; box-shadow:0 2px 5px rgba(0,0,0,0.5);" onclick="removeQaSource(${i}, event)">✕</div>
        </div>
    `).join('');
}
function removeQaSource(index, event) { if(event) event.stopPropagation(); qaSourceImages.splice(index, 1); renderQaSourcePreviews(); }

function renderQaQuestionPreview() {
    const container = document.getElementById("qaQuestionPreview"); if(!container) return;
    if(!qaQuestionImage) { container.innerHTML = ""; return; }
    container.innerHTML = `
        <div class="image-preview-chip" style="display:block; position:relative; width:80px; height:80px; background-image:url(${qaQuestionImage}); background-size:cover; border-radius:8px; flex-shrink:0;">
            <div class="image-preview-close" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; cursor:pointer; font-size:12px; line-height:20px; box-shadow:0 2px 5px rgba(0,0,0,0.5);" onclick="removeQaQuestion(event)">✕</div>
        </div>
    `;
}
function removeQaQuestion(event) { if(event) event.stopPropagation(); qaQuestionImage = null; renderQaQuestionPreview(); }

function clearQaSession() {
    qaSourceImages = []; qaQuestionImage = null; document.getElementById("qaQuestionInput").value = "";
    document.getElementById("qaAnswerBox").innerHTML = "Solution will appear here...";
    document.getElementById("qaProgressBar").style.width = "0%"; document.getElementById("qaStatusText").innerText = "Ready to start.";
    renderQaSourcePreviews(); renderQaQuestionPreview(); showToast("🔄 Session Reset");
}

async function executeQaFlow() {
    if (qaSourceImages.length === 0) return showToast("⚠️ Please add at least 1 source document image.");
    let typedQuestion = document.getElementById("qaQuestionInput").value.trim();
    if (!typedQuestion && !qaQuestionImage) return showToast("⚠️ Please type a question or take a photo of it.");
    
    const targetLang = document.getElementById("qaTargetLang").value;
    const statusTxt = document.getElementById("qaStatusText");
    const pBar = document.getElementById("qaProgressBar");
    const outBox = document.getElementById("qaAnswerBox");
    
    outBox.innerHTML = ""; pBar.style.width = "5%"; pBar.style.background = "#3b82f6";
    window.toggleChatButton(true);
    
    try {
        let extractedContext = "";
        for(let i=0; i<qaSourceImages.length; i++) {
            statusTxt.innerText = `Reading Source Page ${i+1} of ${qaSourceImages.length}...`; pBar.style.width = `${10 + ((i / qaSourceImages.length) * 40)}%`; 
            let rObj = await callGeminiVision(qaSourceImages[i], MASTER_OCR_PROMPT);
            extractedContext += `\n--- PAGE ${i+1} ---\n` + rObj.text.replace(/[\*&#_]/g, '');
        }
        
        let finalQuestion = typedQuestion;
        if (qaQuestionImage) {
            statusTxt.innerText = "Extracting Question from Image..."; pBar.style.width = "65%";
            let rObj = await callGeminiVision(qaQuestionImage, "Extract ONLY the question text exactly as written. Do not answer it.");
            let qText = rObj.text.replace(/[\*&#_]/g, '').trim();
            finalQuestion = typedQuestion ? `${typedQuestion}\n(Image Text: ${qText})` : qText;
        }
        
        statusTxt.innerText = `Solving... Generating answer in ${targetLang}`; pBar.style.width = "85%";
        
        let prompt = `You are an expert Document Assistant.
        DOCUMENT TEXT:\n${extractedContext}\n\nTARGET QUESTION(S) TO SOLVE:\n${finalQuestion}
        CRITICAL INSTRUCTIONS (FAILURE IS NOT AN OPTION):
        1. Answer ALL questions provided in the "TARGET QUESTION(S) TO SOLVE" section thoroughly. Do not skip any!
        2. Answer based ONLY on the Document Text provided. 
        3. You MUST write your entire answer strictly in ${targetLang}. 
        4. If ${targetLang} is Hindi, YOU MUST USE DEVANAGARI SCRIPT ONLY. DO NOT USE ENGLISH UNLESS ENGLISH IS SELECTED.
        5. If the answer cannot be found in the provided text, state that clearly.`;
        
        const qaId = "qa_ans_" + Date.now();
        window.requestCache[qaId] = { type: 'qa', prompt: prompt, targetLang: targetLang, finalQuestion: finalQuestion };

        let ansObj = await callGeminiText("You are a helpful document assistant.", prompt);
        let cleanAns = ansObj.text.replace(/[\*&#_]/g, ''); let provider = ansObj.provider;
        
        pBar.style.width = "100%"; statusTxt.innerText = "✅ Done!";
        
        outBox.style.position = "relative";
        outBox.innerHTML = `
            <div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div>
            <div style="margin-top:10px; font-size:13px; color:#93c5fd; margin-bottom:5px; font-weight:600;">Your Question:</div>
            <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; border:1px solid rgba(255,255,255,0.05);">${finalQuestion.replace(/\n/g, '<br>')}</div>
            <div style="font-size:13px; color:#22c55e; margin-bottom:5px; font-weight:600;">Answer (${targetLang}):</div>
            <div id="${qaId}" style="font-size:15px;">${cleanAns.replace(/\n/g, '<br>')}</div>
            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                <div style="display:flex; gap:10px; width:100%;">
                    <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${qaId}')">🔊 Listen</button>
                    <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${qaId}')">📋 Copy</button>
                </div>
                ${getRetryButtonsHtml(qaId)}
            </div>
        `;
        
        if (window.MathJax) { MathJax.typesetClear([outBox]); MathJax.typesetPromise([outBox]); }
        saveToHistory('qa', finalQuestion, outBox.innerHTML, qaSourceImages[0], provider);
        window.toggleChatButton(false);
        
    } catch(e) { 
        window.toggleChatButton(false);
        if (e.name === 'AbortError') {
             statusTxt.innerText = "⚠️ Stopped by user."; pBar.style.background = "#f59e0b";
        } else {
             statusTxt.innerText = "❌ Error Occurred"; pBar.style.background = "var(--red)"; outBox.innerHTML = "Error: " + e.message; 
        }
    }
}

async function generateTitleWithGroq(sessionId) {
    const item = appHistory.find(i => i.id === sessionId);
    if (!item || !item.interactions) return;
    
    const allQuestions = item.interactions.map(inter => inter.question).join(" | ");
    try {
        const res = await fetch("/api/groq-search", {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ prompt: "Create a highly concise, 2 to 4 word title summarizing the following user queries. Do not use quotes, punctuation, or any prefixes. Just give me the title text. Queries: " + allQuestions, providerOverride: "groq" })
        });
        const data = await checkHtmlError(res);
        if (data.text) { item.title = data.text.replace(/["'*]/g, '').trim(); saveHistorySafe(); if(document.getElementById('historyList')) renderHistory(); }
    } catch(e) { console.log("Groq title generation failed"); }
}

function saveHistorySafe() { try { localStorage.setItem('aiHistory', JSON.stringify(appHistory)); } catch(e) { appHistory.pop(); saveHistorySafe(); } }

function persistHistoryOnChatClose(reason = "page-close") {
    try { saveHistorySafe(); localStorage.setItem('aiHistoryLastCloseReason', reason); localStorage.setItem('aiHistoryLastCloseSavedAt', new Date().toISOString()); } 
    catch(e) { console.log("Close-safe history save failed", e); }
}

window.addEventListener('pagehide', () => persistHistoryOnChatClose('pagehide'));
window.addEventListener('beforeunload', () => persistHistoryOnChatClose('beforeunload'));

function saveToHistory(type, q, a, img = null, provider = "AI") { 
    fetch(GOOGLE_SHEETS_WEBHOOK, {
        method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, 
        body: JSON.stringify({ action: "log", type: type, question: q, answer: a.replace(/<[^>]*>?/gm, ''), provider: provider || "Gemini 1" })
    }).catch(e => console.log("Google Sheets sync failed."));

    let sessionId = sessionCache[type];
    let histItem = appHistory.find(i => i.id === sessionId);

    if (!histItem) {
        sessionId = Date.now(); sessionCache[type] = sessionId; 
        histItem = { id: sessionId, type: type, title: q.substring(0,25) + '...', interactions: [{ question: q, answer: a, image: img, provider: provider }], provider: provider, question: q, answer: a };
        appHistory.unshift(histItem);
    } else {
        histItem.interactions.push({ question: q, answer: a, image: img, provider: provider });
        histItem.question = q; histItem.answer = a; 
    }
    
    saveHistorySafe(); generateTitleWithGroq(sessionId); 
}

window.viewHistory = function(id) {
    const item = appHistory.find(i => i.id === id); if(!item) return;
    document.getElementById('histTitle').innerText = item.title;
    const qBox = document.getElementById('histQuestion'), aBox = document.getElementById('histAnswer');

    if (item.interactions) {
        qBox.innerHTML = item.interactions.map((interaction, i) => `<div style="margin-bottom:10px;"><b>[Q${i+1}]</b> ${interaction.question}</div>`).join('');
        aBox.innerHTML = item.interactions.map((interaction, i) => `<div style="margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;"><b>[A${i+1}]</b> ${interaction.answer}</div>`).join('');
    } else {
        qBox.innerHTML = item.question; aBox.innerHTML = item.answer;
    }
    
    const modal = document.getElementById('historyModal');
    if (modal) modal.classList.add('active');
    if(window.MathJax) { MathJax.typesetClear(); MathJax.typesetPromise(); }
};

window.closeHistory = function() { const modal = document.getElementById('historyModal'); if (modal) modal.classList.remove('active'); };

function renderHistory() { 
    const list = document.getElementById('historyList'); if(!list) return; 
    if(appHistory.length === 0) return list.innerHTML = "<div style='color:var(--muted);text-align:center;'>No history saved yet.</div>"; 
    list.innerHTML = appHistory.map(item => {
        const count = item.interactions ? item.interactions.length : 1;
        const msgText = count > 1 ? `${count} messages` : `1 message`;
        return `
        <div class="wordItem" style="display:flex; justify-content:space-between; align-items:center;">
            <div onclick="viewHistory(${item.id})" style="flex:1;">
                <div class="wordTitle">${item.title}</div>
                <div class="wordMeaning">${item.type.toUpperCase()} • <span style="color:#60a5fa">${msgText}</span></div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="actionBtnSmall green" onclick="restoreSession(event, ${item.id})" title="Restore">🔄</button>
                <button class="actionBtnSmall blue" onclick="quickDownload(event, ${item.id})" title="Download TXT">📥</button>
                <button class="actionBtnSmall red" onclick="deleteHistoryItem(event, ${item.id})" title="Delete">🗑️</button>
            </div>
        </div>`;
    }).join(''); 
}

function clearAllHistory() { if(confirm("⚠️ Are you sure you want to delete ALL saved history? This cannot be undone.")) { appHistory = []; saveHistorySafe(); renderHistory(); showToast("🗑️ All history has been cleared!"); } }
function deleteHistoryItem(e, id) { e.stopPropagation(); appHistory = appHistory.filter(i => i.id !== id); saveHistorySafe(); renderHistory(); showToast("Deleted successfully."); }
function cleanLatexForDownload(text) { return text.replace(/\\frac{([^}]+)}{([^}]+)}/g, '($1/$2)').replace(/\\times/g, 'x').replace(/\\%/g, '%').replace(/[\$\\]/g, '').replace(/&nbsp;/g, ' ').replace(/<br>/g, '\n'); }

function quickDownload(e, id) { e.stopPropagation(); const item = appHistory.find(i => i.id === id); if(item) triggerFileDownload(item); }
function triggerFileDownload(item) { 
    let content = `Chat Title: ${item.title}\n\n`;
    if (item.interactions) {
        item.interactions.forEach((inter, idx) => {
            let q = inter.question.replace(/<[^>]*>?/gm, ''); let a = cleanLatexForDownload(inter.answer.replace(/<[^>]*>?/gm, ''));
            content += `--- QUESTION ${idx+1} ---\n${q}\n\n--- ANSWER ${idx+1} ---\n${a}\n\n`;
        });
    } else {
        let q = item.question.replace(/<[^>]*>?/gm, ''); let a = cleanLatexForDownload(item.answer.replace(/<[^>]*>?/gm, '')); 
        content += `--- QUESTION ---\n${q}\n\n--- ANSWER ---\n${a}`;
    }
    const b = new Blob([content], { type: "text/plain;charset=utf-8" }); 
    const l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `AI_Chat_${item.title}.txt`; l.click(); 
    showToast("📥 Download started!");
}

function restoreSession(e, id) { 
    if(e) e.stopPropagation(); const item = appHistory.find(i => i.id == id); if(!item) return; 
    let targetPage = ''; 
    if(item.type === 'math') targetPage = 'maths.html'; else if(item.type === 'search') targetPage = 'search.html'; else if(item.type === 'translation') targetPage = 'translator.html'; else if(item.type === 'image_translation') targetPage = 'image.html'; else if(item.type === 'qa') targetPage = 'qa.html'; else if(item.type === 'create') targetPage = 'create.html';
    
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    if (currentPage !== targetPage && targetPage !== '') { window.location.href = `${targetPage}?restore=${id}`; return; }
    
    sessionCache[item.type] = item.id;
    const interactionsToRestore = item.interactions || [{ question: item.question, answer: item.answer, image: item.image, provider: item.provider }];

    if(item.type === 'math') { 
        let containerId = "mathChatHistory"; document.getElementById(containerId).innerHTML = ''; 
        interactionsToRestore.forEach(inter => {
            appendUserBubble(inter.question, inter.image, containerId); 
            let lId = appendAiLoading(containerId); updateAiBubble(lId, inter.answer, inter.provider || "AI", false);
        });
    } 
    else if (item.type === 'search') {
        let containerId = "searchChatHistory"; document.getElementById(containerId).innerHTML = ''; 
        interactionsToRestore.forEach(inter => {
            appendUserBubble(inter.question, inter.image, containerId); 
            let lId = appendAiLoading(containerId); const bbl = document.getElementById(lId).querySelector('.bubble');
            if (inter.answer.includes('<div')) { bbl.innerHTML = inter.answer; } 
            else {
                bbl.innerHTML = `
                    <div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${inter.provider || "AI"}</div>
                    <div id="search_${lId}" style="margin-top:10px;">${inter.answer.replace(/\n/g, '<br>')}</div>
                    <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;">
                        <div style="display:flex; gap:10px; width:100%;">
                            <button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button>
                            <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('search_${lId}')">📋 Copy</button>
                        </div>
                        ${getRetryButtonsHtml(lId)}
                    </div>`;
            }
        });
    } 
    else if (item.type === 'image_translation' && document.getElementById("imageChatHistory")) {
        let containerId = "imageChatHistory"; document.getElementById(containerId).innerHTML = ''; 
        interactionsToRestore.forEach(inter => {
            appendUserBubble(inter.question, inter.image, containerId); 
            let lId = appendAiLoading(containerId); const bbl = document.getElementById(lId).querySelector('.bubble');
            if (inter.answer.includes('<div')) { bbl.innerHTML = inter.answer; } else { bbl.innerHTML = `<div id="trans_${lId}">${inter.answer.replace(/\n/g, '<br>')}</div>`; }
        });
    } 
    else if (item.type === 'qa' && document.getElementById("qaAnswerBox")) {
        const lastInter = interactionsToRestore[interactionsToRestore.length - 1];
        document.getElementById("qaAnswerBox").innerHTML = lastInter.answer; document.getElementById("qaProgressBar").style.width = "100%"; document.getElementById("qaStatusText").innerText = "Restored from History";
    }
    showToast("🔄 Session Restored");
}

let currentStream = null, currentFacing = "environment";
async function startCamera() { try { if(currentStream) currentStream.getTracks().forEach(t => t.stop()); currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing, width: {ideal: 1920}, height: {ideal: 1080} } }); document.getElementById("cameraVideo").srcObject = currentStream; const track = currentStream.getVideoTracks()[0]; setTimeout(async () => { try { const cap = track.getCapabilities(); if (cap.torch && currentFacing === "environment") { isFlashOn = true; await track.applyConstraints({ advanced: [{ torch: true }] }); updateFlashUI(); } else { isFlashOn = false; updateFlashUI(); } } catch(err) {} }, 500); } catch(e) { alert("Camera Error."); } }
async function toggleFlash() { if (!currentStream) return; const track = currentStream.getVideoTracks()[0]; try { if (track.getCapabilities().torch) { isFlashOn = !isFlashOn; await track.applyConstraints({ advanced: [{ torch: isFlashOn }] }); updateFlashUI(); } } catch(err){} }
function updateFlashUI() { const btn = document.getElementById("toggleFlashBtn"); if(btn) { btn.innerText = isFlashOn ? "💡" : "🔦"; btn.style.background = isFlashOn ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"; } }
async function openCamera(m){ currentMode = m; const mod = document.getElementById("cameraModal"); if(mod) { mod.classList.add("active"); await startCamera(); } }
function closeCamera() { 
    const mod = document.getElementById("cameraModal"); 
    if (mod) mod.classList.remove("active"); 
    if (currentStream) {
        const track = currentStream.getVideoTracks()[0];
        try { if (track && track.getCapabilities && track.getCapabilities().torch) { track.applyConstraints({ advanced: [{ torch: false }] }); } } catch(err) { console.log("Torch off error:", err); }
        currentStream.getTracks().forEach(t => t.stop()); currentStream = null;
    }
    isFlashOn = false; updateFlashUI();
}
async function switchCamera() { currentFacing = currentFacing === "environment" ? "user" : "environment"; await startCamera(); }

if(document.getElementById('closeCameraBtn')) document.getElementById('closeCameraBtn').onclick = closeCamera;
if(document.getElementById('switchCameraBtn')) document.getElementById('switchCameraBtn').onclick = switchCamera;
if(document.getElementById('capturePhotoBtn')) document.getElementById('capturePhotoBtn').onclick = capturePhoto;
if(document.getElementById('toggleFlashBtn')) document.getElementById('toggleFlashBtn').onclick = toggleFlash;
if(document.getElementById('closePreviewBtn')) document.getElementById('closePreviewBtn').onclick = () => { document.getElementById('photoViewer').classList.remove('active'); };
if(document.getElementById('clearMathImgBtn')) document.getElementById('clearMathImgBtn').onclick = clearMathImage;
if(document.getElementById('openMathCameraBtn')) document.getElementById('openMathCameraBtn').onclick = () => openCamera('math');

function capturePhoto(){ 
    const v = document.getElementById("cameraVideo"), c = document.getElementById("captureCanvas");
    let w = v.videoWidth, h = v.videoHeight; if(w > 1500) { h *= 1500/w; w = 1500; } 
    c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h); capturedImage = c.toDataURL("image/jpeg", 0.7); 
    
    if (currentMode === 'math' || currentMode === 'search') { 
        const chip = document.getElementById("mathPreviewChip"); if(chip) { chip.style.display = "block"; chip.style.backgroundImage = `url(${capturedImage})`; } 
    }
    else if (currentMode === 'image_trans') {
        if(transImages.length >= 3) { showToast("Maximum 3 images allowed!"); } else { transImages.push(capturedImage); renderTransImagePreviews(); }
    }
    else if (currentMode === 'qa_source') {
        if(qaSourceImages.length >= 10) { showToast("Maximum 10 source images allowed!"); } else { qaSourceImages.push(capturedImage); renderQaSourcePreviews(); }
    }
    else if (currentMode === 'qa_question') { qaQuestionImage = capturedImage; renderQaQuestionPreview(); }
    closeCamera(); 
}

window.attachedPdfText = "";

window.handlePdfUpload = async function(event) {
    const file = event.target.files[0]; if (!file) return;
    if (file.type !== "application/pdf") return showToast("⚠️ Only PDF files are supported!");
    
    showToast("📄 Reading PDF... Please wait.");
    const fileReader = new FileReader();
    
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            let fullText = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += `\n--- Page ${i} ---\n` + pageText;
            }
            window.attachedPdfText = fullText;
            const chip = document.getElementById("pdfPreviewChip");
            if(chip) { chip.style.display = "flex"; document.getElementById("pdfName").innerText = file.name; }
            showToast(`✅ PDF Attached! (${pdf.numPages} pages)`);
        } catch(e) { showToast("❌ Error reading PDF: " + e.message); }
    };
    fileReader.readAsArrayBuffer(file);
};

window.clearPdfFile = function(e) {
    if(e) e.stopPropagation(); window.attachedPdfText = "";
    const inp = document.getElementById("pdfUploadInput"); if(inp) inp.value = "";
    const chip = document.getElementById("pdfPreviewChip"); if(chip) chip.style.display = "none";
};

// --- GLOBAL EXPORTS ---
window.toggleSidebar = toggleSidebar; window.openCamera = openCamera; window.closeCamera = closeCamera; window.switchCamera = switchCamera; window.capturePhoto = capturePhoto; window.clearMathImage = clearMathImage; window.executeMathFlow = executeMathFlow; window.speakAndHighlight = speakAndHighlight; window.initVideoGui = initVideoGui; window.exitVideoGui = exitVideoGui; window.cycleVideoSpeed = cycleVideoSpeed; window.toggleVideoPause = toggleVideoPause; window.replayVideo = replayVideo; window.toggleFlash = toggleFlash; window.runTranslation = runTranslation; window.toggleRecording = toggleRecording; window.runGroqSearch = runGroqSearch; window.deleteHistoryItem = deleteHistoryItem; window.quickDownload = quickDownload; window.restoreSession = restoreSession; window.copyToClipboard = copyToClipboard; window.clearAllHistory = clearAllHistory; window.showToast = showToast; window.viewPhotoFullscreen = viewPhotoFullscreen; window.updateVideoVolume = updateVideoVolume; window.toggleVideoFullscreen = toggleVideoFullscreen; window.removeTransImage = removeTransImage; window.executeImageTransFlow = executeImageTransFlow; window.removeQaSource = removeQaSource; window.removeQaQuestion = removeQaQuestion; window.clearQaSession = clearQaSession; window.executeQaFlow = executeQaFlow; window.retryRequest = retryRequest; window.handlePdfUpload = handlePdfUpload; window.clearPdfFile = clearPdfFile;
