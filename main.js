/* =======================================================
   AI PRO SUITE - ULTIMATE BUILD (FRACTIONS + PREMIUM VOICE)
======================================================= */

let appHistory = [];
try { appHistory = JSON.parse(localStorage.getItem('aiHistory') || '[]'); } catch(e) { appHistory = []; }

let apiTime = 60, visionReqs = parseInt(localStorage.getItem('visionReqs') || '0'), textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false, capturedImage = null, currentMode = "", qaImages = [], qaContextText = "", isFlashOn = true, videoSpeed = 1.0, isVideoPaused = false; 
window.latestMathSolution = "";
let availableVoices = [];

// Force load voices immediately to fix the "reading English" bug
function loadVoices() {
    availableVoices = window.speechSynthesis.getVoices();
}
window.speechSynthesis.onvoiceschanged = loadVoices;

document.addEventListener("DOMContentLoaded", () => {
    loadVoices();
    setInterval(() => {
        apiTime--; if(apiTime <= 0) { apiTime = 60; visionReqs = 0; textReqs = 0; localStorage.setItem('visionReqs', '0'); localStorage.setItem('textReqs', '0'); }
        const t = document.getElementById('apiTimer'); if(t) t.innerText = apiTime + 's'; 
    }, 1000);
    if (document.getElementById('historyList')) renderHistory();
});

// --- CORE HELPERS ---
function track(type) { if(type==='v'){ visionReqs++; localStorage.setItem('visionReqs', visionReqs); } else { textReqs++; localStorage.setItem('textReqs', textReqs); } }
function toggleSidebar() { document.getElementById("sidebar").classList.toggle("active"); document.getElementById("overlay").classList.toggle("active"); }
if(document.getElementById("overlay")) document.getElementById("overlay").onclick = toggleSidebar;
function setStatusLoading(id, txt) { const el = document.getElementById(id); if(el) { el.innerHTML = `<div class="spinner"></div> ${txt}`; el.style.display = "flex"; } }
function scrollToBottom(aid) { setTimeout(() => { const a = document.getElementById(aid); if(a) a.scrollTop = a.scrollHeight; }, 50); }

function appendUserBubble(txt, img, cid) {
    const c = document.getElementById(cid); if(!c) return;
    let iH = img ? `<img src="${img}" class="bubble-img">` : '';
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

// --- API FETCHERS ---
async function callGeminiText(sysText, usrText, temp=0) {
  if (isProcessing) throw new Error("Processing"); isProcessing = true; track('t');
  try { const r = await fetch("/api/gemini-text", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ systemPrompt:sysText, userPrompt:usrText, temperature:temp }) }); const d = await r.json(); if(!r.ok) throw new Error(d.error); isProcessing = false; return d.text; } catch(e) { isProcessing = false; throw e; }
}
async function callGeminiVision(imgData, aiQuery, temp=0) {
  if (isProcessing) throw new Error("Processing"); isProcessing = true; track('v');
  try { const r = await fetch("/api/gemini-vision", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ imageBase64:imgData, prompt:aiQuery, temperature:temp }) }); const d = await r.json(); if(!r.ok) throw new Error(d.error); isProcessing = false; return d.text; } catch(e) { isProcessing = false; throw e; }
}

// --- PREMIUM HUMAN VOICE MATCHER ---
function applyBestHindiVoice(utterance) {
    if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
    // Search for Premium Google Network Hindi Voice
    let premium = availableVoices.find(v => (v.name.includes('Google') || v.name.includes('Premium')) && v.lang.includes('hi'));
    let fallback = availableVoices.find(v => v.lang.includes('hi'));
    if (premium) utterance.voice = premium;
    else if (fallback) utterance.voice = fallback;
    utterance.lang = 'hi-IN'; // Force Hindi engine
}

// --- MATH SOLVER (FRACTIONS SUPPORTED & SAFE) ---
function clearMathImage(e) { if(e) e.stopPropagation(); capturedImage = null; const chip = document.getElementById("mathPreviewChip"); if(chip) chip.style.display = "none"; }
async function executeMathFlow() {
    const inp = document.getElementById("mathInstructionInput"); if(!inp) return;
    const instruction = inp.value.trim(); if (!capturedImage && !instruction) return;
    
    appendUserBubble(instruction || "Solve this", capturedImage, "mathChatHistory");
    inp.value = ""; let lId = appendAiLoading("mathChatHistory");

    // SAFE MATHJAX PROMPT: Allows fractions but explicitly bans Hindi inside math tags
    const sysPrompt = `You are a Math Tutor. 
    1. Write the explanation strictly in HINDI.
    2. Format math formulas and FRACTIONS using LaTeX wrapped in $ symbols (e.g. $\\frac{1}{2}$).
    3. CRITICAL RULE: NEVER put any Hindi text or words inside the $ symbols. ONLY math numbers and operators inside $.
    4. Keep it clear and step-by-step.`;
    
    try {
        let sol = capturedImage ? await callGeminiVision(capturedImage, `Instruction: ${instruction}. ${sysPrompt}`, 0) : await callGeminiText(sysPrompt, instruction, 0);
        let cleanSol = sol.replace(/[\*&]/g, ''); 
        window.latestMathSolution = cleanSol;
        
        const bbl = document.getElementById(lId).querySelector('.bubble');
        bbl.innerHTML = `<div id="text_${lId}">${cleanSol.replace(/\n/g, '<br>')}</div>`;
        if (window.MathJax) { MathJax.typesetClear([bbl]); MathJax.typesetPromise([bbl]); }
        
        bbl.insertAdjacentHTML('beforeend', `
            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:10px; padding-top:10px;">
                <button class="btn green" style="padding:10px; margin:0; flex:1;" onclick="speakAndHighlight('text_${lId}')">🔊 Listen</button>
                <button class="btn blue" style="padding:10px; margin:0; flex:1; background:var(--red);" onclick="initVideoGui()">▶️ Video Tutor</button>
            </div>
        `);
        saveToHistory('math', instruction, cleanSol, capturedImage); scrollToBottom("mathScrollArea");
    } catch(e) { document.getElementById(lId).querySelector('.bubble').innerText = "❌ Error: " + e.message; }
}

// --- VIDEO GUI (LINE-BY-LINE FRACTION EXPLAINER) ---
function initVideoGui() {
    if(!window.latestMathSolution) return;
    if(screen.orientation && screen.orientation.lock) { screen.orientation.lock('landscape').catch(()=>{}); }
    
    const ov = document.createElement('div'); ov.id = 'videoGuiOverlay';
    ov.innerHTML = `
        <div id="videoTopBar" style="padding:15px; background:rgba(0,0,0,0.8); display:flex; justify-content:space-between; color:white; font-weight:bold;">
            <div>🔴 AI TUTOR LIVE</div><button onclick="exitVideoGui()" style="background:red; color:white; border:none; padding:5px 15px; border-radius:5px;">Exit</button>
        </div>
        <div id="videoDisplayArea" style="flex:1; padding:30px; overflow-y:auto; background:#111;">
            <div id="videoContent" style="font-size: 24px; color: #fff; line-height:2.0;"></div>
        </div>
        <div id="videoControlsBar" style="padding:20px; background:rgba(0,0,0,0.9); display:flex; justify-content:center; gap:15px;">
            <button class="btn blue" style="width:auto; padding:10px 20px;" onclick="cycleVideoSpeed()">Speed: <span id="vSpeedTxt">1.0x</span></button>
            <button class="btn green" style="width:auto; padding:10px 20px;" onclick="toggleVideoPause()" id="vPlayBtn">⏸️ Pause</button>
            <button class="btn" style="width:auto; padding:10px 20px; background:#444; color:white;" onclick="replayVideo()">🔄 Replay</button>
        </div>
    `;
    document.body.appendChild(ov); ov.style.display = 'flex';
    playFractionVideo();
}

function exitVideoGui() { window.speechSynthesis.cancel(); const ov = document.getElementById('videoGuiOverlay'); if(ov) ov.remove(); if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }
function cycleVideoSpeed() { videoSpeed = videoSpeed === 1.0 ? 1.5 : (videoSpeed === 1.5 ? 2.0 : (videoSpeed === 2.0 ? 0.5 : 1.0)); document.getElementById('vSpeedTxt').innerText = videoSpeed.toFixed(1) + 'x'; window.speechSynthesis.cancel(); replayVideo(); }
function toggleVideoPause() { const btn = document.getElementById('vPlayBtn'); if(window.speechSynthesis.paused) { window.speechSynthesis.resume(); isVideoPaused = false; btn.innerHTML = "⏸️ Pause"; } else if (window.speechSynthesis.speaking) { window.speechSynthesis.pause(); isVideoPaused = true; btn.innerHTML = "▶️ Play"; } }
function replayVideo() { window.speechSynthesis.cancel(); isVideoPaused = false; document.getElementById('vPlayBtn').innerHTML = "⏸️ Pause"; playFractionVideo(); }

async function playFractionVideo() {
    const content = document.getElementById("videoContent");
    content.innerHTML = ""; 
    const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== '');
    
    for(let i=0; i<lines.length; i++) {
        if(!document.getElementById('videoGuiOverlay')) return; 
        const lineText = lines[i];
        
        // 1. Speak the line
        const cleanSpeech = lineText.replace(/[\$\\]/g, ' ').replace(/frac/g, ' divided by ');
        const u = new SpeechSynthesisUtterance(cleanSpeech);
        applyBestHindiVoice(u);
        u.rate = videoSpeed;
        window.speechSynthesis.speak(u);
        
        // 2. Fade in the line with rendered MathJax fractions
        const lineDiv = document.createElement("div");
        lineDiv.style.opacity = 0;
        lineDiv.style.transition = "opacity 0.5s ease-in";
        lineDiv.innerHTML = lineText;
        content.appendChild(lineDiv);
        
        if (window.MathJax) { MathJax.typesetClear([lineDiv]); await MathJax.typesetPromise([lineDiv]); }
        
        setTimeout(() => { lineDiv.style.opacity = 1; content.scrollIntoView({behavior: "smooth", block: "end"}); }, 200);
        
        // Wait for voice to finish
        await new Promise(r => { u.onend = r; setTimeout(r, 2000); }); 
    }
    document.getElementById('vPlayBtn').innerHTML = "✅ Done";
}

// --- CHAT WORD HIGHLIGHT TTS ---
function speakAndHighlight(elId) {
    const el = document.getElementById(elId); if (!el) return;
    window.speechSynthesis.cancel();
    if(!el.innerHTML.includes('class="word"')) {
        const words = el.innerText.split(/(\s+)/);
        el.innerHTML = words.map(w => w.trim() ? `<span class="word">${w}</span>` : w).join('');
    }
    const spans = el.querySelectorAll('.word');
    const u = new SpeechSynthesisUtterance(Array.from(spans).map(s => s.innerText).join(' '));
    applyBestHindiVoice(u);
    u.rate = 1.0; let wIdx = 0;
    u.onboundary = (e) => { if (e.name === 'word') { spans.forEach(s => s.classList.remove('highlighted-word')); if (spans[wIdx]) { spans[wIdx].classList.add('highlighted-word'); wIdx++; } } };
    u.onend = () => { spans.forEach(s => s.classList.remove('highlighted-word')); };
    window.speechSynthesis.speak(u);
}

// --- DEEP SEARCH (GROQ) ---
async function runGroqSearch() {
    const inp = document.getElementById("searchInput"); if(!inp) return;
    const q = inp.value.trim(); if(!q) return;
    appendUserBubble(q, null, "searchChatHistory"); inp.value = ""; let lId = appendAiLoading("searchChatHistory");
    const safePrompt = "Always write your response in HINDI by default.\n\nQuery: " + q;
    try {
        const res = await fetch("/api/groq-search", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ prompt: safePrompt }) });
        const data = await res.json(); if(!res.ok) throw new Error(data.error);
        const ans = data.text.replace(/\*/g, '');
        document.getElementById(lId).querySelector('.bubble').innerHTML = `<div id="search_${lId}">${ans.replace(/\n/g, '<br>')}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button>`;
        saveToHistory('search', q, ans); scrollToBottom("searchScrollArea");
    } catch(e) { document.getElementById(lId).querySelector('.bubble').innerText = "❌ Error: " + e.message; }
}

// --- TRANSLATORS (VOICE & IMAGE) ---
let recognition; let isRecording = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) { 
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition; 
    recognition = new SpeechRec(); recognition.continuous = false; recognition.interimResults = true; 
    recognition.onstart = () => { isRecording = true; const mic = document.getElementById("micBtn"); if(mic) mic.classList.add("recording"); }; 
    recognition.onresult = (e) => { let tr = ""; for (let i = 0; i < e.results.length; i++) tr += e.results[i][0].transcript; const inp = document.getElementById("inputText"); if(inp) inp.value = tr; }; 
    recognition.onerror = () => stopRecording(); recognition.onend = () => stopRecording(); 
}
function toggleRecording() { if (!recognition) return alert("Not supported."); if (isRecording) recognition.stop(); else { recognition.lang = document.getElementById("voiceSourceLang").value; document.getElementById("inputText").value = ""; recognition.start(); } }
function stopRecording() { isRecording = false; const mic = document.getElementById("micBtn"); if(mic) mic.classList.remove("recording"); }

async function runTranslation(){ 
    const txt = document.getElementById("inputText").value.trim(); const lang = document.getElementById("targetLang").value; if(!txt) return; 
    setStatusLoading("translatedTextStatus", "Translating..."); document.getElementById("translatedTextStatus").style.display = "block";
    try{ 
        let r = await callGeminiText("You are a master translator.", `Translate to ${lang}:\n${txt}`); 
        let cleanText = r.replace(/\*/g, ''); const tId = "trans_" + Date.now();
        document.getElementById("translatedText").innerHTML = `<div id="${tId}">${cleanText}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('${tId}')">🔊 Listen</button>`; 
        document.getElementById("translatedTextStatus").style.display = "none"; saveToHistory('translation', txt, cleanText, null);
    }catch(e){ document.getElementById("translatedTextStatus").style.display = "none"; document.getElementById("translatedText").innerText = "❌ " + e.message; } 
}

async function processImageText(){ 
    if(!capturedImage) return; setStatusLoading("imageStatus", "Extracting..."); document.getElementById("imageStatus").style.display = "block"; 
    try { const r = await callGeminiVision(capturedImage, "Extract all text.", 0); document.getElementById("imageExtractedText").value = r.replace(/\*/g, ''); document.getElementById("imageStatus").innerHTML = "✅ Extraction Complete."; } catch(e) { document.getElementById("imageStatus").innerHTML = "❌ " + e.message; } 
}
async function translateExtractedText(){ 
    const txt = document.getElementById("imageExtractedText").value.trim(); const lang = document.getElementById("imageTargetLang").value; if(!txt) return; document.getElementById("translatedImageText").innerText = "Translating..."; 
    try { let t = await callGeminiText("You are a master translator.", `Translate to ${lang}:\n\n${txt}`); const clean = t.replace(/\*/g, ''); const tId = "img_trans_" + Date.now(); document.getElementById("translatedImageText").innerHTML = `<div id="${tId}">${clean}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('${tId}')">🔊 Listen</button>`; saveToHistory('translation', txt, clean, capturedImage); } catch(e) { document.getElementById("translatedImageText").innerText = "❌ " + e.message; } 
}

// --- DOCUMENT QA ---
function compressImg(file) { return new Promise((res) => { const reader = new FileReader(); reader.onload = function(e) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); let w = img.width, h = img.height; if(w>1500||h>1500) { if(w>h){h*=1500/w;w=1500;}else{w*=1500/h;h=1500;} } canvas.width=w; canvas.height=h; canvas.getContext("2d").drawImage(img,0,0,w,h); res(canvas.toDataURL("image/jpeg",0.7)); }; img.src = e.target.result; }; reader.readAsDataURL(file); }); }
function updateQaCount() { document.getElementById('fileListDisplay').innerText = `${qaImages.length} pages ready`; document.getElementById('extractBtn_qa').disabled = qaImages.length === 0; }
function clearQaImages() { qaImages = []; updateQaCount(); document.getElementById('qaStatus').innerText = "Ready"; qaContextText = ""; document.getElementById('qaContextBox').innerText = "Context will appear here..."; }
async function handleMultiUpload(e) { const files = e.target.files; for(let i=0; i<files.length; i++) { qaImages.push(await compressImg(files[i])); } updateQaCount(); }

async function extractMultiImages() { 
    if(qaImages.length===0) return; setStatusLoading("qaStatus", "Reading Doc..."); document.getElementById("qaStatus").style.display = "block"; qaContextText = ""; 
    for(let i=0; i<qaImages.length; i++) { try { const r = await callGeminiVision(qaImages[i], "Read all text.", 0); if(r) qaContextText += `\n--- PAGE ${i+1} ---\n` + r; } catch(e) {} } 
    document.getElementById('qaContextBox').innerText = qaContextText ? qaContextText.substring(0, 300) + "..." : "No text found."; document.getElementById('qaStatus').innerText = "✅ Read Successfully!"; 
}
async function askDocument() { 
    const q = document.getElementById('qaQuestionInput').value; if(!q || !qaContextText) return; document.getElementById("qaAnswerBox").innerHTML = '<div class="spinner"></div> Analyzing...'; 
    try { let a = await callGeminiText("Answer based ONLY on document text. Reply in HINDI.", `Doc Text:\n${qaContextText}\n\nQuestion: ${q}`); const clean = a.replace(/\*/g,''); const aId = "qa_ans_"+Date.now(); document.getElementById('qaAnswerBox').innerHTML = `<div id="${aId}">${clean}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('${aId}')">🔊 Listen</button>`; saveToHistory('qa', q, clean, null); } catch(e) { document.getElementById('qaAnswerBox').innerText = "❌ " + e.message; } 
}

// --- HISTORY SAVING ---
function saveHistorySafe() { try { localStorage.setItem('aiHistory', JSON.stringify(appHistory)); } catch(e) { appHistory.pop(); saveHistorySafe(); } }
function saveToHistory(type, q, a, img = null) { appHistory.unshift({ id: Date.now(), type, title: q.substring(0,25)||'Saved', question: q, answer: a, image: img }); saveHistorySafe(); }
function renderHistory() { const list = document.getElementById('historyList'); if(!list) return; if(appHistory.length === 0) return list.innerHTML = "<div style='color:var(--muted);text-align:center;'>No history saved yet.</div>"; list.innerHTML = appHistory.map(item => `<div class="wordItem" style="display:flex; justify-content:space-between; align-items:center;"><div><div class="wordTitle">${item.title}</div><div class="wordMeaning">${item.type.toUpperCase()}</div></div><button class="btn red" style="width:40px; height:40px; padding:0; border-radius:12px;" onclick="deleteHistoryItem(event, ${item.id})">🗑️</button></div>`).join(''); }
function deleteHistoryItem(e, id) { e.stopPropagation(); appHistory = appHistory.filter(i => i.id !== id); saveHistorySafe(); renderHistory(); }

// --- CAMERA ENGINE ---
let currentStream = null, currentFacing = "environment";
async function startCamera() { try { if(currentStream) currentStream.getTracks().forEach(t => t.stop()); currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing, width: {ideal: 1920}, height: {ideal: 1080} } }); document.getElementById("cameraVideo").srcObject = currentStream; const track = currentStream.getVideoTracks()[0]; setTimeout(async () => { try { const cap = track.getCapabilities(); if (cap.torch && currentFacing === "environment") { isFlashOn = true; await track.applyConstraints({ advanced: [{ torch: true }] }); updateFlashUI(); } else { isFlashOn = false; updateFlashUI(); } } catch(err) {} }, 500); } catch(e) { alert("Camera Error."); } }
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

function capturePhoto(){ 
    const v = document.getElementById("cameraVideo"), c = document.getElementById("captureCanvas");
    let w = v.videoWidth, h = v.videoHeight; if(w > 1500) { h *= 1500/w; w = 1500; } 
    c.width = w; c.height = h; c.getContext("2d").drawImage(v, 0, 0, w, h); capturedImage = c.toDataURL("image/jpeg", 0.7); 
    if (currentMode === 'math') { const chip = document.getElementById("mathPreviewChip"); if(chip) { chip.style.display = "block"; chip.style.backgroundImage = `url(${capturedImage})`; } }
    else if (currentMode === 'qa') { qaImages.push(capturedImage); updateQaCount(); }
    else if (currentMode === 'translate') { document.getElementById("imageStatus").style.display="block"; document.getElementById("imageStatus").innerText="📸 Captured!"; document.getElementById("extractBtn_trans").disabled=false; }
    closeCamera(); 
}

// Global Bindings
window.toggleSidebar = toggleSidebar; window.openCamera = openCamera; window.closeCamera = closeCamera; window.switchCamera = switchCamera; window.capturePhoto = capturePhoto; window.clearMathImage = clearMathImage; window.executeMathFlow = executeMathFlow; window.speakAndHighlight = speakAndHighlight; window.initVideoGui = initVideoGui; window.exitVideoGui = exitVideoGui; window.cycleVideoSpeed = cycleVideoSpeed; window.toggleVideoPause = toggleVideoPause; window.replayVideo = replayVideo; window.toggleFlash = toggleFlash; window.runTranslation = runTranslation; window.toggleRecording = toggleRecording; window.processImageText = processImageText; window.translateExtractedText = translateExtractedText; window.handleMultiUpload = handleMultiUpload; window.clearQaImages = clearQaImages; window.extractMultiImages = extractMultiImages; window.askDocument = askDocument; window.runGroqSearch = runGroqSearch; window.deleteHistoryItem = deleteHistoryItem;
