/* =======================================================
   AI PRO SUITE - MAIN.JS (COMPLETE & BUG-FREE EDITION)
   ======================================================= */

let appHistory = [];
let visionReqs = parseInt(localStorage.getItem('visionReqs') || '0');
let textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false;
window.capturedImage = null; // MASTER IMAGE VARIABLE
window.currentMathImage = null; // SAFE MATH IMAGE VARIABLE
let currentMode = "";
let qaImages = [];
let transImages = [];
let qaContextText = "";
window.latestMathSolution = "";
let availableVoices = [];
window.hasResetToday = false;

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

// 🛑 DATABASE LOADER 🛑
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
}

// 🛑 TTS & SESSION CONTEXT 🛑
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
    
    activeUtterance.onstart = () => { const p = document.getElementById('ttsPlayer'); if(p) p.style.display = 'flex'; };
    activeUtterance.onend = () => { const p = document.getElementById('ttsPlayer'); if(p) p.style.display = 'none'; };
    
    speechSynth.speak(activeUtterance);
};

window.toggleTts = function() {
    const btn = document.getElementById('ttsPlayPauseBtn');
    if (speechSynth.paused) {
        speechSynth.resume();
        if(btn) btn.innerHTML = "⏸️";
    } else {
        speechSynth.pause();
        if(btn) btn.innerHTML = "▶️";
    }
};

window.closeTts = function() {
    if(speechSynth) speechSynth.cancel();
    const p = document.getElementById('ttsPlayer');
    if(p) p.style.display = 'none';
};

window.formatHindiSpeechText = function(text) { return text; };

window.getSessionContext = function(type) {
    let context = "";
    if(appHistory && appHistory.length > 0) {
        let session = appHistory.find(i => i.type === type);
        if(session && session.interactions) {
            let lastFew = session.interactions.slice(-3);
            lastFew.forEach(i => { 
                // CRITICAL FIX: Strip massive Base64 image tags out of the AI's memory
                // so it doesn't crash the prompt limit on the next question!
                let cleanAnswer = String(i.answer || "")
                    .replace(/<img[^>]*src="data:image[^>]*>/gi, '[DIAGRAM REMOVED]')
                    .replace(/<[^>]*>?/gm, ' ')
                    .trim();
                
                context += `User: ${i.question}\nAI: ${cleanAnswer}\n`; 
            });
        }
    }
    return context ? `Previous Context:\n${context}\n` : "";
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
    
    // Auto-fix the missing Flash button onclick from HTML
    const flashBtn = document.getElementById("toggleFlashBtn");
    if (flashBtn) flashBtn.onclick = window.toggleFlash;

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

// 🛑 BULLETPROOF CAMERA ENGINE (ALL PAGES FIXED) 🛑
window.currentStream = null;
window.currentFacing = "environment";
window.isFlashOn = false;
window.currentMode = "";

// Auto-fix missing Flash and Close buttons across all pages dynamically
document.addEventListener("DOMContentLoaded", () => {
    const flashBtn = document.getElementById("toggleFlashBtn");
    if (flashBtn) flashBtn.onclick = window.toggleFlash;

    // Fixes the X button for both maths, qa, and image translation files
    const closeBtn = document.getElementById("closeCameraBtn");
    if (closeBtn) closeBtn.onclick = window.closeCamera;
});

window.startCamera = async function() { 
    try { 
        if(window.currentStream) window.currentStream.getTracks().forEach(t => t.stop()); 
        
        window.currentStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: window.currentFacing, width: {ideal: 1920}, height: {ideal: 1080} } 
        }); 
        
        const videoEl = document.getElementById("cameraVideo");
        if (!videoEl) return alert("Error: <video id='cameraVideo'> not found!");
        
        videoEl.setAttribute('autoplay', '');
        videoEl.setAttribute('playsinline', '');
        videoEl.srcObject = window.currentStream; 
        
        const track = window.currentStream.getVideoTracks()[0]; 
        setTimeout(async () => { 
            try { 
                const cap = track.getCapabilities(); 
                if (cap.torch && window.currentFacing === "environment") { 
                    window.isFlashOn = true; 
                    await track.applyConstraints({ advanced: [{ torch: true }] }); 
                } else { 
                    window.isFlashOn = false; 
                } 
                window.updateFlashUI();
            } catch(err) {} 
        }, 500); 
    } catch(e) { 
        alert("Camera Error: Please check permissions.\n" + e.message); 
    } 
};

window.toggleFlash = async function() { 
    if (!window.currentStream) return; 
    const track = window.currentStream.getVideoTracks()[0]; 
    try { 
        if (track.getCapabilities().torch) { 
            window.isFlashOn = !window.isFlashOn; 
            await track.applyConstraints({ advanced: [{ torch: window.isFlashOn }] }); 
            window.updateFlashUI(); 
        } 
    } catch(err){} 
};

window.updateFlashUI = function() { 
    const btn = document.getElementById("toggleFlashBtn"); 
    if(btn) { btn.innerText = window.isFlashOn ? "💡" : "🔦"; } 
};

window.openCamera = async function(m) { 
    window.currentMode = m; 
    const mod = document.getElementById("cameraModal"); 
    if(mod) { 
        mod.style.display = "flex";
        mod.style.opacity = "1";
        mod.classList.add("active"); 
        await window.startCamera(); 
    } else {
        alert("Camera Modal container not found!");
    }
};

window.closeCamera = function() { 
    const mod = document.getElementById("cameraModal"); 
    if (mod) {
        mod.classList.remove("active"); 
        mod.style.display = "none";
    }
    if (window.currentStream) { 
        const track = window.currentStream.getVideoTracks()[0]; 
        try { if (track && track.getCapabilities && track.getCapabilities().torch) track.applyConstraints({ advanced: [{ torch: false }] }); } catch(err) {} 
        window.currentStream.getTracks().forEach(t => t.stop()); 
        window.currentStream = null; 
    }
    window.isFlashOn = false; 
    window.updateFlashUI();
};

window.switchCamera = async function() { 
    window.currentFacing = window.currentFacing === "environment" ? "user" : "environment"; 
    await window.startCamera(); 
};

window.capturePhoto = function() { 
    const v = document.getElementById("cameraVideo"), c = document.getElementById("captureCanvas");
    if (!v || !c) return alert("Capture components missing!");
    
    let w = v.videoWidth, h = v.videoHeight; if(w > 1500) { h *= 1500/w; w = 1500; } 
    c.width = w; c.height = h; 
    c.getContext("2d").drawImage(v, 0, 0, w, h); 
    window.capturedImage = c.toDataURL("image/jpeg", 0.7); 
    
    // Wire up variables safely across all features
    if (window.currentMode === 'math' || window.currentMode === 'search') { 
        window.currentMathImage = window.capturedImage;
        const chip = document.getElementById("mathPreviewChip"); 
        if(chip) { chip.style.display = "block"; chip.style.backgroundImage = `url(${window.capturedImage})`; } 
    }
    else if (window.currentMode === 'image_trans') {
        if (typeof transImages === 'undefined') window.transImages = [];
        if(window.transImages.length >= 3) { showToast("Max 3 images allowed!"); } 
        else { window.transImages.push(window.capturedImage); if(typeof renderTransImagePreviews === 'function') renderTransImagePreviews(); }
    }
    else if (window.currentMode === 'qa_source') {
        if (typeof qaSourceImages === 'undefined') window.qaSourceImages = [];
        if(window.qaSourceImages.length >= 10) { showToast("Max 10 images allowed!"); } 
        else { window.qaSourceImages.push(window.capturedImage); if(typeof renderQaSourcePreviews === 'function') renderQaSourcePreviews(); }
    }
    else if (window.currentMode === 'qa_question') { 
        window.qaQuestionImage = window.capturedImage; 
        if(typeof renderQaQuestionPreview === 'function') renderQaQuestionPreview(); 
    }
    
    window.closeCamera(); 
};

// 🛑 SUPERCHARGED IMAGE CLEARER 🛑
window.clearMathImage = function(e) {
    if(e) e.stopPropagation();
    window.capturedImage = null;
    window.currentMathImage = null;
    const chip = document.getElementById("mathPreviewChip");
    if(chip) { chip.style.display = "none"; chip.style.backgroundImage = "none"; }
};

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
    // FIX: Changed margin-top to 35px so it doesn't overlap the "BY GEMINI" badge
    containerEl.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div id="${contentId}" style="margin-top:35px;"></div>`;
    const txtEl = document.getElementById(contentId);
    
    let tickRate = 20; 
    let charsPerTick = 1;
    
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
    else { 
        // FIX: Changed margin-top to 35px so it doesn't overlap the "BY GEMINI" badge
        bbl.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div id="text_${lId}" style="margin-top:35px;">${answer.replace(/\n/g, '<br>')}</div>${buttons}`; 
        if (window.MathJax) { MathJax.typesetClear([bbl]); MathJax.typesetPromise([bbl]); } 
        window.toggleChatButton(false); 
    }
}

// 🛑 FIXED MATH SOLVER FLOW (NO GHOST IMAGES, NO LOST PHOTOS) 🛑
window.executeMathFlow = async function() {
    const inp = document.getElementById("mathInstructionInput"); if(!inp) return;
    const instruction = inp.value.trim();

    // SAFELY GRAB THE EXACT IMAGE YOU JUST ATTACHED
    let uiImage = window.currentMathImage || window.capturedImage;

    // IF NO IMAGE AND NO TEXT, DO NOTHING
    if (!uiImage && !instruction) return; 

    appendUserBubble(instruction || (uiImage ? "Analyze this image" : "Solve this"), uiImage, "mathChatHistory");
    inp.value = "";

    let lId = appendAiLoading("mathChatHistory");
    window.toggleChatButton(true);

    // STRICT FIX: Only use the image you JUST attached. NO "getLastContextImage" ghost images!
    let activeImage = uiImage;
    let memoryContext = window.getSessionContext('math');

    const modeStatus = window.isImageGenerationMode ? "[IMAGE MODE ON]" : "[IMAGE MODE OFF - EXACT QUESTION ONLY]";

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
$$[Proper math equation with \\frac]$$
**2. [Step 2 Heading]**
[Step 2 explanation]
$$[Proper math equation]$$
(Add more steps as needed)
**वैकल्पिक आसान तरीका (Short Trick)**
[Provide a quick shortcut, formula, or trick to solve it faster]
**✅ अंतिम उत्तर**
[Final explicit answer sentence]`;

    let finalPrompt = `${sysPrompt}\n\n${modeStatus}\n\n${memoryContext}User: ${instruction || "Analyze image"}`;
    if (!window.isImageGenerationMode) { window.requestCache[lId] = { type: 'math', sysPrompt, prompt: finalPrompt, image: activeImage }; }

    // CLEAR UI IMMEDIATELY SO PHOTO DOESN'T CARRY OVER TO NEXT QUESTION
    window.clearMathImage();

    try {
        let resObj = activeImage ? await callGeminiVision(activeImage, finalPrompt) : await callGeminiText(sysPrompt, finalPrompt);
        let rawText = resObj.text;
        
        let qCount = 1;
        if (rawText.includes("COUNT:-")) { let topPart = rawText.split("COUNT:-")[1]; if (topPart) qCount = parseInt(topPart.split("||MATH||")[0].trim()) || 1; }

        let mathBlock = rawText; let svgBlock = ""; let finalAnswerBlock = "";
        if (rawText.includes("||MATH||")) { let parts = rawText.split("||MATH||")[1] || rawText; let svgSplit = parts.split("||SVG||"); mathBlock = svgSplit[0].trim(); if (svgSplit.length > 1) { let ansSplit = svgSplit[1].split("||ANSWER||"); svgBlock = ansSplit[0].trim(); if (ansSplit.length > 1) finalAnswerBlock = ansSplit[1].trim(); } }
        mathBlock = mathBlock.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').trim(); 

        let generatedImgHtml = "";
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
};

// 🛑 GROQ SEARCH 🛑
async function runGroqSearch() {
    const inp = document.getElementById("searchInput"); if(!inp) return;
    const q = inp.value.trim(); if(!q && !window.capturedImage && !window.attachedPdfText) return;
    
    let uiImage = window.capturedImage;
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
        window.clearMathImage(); if(window.clearPdfFile) window.clearPdfFile();
    } catch(e) { window.toggleChatButton(false); const el = document.getElementById(lId); if(el) { if (e.name === 'AbortError') el.querySelector('.bubble').innerText = "⚠️ Stopped by user."; else el.querySelector('.bubble').innerText = "❌ Error: " + e.message; } }
}

// 🛑 TEXT TRANSLATOR 🛑
async function runTranslation(){ 
    const txt = document.getElementById("inputText").value.trim(); const lang = document.getElementById("targetLang").value; if(!txt) return; 
    try{ 
        let prompt = `You are a STRICT Language Translator. ONLY TRANSLATE the text exactly into ${lang}. After your translation, write the exact symbol "|||" on a new line. Below "|||", extract 3 to 5 difficult words from the ORIGINAL text. Text to translate:\n${txt}`;
        let resObj = await callGeminiText("You are a strict translator.", prompt); let parts = resObj.text.split('|||'); let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed."; let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found."; let provider = resObj.provider;
        const tId = "trans_" + Date.now(); const transBox = document.getElementById("translatedText"); transBox.style.position = "relative";
        transBox.innerHTML = `<div id="${tId}" style="margin-top:10px;">${cleanText}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${tId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${tId}')">📋 Copy</button></div>`; 
        let hwDiv = document.getElementById("hardWords"); if(hwDiv) hwDiv.innerHTML = hardWordsText.replace(/\n/g, '<br>');
        saveToHistory('translation', txt, cleanText + "\n\nHard Words:\n" + hardWordsText, null, provider);
    }catch(e){ document.getElementById("translatedText").innerText = "❌ " + e.message; } 
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
        combinedText = combinedText.trim(); if (!combinedText || combinedText.toLowerCase().includes("no text found")) throw new Error("Could not detect any text in the images.");
        let prompt = `You are a STRICT Language Translator. ONLY TRANSLATE the text exactly into ${targetLang}. After your translation, write the exact symbol "|||" on a new line. Below "|||", extract 3 to 5 difficult words from the ORIGINAL text. Text to translate:\n${combinedText}`;
        let resObj = await callGeminiText("You are a strict translator.", prompt); let parts = resObj.text.split('|||'); let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed."; let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found."; let provider = resObj.provider;
        
        let finalHtml = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div style="margin-top:10px; font-size:12px; color:#cbd5e1; margin-bottom:5px; font-weight:600;">📄 Extracted Text:</div><div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; max-height:150px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1);">${combinedText.replace(/\n/g, '<br>')}</div><div style="font-size:12px; color:#3b82f6; margin-bottom:5px; font-weight:600;">🌍 Translated to ${targetLang}:</div><div id="trans_${lId}" style="font-size:15px;">${cleanText.replace(/\n/g, '<br>')}</div><div style="font-size:12px; color:#a855f7; margin-top:15px; margin-bottom:5px; font-weight:600;">📖 Hard Words Dictionary:</div><div style="background:rgba(168,85,247,0.1); padding:10px; border-radius:8px; font-size:14px; border:1px solid rgba(168,85,247,0.3);">${hardWordsText.replace(/\n/g, '<br>')}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('trans_${lId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('trans_${lId}')">📋 Copy</button></div></div>`;
        const loadingBubble = document.getElementById(lId); if (loadingBubble) { loadingBubble.querySelector('.bubble').innerHTML = finalHtml; }
        saveToHistory('image_translation', `Translate to ${targetLang}:\n${combinedText}`, finalHtml, imagesToProcess[0], provider); window.toggleChatButton(false);
    } catch(e) { window.toggleChatButton(false); const el = document.getElementById(lId); if(el) el.querySelector('.bubble').innerText = "❌ Error: " + e.message; }
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
        let prompt = `You are an expert Document Assistant. DOCUMENT TEXT:\n${extractedContext}\n\nTARGET QUESTION(S) TO SOLVE:\n${finalQuestion}\nCRITICAL INSTRUCTIONS:\n1. Answer ALL questions provided. Do not skip any!\n2. Answer based ONLY on the Document Text provided.\n3. You MUST write your entire answer strictly in ${targetLang}.\n4. If ${targetLang} is Hindi, YOU MUST USE DEVANAGARI SCRIPT ONLY.`;
        
        const qaId = "qa_ans_" + Date.now(); window.requestCache[qaId] = { type: 'qa', prompt: prompt, targetLang: targetLang, finalQuestion: finalQuestion };
        let ansObj = await callGeminiText("You are a helpful document assistant.", prompt); let cleanAns = ansObj.text.replace(/[\*&#_]/g, ''); let provider = ansObj.provider;
        pBar.style.width = "100%"; statusTxt.innerText = "✅ Done!"; outBox.style.position = "relative";
        outBox.innerHTML = `<div style="position:absolute; top:12px; right:16px; font-size:9px; color:var(--muted); font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; z-index:2;">✨ BY ${provider}</div><div style="margin-top:10px; font-size:13px; color:#93c5fd; margin-bottom:5px; font-weight:600;">Your Question:</div><div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; border:1px solid rgba(255,255,255,0.05);">${finalQuestion.replace(/\n/g, '<br>')}</div><div style="font-size:13px; color:#22c55e; margin-bottom:5px; font-weight:600;">Answer (${targetLang}):</div><div id="${qaId}" style="font-size:15px;">${cleanAns.replace(/\n/g, '<br>')}</div><div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; display:flex; flex-direction:column; gap:12px; width:100%;"><div style="display:flex; gap:10px; width:100%;"><button class="btn green" style="padding:10px; flex:1; font-size:13px; border-radius:20px;" onclick="speakAndHighlight('${qaId}')">🔊 Listen</button><button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white; border-radius:20px;" onclick="copyToClipboard('${qaId}')">📋 Copy</button></div></div>`;
        if (window.MathJax) { MathJax.typesetClear([outBox]); MathJax.typesetPromise([outBox]); }
        saveToHistory('qa', finalQuestion, outBox.innerHTML, qaSourceImages[0], provider); window.toggleChatButton(false);
    } catch(e) { window.toggleChatButton(false); if (e.name === 'AbortError') { statusTxt.innerText = "⚠️ Stopped by user."; pBar.style.background = "#f59e0b"; } else { statusTxt.innerText = "❌ Error Occurred"; pBar.style.background = "var(--red)"; outBox.innerHTML = "Error: " + e.message; } }
}

// 🛑 HISTORY SAVING & RESTORATION ENGINE 🛑
window.saveHistorySafe = function() { 
    if (typeof localforage !== 'undefined') { localforage.setItem('aiHistory', appHistory).catch(e => console.error("Vault save failed:", e)); }
    try { let lightHistory = appHistory.slice(0, 30).map(item => { let cloned = { ...item }; cloned.image = null; if (cloned.interactions) { cloned.interactions = cloned.interactions.map(i => ({ ...i, image: null })); } return cloned; }); localStorage.setItem('aiHistory', JSON.stringify(lightHistory)); } 
    catch(e) { try { localStorage.setItem('aiHistory', JSON.stringify(appHistory.slice(0, 5).map(i => ({...i, image: null})))); } catch(err) {} }
}

// FIXED: Attached to Window so inline scripts in QA and Translator can access it
window.saveToHistory = function(type, q, a, img = null, provider = "AI") { 
    try { fetch(GOOGLE_SHEETS_WEBHOOK, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "log", type: type, question: q || "Action", answer: String(a || "").replace(/<[^>]*>?/gm, ''), provider: provider || "Gemini 1" }) }).catch(e => console.log("Google Sheets sync failed.")); } catch(e) {}
    let sessionId = sessionCache[type]; let histItem = appHistory.find(i => i.id === sessionId);
    if (!histItem) { sessionId = Date.now(); sessionCache[type] = sessionId; histItem = { id: sessionId, type: type, title: String(q || "").substring(0,35) + '...', interactions: [{ question: q, answer: a, image: img, provider: provider }], provider: provider, question: q, answer: a }; appHistory.unshift(histItem); } 
    else { histItem.interactions.push({ question: q, answer: a, image: img, provider: provider }); histItem.question = q; histItem.answer = a; }
    window.saveHistorySafe(); generateTitleWithGroq(sessionId); 
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
    showToast("🔄 Session Restored Successfully");
};
