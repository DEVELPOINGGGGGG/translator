/* =======================================================
   AI PRO SUITE - MAIN.JS (COMPLETE & UNCUT)
   ======================================================= */

let appHistory = [];
let visionReqs = parseInt(localStorage.getItem('visionReqs') || '0');
let textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false;
let capturedImage = null; // MASTER IMAGE VARIABLE
let currentMode = "";
let qaImages = [];
let transImages = [];
let qaContextText = "";
let isFlashOn = true;
window.latestMathSolution = "";
let availableVoices = [];
window.hasResetToday = false;

// 🟢 NEW VARIABLES ADDED FOR MISSING FEATURES 🟢
let qaSourceImages = [];
let qaQuestionImage = null;
const MASTER_OCR_PROMPT = "Extract all text from this image exactly as it appears. Do not translate or summarize.";

// Video Player Variables
let videoTickInterval = null;
let videoTotalEst = 0;
let videoElapsed = 0;
let isVideoPaused = false;
let videoLineIndex = 0;
let activeVideoUtterance = null;
let currentVideoVolume = 1;
let videoSpeed = 1;
let videoRunToken = 0;
let hideControlsTimer = null;

// TTS System
let speechSynth = window.speechSynthesis;
let activeUtterance = null;

window.currentAbortController = null;
window.currentTypingTimer = null;
window.isImageGenerationMode = false;

const GOOGLE_SHEETS_WEBHOOK = "https://script.google.com/macros/s/AKfycbz1_gv9M2QYJcWkkUQMlDtpBXajrV0psXXc9q68LZLJkZ0b_rokKsz6fyKcYzJ8R6Dsnw/exec";

window.requestCache = {};
let sessionCache = { math: null, search: null, translation: null, image_translation: null, qa: null };

// 🛑 DATABASE LOADER & MIRROR 🛑
if (typeof localforage !== 'undefined') {
    localforage.config({ name: 'AI_Pro_Suite', storeName: 'massive_chat_history' });
    localforage.getItem('aiHistory').then(function(savedData) {
        let mergedHistory = savedData ? savedData : [];
        let oldHistory = [];
        try { let oldData = localStorage.getItem('aiHistory'); if (oldData) oldHistory = JSON.parse(oldData); } catch(e) {}

        if (oldHistory.length > 0) {
            let existingIds = new Set(mergedHistory.map(item => item.id));
            oldHistory.forEach(item => { if (!existingIds.has(item.id)) mergedHistory.push(item); });
            mergedHistory.sort((a, b) => b.id - a.id);
            localforage.setItem('aiHistory', mergedHistory);
        }

        appHistory = mergedHistory;
        if (document.getElementById('historyList')) renderHistory();

        const urlParams = new URLSearchParams(window.location.search);
        const restoreId = urlParams.get('restore');
        if (restoreId) {
            setTimeout(() => restoreSession(null, restoreId), 150);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }).catch(e => console.log("Vault error:", e));
} else {
    try { appHistory = JSON.parse(localStorage.getItem('aiHistory') || '[]'); } catch(e) { appHistory = []; }
    setTimeout(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const restoreId = urlParams.get('restore');
        if (restoreId) {
            setTimeout(() => restoreSession(null, restoreId), 400);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, 100);
}

// 🟢 TTS, SESSION CONTEXT, AND MATH IMAGE MODE FUNCTIONS 🟢
window.loadVoices = function() {
    if (speechSynth) {
        availableVoices = speechSynth.getVoices();
        if (speechSynth.onvoiceschanged !== undefined) {
            speechSynth.onvoiceschanged = () => { availableVoices = speechSynth.getVoices(); };
        }
    }
};

window.speakAndHighlight = function(elementId) {
    if (!speechSynth) return showToast("TTS not supported.");
    let textEl = document.getElementById(elementId);
    let text = textEl ? textEl.innerText : "";
    if(!text) return;
    
    speechSynth.cancel();
    activeUtterance = new SpeechSynthesisUtterance(text);
    
    let isHindi = /[अ-ह]/.test(text);
    activeUtterance.lang = isHindi ? 'hi-IN' : 'en-US';
    
    let preferredVoice = availableVoices.find(v => v.lang === activeUtterance.lang && (v.name.includes('Google') || v.name.includes('Premium')));
    if (preferredVoice) activeUtterance.voice = preferredVoice;
    
    activeUtterance.onstart = () => { const p = document.getElementById('ttsMiniPlayer'); if(p) p.style.display = 'flex'; };
    activeUtterance.onend = () => { const p = document.getElementById('ttsMiniPlayer'); if(p) p.style.display = 'none'; };
    
    speechSynth.speak(activeUtterance);
};

window.toggleTtsPause = function() {
    const btn = document.getElementById('ttsPlayPauseBtn');
    if (speechSynth.paused) {
        speechSynth.resume();
        if(btn) btn.innerHTML = "⏸️";
    } else {
        speechSynth.pause();
        if(btn) btn.innerHTML = "▶️";
    }
};

window.closeTtsPlayer = function() {
    if(speechSynth) speechSynth.cancel();
    const p = document.getElementById('ttsMiniPlayer');
    if(p) p.style.display = 'none';
};

window.formatHindiSpeechText = function(text) { return text; };

window.getSessionContext = function(type) {
    let context = "";
    if(appHistory && appHistory.length > 0) {
        let session = appHistory.find(i => i.type === type);
        if(session && session.interactions) {
            let lastFew = session.interactions.slice(-3);
            lastFew.forEach(i => { context += `User: ${i.question}\nAI: ${i.answer}\n`; });
        }
    }
    return context ? `Previous Context:\n${context}\n` : "";
};

window.getLastContextImage = function(type) {
    if(appHistory && appHistory.length > 0) {
        let session = appHistory.find(i => i.type === type);
        if(session && session.interactions) {
            for(let i = session.interactions.length - 1; i >= 0; i--) {
                if(session.interactions[i].image) return session.interactions[i].image;
            }
        }
    }
    return null;
};

window.toggleImageModeBtn = function() {
    window.isImageGenerationMode = !window.isImageGenerationMode;
    const btn = document.getElementById("imgModeBtn");
    if(!btn) return;
    if(window.isImageGenerationMode) {
        btn.innerHTML = "🖼️ Image Mode ON";
        btn.style.background = "var(--primary)";
        btn.style.color = "white";
        showToast("Image Generation Mode Enabled");
    } else {
        btn.innerHTML = "🖼️ Image Mode";
        btn.style.background = "var(--input-bg)";
        btn.style.color = "var(--text-main)";
        showToast("Image Generation Mode Disabled");
    }
};

window.openImageModeViewer = function(imgSrc) {
    const modal = document.getElementById('imageModeModal');
    if(!modal) return;
    const paper = document.getElementById('imageModePaper');
    if(paper) paper.innerHTML = `<img src="${imgSrc}" style="max-width:100%;">`;
    modal.style.display = 'flex';
    setTimeout(() => modal.style.opacity = '1', 10);
};

window.closeImageMode = function() {
    const modal = document.getElementById('imageModeModal');
    if(modal) {
        modal.style.opacity = '0';
        setTimeout(() => modal.style.display = 'none', 300);
    }
};

window.downloadImageMode = function() {
    const img = document.querySelector('#imageModePaper img');
    if(img) {
        const link = document.createElement('a');
        link.download = 'AI_Math_Solution.png';
        link.href = img.src;
        link.click();
    }
};

// 🛑 INIT SCRIPT & TIMERS 🛑
document.addEventListener("DOMContentLoaded", () => {
    window.loadVoices();
    
    const ttsDiv = document.createElement('div');
    ttsDiv.id = 'ttsMiniPlayer';
    ttsDiv.className = 'tts-mini-player';
    ttsDiv.innerHTML = `
        <div style="font-size: 18px; filter: drop-shadow(0 0 5px #38bdf8);">🎧</div>
        <div class="tts-wave" id="ttsWave"><div class="tts-bar"></div><div class="tts-bar"></div><div class="tts-bar"></div><div class="tts-bar"></div></div>
        <button class="tts-btn play-pause" id="ttsPlayPauseBtn" onclick="toggleTtsPause()">⏸️</button>
        <button class="tts-btn stop" onclick="closeTtsPlayer()">⏹️</button>
    `;
    document.body.appendChild(ttsDiv);

    setInterval(() => {
        const now = new Date();
        const laTimeStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
        const laTime = new Date(laTimeStr);
        const currentPtDate = laTime.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
        const lastResetDate = localStorage.getItem('lastApiResetDatePT');
        
        const nextMidnight = new Date(laTime); nextMidnight.setHours(24, 0, 0, 0);
        let diffMs = nextMidnight - laTime;
        let h = Math.floor(diffMs / (1000 * 60 * 60)), m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)), s = Math.floor((diffMs % (1000 * 60)) / 1000);
        const pad = (num) => num.toString().padStart(2, '0');
        
        if (!lastResetDate) {
            localStorage.setItem('lastApiResetDatePT', currentPtDate); 
        } else if (currentPtDate !== lastResetDate) { 
            visionReqs = 0; textReqs = 0; 
            localStorage.setItem('visionReqs', '0'); localStorage.setItem('textReqs', '0'); 
            localStorage.setItem('lastApiResetDatePT', currentPtDate); 
            fetch(GOOGLE_SHEETS_WEBHOOK, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "reset" }) }).catch(e => console.log("Failed to wipe DB", e));
        }
        
        const t = document.getElementById('apiTimer'); if(t) t.innerText = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
        const elTotal = document.getElementById('apiTotal'); if(elTotal) elTotal.innerText = visionReqs + textReqs;
        const elVis = document.getElementById('apiVision'); if(elVis) elVis.innerText = visionReqs;
        const elTxt = document.getElementById('apiText'); if(elTxt) elTxt.innerText = textReqs;
    }, 1000);
    
    const inputs = [{id:"searchInput", fn:runGroqSearch}, {id:"mathInstructionInput", fn:executeMathFlow}];
    inputs.forEach(i => { const el = document.getElementById(i.id); if(el) el.addEventListener("keypress", (e) => { if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); i.fn(); } }); });
    if (document.getElementById('historyList') && typeof localforage === 'undefined') renderHistory();
});

// 🛑 UTILITIES & UI CONTROLS 🛑
function showToast(msg) {
    let t = document.createElement('div'); t.innerText = msg;
    t.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:linear-gradient(135deg, #3b82f6, #8b5cf6); color:white; padding:12px 25px; border-radius:30px; box-shadow:0 10px 25px rgba(0,0,0,0.5); z-index:10000; font-weight:600; font-size: 14px; text-align:center; animation:fadeInOut 3s forwards;";
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
    const sidebar = document.getElementById("sidebar"); const overlay = document.getElementById("overlay");
    if (!sidebar || !overlay) return;
    const active = !sidebar.classList.contains("active");
    sidebar.classList.toggle("active", active); overlay.classList.toggle("active", active); document.body.classList.toggle("sidebar-open", active);
}
if(document.getElementById("overlay")) document.getElementById("overlay").onclick = toggleSidebar;

function scrollToBottom(aid, force = true) {
    const scrollTargets = [];
    [aid, "mathScrollArea", "searchChatHistory", "imageScrollArea"].forEach(id => { if (id) { const el = document.getElementById(id); if (el) scrollTargets.push(el); } });
    const run = () => scrollTargets.forEach(a => { if (a) { a.scrollTop = a.scrollHeight; if (force && a.scrollTo) a.scrollTo({ top: a.scrollHeight, behavior: "auto" }); } });
    requestAnimationFrame(run); setTimeout(run, 40); setTimeout(run, 160);
}

window.toggleFocusMode = function(enable) {
    const topbar = document.getElementById('appTopbar'); const inputArea = document.querySelector('.chat-input-area'); const exitBtn = document.getElementById('exitFocusBtn'); const page = document.querySelector('.page');
    if (enable) {
        if(topbar) topbar.style.display = "none";
        if(inputArea) { inputArea.style.opacity = "0"; inputArea.style.pointerEvents = "none"; inputArea.style.transform = "translateY(20px)"; }
        exitBtn.style.display = "block"; setTimeout(() => exitBtn.style.opacity = "1", 10);
        if (page) page.style.paddingTop = "15px";
        if(typeof showToast === 'function') showToast("🎯 Focus Mode Activated!");
    } else {
        if(topbar) topbar.style.display = "flex";
        if(inputArea) { inputArea.style.opacity = "1"; inputArea.style.pointerEvents = "auto"; inputArea.style.transform = "translateY(0)"; }
        exitBtn.style.opacity = "0"; setTimeout(() => exitBtn.style.display = "none", 500);
        if (page) page.style.paddingTop = "105px";
        if(typeof showToast === 'function') showToast("UI Restored");
    }
};

window.appendUserBubble = function(text, img, containerId) {
    const historyDiv = document.getElementById(containerId); if (!historyDiv) return;
    const msgDiv = document.createElement("div"); msgDiv.className = "chat-msg chat-user";
    let escapedText = String(text || "").replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n');
    let contentHtml = `<div class="bubble" style="position:relative;">`;
    contentHtml += `<button onclick="navigator.clipboard.writeText('${escapedText}'); typeof showToast === 'function' ? showToast('✅ Copied!') : alert('Copied!');" style="position:absolute; top:-10px; right:-10px; background:var(--primary); color:white; border:2px solid var(--bg-surface); border-radius:50%; width:28px; height:28px; font-size:12px; cursor:pointer; box-shadow:0 4px 10px rgba(0,0,0,0.3); display:flex; justify-content:center; align-items:center; transition:0.2s;">📋</button>`;
    if (img) contentHtml += `<img src="${img}" class="bubble-img" onclick="viewPhotoFullscreen(this.src)" title="Click to expand" style="max-width:200px; border-radius:10px; margin-bottom:10px;"><br>`;
    contentHtml += `<div>${String(text || "").replace(/\n/g, '<br>')}</div></div>`;
    msgDiv.innerHTML = contentHtml; historyDiv.appendChild(msgDiv);
    scrollToBottom(containerId.replace('ChatHistory', 'ScrollArea'));
};

function appendAiLoading(cid) {
    const c = getActiveChatContainer(cid); if(!c) return null;
    const id = "loading_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-ai" id="${id}"><div class="bubble" style="display:flex; align-items:center; background:transparent; box-shadow:none; padding:0;"><div style="display:flex; gap:6px; padding:12px 20px; background:var(--input-bg); border:1px solid var(--border-light); border-radius:20px; box-shadow:0 4px 15px rgba(0,0,0,0.1);"><div style="width:10px; height:10px; background:var(--primary); border-radius:50%; animation:pulse 1s infinite alternate;"></div><div style="width:10px; height:10px; background:#f43f5e; border-radius:50%; animation:pulse 1s infinite alternate 0.2s;"></div><div style="width:10px; height:10px; background:#10b981; border-radius:50%; animation:pulse 1s infinite alternate 0.4s;"></div></div></div></div>`);
    scrollToBottom(cid.replace('ChatHistory', 'ScrollArea')); 
    return id;
}

window.toggleChatButton = function(isCancel) {
    const btnIds = ['sendMathBtn', 'sendSearchBtn', 'sendImageTransBtn']; let activeBtn = null;
    for (let id of btnIds) { const btn = document.getElementById(id); if (btn) activeBtn = btn; }
    if (!activeBtn) return;
    if (isCancel) {
        activeBtn.dataset.originalHtml = activeBtn.innerHTML; activeBtn.innerHTML = '⏹️'; 
        activeBtn.classList.add('cancel-mode'); activeBtn.classList.remove('send');
        activeBtn.dataset.originalOnclick = activeBtn.getAttribute('onclick');
        activeBtn.setAttribute('onclick', 'cancelActiveRequest()');
    } else {
        if(activeBtn.dataset.originalHtml) activeBtn.innerHTML = activeBtn.dataset.originalHtml;
        activeBtn.classList.remove('cancel-mode'); activeBtn.classList.add('send');
        if (activeBtn.dataset.originalOnclick) activeBtn.setAttribute('onclick', activeBtn.dataset.originalOnclick);
    }
};

window.cancelActiveRequest = function() {
    if (window.currentAbortController) { window.currentAbortController.abort(); window.currentAbortController = null; }
    if (window.currentTypingTimer) { clearInterval(window.currentTypingTimer); window.currentTypingTimer = null; }
    isProcessing = false; window.toggleChatButton(false); showToast("⚠️ Generation Stopped");
};

// 🛑 CAMERA ENGINE 🛑
let currentStream = null, currentFacing = "environment";

async function startCamera() { 
    try { 
        if(currentStream) currentStream.getTracks().forEach(t => t.stop()); 
        currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing, width: {ideal: 1920}, height: {ideal: 1080} } }); 
        document.getElementById("cameraVideo").srcObject = currentStream; const track = currentStream.getVideoTracks()[0]; 
        setTimeout(async () => { try { const cap = track.getCapabilities(); if (cap.torch && currentFacing === "environment") { isFlashOn = true; await track.applyConstraints({ advanced: [{ torch: true }] }); updateFlashUI(); } else { isFlashOn = false; updateFlashUI(); } } catch(err) {} }, 500); 
    } catch(e) { alert("Camera Error."); } 
}

async function toggleFlash() { if (!currentStream) return; const track = currentStream.getVideoTracks()[0]; try { if (track.getCapabilities().torch) { isFlashOn = !isFlashOn; await track.applyConstraints({ advanced: [{ torch: isFlashOn }] }); updateFlashUI(); } } catch(err){} }
function updateFlashUI() { const btn = document.getElementById("toggleFlashBtn"); if(btn) { btn.innerText = isFlashOn ? "💡" : "🔦"; btn.style.background = isFlashOn ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"; } }

async function openCamera(m){ currentMode = m; const mod = document.getElementById("cameraModal"); if(mod) { mod.classList.add("active"); await startCamera(); } }

function closeCamera() { 
    const mod = document.getElementById("cameraModal"); if (mod) mod.classList.remove("active"); 
    if (currentStream) { const track = currentStream.getVideoTracks()[0]; try { if (track && track.getCapabilities && track.getCapabilities().torch) { track.applyConstraints({ advanced: [{ torch: false }] }); } } catch(err) {} currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    isFlashOn = false; updateFlashUI();
}

async function switchCamera() { currentFacing = currentFacing === "environment" ? "user" : "environment"; await startCamera(); }

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

function clearMathImage(e) { if(e) e.stopPropagation(); capturedImage = null; const chip = document.getElementById("mathPreviewChip"); if(chip) { chip.style.display = "none"; chip.style.backgroundImage = "none"; } }

// 🛑 API COMMUNICATION ENGINE 🛑
async function checkHtmlError(r) {
    const contentType = r.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) throw new Error("⚠️ Server Connection Error: Your backend server is asleep. Wait 30s and try again!");
    return await r.json();
}

async function callGeminiText(sysText, usrText, override = null) {
  if (isProcessing) throw new Error("Processing..."); isProcessing = true; track('t'); window.currentAbortController = new AbortController();
  try { 
      const r = await fetch("/api/gemini-text", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ systemPrompt: sysText, userPrompt: usrText, providerOverride: override }), signal: window.currentAbortController.signal }); 
      const d = await checkHtmlError(r); if(!r.ok) throw new Error(d.error || "All API keys failed."); 
      isProcessing = false; window.currentAbortController = null; return d; 
  } catch(e) { isProcessing = false; window.currentAbortController = null; throw e; }
}

async function callGeminiVision(imgData, aiQuery, override = null) {
  if (isProcessing) throw new Error("Processing..."); isProcessing = true; track('v'); window.currentAbortController = new AbortController();
  try { 
      const r = await fetch("/api/gemini-vision", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ imageBase64: imgData, userPrompt: aiQuery, providerOverride: override }), signal: window.currentAbortController.signal }); 
      const d = await checkHtmlError(r); if(!r.ok) throw new Error(d.error); 
      isProcessing = false; window.currentAbortController = null; return d; 
  } catch(e) { isProcessing = false; window.currentAbortController = null; throw e; }
}

function getRetryButtonsHtml(lId) {
    return `
    <div style="display:flex; gap:8px; flex-wrap:wrap; background:rgba(0,0,0,0.2); padding:10px; border-radius:15px; border:1px solid rgba(255,255,255,0.05); width:100%; align-items:center; justify-content:flex-start;">
        <span style="font-size:11px; color:var(--muted); width:100%; margin-bottom:2px;">Retry Model:</span>
        <button style="flex:1 1 auto; min-width:80px; background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid #3b82f6; padding:8px 12px; border-radius:12px; font-size:11px; cursor:pointer;" onclick="retryRequest('${lId}', 'gemini')">Gemini</button>
        <button style="flex:1 1 auto; min-width:80px; background:rgba(245,158,11,0.1); color:#f59e0b; border:1px solid #f59e0b; padding:8px 12px; border-radius:12px; font-size:11px; cursor:pointer;" onclick="retryRequest('${lId}', 'cloudflare')">Cloudflare</button>
        <button style="flex:1 1 auto; min-width:80px; background:rgba(16,185,129,0.1); color:#10b981; border:1px solid #10b981; padding:8px 12px; border-radius:12px; font-size:11px; cursor:pointer;" onclick="retryRequest('${lId}', 'groq')">Groq</button>
    </div>`;
}

function typeWriteResponse(containerEl, rawText, provider, contentId, buttonsHtml, isMath, onComplete) {
    containerEl.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div id="${contentId}" style="margin-top:10px;"></div>`;
    const txtEl = document.getElementById(contentId);
    
    const chars = rawText.length || 1;
    let tickRate = Math.floor(10000 / chars);
    let charsPerTick = 1;
    
    if (tickRate > 35) { tickRate = 35; } 
    else if (tickRate < 20) { tickRate = 20; charsPerTick = Math.ceil(chars / (10000 / 20)); }
    
    let i = 0; let currentHtml = ""; let needsMathRender = false;

    window.currentTypingTimer = setInterval(() => {
        if (i < rawText.length) {
            let chunk = ""; needsMathRender = false;

            for (let j = 0; j < charsPerTick && i < rawText.length; j++) {
                if (rawText[i] === '<') { let tagEnd = rawText.indexOf('>', i); if (tagEnd !== -1) { chunk += rawText.substring(i, tagEnd + 1); i = tagEnd + 1; } else { chunk += rawText[i]; i++; } } 
                else if (rawText.substring(i, i + 2) === '$$') { let mathEnd = rawText.indexOf('$$', i + 2); if (mathEnd !== -1) { chunk += rawText.substring(i, mathEnd + 2); i = mathEnd + 2; needsMathRender = true; } else { chunk += rawText[i]; i++; } }
                else if (rawText.substring(i, i + 2) === '\\(') { let mathEnd = rawText.indexOf('\\)', i + 2); if (mathEnd !== -1) { chunk += rawText.substring(i, mathEnd + 2); i = mathEnd + 2; needsMathRender = true; } else { chunk += rawText[i]; i++; } } 
                else { chunk += rawText[i]; i++; }
            }
            currentHtml += chunk; txtEl.innerHTML = currentHtml.replace(/\n/g, '<br>');
            if (needsMathRender && isMath && window.MathJax) { MathJax.typesetClear([txtEl]); MathJax.typesetPromise([txtEl]).catch(err => console.log(err)); }
        } else {
            clearInterval(window.currentTypingTimer); window.currentTypingTimer = null;
            if (isMath && window.MathJax) { MathJax.typesetClear([containerEl]); MathJax.typesetPromise([containerEl]).catch(e => console.log(e)); }
            containerEl.insertAdjacentHTML('beforeend', buttonsHtml);
            if (onComplete) onComplete(); window.toggleChatButton(false);
        }
    }, tickRate);
}

function updateAiBubble(lId, answer, provider = "AI", useTyping = true) {
    const loadingBubble = document.getElementById(lId); if (!loadingBubble) return;
    const bbl = loadingBubble.querySelector('.bubble'); window.latestMathSolution = answer; 
    
    const buttons = `<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('text_${lId}')">🔊 Listen</button><button class="btn blue" style="padding:10px; flex:1; font-size:13px; border-radius:20px; background:linear-gradient(135deg, #f43f5e, #be123c);" onclick="initVideoGui()">▶️ Tutor</button><button class="btn" style="padding:10px; flex:0.5; font-size:13px; border-radius:20px; background:#475569; color:white;" onclick="copyToClipboard('text_${lId}')">📋</button></div>${getRetryButtonsHtml(lId)}</div>`;
    
    if (useTyping) { typeWriteResponse(bbl, answer, provider, `text_${lId}`, buttons, true); } 
    else { bbl.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div id="text_${lId}" style="margin-top:10px;">${answer.replace(/\n/g, '<br>')}</div>${buttons}`; if (window.MathJax) { MathJax.typesetClear([bbl]); MathJax.typesetPromise([bbl]); } window.toggleChatButton(false); }
}

async function retryRequest(lId, targetProvider) {
    const req = window.requestCache[lId]; if(!req) return showToast("Request data expired.");
    
    let container;
    if (req.type === 'qa') { container = document.getElementById("qaAnswerBox"); document.getElementById("qaStatusText").innerText = `Retrying with ${targetProvider.toUpperCase()}...`; document.getElementById("qaProgressBar").style.width = "85%"; } 
    else { container = document.getElementById(lId)?.querySelector('.bubble'); }
    
    if(!container) return;
    container.innerHTML = `<div class="spinner"></div> Retrying with ${targetProvider.toUpperCase()}...`; window.toggleChatButton(true);
    
    try {
        if (req.type === 'math') {
            let resObj = req.image ? await callGeminiVision(req.image, req.prompt, targetProvider) : await callGeminiText(req.sysPrompt, req.prompt, targetProvider);
            let cleanSol = resObj.text.replace(/[\*&#_]/g, ''); saveToHistory('math', req.prompt.substring(0, 100) + " (Retry)", cleanSol, req.image, resObj.provider); updateAiBubble(lId, cleanSol, resObj.provider, true);
        }
        else if (req.type === 'search') {
            let resObj;
            if (req.image) { resObj = await callGeminiVision(req.image, req.prompt, targetProvider); } 
            else { track('t'); window.currentAbortController = new AbortController(); if(targetProvider === "gemini") { resObj = await callGeminiText("Act as an Internet Search Engine.", req.prompt, "gemini"); } else { const res = await fetch("/api/groq-search", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ prompt: req.originalSearch, providerOverride: targetProvider }), signal: window.currentAbortController.signal }); resObj = await checkHtmlError(res); if(!resObj.text) throw new Error(resObj.error || "Search failed"); window.currentAbortController = null; } }
            let ans = resObj.text.replace(/[\*&#_]/g, ''); saveToHistory('search', req.originalSearch + " (Retry)", ans, req.image, resObj.provider || targetProvider);
            const buttons = `<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('search_${lId}')">📋 Copy</button></div>${getRetryButtonsHtml(lId)}</div>`; typeWriteResponse(container, ans, resObj.provider || targetProvider, `search_${lId}`, buttons, false);
        }
        else if (req.type === 'image_trans') {
            let resObj = await callGeminiText("You are a strict translator.", req.prompt, targetProvider); 
            let parts = resObj.text.split('|||'); let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed."; let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found.";
            saveToHistory('image_translation', `Translate to ${req.targetLang} (Retry)`, cleanText + "\n\nHard Words:\n" + hardWordsText, null, resObj.provider);
            container.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${resObj.provider}</div><div style="margin-top:10px; font-size:12px; color:#cbd5e1; margin-bottom:5px; font-weight:600;">📄 Extracted Text:</div><div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; max-height:150px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1);">${req.extractedText.replace(/\n/g, '<br>')}</div><div style="font-size:12px; color:#3b82f6; margin-bottom:5px; font-weight:600;">🌍 Translated to ${req.targetLang}:</div><div id="trans_${lId}" style="font-size:15px;">${cleanText.replace(/\n/g, '<br>')}</div><div style="font-size:12px; color:#a855f7; margin-top:15px; margin-bottom:5px; font-weight:600;">📖 Hard Words Dictionary:</div><div style="background:rgba(168,85,247,0.1); padding:10px; border-radius:8px; font-size:14px; border:1px solid rgba(168,85,247,0.3);">${hardWordsText.replace(/\n/g, '<br>')}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('trans_${lId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('trans_${lId}')">📋 Copy</button></div>${getRetryButtonsHtml(lId)}</div>`; window.toggleChatButton(false);
        }
        else if (req.type === 'qa') {
            let ansObj = await callGeminiText("You are a helpful document assistant.", req.prompt, targetProvider);
            let cleanAns = ansObj.text.replace(/[\*&#_]/g, ''); document.getElementById("qaProgressBar").style.width = "100%"; document.getElementById("qaStatusText").innerText = "✅ Done!";
            saveToHistory('qa', req.finalQuestion + " (Retry)", cleanAns, null, ansObj.provider);
            container.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${ansObj.provider}</div><div style="margin-top:10px; font-size:13px; color:#93c5fd; margin-bottom:5px; font-weight:600;">Your Question:</div><div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; border:1px solid rgba(255,255,255,0.05);">${req.finalQuestion.replace(/\n/g, '<br>')}</div><div style="font-size:13px; color:#22c55e; margin-bottom:5px; font-weight:600;">Answer:</div><div id="${lId}" style="font-size:15px;">${cleanAns.replace(/\n/g, '<br>')}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${lId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${lId}')">📋 Copy</button></div>${getRetryButtonsHtml(lId)}</div>`;
            if (window.MathJax) { MathJax.typesetClear([container]); MathJax.typesetPromise([container]); } window.toggleChatButton(false);
        }
    } catch(e) { 
        window.toggleChatButton(false);
        if(req.type === 'qa') { document.getElementById("qaStatusText").innerText = "❌ Error Occurred"; document.getElementById("qaProgressBar").style.background = "var(--red)"; container.innerHTML = "Error: " + e.message; } 
        else { container.innerText = "❌ Error: " + e.message; }
    }
}

// 🛑 MATH SOLVER 🛑
window.showGeneratedImageGUI = function(src) {
    let modal = document.getElementById('genImageModal');
    if (!modal) {
        modal = document.createElement('div'); modal.id = 'genImageModal'; modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:9999999; display:flex; flex-direction:column; align-items:center; justify-content:center; opacity:0; transition:opacity 0.3s;";
        modal.innerHTML = `<div style="position:absolute; top:20px; right:20px; display:flex; gap:15px; z-index:100;"><button id="genImgDownloadBtn" style="background:#3b82f6; color:white; border:2px solid white; padding:8px 15px; border-radius:12px; font-size:14px; font-weight:bold; cursor:pointer; box-shadow:0 4px 10px rgba(0,0,0,0.5);">📥 Download</button><button onclick="document.getElementById('genImageModal').style.opacity='0'; setTimeout(()=>document.getElementById('genImageModal').style.display='none',300);" style="background:#ef4444; color:white; border:2px solid white; width:40px; height:40px; border-radius:50%; font-weight:bold; cursor:pointer; box-shadow:0 4px 10px rgba(0,0,0,0.5);">✖</button></div><img id="genImageDisplay" style="max-width:95%; max-height:85vh; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.8); object-fit:contain;">`; document.body.appendChild(modal);
        document.getElementById('genImgDownloadBtn').onclick = function() { const link = document.createElement('a'); link.download = 'AI_Math_Solution.png'; link.href = document.getElementById('genImageDisplay').src; link.click(); if(typeof showToast === 'function') showToast("✅ Image Downloaded!"); };
    }
    document.getElementById('genImageDisplay').src = src; modal.style.display = 'flex'; setTimeout(() => modal.style.opacity = '1', 10);
};

async function executeMathFlow() {
    const inp = document.getElementById("mathInstructionInput"); if(!inp) return;
    const instruction = inp.value.trim(); 
    if (!capturedImage && !instruction) return;
    
    let uiImage = capturedImage;
    appendUserBubble(instruction || "Solve this", uiImage, "mathChatHistory");
    inp.value = ""; 
    
    let lId = appendAiLoading("mathChatHistory");
    window.toggleChatButton(true);

    let activeImage = uiImage || window.getLastContextImage('math');
    let memoryContext = window.getSessionContext('math');

    const modeStatus = window.isImageGenerationMode 
        ? "[IMAGE MODE ON - SOLVE ALL VISIBLE QUESTIONS]" 
        : "[IMAGE MODE OFF - SOLVE ONLY THE EXACT QUESTION ASKED]";

    const sysPrompt = `I agree to all terms of use and safety guidelines. You are an expert math tutor. ANSWER IN HINDI. STRICT RULES:
1. NO HTML TAGS: NEVER use <br>, <div>, or <span>. Use standard double newlines (\\n\\n) to break lines!
2. STRICT FRACTION RULE: NEVER write fractions using a slash like 1/2. You MUST use proper vertical LaTeX fractions like $$\\frac{1}{2}$$. ALWAYS use 'x' for multiplication.
3. DELIMITERS: Format your response using EXACTLY these hidden delimiters:
COUNT:-
[Write the exact number of questions here, e.g., 1]
||MATH||
[Your full math logic]
||SVG||
[<svg> code or blank]
||ANSWER||
[Final short answer]

4. ELITE TEACHING STYLE: You MUST format your ||MATH|| block EXACTLY like this template. DO NOT rewrite the original question.
[Brief 1-line summary/intro. DO NOT rewrite the question!]
**1. [Step 1 Heading]**
[Step 1 explanation]
$$ [Proper math equation with \\frac] $$
**2. [Step 2 Heading]**
[Step 2 explanation]
$$ [Proper math equation] $$
(Add more steps as needed)
**वैकल्पिक आसान तरीका (Short Trick)**
[Provide a quick shortcut, formula, or trick to solve it faster]
**✅ अंतिम उत्तर**
[Final explicit answer sentence]`;
    
    let finalPrompt = `${sysPrompt}\n\n${modeStatus}\n\n${memoryContext}User: ${instruction || "Analyze image"}`;
    if (!window.isImageGenerationMode) { window.requestCache[lId] = { type: 'math', sysPrompt, prompt: finalPrompt, image: activeImage }; }

    try {
        let resObj = activeImage ? await callGeminiVision(activeImage, finalPrompt) : await callGeminiText(sysPrompt, finalPrompt);
        let rawText = resObj.text;
        
        let qCount = 1;
        if (rawText.includes("COUNT:-")) { let topPart = rawText.split("COUNT:-")[1]; if (topPart) qCount = parseInt(topPart.split("||MATH||")[0].trim()) || 1; }

        let mathBlock = rawText; let svgBlock = ""; let finalAnswerBlock = "";
        if (rawText.includes("||MATH||")) { let parts = rawText.split("||MATH||")[1] || rawText; let svgSplit = parts.split("||SVG||"); mathBlock = svgSplit[0].trim(); if (svgSplit.length > 1) { let ansSplit = svgSplit[1].split("||ANSWER||"); svgBlock = ansSplit[0].trim(); if (ansSplit.length > 1) finalAnswerBlock = ansSplit[1].trim(); } }
        mathBlock = mathBlock.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').trim(); 

        clearMathImage(); let generatedImgHtml = "";
        let generateStandaloneShape = (!window.isImageGenerationMode && svgBlock.length > 10);
        let warningText = "";
        if (generateStandaloneShape && qCount > 1) { generateStandaloneShape = false; warningText = "\n\n<small style='color:#ef4444; font-weight:bold;'>⚠️ Multiple questions detected. Diagram disabled.</small>"; }

        if (window.isImageGenerationMode || generateStandaloneShape) {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            let bgColor = isDark ? '#0f172a' : '#fdfbf7'; let textColor = isDark ? '#f8fafc' : '#0f172a'; let primaryColor = isDark ? '#8b5cf6' : '#3b82f6';
            const offscreen = document.createElement('div'); offscreen.style.position = 'fixed'; offscreen.style.top = '0'; offscreen.style.left = '0'; offscreen.style.width = '750px'; offscreen.style.zIndex = '-9999'; 

            if (generateStandaloneShape) { offscreen.innerHTML = `<div style="background-color:${bgColor}; color:${textColor}; padding:40px; display:flex; flex-direction:column; align-items:center; justify-content:center; border: 4px solid ${primaryColor}; border-radius: 15px;">${svgBlock}${finalAnswerBlock ? `<div style="margin-top:25px; font-size:26px; font-weight:900; padding:12px 25px; background:rgba(59,130,246,0.1); border-radius:12px; border:2px solid ${primaryColor};">ANSWER = ${finalAnswerBlock}</div>` : ''}</div>`; } 
            else if (window.isImageGenerationMode) { offscreen.innerHTML = `<div style="background-color:${bgColor}; line-height:35px; padding:40px; position:relative; font-family:'Kalam', sans-serif; font-size:20px; color:${textColor}; border: 4px solid ${primaryColor}; border-radius: 15px; box-sizing: border-box; width:100%; white-space: pre-wrap; word-wrap: break-word;"><div style="width:100%; display:block;">${mathBlock}</div>${svgBlock ? `<div style="margin-top:30px; display:flex; justify-content:center; width:100%;">${svgBlock}</div>` : ''}</div>`; }
            
            document.body.appendChild(offscreen);
            if (window.MathJax) { MathJax.typesetClear([offscreen]); await MathJax.typesetPromise([offscreen]); const assistiveElements = offscreen.querySelectorAll('mjx-assistive-mml'); assistiveElements.forEach(el => el.remove()); }

            try { const canvas = await html2canvas(offscreen, { scale: 2, useCORS: true, backgroundColor: bgColor, windowWidth: 800 }); const base64Img = canvas.toDataURL("image/png"); generatedImgHtml = `<div style="position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:10px; margin-bottom:15px; width:100%;"><div style="position:absolute; top:-12px; right:5px; font-size:10px; color:white; background:var(--primary); padding:3px 10px; border-radius:10px; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.5); z-index:10;">✨ ${resObj.provider}</div><img src="${base64Img}" style="width:100%; max-width:450px; height:auto; object-fit:contain; border-radius:12px; border:2px solid var(--primary); cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.2); transition:transform 0.2s;" onclick="showGeneratedImageGUI(this.src)"></div>`; } catch (err) { console.error("Render Error:", err); } finally { offscreen.remove(); }
        }

        let finalOutputText = mathBlock + warningText;

        if (window.isImageGenerationMode) {
            const loadingBubble = document.getElementById(lId);
            if (loadingBubble && generatedImgHtml) { loadingBubble.querySelector('.bubble').innerHTML = `<div style="display:flex; justify-content:flex-end; margin-bottom:5px;"><span style="font-size:10px; color:var(--text-muted); font-weight:bold; background:var(--bg-surface); padding:4px 8px; border-radius:8px; white-space:nowrap; border: 1px solid var(--border-light);">✨ IMAGE MODE • ${resObj.provider}</span></div>${generatedImgHtml}<br><button class="btn blue" style="width:100%;" onclick="openImageModeViewer(latestMathSolution)">🔍 Open Full Image Viewer</button>`; }
            saveToHistory('math', instruction || "Analyze image", generatedImgHtml, uiImage, resObj.provider);
        } else {
            saveToHistory('math', instruction || "Analyze image", finalOutputText, uiImage, resObj.provider); 
            updateAiBubble(lId, finalOutputText, resObj.provider, true); 
            if (generatedImgHtml) { const bbl = document.getElementById(lId)?.querySelector('.bubble'); if (bbl) bbl.insertAdjacentHTML('afterbegin', generatedImgHtml); }
        }
    } catch(e) { window.toggleChatButton(false); const el = document.getElementById(lId); if(el) { el.querySelector('.bubble').innerText = e.name === 'AbortError' ? "⚠️ Stopped by user." : "❌ Error: " + e.message; } }
}

// 🛑 GROQ SEARCH 🛑
async function runGroqSearch() {
    const inp = document.getElementById("searchInput"); if(!inp) return;
    const q = inp.value.trim(); if(!q && !capturedImage && !window.attachedPdfText) return;
    
    let uiImage = capturedImage;
    let displayQ = q || (window.attachedPdfText ? "Analyze this document." : "Analyze this image.");
    if(window.attachedPdfText) displayQ = "📄 [PDF Attached]\n" + displayQ;
    
    appendUserBubble(displayQ, uiImage, "searchChatHistory"); 
    inp.value = ""; let lId = appendAiLoading("searchChatHistory"); window.toggleChatButton(true);
    
    let activeImage = uiImage || window.getLastContextImage('search');
    let memoryContext = window.getSessionContext('search');
    let sysPrompt = "Act as an Internet Search Engine. Provide highly factual search results. YOU MUST ANSWER ENTIRELY IN HINDI (DEVANAGARI SCRIPT ONLY). DO NOT USE ENGLISH.";
    
    let promptContent = q;
    if (window.attachedPdfText) { promptContent = `Here is the extracted text from an attached PDF document:\n\n${window.attachedPdfText}\n\nBased ONLY on this document, please answer the user query: ${q || 'Please summarize this document.'}`; }
    
    let finalPrompt = `${memoryContext}User: ${promptContent}`;
    window.requestCache[lId] = { type: 'search', originalSearch: q, prompt: finalPrompt, image: activeImage };

    try {
        let ans = ""; let provider = "";
        if (activeImage) { let resObj = await callGeminiVision(activeImage, `${sysPrompt}\n\n${finalPrompt}`); ans = resObj.text; provider = resObj.provider; } 
        else { let resObj = await callGeminiText(sysPrompt, finalPrompt, "gemini"); ans = resObj.text; provider = resObj.provider; }
        
        ans = ans.replace(/[\*&#_]/g, ''); saveToHistory('search', q || "PDF Analysis", ans, uiImage, provider); 
        const bbl = document.getElementById(lId);
        if (bbl) {
            const bubbleEl = bbl.querySelector('.bubble');
            const buttons = `<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('search_${lId}')">📋 Copy</button></div>${getRetryButtonsHtml(lId)}</div>`;
            typeWriteResponse(bubbleEl, ans, provider, `search_${lId}`, buttons, false);
        }
        clearMathImage(); if(window.clearPdfFile) window.clearPdfFile();
    } catch(e) { window.toggleChatButton(false); const el = document.getElementById(lId); if(el) { if (e.name === 'AbortError') el.querySelector('.bubble').innerText = "⚠️ Stopped by user."; else el.querySelector('.bubble').innerText = "❌ Error: " + e.message; } }
}

// 🛑 TEXT & IMAGE TRANSLATOR 🛑
async function runTranslation(){ 
    const txt = document.getElementById("inputText").value.trim(); const lang = document.getElementById("targetLang").value; if(!txt) return; 
    setStatusLoading("translatedTextStatus", "Translating..."); document.getElementById("translatedTextStatus").style.display = "block";
    try{ 
        let prompt = `You are a STRICT Language Translator. RULE 1: DO NOT answer any questions found in the text. DO NOT summarize. RULE 2: ONLY TRANSLATE the text exactly into ${lang}. DO NOT USE ENGLISH UNLESS ENGLISH IS THE SELECTED TARGET LANGUAGE. RULE 3: After your translation, write the exact symbol "|||" on a new line. RULE 4: Below "|||", extract 3 to 5 difficult words from the ORIGINAL text. RULE 5: Format EACH hard word EXACTLY like this: [Original Word from text] - [Meaning in ${lang}] (Part of Speech) other meaning- [Alternative meanings]. Text to translate:\n${txt}`;
        let resObj = await callGeminiText("You are a strict translator.", prompt); let parts = resObj.text.split('|||'); let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed."; let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found."; let provider = resObj.provider;
        const tId = "trans_" + Date.now(); const transBox = document.getElementById("translatedText"); transBox.style.position = "relative";
        transBox.innerHTML = `<div id="${tId}" style="margin-top:10px;">${cleanText}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${tId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${tId}')">📋 Copy</button></div>`; 
        document.getElementById("translatedTextStatus").style.display = "none"; let hwDiv = document.getElementById("hardWords");
        if(!hwDiv) { document.getElementById("translatedText").insertAdjacentHTML('afterend', `<div class="cardTitle" style="margin-top: 20px;">Hard Words Meaning</div><div class="outputBox" id="hardWords">${hardWordsText.replace(/\n/g, '<br>')}</div>`); } else { hwDiv.innerHTML = hardWordsText.replace(/\n/g, '<br>'); }
        saveToHistory('translation', txt, cleanText + "\n\nHard Words:\n" + hardWordsText, null, provider);
    }catch(e){ document.getElementById("translatedTextStatus").style.display = "none"; document.getElementById("translatedText").innerText = "❌ " + e.message; } 
}

function renderTransImagePreviews() { const container = document.getElementById("imagePreviewContainer"); if (!container) return; if (transImages.length === 0) { container.style.display = "none"; return; } container.style.display = "flex"; container.innerHTML = transImages.map((img, index) => `<div class="image-preview-chip" style="display:block; position:relative; width:60px; height:60px; background-image:url(${img}); background-size:cover; border-radius:8px; flex-shrink:0;"><div class="image-preview-close" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; cursor:pointer; font-size:12px; line-height:20px; box-shadow:0 2px 5px rgba(0,0,0,0.5);" onclick="removeTransImage(${index}, event)">✕</div></div>`).join(''); }
function removeTransImage(index, event) { if(event) event.stopPropagation(); transImages.splice(index, 1); renderTransImagePreviews(); }

async function executeImageTransFlow() {
    if (transImages.length === 0) return showToast("Please click ➕ to attach at least 1 image!");
    const targetLang = document.getElementById("chatTargetLang").value;
    const c = getActiveChatContainer("imageChatHistory");
    let imgsHtml = transImages.map(img => `<img src="${img}" class="bubble-img" onclick="viewPhotoFullscreen(this.src)" style="width:70px; height:70px; object-fit:cover; display:inline-block; margin-right:5px; border-radius:8px;">`).join('');
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-user"><div class="bubble">${imgsHtml}<div style="margin-top:8px;">Translate to <b>${targetLang}</b></div></div></div>`);
    scrollToBottom("imageScrollArea"); let lId = appendAiLoading("imageChatHistory"); window.toggleChatButton(true);

    let imagesToProcess = [...transImages]; transImages = []; renderTransImagePreviews();
    
    try {
        let combinedText = "";
        for (let i = 0; i < imagesToProcess.length; i++) { const rObj = await callGeminiVision(imagesToProcess[i], MASTER_OCR_PROMPT); combinedText += rObj.text.replace(/[\*&#_]/g, '') + "\n\n"; }
        combinedText = combinedText.trim(); if (!combinedText || combinedText.toLowerCase().includes("no text found") || combinedText === "NO_TEXT_FOUND") throw new Error("Could not detect any text in the images.");
        let prompt = `You are a STRICT Language Translator. RULE 1: DO NOT answer any questions found in the text. RULE 2: ONLY TRANSLATE the text exactly into ${targetLang}. DO NOT USE ENGLISH UNLESS ENGLISH IS THE SELECTED TARGET LANGUAGE. RULE 3: After your translation, write the exact symbol "|||" on a new line. RULE 4: Below "|||", extract 3 to 5 difficult words from the ORIGINAL text. RULE 5: Format EACH hard word EXACTLY like this: [Original Word from text] - [Meaning in ${targetLang}] (Part of Speech) other meaning- [Alternative meanings]. Text to translate:\n${combinedText}`;
        window.requestCache[lId] = { type: 'image_trans', prompt: prompt, extractedText: combinedText, targetLang: targetLang };
        let resObj = await callGeminiText("You are a strict translator.", prompt); let parts = resObj.text.split('|||'); let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed."; let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found."; let provider = resObj.provider;
        
        let finalHtml = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div style="margin-top:10px; font-size:12px; color:#cbd5e1; margin-bottom:5px; font-weight:600;">📄 Extracted Text:</div><div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; max-height:150px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1);">${combinedText.replace(/\n/g, '<br>')}</div><div style="font-size:12px; color:#3b82f6; margin-bottom:5px; font-weight:600;">🌍 Translated to ${targetLang}:</div><div id="trans_${lId}" style="font-size:15px;">${cleanText.replace(/\n/g, '<br>')}</div><div style="font-size:12px; color:#a855f7; margin-top:15px; margin-bottom:5px; font-weight:600;">📖 Hard Words Dictionary:</div><div style="background:rgba(168,85,247,0.1); padding:10px; border-radius:8px; font-size:14px; border:1px solid rgba(168,85,247,0.3);">${hardWordsText.replace(/\n/g, '<br>')}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('trans_${lId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('trans_${lId}')">📋 Copy</button></div>${getRetryButtonsHtml(lId)}</div>`;
        const loadingBubble = document.getElementById(lId); if (loadingBubble) { loadingBubble.querySelector('.bubble').innerHTML = finalHtml; }
        saveToHistory('image_translation', `Translate to ${targetLang}:\n${combinedText}`, finalHtml, imagesToProcess[0], provider); window.toggleChatButton(false);
    } catch(e) { window.toggleChatButton(false); const el = document.getElementById(lId); if(el) { if (e.name === 'AbortError') el.querySelector('.bubble').innerText = "⚠️ Stopped by user."; else el.querySelector('.bubble').innerText = "❌ Error: " + e.message; } }
}

// 🛑 DOCUMENT Q&A 🛑
function renderQaSourcePreviews() { const count = document.getElementById("qaSourceCount"); if(count) count.innerText = qaSourceImages.length; const container = document.getElementById("qaSourcePreviews"); if(!container) return; container.innerHTML = qaSourceImages.map((img, i) => `<div class="image-preview-chip" style="display:block; position:relative; width:60px; height:60px; background-image:url(${img}); background-size:cover; border-radius:8px; flex-shrink:0;"><div class="image-preview-close" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; cursor:pointer; font-size:12px; line-height:20px; box-shadow:0 2px 5px rgba(0,0,0,0.5);" onclick="removeQaSource(${i}, event)">✕</div></div>`).join(''); }
function removeQaSource(index, event) { if(event) event.stopPropagation(); qaSourceImages.splice(index, 1); renderQaSourcePreviews(); }
function renderQaQuestionPreview() { const container = document.getElementById("qaQuestionPreview"); if(!container) return; if(!qaQuestionImage) { container.innerHTML = ""; return; } container.innerHTML = `<div class="image-preview-chip" style="display:block; position:relative; width:80px; height:80px; background-image:url(${qaQuestionImage}); background-size:cover; border-radius:8px; flex-shrink:0;"><div class="image-preview-close" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; cursor:pointer; font-size:12px; line-height:20px; box-shadow:0 2px 5px rgba(0,0,0,0.5);" onclick="removeQaQuestion(event)">✕</div></div>`; }
function removeQaQuestion(event) { if(event) event.stopPropagation(); qaQuestionImage = null; renderQaQuestionPreview(); }
function clearQaSession() { qaSourceImages = []; qaQuestionImage = null; document.getElementById("qaQuestionInput").value = ""; document.getElementById("qaAnswerBox").innerHTML = "Solution will appear here..."; document.getElementById("qaProgressBar").style.width = "0%"; document.getElementById("qaStatusText").innerText = "Ready to start."; renderQaSourcePreviews(); renderQaQuestionPreview(); showToast("🔄 Session Reset"); }

async function executeQaFlow() {
    if (qaSourceImages.length === 0) return showToast("⚠️ Please add at least 1 source document image.");
    let typedQuestion = document.getElementById("qaQuestionInput").value.trim();
    if (!typedQuestion && !qaQuestionImage) return showToast("⚠️ Please type a question or take a photo of it.");
    
    const targetLang = document.getElementById("qaTargetLang").value; const statusTxt = document.getElementById("qaStatusText"); const pBar = document.getElementById("qaProgressBar"); const outBox = document.getElementById("qaAnswerBox");
    outBox.innerHTML = ""; pBar.style.width = "5%"; pBar.style.background = "#3b82f6"; window.toggleChatButton(true);
    
    try {
        let extractedContext = "";
        for(let i=0; i<qaSourceImages.length; i++) { statusTxt.innerText = `Reading Source Page ${i+1} of ${qaSourceImages.length}...`; pBar.style.width = `${10 + ((i / qaSourceImages.length) * 40)}%`; let rObj = await callGeminiVision(qaSourceImages[i], MASTER_OCR_PROMPT); extractedContext += `\n--- PAGE ${i+1} ---\n` + rObj.text.replace(/[\*&#_]/g, ''); }
        
        let finalQuestion = typedQuestion;
        if (qaQuestionImage) { statusTxt.innerText = "Extracting Question from Image..."; pBar.style.width = "65%"; let rObj = await callGeminiVision(qaQuestionImage, "Extract ONLY the question text exactly as written. Do not answer it."); let qText = rObj.text.replace(/[\*&#_]/g, '').trim(); finalQuestion = typedQuestion ? `${typedQuestion}\n(Image Text: ${qText})` : qText; }
        
        statusTxt.innerText = `Solving... Generating answer in ${targetLang}`; pBar.style.width = "85%";
        let prompt = `You are an expert Document Assistant. DOCUMENT TEXT:\n${extractedContext}\n\nTARGET QUESTION(S) TO SOLVE:\n${finalQuestion}\nCRITICAL INSTRUCTIONS:\n1. Answer ALL questions provided. Do not skip any!\n2. Answer based ONLY on the Document Text provided.\n3. You MUST write your entire answer strictly in ${targetLang}.\n4. If ${targetLang} is Hindi, YOU MUST USE DEVANAGARI SCRIPT ONLY.\n5. If the answer cannot be found in the provided text, state that clearly.`;
        
        const qaId = "qa_ans_" + Date.now(); window.requestCache[qaId] = { type: 'qa', prompt: prompt, targetLang: targetLang, finalQuestion: finalQuestion };
        let ansObj = await callGeminiText("You are a helpful document assistant.", prompt); let cleanAns = ansObj.text.replace(/[\*&#_]/g, ''); let provider = ansObj.provider;
        pBar.style.width = "100%"; statusTxt.innerText = "✅ Done!"; outBox.style.position = "relative";
        outBox.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div style="margin-top:10px; font-size:13px; color:#93c5fd; margin-bottom:5px; font-weight:600;">Your Question:</div><div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; border:1px solid rgba(255,255,255,0.05);">${finalQuestion.replace(/\n/g, '<br>')}</div><div style="font-size:13px; color:#22c55e; margin-bottom:5px; font-weight:600;">Answer (${targetLang}):</div><div id="${qaId}" style="font-size:15px;">${cleanAns.replace(/\n/g, '<br>')}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${qaId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${qaId}')">📋 Copy</button></div>${getRetryButtonsHtml(qaId)}</div>`;
        if (window.MathJax) { MathJax.typesetClear([outBox]); MathJax.typesetPromise([outBox]); }
        saveToHistory('qa', finalQuestion, outBox.innerHTML, qaSourceImages[0], provider); window.toggleChatButton(false);
    } catch(e) { window.toggleChatButton(false); if (e.name === 'AbortError') { statusTxt.innerText = "⚠️ Stopped by user."; pBar.style.background = "#f59e0b"; } else { statusTxt.innerText = "❌ Error Occurred"; pBar.style.background = "var(--red)"; outBox.innerHTML = "Error: " + e.message; } }
}

// 🛑 HISTORY SAVING & RESTORATION ENGINE 🛑
function saveHistorySafe() { 
    if (typeof localforage !== 'undefined') { localforage.setItem('aiHistory', appHistory).catch(e => console.error("Vault save failed:", e)); }
    try { let lightHistory = appHistory.slice(0, 30).map(item => { let cloned = { ...item }; cloned.image = null; if (cloned.interactions) { cloned.interactions = cloned.interactions.map(i => ({ ...i, image: null })); } return cloned; }); localStorage.setItem('aiHistory', JSON.stringify(lightHistory)); } 
    catch(e) { try { localStorage.setItem('aiHistory', JSON.stringify(appHistory.slice(0, 5).map(i => ({...i, image: null})))); } catch(err) {} }
}

function saveToHistory(type, q, a, img = null, provider = "AI") { 
    try { fetch(GOOGLE_SHEETS_WEBHOOK, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "log", type: type, question: q || "Action", answer: String(a || "").replace(/<[^>]*>?/gm, ''), provider: provider || "Gemini 1" }) }).catch(e => console.log("Google Sheets sync failed.")); } catch(e) {}
    let sessionId = sessionCache[type]; let histItem = appHistory.find(i => i.id === sessionId);
    if (!histItem) { sessionId = Date.now(); sessionCache[type] = sessionId; histItem = { id: sessionId, type: type, title: String(q || "").substring(0,35) + '...', interactions: [{ question: q, answer: a, image: img, provider: provider }], provider: provider, question: q, answer: a }; appHistory.unshift(histItem); } 
    else { histItem.interactions.push({ question: q, answer: a, image: img, provider: provider }); histItem.question = q; histItem.answer = a; }
    saveHistorySafe(); generateTitleWithGroq(sessionId); 
}

async function generateTitleWithGroq(sessionId) {
    const item = appHistory.find(i => i.id === sessionId); if (!item || !item.interactions) return;
    const allQuestions = item.interactions.map(inter => inter.question).join(" | ");
    try { const res = await fetch("/api/groq-search", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ prompt: "Create a highly concise, 2 to 4 word title summarizing the following user queries. Do not use quotes, punctuation, or any prefixes. Just give me the title text. Queries: " + allQuestions, providerOverride: "groq" }) }); const data = await checkHtmlError(res); if (data.text) { item.title = data.text.replace(/["'*]/g, '').trim(); saveHistorySafe(); if(document.getElementById('historyList')) renderHistory(); } } catch(e) {}
}

window.viewHistory = function(id) {
    const item = appHistory.find(i => String(i.id) === String(id)); if(!item) return;
    document.getElementById('histTitle').innerText = item.title; const qBox = document.getElementById('histQuestion'), aBox = document.getElementById('histAnswer');
    if (item.interactions) { qBox.innerHTML = item.interactions.map((interaction, i) => `<div style="margin-bottom:10px;"><b>[Q${i+1}]</b> ${interaction.question}</div>`).join(''); aBox.innerHTML = item.interactions.map((interaction, i) => `<div style="margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;"><b>[A${i+1}]</b> ${interaction.answer}</div>`).join(''); } 
    else { qBox.innerHTML = item.question; aBox.innerHTML = item.answer; }
    const modal = document.getElementById('historyModal'); if (modal) modal.classList.add('active'); if(window.MathJax) { MathJax.typesetClear(); MathJax.typesetPromise(); }
};

window.closeHistory = function() { const modal = document.getElementById('historyModal'); if (modal) modal.classList.remove('active'); };

function renderHistory() { 
    const list = document.getElementById('historyList'); if(!list) return; 
    if(appHistory.length === 0) return list.innerHTML = "<div style='color:var(--muted);text-align:center;'>No history saved yet.</div>"; 
    list.innerHTML = appHistory.map(item => {
        const count = item.interactions ? item.interactions.length : 1; const msgText = count > 1 ? `${count} messages` : `1 message`;
        return `<div class="wordItem" style="display:flex; justify-content:space-between; align-items:center;"><div onclick="viewHistory('${item.id}')" style="flex:1;"><div class="wordTitle">${item.title}</div><div class="wordMeaning">${item.type.toUpperCase()} • <span style="color:#60a5fa">${msgText}</span></div></div><div style="display:flex; gap:8px;"><button class="actionBtnSmall green" onclick="restoreSession(event, '${item.id}')" title="Restore">🔄</button><button class="actionBtnSmall blue" onclick="quickDownload(event, '${item.id}')" title="Download TXT">📥</button><button class="actionBtnSmall red" onclick="deleteHistoryItem(event, '${item.id}')" title="Delete">🗑️</button></div></div>`;
    }).join(''); 
}

function deleteHistoryItem(e, id) { e.stopPropagation(); appHistory = appHistory.filter(i => String(i.id) !== String(id)); saveHistorySafe(); renderHistory(); showToast("Deleted successfully."); }
function clearAllHistory() { if(confirm("⚠️ Are you sure you want to delete ALL saved history? This cannot be undone.")) { appHistory = []; if (typeof localforage !== 'undefined') localforage.removeItem('aiHistory'); localStorage.removeItem('aiHistory'); renderHistory(); showToast("🗑️ All history has been cleared!"); } }
function cleanLatexForDownload(text) { return text.replace(/\\frac{([^}]+)}{([^}]+)}/g, '($1/$2)').replace(/\\times/g, 'x').replace(/\\%/g, '%').replace(/[\$\\]/g, '').replace(/&nbsp;/g, ' ').replace(/<br>/g, '\n'); }
function quickDownload(e, id) { e.stopPropagation(); const item = appHistory.find(i => String(i.id) === String(id)); if(item) triggerFileDownload(item); }
function triggerFileDownload(item) { 
    let content = `Chat Title: ${item.title}\n\n`;
    if (item.interactions) { item.interactions.forEach((inter, idx) => { let q = inter.question.replace(/<[^>]*>?/gm, ''); let a = cleanLatexForDownload(inter.answer.replace(/<[^>]*>?/gm, '')); content += `--- QUESTION ${idx+1} ---\n${q}\n\n--- ANSWER ${idx+1} ---\n${a}\n\n`; }); } 
    else { let q = item.question.replace(/<[^>]*>?/gm, ''); let a = cleanLatexForDownload(item.answer.replace(/<[^>]*>?/gm, '')); content += `--- QUESTION ---\n${q}\n\n--- ANSWER ---\n${a}`; }
    const b = new Blob([content], { type: "text/plain;charset=utf-8" }); const l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `AI_Chat_${item.title}.txt`; l.click(); showToast("📥 Download started!");
}

window.restoreSession = function(e, id) { 
    if(e) e.stopPropagation(); const item = appHistory.find(i => String(i.id) === String(id)); if(!item) return; 
    let targetPage = ''; 
    if(item.type === 'math') targetPage = 'maths.html'; else if(item.type === 'search') targetPage = 'search.html'; else if(item.type === 'translation') targetPage = 'translator.html'; else if(item.type === 'image_translation') targetPage = 'image.html'; else if(item.type === 'qa') targetPage = 'qa.html'; else if(item.type === 'quiz') targetPage = 'quiz.html'; else if(item.type === 'youtube') targetPage = 'youtube.html';
    const currentPath = window.location.pathname.toLowerCase();
    if (targetPage !== '' && !currentPath.includes(targetPage)) { window.location.href = `${targetPage}?restore=${id}`; return; }
    
    sessionCache[item.type] = item.id; const interactionsToRestore = item.interactions || [{ question: item.question, answer: item.answer, image: item.image, provider: item.provider }];
    let container = document.querySelector('.chat-scroll-area') || document.getElementById('chatHistory') || document.getElementById('searchChatHistory') || document.getElementById('mathChatHistory') || document.getElementById('mathsChatHistory') || document.getElementById('imageChatHistory');
    let containerId = container ? (container.id || "chatContainerFallback") : ""; if (container && !container.id) container.id = containerId;

    if(item.type === 'math' && container) { container.innerHTML = ''; interactionsToRestore.forEach(inter => { appendUserBubble(inter.question, inter.image, containerId); let lId = appendAiLoading(containerId); updateAiBubble(lId, inter.answer, inter.provider || "AI", false); }); scrollToBottom(containerId); } 
    else if (item.type === 'search' && container) { container.innerHTML = ''; interactionsToRestore.forEach(inter => { appendUserBubble(inter.question, inter.image, containerId); let lId = appendAiLoading(containerId); const bbl = document.getElementById(lId).querySelector('.bubble'); bbl.innerHTML = `<div class="api-badge">✨ BY ${inter.provider || "AI"}</div><div id="search_${lId}" style="margin-top:10px;">${inter.answer.replace(/\n/g, '<br>')}</div><div class="action-buttons-container"><button class="btn green" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button><button class="btn" style="background:#475569; color:white;" onclick="copyToClipboard('search_${lId}')">📋 Copy</button></div>`; }); scrollToBottom(containerId); } 
    else if (item.type === 'translation') { const inputField = document.getElementById("inputText"); const outputBox = document.getElementById("translatedText"); if(inputField && outputBox) { inputField.value = item.question || ""; outputBox.innerHTML = item.answer || ""; let parts = item.answer.split("Hard Words:"); if(parts[1] && document.getElementById("hardWords")) { document.getElementById("hardWords").innerHTML = parts[1].trim(); } } }
    else if (item.type === 'image_translation' && container) { container.innerHTML = ''; interactionsToRestore.forEach(inter => { appendUserBubble(inter.question, inter.image, containerId); let lId = appendAiLoading(containerId); const bbl = document.getElementById(lId).querySelector('.bubble'); bbl.innerHTML = inter.answer; }); scrollToBottom(containerId); } 
    else if (item.type === 'qa') { const outBox = document.getElementById("qaAnswerBox") || document.getElementById("qaResult"); const statusTxt = document.getElementById("qaStatusText"); const pBar = document.getElementById("qaProgressBar"); if(outBox) { const lastInter = interactionsToRestore[interactionsToRestore.length - 1]; outBox.innerHTML = lastInter.answer; if(pBar) pBar.style.width = "100%"; if(statusTxt) statusTxt.innerText = "Restored from History"; } else if (container) { container.innerHTML = ''; interactionsToRestore.forEach(inter => { appendUserBubble(inter.question, inter.image, containerId); let lId = appendAiLoading(containerId); document.getElementById(lId).querySelector('.bubble').innerHTML = inter.answer; }); scrollToBottom(containerId); } }
    else if (item.type === 'youtube') { let ytInput = document.getElementById('ytSearchInput') || document.getElementById('searchInput'); let ytBtn = document.getElementById('ytSearchBtn') || document.getElementById('searchBtn'); if (ytInput && ytBtn && interactionsToRestore.length > 0) { ytInput.value = interactionsToRestore[0].question.replace("YouTube Search: ", ""); let status = document.getElementById('ytStatus'); if (status) status.innerHTML = `⏳ Loaded from history. Re-triggering search ranking...`; ytBtn.click(); } }
    else if (item.type === 'quiz') { let reviewContainer = document.getElementById('reviewContainer'); if (reviewContainer) { let setup = document.getElementById('quizSetup'); if(setup) setup.classList.remove('active'); let active = document.getElementById('quizActive'); if(active) active.classList.remove('active'); let results = document.getElementById('quizResults'); if(results) results.classList.add('active'); reviewContainer.innerHTML = interactionsToRestore[0].answer; let subText = document.getElementById('resultSubtext'); if (subText) subText.innerText = item.title || "Restored Quiz"; let scoreMatch = interactionsToRestore[0].answer.match(/Score:\s*(\d+)\s*out\s*of\s*(\d+)/i); if(scoreMatch) { let elC = document.getElementById('statCorrect'); if(elC) elC.innerText = scoreMatch[1]; let elT = document.getElementById('statTotal'); if(elT) elT.innerText = scoreMatch[2]; let elW = document.getElementById('statWrong'); if(elW) elW.innerText = parseInt(scoreMatch[2]) - parseInt(scoreMatch[1]); } if (window.MathJax) MathJax.typesetPromise([reviewContainer]).catch(e=>console.log(e)); } }
    showToast("🔄 Session Restored Successfully");
};

// 🛑 TTS & VIDEO ENGINE 🛑
function formatTime(sec) { let m = Math.floor(sec / 60); let s = Math.floor(sec % 60); return (m < 10 ? '0'+m : m) + ':' + (s < 10 ? '0'+s : s); }
function startVideoTimer(totalChars) { clearInterval(videoTickInterval); videoTotalEst = Math.max(5, Math.floor(totalChars / (14 * videoSpeed))); document.getElementById('vTimeDisplay').innerText = `${formatTime(videoElapsed)} / ${formatTime(videoTotalEst)}`; videoTickInterval = setInterval(() => { if(!isVideoPaused && window.speechSynthesis.speaking) { videoElapsed += 1; let displayTotal = videoTotalEst; if(videoElapsed > videoTotalEst) displayTotal = videoElapsed; document.getElementById('vTimeDisplay').innerText = `${formatTime(videoElapsed)} / ${formatTime(displayTotal)}`; } }, 1000); }
function resetVideoActivity() { const top = document.getElementById('vTopBar'); const bot = document.getElementById('vControlsContainer'); const ov = document.getElementById('videoGuiOverlay'); if(top) top.style.opacity = '1'; if(bot) bot.style.opacity = '1'; if(ov) ov.style.cursor = 'default'; clearTimeout(hideControlsTimer); hideControlsTimer = setTimeout(() => { if(!isVideoPaused) { if(top) top.style.opacity = '0'; if(bot) bot.style.opacity = '0'; if(ov) ov.style.cursor = 'none'; } }, 3000); }
function toggleVideoFullscreen() { const ov = document.getElementById('videoGuiOverlay'); if (!document.fullscreenElement) { if(ov.requestFullscreen) ov.requestFullscreen().catch(()=>{}); if(screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{}); } else { document.exitFullscreen().catch(()=>{}); if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } }
function updateVideoVolume(val) { currentVideoVolume = parseFloat(val); if (activeVideoUtterance) activeVideoUtterance.volume = currentVideoVolume; resetVideoActivity(); }

function initVideoGui() {
    if(!window.latestMathSolution) return;
    videoElapsed = 0; isVideoPaused = false; 
    const ov = document.createElement('div'); ov.id = 'videoGuiOverlay';
    ov.style.cssText = "position:fixed; inset:0; background:radial-gradient(circle, #1e293b 0%, #000000 100%); z-index:9999; display:flex; flex-direction:column; font-family:'Poppins', sans-serif; touch-action:none;";
    ov.innerHTML = `
        <div id="vTopBar" style="position:absolute; top:0; left:0; right:0; padding:20px; background:linear-gradient(rgba(0,0,0,0.9), transparent); display:flex; justify-content:space-between; transition: opacity 0.3s; z-index:100;">
            <div style="color:white; font-weight:bold; font-size:18px;">🔴 AI TUTOR LIVE</div><button onclick="exitVideoGui()" style="background:rgba(239, 68, 68, 0.2); border:1px solid var(--red); color:white; padding:5px 15px; border-radius:5px; cursor:pointer;">Exit</button>
        </div>
        <div style="position:absolute; left:0; top:60px; bottom:100px; width:40%; z-index:50;" onclick="handleVideoTap(event, -1)"></div>
        <div style="position:absolute; right:0; top:60px; bottom:100px; width:40%; z-index:50;" onclick="handleVideoTap(event, 1)"></div>
        <div id="skipIndLeft" style="position:absolute; left:10%; top:50%; transform:translateY(-50%); font-size:40px; color:white; opacity:0; z-index:51; pointer-events:none; transition:0.2s; background:rgba(0,0,0,0.5); padding:20px; border-radius:50%;">⏪</div>
        <div id="skipIndRight" style="position:absolute; right:10%; top:50%; transform:translateY(-50%); font-size:40px; color:white; opacity:0; z-index:51; pointer-events:none; transition:0.2s; background:rgba(0,0,0,0.5); padding:20px; border-radius:50%;">⏩</div>
        <div id="videoDisplayArea" style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:60px 20px; overflow-y:auto; padding-bottom:100px; position:relative; z-index:10;">
            <div id="videoContent" style="font-size: 36px; font-weight: 700; color: #fff; line-height: 1.8; max-width: 900px; width:100%; text-align:left; background:rgba(0,0,0,0.4); padding:40px; border-radius:20px; border:1px solid rgba(255,255,255,0.1); box-shadow:0 10px 40px rgba(0,0,0,0.5);"></div>
        </div>
        <div id="vControlsContainer" style="position:absolute; bottom:0; left:0; right:0; padding:20px; background:linear-gradient(transparent, rgba(0,0,0,0.95)); transition: opacity 0.3s; z-index:100;">
           <div style="width:100%; height:20px; cursor:pointer; display:flex; align-items:center;" onclick="seekVideo(event)"><div style="width:100%; height:5px; background:rgba(255,255,255,0.2); border-radius:3px; position:relative;" id="vProgressBarBg"><div style="height:100%; width:0%; background:#3b82f6; border-radius:3px; transition: width 0.1s linear;" id="vProgressBar"></div></div></div>
           <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:5px;">
               <div style="display:flex; align-items:center; gap:20px;"><button id="vPlayBtn" onclick="toggleVideoPause()" style="background:none; border:none; color:white; font-size:26px; cursor:pointer;">⏸️</button><span id="vTimeDisplay" style="color:#cbd5e1; font-size:14px; font-weight:500; font-family:monospace;">00:00 / 00:00</span></div>
               <div style="display:flex; align-items:center; gap:20px;"><div style="display:flex; align-items:center; gap:5px;"><span style="color:white; font-size:16px;">🔊</span><input type="range" id="vVolumeSlider" min="0" max="1" step="0.1" value="${currentVideoVolume}" onchange="updateVideoVolume(this.value)" style="width:70px; accent-color:#3b82f6; cursor:pointer;"></div><button onclick="cycleVideoSpeed()" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; font-size:14px; font-weight:bold; cursor:pointer; border-radius:10px; padding:5px 12px;" id="vSpeedTxt">${videoSpeed}x</button><button onclick="toggleVideoFullscreen()" style="background:none; border:none; color:white; font-size:22px; cursor:pointer;" title="Fullscreen">🔲</button></div>
           </div>
        </div>
    `;
    document.body.appendChild(ov); 
    if(ov.requestFullscreen) ov.requestFullscreen().catch(()=>{}); if(screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{});
    ov.addEventListener('mousemove', resetVideoActivity); ov.addEventListener('touchstart', resetVideoActivity); resetVideoActivity(); playFractionVideo(0);
}

window.handleVideoTap = function(e, dir) { const now = Date.now(); if (now - (e.target.lastTap || 0) < 300) { skipVideo(dir); e.target.lastTap = 0; } else { e.target.lastTap = now; resetVideoActivity(); } };
window.skipVideo = function(dir) { const ind = document.getElementById(dir === 1 ? 'skipIndRight' : 'skipIndLeft'); if(ind) { ind.style.opacity = '1'; setTimeout(()=>ind.style.opacity='0', 400); } window.speechSynthesis.cancel(); const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== ''); let target = videoLineIndex + dir; if(target < 0) target = 0; if(target >= lines.length) target = lines.length - 1; videoElapsed = Math.floor((target / lines.length) * videoTotalEst); playFractionVideo(target, false, isVideoPaused); };
window.seekVideo = function(e) { const barBg = document.getElementById('vProgressBarBg'); const rect = barBg.getBoundingClientRect(); const clickX = e.clientX - rect.left; const percent = Math.max(0, Math.min(1, clickX / rect.width)); const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== ''); let targetLine = Math.floor(percent * lines.length); if(targetLine >= lines.length) targetLine = lines.length - 1; window.speechSynthesis.cancel(); videoElapsed = Math.floor((targetLine / lines.length) * videoTotalEst); playFractionVideo(targetLine, false, isVideoPaused); };
function exitVideoGui() { window.speechSynthesis.cancel(); clearInterval(videoTickInterval); clearTimeout(hideControlsTimer); const ov = document.getElementById('videoGuiOverlay'); if(ov) { if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.remove(); } if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }
function cycleVideoSpeed() { videoSpeed = videoSpeed === 0.75 ? 1.0 : (videoSpeed === 1.0 ? 1.5 : (videoSpeed === 1.5 ? 2.0 : 0.75)); document.getElementById('vSpeedTxt').innerText = videoSpeed + 'x'; const wasPaused = isVideoPaused; window.speechSynthesis.cancel(); resetVideoActivity(); playFractionVideo(videoLineIndex, true, wasPaused); }
function toggleVideoPause() { const btn = document.getElementById('vPlayBtn'); if (isVideoPaused) { isVideoPaused = false; window.speechSynthesis.resume(); if(btn) btn.innerHTML = "⏸️"; } else { isVideoPaused = true; window.speechSynthesis.pause(); if(btn) btn.innerHTML = "▶️"; } resetVideoActivity(); }
function replayVideo() { window.speechSynthesis.cancel(); videoLineIndex = 0; videoElapsed = 0; isVideoPaused = false; document.getElementById('vPlayBtn').innerHTML = "⏸️"; playFractionVideo(0); }

async function playFractionVideo(startIndex = 0, preserveContent = false, pauseAfterStart = false) {
    const token = ++videoRunToken; const content = document.getElementById("videoContent"); if (!content) return;
    const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== '');
    videoLineIndex = Math.min(startIndex, Math.max(lines.length - 1, 0));
    
    if (!preserveContent) { content.innerHTML = ""; for(let i=0; i<videoLineIndex; i++) { let div = document.createElement("div"); div.dataset.videoLine = i; div.className = "video-line-card"; div.innerHTML = lines[i]; content.appendChild(div); if (window.MathJax) MathJax.typesetPromise([div]); } }
    startVideoTimer(window.latestMathSolution.length); const pBar = document.getElementById('vProgressBar');

    for(let i=videoLineIndex; i<lines.length; i++) {
        if(token !== videoRunToken || !document.getElementById('videoGuiOverlay')) return;
        videoLineIndex = i; if(pBar) pBar.style.width = ((i / lines.length) * 100) + '%';
        const lineText = lines[i]; const cleanSpeech = formatHindiSpeechText(lineText);
        const u = new SpeechSynthesisUtterance(cleanSpeech); activeVideoUtterance = u;
        if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
        let premium = availableVoices.find(v => v.name === 'Google हिन्दी' || v.name === 'Google Hindi' || (v.name.includes('Google') && v.lang.includes('hi')));
        if (premium) u.voice = premium; u.lang = 'hi-IN'; u.rate = videoSpeed; u.volume = currentVideoVolume;

       let lineDiv = document.querySelector(`[data-video-line="${i}"]`);
        if (!lineDiv) { lineDiv = document.createElement("div"); lineDiv.dataset.videoLine = i; lineDiv.className = "video-line-card"; lineDiv.style.color = "#ffffff"; lineDiv.style.textShadow = "0 2px 5px rgba(0,0,0,1)"; content.appendChild(lineDiv); }
        lineDiv.innerHTML = lineText; lineDiv.classList.add("active");
        if (window.MathJax && !lineDiv.hasAttribute('data-math-done')) { MathJax.typesetClear([lineDiv]); await MathJax.typesetPromise([lineDiv]); lineDiv.setAttribute('data-math-done', 'true'); }
        setTimeout(() => { if(content.parentElement) content.parentElement.scrollTo({ top: content.parentElement.scrollHeight, behavior: "smooth" }); }, 10);

        window.speechSynthesis.speak(u);
        if (pauseAfterStart) { window.speechSynthesis.pause(); isVideoPaused = true; const playBtn = document.getElementById('vPlayBtn'); if(playBtn) playBtn.innerHTML = "▶️"; pauseAfterStart = false; }
        let estimatedDurationMs = (cleanSpeech.length / 13.5) * 1000 / videoSpeed; let startTime = Date.now();
        let waitInterval = setInterval(() => { if (isVideoPaused) startTime += 50; let elapsed = Date.now() - startTime; if (elapsed >= estimatedDurationMs) clearInterval(waitInterval); }, 50);

        await new Promise(r => { u.onend = r; u.onerror = r; setTimeout(r, Math.max(estimatedDurationMs + 500, 2000)); });
        lineDiv.classList.remove("active"); if(token !== videoRunToken) return;
    }
    if(pBar) pBar.style.width = '100%'; clearInterval(videoTickInterval); const playBtn = document.getElementById('vPlayBtn'); if(playBtn) playBtn.innerHTML = "🔄"; resetVideoActivity();
}

let recognition; let isRecording = false;
function getActiveTextInput() { return document.getElementById("searchInput") || document.getElementById("inputText") || document.getElementById("mathInstructionInput") || document.getElementById("qaQuestionInput"); }
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) { const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition; recognition = new SpeechRec(); recognition.continuous = false; recognition.interimResults = true; recognition.onstart = () => { isRecording = true; const mic = document.getElementById("micBtn"); if(mic) { mic.classList.add("recording"); mic.style.background = "rgba(239, 68, 68, 0.8)"; mic.style.boxShadow = "0 0 15px rgba(239, 68, 68, 0.8)"; } }; recognition.onresult = (e) => { let tr = ""; for (let i = 0; i < e.results.length; i++) tr += e.results[i][0].transcript; const inp = getActiveTextInput(); if(inp) inp.value = tr; }; recognition.onerror = () => stopRecording(); recognition.onend = () => stopRecording(); }
window.toggleRecording = function() { if (!recognition) return showToast("⚠️ Microphone not supported on this browser."); if (isRecording) { recognition.stop(); } else { const langEl = document.getElementById("voiceSourceLang"); recognition.lang = langEl ? langEl.value : "hi-IN"; const inp = getActiveTextInput(); if(inp) inp.value = "Listening..."; recognition.start(); } };
window.stopRecording = function() { isRecording = false; const mic = document.getElementById("micBtn"); if(mic) { mic.classList.remove("recording"); mic.style.background = "rgba(255, 255, 255, 0.08)"; mic.style.boxShadow = "none"; } const inp = getActiveTextInput(); if(inp && inp.value === "Listening...") inp.value = ""; };

// EXPORT TO WINDOW
window.toggleSidebar = toggleSidebar; 
window.openCamera = openCamera; 
window.closeCamera = closeCamera; 
window.switchCamera = switchCamera; 
window.capturePhoto = capturePhoto; 
window.clearMathImage = clearMathImage; 
window.executeMathFlow = executeMathFlow; 
window.speakAndHighlight = speakAndHighlight; 
window.restoreSession = restoreSession; 
window.copyToClipboard = copyToClipboard; 
window.showToast = showToast; 
window.viewPhotoFullscreen = viewPhotoFullscreen;
