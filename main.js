/* =======================================================
   AI PRO SUITE - ULTIMATE BUILD (V38 - THE REAL FIX)
======================================================= */

let appHistory = [];
try { appHistory = JSON.parse(localStorage.getItem('aiHistory') || '[]'); } catch(e) { appHistory = []; }

let apiTime = 60, visionReqs = parseInt(localStorage.getItem('visionReqs') || '0'), textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false, capturedImage = null, currentMode = "", qaImages = [], qaContextText = "", isFlashOn = true, videoSpeed = 1.0, isVideoPaused = false; 
window.latestMathSolution = "";
let availableVoices = [];

function loadVoices() { availableVoices = window.speechSynthesis.getVoices(); }
window.speechSynthesis.onvoiceschanged = loadVoices;

document.addEventListener("DOMContentLoaded", () => {
    loadVoices();
    setInterval(() => {
        apiTime--; if(apiTime <= 0) { apiTime = 60; visionReqs = 0; textReqs = 0; localStorage.setItem('visionReqs', '0'); localStorage.setItem('textReqs', '0'); }
        const t = document.getElementById('apiTimer'); if(t) t.innerText = apiTime + 's'; 
    }, 1000);
    
    const inputs = [{id:"searchInput", fn:runGroqSearch}, {id:"mathInstructionInput", fn:executeMathFlow}];
    inputs.forEach(i => { const el = document.getElementById(i.id); if(el) el.addEventListener("keypress", (e) => { if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); i.fn(); } }); });
    
    const buttons = [ {id: "sendMathBtn", fn: executeMathFlow}, {id: "sendSearchBtn", fn: runGroqSearch}, {id: "sendQaBtn", fn: askDocument}, {id: "askQaBtn", fn: askDocument} ];
    buttons.forEach(b => { const btn = document.getElementById(b.id); if(btn) btn.onclick = b.fn; });

    if (document.getElementById('historyList')) renderHistory();

    // --- 🛑 FIX: LISTEN FOR RESTORE COMMAND IN THE URL 🛑 ---
    const urlParams = new URLSearchParams(window.location.search);
    const restoreId = urlParams.get('restore');
    if (restoreId) {
        setTimeout(() => restoreSession(null, restoreId), 300);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

// --- CORE HELPERS ---
function getActiveChatContainer(defaultId) {
    let container = document.getElementById(defaultId);
    if (!container) container = document.getElementById("mathsChatHistory");
    if (!container) container = document.getElementById("chatHistory");
    if (!container) container = document.querySelector(".chat-scroll-area");
    return container;
}

function track(type) { if(type==='v'){ visionReqs++; localStorage.setItem('visionReqs', visionReqs); } else { textReqs++; localStorage.setItem('textReqs', textReqs); } }
function toggleSidebar() { document.getElementById("sidebar").classList.toggle("active"); document.getElementById("overlay").classList.toggle("active"); }
if(document.getElementById("overlay")) document.getElementById("overlay").onclick = toggleSidebar;
function setStatusLoading(id, txt) { const el = document.getElementById(id); if(el) { el.innerHTML = `<div class="spinner"></div> ${txt}`; el.style.display = "flex"; } }
function scrollToBottom(aid) { setTimeout(() => { const a = document.getElementById(aid) || document.querySelector(".chat-scroll-area"); if(a) a.scrollTop = a.scrollHeight; }, 50); }

function appendUserBubble(txt, img, cid) {
    const c = getActiveChatContainer(cid); if(!c) return;
    let iH = img ? `<img src="${img}" class="bubble-img">` : '';
    let tH = txt ? `<div>${txt.replace(/\n/g, '<br>')}</div>` : '';
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-user"><div class="bubble">${iH}${tH}</div></div>`);
    scrollToBottom(cid.replace('ChatHistory', 'ScrollArea'));
}
function appendAiLoading(cid) {
    const c = getActiveChatContainer(cid); if(!c) return null;
    const id = "loading_" + Date.now();
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-ai" id="${id}"><div class="bubble"><div class="spinner"></div> Thinking...</div></div>`);
    scrollToBottom(cid.replace('ChatHistory', 'ScrollArea')); return id;
}

// --- 🛑 FIX: MISSING RENDER BUBBLE FUNCTION FOR RESTORE 🛑 ---
function updateAiBubble(lId, answer) {
    const loadingBubble = document.getElementById(lId);
    if (loadingBubble) {
        const bbl = loadingBubble.querySelector('.bubble');
        bbl.innerHTML = `<div id="text_${lId}">${answer.replace(/\n/g, '<br>')}</div>`;
        window.latestMathSolution = answer; // Make video tutor work for restored items
        
        if (window.MathJax) { 
            MathJax.typesetClear([bbl]); 
            MathJax.typesetPromise([bbl]); 
        }
        
        // Restore the listen/video buttons
        bbl.insertAdjacentHTML('beforeend', `
            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:10px; padding-top:10px; width:100%;">
                <button class="btn green" style="padding:12px; flex:1; font-size:14px;" onclick="speakAndHighlight('text_${lId}', 'hi-IN')">🔊 Listen</button>
                <button class="btn blue" style="padding:12px; flex:1; font-size:14px; background:rgb(220,38,38);" onclick="initVideoGui()">▶️ Video Tutor</button>
            </div>
        `);
    }
}

// --- SAFE API FETCHERS ---
async function callGeminiText(sysText, usrText) {
  if (isProcessing) throw new Error("Processing"); isProcessing = true; track('t');
  try { const r = await fetch("/api/gemini-text", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ systemPrompt: sysText, userPrompt: usrText }) }); const d = await r.json(); if(!r.ok) throw new Error(d.error); isProcessing = false; return d.text; } catch(e) { isProcessing = false; throw e; }
}
async function callGeminiVision(imgData, aiQuery) {
  if (isProcessing) throw new Error("Processing"); isProcessing = true; track('v');
  try { const r = await fetch("/api/gemini-vision", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ imageBase64: imgData, userPrompt: aiQuery }) }); const d = await r.json(); if(!r.ok) throw new Error(d.error); isProcessing = false; return d.text; } catch(e) { isProcessing = false; throw e; }
}

// --- DYNAMIC SMART VOICE ENGINE ---
function speakAndHighlight(elId, langCode = 'hi-IN') {
    const el = document.getElementById(elId); if (!el) return;
    window.speechSynthesis.cancel();
    if(!el.innerHTML.includes('class="word"')) {
        const words = el.innerText.split(/(\s+)/);
        el.innerHTML = words.map(w => w.trim() ? `<span class="word">${w}</span>` : w).join('');
    }
    const spans = el.querySelectorAll('.word');
    const u = new SpeechSynthesisUtterance(Array.from(spans).map(s => s.innerText).join(' '));
    
    if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
    let premium = availableVoices.find(v => (v.name.includes('Google') || v.name.includes('Premium')) && v.lang.includes(langCode.split('-')[0]));
    let fallback = availableVoices.find(v => v.lang.includes(langCode.split('-')[0]));
    if (premium) u.voice = premium; else if (fallback) u.voice = fallback;
    
    u.lang = langCode; u.rate = 1.0; let wIdx = 0;
    u.onboundary = (e) => { if (e.name === 'word') { spans.forEach(s => s.classList.remove('highlighted-word')); if (spans[wIdx]) { spans[wIdx].classList.add('highlighted-word'); wIdx++; } } };
    u.onend = () => { spans.forEach(s => s.classList.remove('highlighted-word')); };
    window.speechSynthesis.speak(u);
}

// --- MATH SOLVER (WITH FRACTIONS, NO ERRORS) ---
function clearMathImage(e) { if(e) e.stopPropagation(); capturedImage = null; const chip = document.getElementById("mathPreviewChip"); if(chip) chip.style.display = "none"; }
async function executeMathFlow() {
    const inp = document.getElementById("mathInstructionInput"); if(!inp) return;
    const instruction = inp.value.trim(); if (!capturedImage && !instruction) return;
    
    appendUserBubble(instruction || "Solve this", capturedImage, "mathChatHistory");
    inp.value = ""; let lId = appendAiLoading("mathChatHistory");

    const sysPrompt = `You are a Math Tutor. 
    1. Write explanations purely in HINDI.
    2. Format math formulas and FRACTIONS using LaTeX wrapped in $ symbols (e.g. $\\frac{12}{1200}$).
    3. CRITICAL RULE: NEVER put any Hindi text or words inside the $ symbols. ONLY math numbers and operators inside $. MathJax will crash if you do.
    4. Keep it clear and step-by-step.`;
    
    try {
        let sol = capturedImage ? await callGeminiVision(capturedImage, `Instruction: ${instruction}. ${sysPrompt}`) : await callGeminiText(sysPrompt, instruction);
        let cleanSol = sol.replace(/[\*&]/g, ''); window.latestMathSolution = cleanSol;
        
        const loadingBubble = document.getElementById(lId);
        if (loadingBubble) {
            const bbl = loadingBubble.querySelector('.bubble');
            bbl.innerHTML = `<div id="text_${lId}">${cleanSol.replace(/\n/g, '<br>')}</div>`;
            if (window.MathJax) { MathJax.typesetClear([bbl]); MathJax.typesetPromise([bbl]); }
            bbl.insertAdjacentHTML('beforeend', `
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:10px; padding-top:10px; width:100%;">
                    <button class="btn green" style="padding:12px; flex:1; font-size:14px;" onclick="speakAndHighlight('text_${lId}', 'hi-IN')">🔊 Listen</button>
                    <button class="btn blue" style="padding:12px; flex:1; font-size:14px; background:rgb(220,38,38);" onclick="initVideoGui()">▶️ Video Tutor</button>
                </div>
            `);
        }
        saveToHistory('math', instruction, cleanSol, capturedImage); scrollToBottom("mathScrollArea");
    } catch(e) { const el = document.getElementById(lId); if(el) el.querySelector('.bubble').innerText = "❌ Error: " + e.message; }
}

// --- VIDEO GUI ENGINE ---
function initVideoGui() {
    if(!window.latestMathSolution) return;
    if(screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{});
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
    document.body.appendChild(ov); ov.style.display = 'flex'; playFractionVideo();
}

function exitVideoGui() { window.speechSynthesis.cancel(); const ov = document.getElementById('videoGuiOverlay'); if(ov) ov.remove(); if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }
function cycleVideoSpeed() { videoSpeed = videoSpeed === 1.0 ? 1.5 : (videoSpeed === 1.5 ? 2.0 : (videoSpeed === 2.0 ? 0.5 : 1.0)); document.getElementById('vSpeedTxt').innerText = videoSpeed.toFixed(1) + 'x'; window.speechSynthesis.cancel(); replayVideo(); }
function toggleVideoPause() { const btn = document.getElementById('vPlayBtn'); if(window.speechSynthesis.paused) { window.speechSynthesis.resume(); isVideoPaused = false; btn.innerHTML = "⏸️ Pause"; } else if (window.speechSynthesis.speaking) { window.speechSynthesis.pause(); isVideoPaused = true; btn.innerHTML = "▶️ Play"; } }
function replayVideo() { window.speechSynthesis.cancel(); isVideoPaused = false; document.getElementById('vPlayBtn').innerHTML = "⏸️ Pause"; playFractionVideo(); }

async function playFractionVideo() {
    const content = document.getElementById("videoContent"); content.innerHTML = ""; 
    const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== '');
    for(let i=0; i<lines.length; i++) {
        if(!document.getElementById('videoGuiOverlay')) return; 
        const lineText = lines[i];
        
        const cleanSpeech = lineText.replace(/[\$\\]/g, ' ').replace(/frac/g, ' divided by ');
        const u = new SpeechSynthesisUtterance(cleanSpeech);
        if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
        let premium = availableVoices.find(v => (v.name.includes('Google') || v.name.includes('Premium')) && v.lang.includes('hi'));
        if (premium) u.voice = premium;
        u.lang = 'hi-IN'; u.rate = videoSpeed; window.speechSynthesis.speak(u);
        
        const lineDiv = document.createElement("div"); lineDiv.style.opacity = 0; lineDiv.style.transition = "opacity 0.5s ease-in"; lineDiv.innerHTML = lineText; content.appendChild(lineDiv);
        if (window.MathJax) { MathJax.typesetClear([lineDiv]); await MathJax.typesetPromise([lineDiv]); }
        setTimeout(() => { lineDiv.style.opacity = 1; if(content.parentElement) content.parentElement.scrollTop = content.parentElement.scrollHeight; }, 200);
        await new Promise(r => { u.onend = r; setTimeout(r, 2000); }); 
    }
    document.getElementById('vPlayBtn').innerHTML = "✅ Done";
}

// --- DEEP SEARCH ---
async function runGroqSearch() {
    const inp = document.getElementById("searchInput"); if(!inp) return;
    const q = inp.value.trim(); if(!q) return;
    appendUserBubble(q, null, "searchChatHistory"); inp.value = ""; let lId = appendAiLoading("searchChatHistory");
    try {
        const res = await fetch("/api/groq-search", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ prompt: "Always write your response in HINDI by default.\n\nQuery: " + q }) });
        const data = await res.json(); if(!res.ok) throw new Error(data.error);
        const ans = data.text.replace(/\*/g, '');
        const bbl = document.getElementById(lId);
        if (bbl) {
            bbl.querySelector('.bubble').innerHTML = `<div id="search_${lId}">${ans.replace(/\n/g, '<br>')}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('search_${lId}', 'hi-IN')">🔊 Listen</button>`;
        }
        saveToHistory('search', q, ans); scrollToBottom("searchScrollArea");
    } catch(e) { if(document.getElementById(lId)) document.getElementById(lId).querySelector('.bubble').innerText = "❌ Error: " + e.message; }
}

// --- TRANSLATORS (VOICE & IMAGE) ---
const langMap = { "Hindi": "hi-IN", "English": "en-US", "French": "fr-FR", "Spanish": "es-ES", "German": "de-DE", "Japanese": "ja-JP" };

let recognition; let isRecording = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) { 
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition; recognition = new SpeechRec(); recognition.continuous = false; recognition.interimResults = true; 
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
        const code = langMap[lang] || 'en-US'; 
        document.getElementById("translatedText").innerHTML = `<div id="${tId}">${cleanText}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('${tId}', '${code}')">🔊 Listen</button>`; 
        document.getElementById("translatedTextStatus").style.display = "none"; saveToHistory('translation', txt, cleanText, null);
    }catch(e){ document.getElementById("translatedTextStatus").style.display = "none"; document.getElementById("translatedText").innerText = "❌ " + e.message; } 
}

async function processImageText(){ 
    if(!capturedImage) return; setStatusLoading("imageStatus", "Extracting..."); document.getElementById("imageStatus").style.display = "block"; 
    try { const r = await callGeminiVision(capturedImage, "Extract all text."); document.getElementById("imageExtractedText").value = r.replace(/\*/g, ''); document.getElementById("imageStatus").innerHTML = "✅ Extraction Complete."; } catch(e) { document.getElementById("imageStatus").innerHTML = "❌ " + e.message; } 
}
async function translateExtractedText(){ 
    const txt = document.getElementById("imageExtractedText").value.trim(); const lang = document.getElementById("imageTargetLang").value; if(!txt) return; document.getElementById("translatedImageText").innerText = "Translating..."; 
    try { 
        let t = await callGeminiText("You are a master translator.", `Translate to ${lang}:\n\n${txt}`); 
        const clean = t.replace(/\*/g, ''); const tId = "img_trans_" + Date.now(); const code = langMap[lang] || 'en-US';
        document.getElementById("translatedImageText").innerHTML = `<div id="${tId}">${clean}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('${tId}', '${code}')">🔊 Listen</button>`; 
        saveToHistory('translation', txt, clean, capturedImage); 
    } catch(e) { document.getElementById("translatedImageText").innerText = "❌ " + e.message; } 
}

// --- DOCUMENT QA ---
function compressImg(file) { return new Promise((res) => { const reader = new FileReader(); reader.onload = function(e) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); let w = img.width, h = img.height; if(w>1500||h>1500) { if(w>h){h*=1500/w;w=1500;}else{w*=1500/h;h=1500;} } canvas.width=w; canvas.height=h; canvas.getContext("2d").drawImage(img,0,0,w,h); res(canvas.toDataURL("image/jpeg",0.7)); }; img.src = e.target.result; }; reader.readAsDataURL(file); }); }
function updateQaCount() { document.getElementById('fileListDisplay').innerText = `${qaImages.length} pages ready`; document.getElementById('extractBtn_qa').disabled = qaImages.length === 0; }
function clearQaImages() { qaImages = []; updateQaCount(); document.getElementById('qaStatus').innerText = "Ready"; qaContextText = ""; document.getElementById('qaContextBox').innerText = "Context will appear here..."; }
async function handleMultiUpload(e) { const files = e.target.files; for(let i=0; i<files.length; i++) { qaImages.push(await compressImg(files[i])); } updateQaCount(); }

async function extractMultiImages() { 
    if(qaImages.length===0) return; setStatusLoading("qaStatus", "Reading Doc..."); document.getElementById("qaStatus").style.display = "block"; qaContextText = ""; 
    for(let i=0; i<qaImages.length; i++) { try { const r = await callGeminiVision(qaImages[i], "Read all text."); if(r) qaContextText += `\n--- PAGE ${i+1} ---\n` + r; } catch(e) {} } 
    document.getElementById('qaContextBox').innerText = qaContextText ? qaContextText.substring(0, 300) + "..." : "No text found."; document.getElementById('qaStatus').innerText = "✅ Read Successfully!"; 
}
async function askDocument() { 
    const q = document.getElementById('qaQuestionInput').value; if(!q || !qaContextText) return; document.getElementById("qaAnswerBox").innerHTML = '<div class="spinner"></div> Analyzing...'; 
    try { let a = await callGeminiText("Answer based ONLY on document text. Reply in HINDI.", `Doc Text:\n${qaContextText}\n\nQuestion: ${q}`); const clean = a.replace(/\*/g,''); const aId = "qa_ans_"+Date.now(); document.getElementById('qaAnswerBox').innerHTML = `<div id="${aId}">${clean}</div><button class="btn green" style="margin-top:10px;" onclick="speakAndHighlight('${aId}', 'hi-IN')">🔊 Listen</button>`; saveToHistory('qa', q, clean, null); } catch(e) { document.getElementById('qaAnswerBox').innerText = "❌ " + e.message; } 
}

// --- RESTORED HISTORY SAVING & UI BUTTONS ---
function saveHistorySafe() { try { localStorage.setItem('aiHistory', JSON.stringify(appHistory)); } catch(e) { appHistory.pop(); saveHistorySafe(); } }
function saveToHistory(type, q, a, img = null) { appHistory.unshift({ id: Date.now(), type, title: q.substring(0,25)||'Saved', question: q, answer: a, image: img }); saveHistorySafe(); }
function renderHistory() { 
    const list = document.getElementById('historyList'); if(!list) return; 
    if(appHistory.length === 0) return list.innerHTML = "<div style='color:var(--muted);text-align:center;'>No history saved yet.</div>"; 
    list.innerHTML = appHistory.map(item => `
        <div class="wordItem" style="display:flex; justify-content:space-between; align-items:center;">
            <div onclick="viewHistory(${item.id})" style="flex:1;">
                <div class="wordTitle">${item.title}</div>
                <div class="wordMeaning">${item.type.toUpperCase()}</div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="actionBtnSmall green" onclick="restoreSession(event, ${item.id})">🔄</button>
                <button class="actionBtnSmall blue" onclick="quickDownload(event, ${item.id})">📥</button>
                <button class="actionBtnSmall red" onclick="deleteHistoryItem(event, ${item.id})">🗑️</button>
            </div>
        </div>
    `).join(''); 
}
function deleteHistoryItem(e, id) { e.stopPropagation(); appHistory = appHistory.filter(i => i.id !== id); saveHistorySafe(); renderHistory(); }
function quickDownload(e, id) { e.stopPropagation(); const item = appHistory.find(i => i.id === id); if(item) triggerFileDownload(item); }
function triggerFileDownload(item) { let q = item.question.replace(/<[^>]*>?/gm, ''); let a = item.answer.replace(/<[^>]*>?/gm, ''); const b = new Blob([`Title: ${item.title}\n\n--- INPUT ---\n${q}\n\n--- OUTPUT ---\n${a}`], { type: "text/plain" }); const l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `AI_${item.title}.txt`; l.click(); }
function restoreSession(e, id) { 
    if(e) e.stopPropagation(); const item = appHistory.find(i => i.id == id); if(!item) return; 
    let targetPage = ''; if(item.type === 'math') targetPage = 'maths.html'; else if(item.type === 'search') targetPage = 'search.html'; else if(item.type === 'translation') targetPage = 'image.html'; else if(item.type === 'qa') targetPage = 'qa.html';
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    if (currentPage !== targetPage && targetPage !== '') { window.location.href = `${targetPage}?restore=${id}`; return; }
    if(item.type === 'math') { document.getElementById("mathChatHistory").innerHTML = ''; appendUserBubble(item.question, item.image, "mathChatHistory"); let lId = appendAiLoading("mathChatHistory"); updateAiBubble(lId, item.answer); } 
    else if (item.type === 'search') { document.getElementById("searchChatHistory").innerHTML = ''; appendUserBubble(item.question, null, "searchChatHistory"); let lId = appendAiLoading("searchChatHistory"); updateAiBubble(lId, item.answer); }
}

// --- CAMERA CONTROL ---
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
window.toggleSidebar = toggleSidebar; window.openCamera = openCamera; window.closeCamera = closeCamera; window.switchCamera = switchCamera; window.capturePhoto = capturePhoto; window.clearMathImage = clearMathImage; window.executeMathFlow = executeMathFlow; window.speakAndHighlight = speakAndHighlight; window.initVideoGui = initVideoGui; window.exitVideoGui = exitVideoGui; window.cycleVideoSpeed = cycleVideoSpeed; window.toggleVideoPause = toggleVideoPause; window.replayVideo = replayVideo; window.toggleFlash = toggleFlash; window.runTranslation = runTranslation; window.toggleRecording = toggleRecording; window.processImageText = processImageText; window.translateExtractedText = translateExtractedText; window.handleMultiUpload = handleMultiUpload; window.clearQaImages = clearQaImages; window.extractMultiImages = extractMultiImages; window.askDocument = askDocument; window.runGroqSearch = runGroqSearch; window.deleteHistoryItem = deleteHistoryItem; window.quickDownload = quickDownload; window.restoreSession = restoreSession;
