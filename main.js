/* =======================================================
   AI PRO SUITE - ULTIMATE V32 (WhatsApp Math + Video GUI)
======================================================= */

// --- 1. GLOBAL STATE & INITIALIZATION ---
let appHistory = [];
try { appHistory = JSON.parse(localStorage.getItem('aiHistory') || '[]'); } 
catch(e) { appHistory = []; }

let apiTime = 60, visionReqs = parseInt(localStorage.getItem('visionReqs') || '0'), textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false, capturedImage = null, currentMode = "", qaImages = [], qaContextText = "", isFlashOn = true; 
window.latestMathSolution = "";

document.addEventListener("DOMContentLoaded", () => {
    setInterval(() => {
        apiTime--;
        if(apiTime <= 0) { apiTime = 60; visionReqs = 0; textReqs = 0; localStorage.setItem('visionReqs', '0'); localStorage.setItem('textReqs', '0'); }
        const t = document.getElementById('apiTimer'); if(t) t.innerText = apiTime + 's'; 
        const v = document.getElementById('apiVision'); if(v) v.innerText = visionReqs; 
        const txt = document.getElementById('apiText'); if(txt) txt.innerText = textReqs;
    }, 1000);

    const inputs = [{id:"searchInput", fn:runGroqSearch}, {id:"mathInstructionInput", fn:executeMathFlow}];
    inputs.forEach(i => { const el = document.getElementById(i.id); if(el) el.addEventListener("keypress", (e) => { if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); i.fn(); } }); });
    if (document.getElementById('historyList')) renderHistory();
});

// --- 2. UI HELPERS ---
function track(type) { if(type==='v'){ visionReqs++; localStorage.setItem('visionReqs', visionReqs); } else { textReqs++; localStorage.setItem('textReqs', textReqs); } }
function autoResize(ta) { ta.style.height = '40px'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }
function toggleSidebar() { document.getElementById("sidebar").classList.toggle("active"); document.getElementById("overlay").classList.toggle("active"); }
if(document.getElementById("overlay")) document.getElementById("overlay").onclick = toggleSidebar;

function appendUserBubble(txt, img, cid) {
    const c = document.getElementById(cid); if(!c) return;
    let iH = img ? `<img src="${img}" class="bubble-img" onclick="viewSpecificImage('${img}')">` : '';
    let tH = txt ? `<div>${txt.replace(/\n/g, '<br>')}</div>` : '';
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-user"><div class="bubble">${iH}${tH}</div></div>`);
    scrollToBottom(cid.replace('ChatHistory', 'ScrollArea'));
}
function appendAiLoading(cid) {
    const c = document.getElementById(cid); if(!c) return null;
    const id = "loading_" + Date.now();
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-ai" id="${id}"><div class="bubble"><div class="spinner"></div> Thinking...</div></div>`);
    scrollToBottom(cid.replace('ChatHistory', 'ScrollArea')); return id;
}
function updateAiBubble(id, txt) { const el = document.getElementById(id); if(el) el.querySelector('.bubble').innerHTML = txt.replace(/\n/g, '<br>'); }
function scrollToBottom(aid) { setTimeout(() => { const a = document.getElementById(aid); if(a) a.scrollTop = a.scrollHeight; }, 50); }
function viewSpecificImage(src) { const pv = document.getElementById("photoViewer"); if(pv) { document.getElementById("previewImage").src = src; pv.classList.add("active"); } }

// --- 3. API FETCHERS ---
async function callGeminiText(sys, usr, temp=0) {
  if (textReqs >= 20) throw new Error("Limit Reached"); if (isProcessing) throw new Error("Processing");
  isProcessing = true; track('t');
  try { const r = await fetch("/api/gemini-text", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ systemPrompt:sys, userPrompt:usr, temperature:temp }) }); const d = await r.json(); if(!r.ok) throw new Error(d.error); isProcessing = false; return d.text; } catch(e) { isProcessing = false; throw e; }
}
async function callGeminiVision(img, aiPrmpt, temp=0) {
  if (visionReqs >= 20) throw new Error("Limit Reached"); if (isProcessing) throw new Error("Processing");
  isProcessing = true; track('v');
  try { const r = await fetch("/api/gemini-vision", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ imageBase64:img, prompt:aiPrmpt, temperature:temp }) }); const d = await r.json(); if(!r.ok) throw new Error(d.error); isProcessing = false; return d.text; } catch(e) { isProcessing = false; throw e; }
}

// --- 4. WHATSAPP MATH SOLVER (NO MATH INPUT ERROR) ---
function clearMathImage(e) { if(e) e.stopPropagation(); capturedImage = null; const chip = document.getElementById("mathPreviewChip"); if(chip) chip.style.display = "none"; }
function viewLoadedImage(e) { if(e.target.classList.contains('image-preview-close')) return; if(capturedImage) viewSpecificImage(capturedImage); }

async function executeMathFlow() {
    const inp = document.getElementById("mathInstructionInput"); if(!inp) return;
    const instruction = inp.value.trim(); if (!capturedImage && !instruction) return;
    
    appendUserBubble(instruction || "Solve this", capturedImage, "mathChatHistory");
    inp.value = ""; autoResize(inp);
    let lId = appendAiLoading("mathChatHistory");

    // ULTIMATE PROMPT: Forces WhatsApp Meta AI style. Kills MathJax errors forever.
    const sysPrompt = `You are an expert Math Tutor. 
    CRITICAL RULES:
    1. Write the solution in HINDI, but use standard English numbers (1, 2, 3).
    2. Format EXACTLY like a WhatsApp message using bullet points, short lines, and clear steps.
    3. ABSOLUTELY NO LaTeX. DO NOT use $ signs. DO NOT use \\frac.
    4. Write fractions and math in simple plain text using symbols like ×, ÷, /, +, -, =, ≈, %. (Example: 157.50 / 1800 × 100 = 8.75%).
    5. Be very easy to understand. End with a friendly emoji.`;
    
    try {
        let sol = capturedImage ? await callGeminiVision(capturedImage, `Instruction: ${instruction}. ${sysPrompt}`, 0) : await callGeminiText(sysPrompt, instruction, 0);
        let cleanSol = sol.replace(/[\*&]/g, ''); // Clean markdown
        window.latestMathSolution = cleanSol;
        
        const bbl = document.getElementById(lId).querySelector('.bubble');
        bbl.innerHTML = `<div id="text_${lId}">${cleanSol.replace(/\n/g, '<br>')}</div>`;
        
        // Add Audio + Video UI Buttons
        bbl.insertAdjacentHTML('beforeend', `
            <div style="margin-top:15px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:10px;">
                <button class="btn green" style="padding:10px; margin:0; font-size:14px; flex:1;" onclick="speakAndHighlight('text_${lId}')">🔊 Listen</button>
                <button class="btn blue" style="padding:10px; margin:0; font-size:14px; flex:1; background:var(--red);" onclick="initVideoGui()">▶️ Video</button>
            </div>
        `);
        saveToHistory('math', instruction, cleanSol, capturedImage); scrollToBottom("mathScrollArea");
    } catch(e) { updateAiBubble(lId, "❌ Error: " + e.message); }
}

// --- 5. WORD HIGHLIGHT TTS ENGINE ---
let currentUtterance = null;
function speakAndHighlight(elId) {
    const el = document.getElementById(elId); if (!el) return;
    
    // Stop any current speaking
    window.speechSynthesis.cancel();
    
    // Check if already spanned
    if(!el.innerHTML.includes('class="word"')) {
        const text = el.innerText;
        const words = text.split(/(\s+)/); // Preserve spaces
        el.innerHTML = words.map(w => w.trim() ? `<span class="word">${w}</span>` : w).join('');
    }
    
    const spans = el.querySelectorAll('.word');
    const fullText = Array.from(spans).map(s => s.innerText).join(' ');
    
    currentUtterance = new SpeechSynthesisUtterance(fullText);
    currentUtterance.lang = 'hi-IN'; // Force Hindi Best Voice
    currentUtterance.rate = 1.0;

    let wIdx = 0;
    currentUtterance.onboundary = (e) => {
        if (e.name === 'word') {
            spans.forEach(s => s.classList.remove('highlighted-word'));
            if (spans[wIdx]) { spans[wIdx].classList.add('highlighted-word'); wIdx++; }
        }
    };
    currentUtterance.onend = () => { spans.forEach(s => s.classList.remove('highlighted-word')); };
    window.speechSynthesis.speak(currentUtterance);
}

// --- 6. LANDSCAPE VIDEO GUI ENGINE ---
let videoSpeed = 1.0;
let isVideoPaused = false;

function initVideoGui() {
    if(!window.latestMathSolution) return alert("Solve a math problem first!");
    
    // Try to lock landscape
    if(screen.orientation && screen.orientation.lock) { screen.orientation.lock('landscape').catch(()=>{}); }
    
    const overlay = document.createElement('div');
    overlay.id = 'videoGuiOverlay';
    overlay.innerHTML = `
        <div id="videoTopBar">
            <div id="videoTitle">🔴 AI TUTOR LIVE</div>
            <button id="videoCloseBtn" onclick="exitVideoGui()">Exit Classroom</button>
        </div>
        <div id="videoDisplayArea">
            <div id="videoContent"></div>
        </div>
        <div id="videoControlsBar">
            <button class="vc-btn speed" onclick="cycleVideoSpeed()">Speed: <span id="vSpeedTxt">1.0x</span></button>
            <button class="vc-btn play" onclick="toggleVideoPause()" id="vPlayBtn">⏸️ Pause</button>
            <button class="vc-btn" onclick="replayVideo()">🔄 Replay</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';
    playVideoLogic();
}

function exitVideoGui() {
    window.speechSynthesis.cancel();
    const ov = document.getElementById('videoGuiOverlay'); if(ov) ov.remove();
    if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
}

function cycleVideoSpeed() {
    videoSpeed = videoSpeed === 1.0 ? 1.5 : (videoSpeed === 1.5 ? 2.0 : (videoSpeed === 2.0 ? 0.5 : 1.0));
    document.getElementById('vSpeedTxt').innerText = videoSpeed.toFixed(1) + 'x';
    // Restart voice at new speed
    const isPaused = isVideoPaused;
    window.speechSynthesis.cancel();
    playVideoLogic(true); 
    if(isPaused) toggleVideoPause();
}

function toggleVideoPause() {
    const btn = document.getElementById('vPlayBtn');
    if(window.speechSynthesis.paused) { window.speechSynthesis.resume(); isVideoPaused = false; btn.innerHTML = "⏸️ Pause"; } 
    else if (window.speechSynthesis.speaking) { window.speechSynthesis.pause(); isVideoPaused = true; btn.innerHTML = "▶️ Play"; }
}

function replayVideo() { window.speechSynthesis.cancel(); isVideoPaused = false; document.getElementById('vPlayBtn').innerHTML = "⏸️ Pause"; playVideoLogic(); }

function playVideoLogic(resumeFromCurrent = false) {
    const content = document.getElementById("videoContent");
    if(!resumeFromCurrent) {
        // Reset Text
        const words = window.latestMathSolution.split(/(\s+)/);
        content.innerHTML = words.map(w => w.trim() ? `<span class="word">${w}</span>` : w).join('').replace(/\n/g, '<br><br>');
    }
    
    const spans = content.querySelectorAll('.word');
    const cleanText = Array.from(spans).map(s => s.innerText).join(' ');

    const u = new SpeechSynthesisUtterance(cleanText);
    u.lang = 'hi-IN';
    u.rate = videoSpeed;

    let idx = 0;
    u.onboundary = (e) => {
        if (e.name === 'word') {
            spans.forEach(s => s.classList.remove('highlighted-word'));
            if (spans[idx]) { 
                spans[idx].classList.add('highlighted-word'); 
                // Auto-scroll the video box
                spans[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                idx++; 
            }
        }
    };
    u.onend = () => { spans.forEach(s => s.classList.remove('highlighted-word')); document.getElementById('vPlayBtn').innerHTML = "✅ Done"; };
    window.speechSynthesis.speak(u);
}

// --- 7. CAMERA & HARDWARE ---
let currentStream = null, currentFacing = "environment";
async function startCamera() { 
    try { if(currentStream) currentStream.getTracks().forEach(t => t.stop()); currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing, width: {ideal: 1920}, height: {ideal: 1080} } }); document.getElementById("cameraVideo").srcObject = currentStream; 
        const track = currentStream.getVideoTracks()[0]; setTimeout(async () => { try { const cap = track.getCapabilities(); if (cap.torch && currentFacing === "environment") { isFlashOn = true; await track.applyConstraints({ advanced: [{ torch: true }] }); updateFlashUI(); } else { isFlashOn = false; updateFlashUI(); } } catch(err) {} }, 500); 
    } catch(e) { alert("Camera Error."); } 
}
async function toggleFlash() { if (!currentStream) return; const track = currentStream.getVideoTracks()[0]; try { if (track.getCapabilities().torch) { isFlashOn = !isFlashOn; await track.applyConstraints({ advanced: [{ torch: isFlashOn }] }); updateFlashUI(); } } catch(err){} }
function updateFlashUI() { const btn = document.getElementById("toggleFlashBtn"); if(btn) { btn.innerText = isFlashOn ? "💡" : "🔦"; btn.style.background = isFlashOn ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"; } }
async function openCamera(m){ currentMode = m; const mod = document.getElementById("cameraModal"); if(mod) { mod.classList.add("active"); await startCamera(); } }
function closeCamera(){ const mod = document.getElementById("cameraModal"); if(mod) mod.classList.remove("active"); if(currentStream) currentStream.getTracks().forEach(t => t.stop()); }
async function switchCamera() { currentFacing = currentFacing === "environment" ? "user" : "environment"; await startCamera(); }

if(document.getElementById('closeCameraBtn')) document.getElementById('closeCameraBtn').onclick = closeCamera;
if(document.getElementById('switchCameraBtn')) document.getElementById('switchCameraBtn').onclick = switchCamera;
if(document.getElementById('capturePhotoBtn')) document.getElementById('capturePhotoBtn').onclick = capturePhoto;
if(document.getElementById('toggleFlashBtn')) document.getElementById('toggleFlashBtn').onclick = toggleFlash;
if(document.getElementById('closePreviewBtn')) document.getElementById('closePreviewBtn').onclick = () => { document.getElementById('photoViewer').classList.remove('active'); };
if(document.getElementById('clearMathImgBtn')) document.getElementById('clearMathImgBtn').onclick = clearMathImage;
if(document.getElementById('openMathCameraBtn')) document.getElementById('openMathCameraBtn').onclick = () => openCamera('math');
if(document.getElementById('sendMathBtn')) document.getElementById('sendMathBtn').onclick = executeMathFlow;

function capturePhoto(){ 
    const v = document.getElementById("cameraVideo"), c = document.getElementById("captureCanvas");
    let w = v.videoWidth, h = v.videoHeight; if(w > 1500) { h *= 1500/w; w = 1500; } 
    c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h); capturedImage = c.toDataURL("image/jpeg", 0.7); 
    if (currentMode === 'math') { const chip = document.getElementById("mathPreviewChip"); if(chip) { chip.style.display = "block"; chip.style.backgroundImage = `url(${capturedImage})`; } } 
    closeCamera(); 
}

// --- 8. SEARCH, QA, TRANSLATOR & HISTORY (Stubs for full app functionality) ---
async function runGroqSearch() { /* Same as previous versions, omit for brevity or copy over if needed */ }
function saveHistorySafe() { try { localStorage.setItem('aiHistory', JSON.stringify(appHistory)); } catch(e) { appHistory.pop(); saveHistorySafe(); } }
function saveToHistory(type, q, a, img = null) { appHistory.unshift({ id: Date.now(), type, title: q.substring(0,30), question: q, answer: a, image: img }); saveHistorySafe(); }
function renderHistory() { /* Renders history items */ }

window.toggleSidebar = toggleSidebar; window.openCamera = openCamera; window.closeCamera = closeCamera; window.switchCamera = switchCamera; window.capturePhoto = capturePhoto; window.clearMathImage = clearMathImage; window.viewLoadedImage = viewLoadedImage; window.executeMathFlow = executeMathFlow; window.speakAndHighlight = speakAndHighlight; window.initVideoGui = initVideoGui; window.exitVideoGui = exitVideoGui; window.cycleVideoSpeed = cycleVideoSpeed; window.toggleVideoPause = toggleVideoPause; window.replayVideo = replayVideo; window.toggleFlash = toggleFlash;
