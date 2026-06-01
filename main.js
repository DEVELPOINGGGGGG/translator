/* =======================================================
   AI PRO SUITE - MASTER JAVASCRIPT (V29 - AI Hindi Writing Default)
======================================================= */

// --- 1. GLOBAL STATE & INITIALIZATION ---
let appHistory = [];
try { appHistory = JSON.parse(localStorage.getItem('aiHistory') || '[]'); } 
catch(e) { console.error("History error"); appHistory = []; }

let apiTime = 60; 
let visionReqs = parseInt(localStorage.getItem('visionReqs') || '0'); 
let textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false;
let capturedImage = null; 
let currentMode = ""; 
let qaImages = []; 
let qaContextText = "";
let isFlashOn = true; 

document.addEventListener("DOMContentLoaded", () => {
    // 1. Setup API Trackers
    const timerEl = document.getElementById('apiTimer');
    if (timerEl) {
        document.getElementById('apiVision').innerText = visionReqs; 
        document.getElementById('apiText').innerText = textReqs;
        setInterval(() => {
            apiTime--;
            if(apiTime <= 0) { 
                apiTime = 60; visionReqs = 0; textReqs = 0; 
                localStorage.setItem('visionReqs', '0'); localStorage.setItem('textReqs', '0'); 
            }
            document.getElementById('apiTimer').innerText = apiTime + 's'; 
            document.getElementById('apiVision').innerText = visionReqs; 
            document.getElementById('apiText').innerText = textReqs;
        }, 1000);
    }

    // 2. Safely attach Enter-key listeners for chat inputs
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("keypress", (e) => { if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runGroqSearch(); } });
    }
    const mathInput = document.getElementById("mathInstructionInput");
    if (mathInput) {
        mathInput.addEventListener("keypress", (e) => { if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); executeMathFlow(); } });
    }

    // 3. Render history automatically if on History page
    if (document.getElementById('historyList')) renderHistory();

    // 4. CROSS-PAGE RESTORE LOGIC
    const urlParams = new URLSearchParams(window.location.search);
    const restoreId = urlParams.get('restore');
    if (restoreId) {
        restoreSession(null, parseInt(restoreId));
        window.history.replaceState({}, document.title, window.location.pathname); // Clean URL
    }
});

// --- 2. TRACKERS & UI HELPERS ---
function trackVision() { visionReqs++; localStorage.setItem('visionReqs', visionReqs); const el = document.getElementById('apiVision'); if(el) el.innerText = visionReqs; }
function trackText() { textReqs++; localStorage.setItem('textReqs', textReqs); const el = document.getElementById('apiText'); if(el) el.innerText = textReqs; }

function setStatusLoading(elementId, text) { 
    const el = document.getElementById(elementId);
    if(el) { el.innerHTML = `<div class="spinner"></div> ${text}`; el.style.display = "flex"; }
}

function autoResize(textarea) {
    textarea.style.height = '40px';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function toggleSidebar() { 
    document.getElementById("sidebar").classList.toggle("active"); 
    document.getElementById("overlay").classList.toggle("active"); 
}
if(document.getElementById("overlay")) {
    document.getElementById("overlay").onclick = () => { document.getElementById("sidebar").classList.remove("active"); document.getElementById("overlay").classList.remove("active"); };
}

// --- 3. CHAT BUBBLE HELPERS ---
function appendUserBubble(text, imgSrc, containerId) {
    const container = document.getElementById(containerId);
    if(!container) return;
    let imgHtml = imgSrc ? `<img src="${imgSrc}" class="bubble-img" onclick="viewSpecificImage('${imgSrc}')">` : '';
    let textHtml = text ? `<div>${text.replace(/\n/g, '<br>')}</div>` : '';
    container.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-user"><div class="bubble">${imgHtml}${textHtml}</div></div>`);
    scrollToBottom(containerId.replace('ChatHistory', 'ScrollArea'));
}

function appendAiLoading(containerId) {
    const container = document.getElementById(containerId);
    if(!container) return null;
    const id = "loading_" + Date.now();
    container.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-ai" id="${id}"><div class="bubble"><div class="spinner"></div> Thinking...</div></div>`);
    scrollToBottom(containerId.replace('ChatHistory', 'ScrollArea'));
    return id;
}

function updateAiBubble(id, text) {
    const el = document.getElementById(id);
    if(el) {
        el.querySelector('.bubble').innerHTML = text.replace(/\n/g, '<br>');
        if (window.MathJax) { MathJax.typesetClear([el]); MathJax.typesetPromise([el]); }
    }
}

function scrollToBottom(areaId) {
    setTimeout(() => { const area = document.getElementById(areaId); if(area) area.scrollTop = area.scrollHeight; }, 50);
}

function viewSpecificImage(src) {
    const pv = document.getElementById("photoViewer");
    if(pv) { document.getElementById("previewImage").src = src; pv.classList.add("active"); }
}

// --- 4. CORE API FETCHERS ---
async function callGeminiText(systemPrompt, userPrompt, temp = 0) {
  if (textReqs >= 20) throw new Error("⏳ Text Limit Reached! Wait for timer.");
  if (isProcessing) throw new Error("⏳ AI is already processing.");
  isProcessing = true; trackText();
  try {
      const res = await fetch("/api/gemini-text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemPrompt, userPrompt, temperature: temp }) });
      const data = await res.json(); if(!res.ok) throw new Error(data.error); isProcessing = false; return data.text;
  } catch(e) { isProcessing = false; throw e; }
}

async function callGeminiVision(imageBase64, aiPrompt, temp = 0) {
  if (visionReqs >= 20) throw new Error("⏳ Vision Limit Reached! Wait for timer.");
  if (isProcessing) throw new Error("⏳ AI is already processing.");
  isProcessing = true; trackVision();
  try {
      const res = await fetch("/api/gemini-vision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64, prompt: aiPrompt, temperature: temp }) });
      const data = await res.json(); if(!res.ok) throw new Error(data.error); isProcessing = false; return data.text;
  } catch(e) { isProcessing = false; throw e; }
}

// --- 5. DEEP SEARCH (GROQ) ---
async function runGroqSearch() {
    const inputField = document.getElementById("searchInput");
    if(!inputField) return;
    const q = inputField.value.trim();
    if(!q) return;
    
    appendUserBubble(q, null, "searchChatHistory");
    inputField.value = ""; autoResize(inputField);
    let loadingId = appendAiLoading("searchChatHistory");
    
    // Inject the Hindi rule directly into the payload so we don't have to change server.js
    const groqPrompt = "CRITICAL RULE: You MUST always write your response in HINDI by default. ONLY reply in another language if the user explicitly asks for it in their query (e.g., 'talk in English', 'explain in French').\n\nUser Query: " + q;

    try {
        const res = await fetch("/api/groq-search", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ prompt: groqPrompt })
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || "Search failed");
        
        const ans = data.text.replace(/\*/g, '');
        updateAiBubble(loadingId, ans);
        saveToHistory('search', q, ans);
        scrollToBottom("searchScrollArea");
    } catch(e) { updateAiBubble(loadingId, "❌ " + e.message); }
}

// --- 6. MATH SOLVER ---
function clearMathImage(e) {
    if(e) e.stopPropagation();
    capturedImage = null;
    const chip = document.getElementById("mathPreviewChip");
    if(chip) chip.style.display = "none";
}
function viewLoadedImage(e) {
    if(e.target.classList.contains('image-preview-close')) return;
    if(capturedImage) viewSpecificImage(capturedImage);
}

async function executeMathFlow() {
    const inputField = document.getElementById("mathInstructionInput");
    if(!inputField) return;
    const instruction = inputField.value.trim();

    if (!capturedImage && !instruction) return;
    
    appendUserBubble(instruction || "Solve this image", capturedImage, "mathChatHistory");
    inputField.value = ""; autoResize(inputField);
    let loadingId = appendAiLoading("mathChatHistory");

    // UPDATED PROMPT: Write in Hindi by default, but respect user language requests
    const systemPrompt = `You are an expert Math Tutor for a class 9 student. 
    IMPORTANT RULES:
    1. Extract and solve the problem based on the user's instruction.
    2. Write the ENTIRE solution strictly in HINDI by default. IF the user specifically asks to explain in another language (e.g., 'talk in English'), use that requested language instead.
    3. Explain simply and step-by-step.
    4. MUST wrap ALL math fractions, roots, and equations in $ symbols (e.g., $\\frac{47}{100}$ or $\\sqrt{43}$).
    5. CRITICAL RULE: NEVER put text words inside the $ symbols. ONLY numbers and math operators go inside $. MathJax will break if you put text inside $! 
       - BAD Example: $कुल हानि = 12$
       - GOOD Example: कुल हानि = $12$`;
    
    try {
        let sol = "";
        if (capturedImage) {
            const aiPrompt = `User instruction: "${instruction || 'Solve the math problem in this image'}".\n\n${systemPrompt}`;
            sol = await callGeminiVision(capturedImage, aiPrompt, 0);
        } else {
            sol = await callGeminiText(systemPrompt, `Solve this problem:\n\n${instruction}`, 0);
        }

        let cleanSol = sol.replace(/[\*&]/g, ''); 
        updateAiBubble(loadingId, cleanSol);
        saveToHistory('math', instruction || "Solve Image", cleanSol, capturedImage); 
        scrollToBottom("mathScrollArea");
    } catch(e) { 
        updateAiBubble(loadingId, "❌ " + e.message); 
    }
}

// --- 7. CAMERA & FLASHLIGHT SYSTEM ---
let currentStream = null, currentFacing = "environment";

async function startCamera() { 
    try { 
        if(currentStream) currentStream.getTracks().forEach(t => t.stop()); 
        currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing, width: {ideal: 1920}, height: {ideal: 1080} } }); 
        document.getElementById("cameraVideo").srcObject = currentStream; 
        
        const track = currentStream.getVideoTracks()[0];
        setTimeout(async () => {
            try {
                const capabilities = track.getCapabilities();
                if (capabilities.torch && currentFacing === "environment") {
                    isFlashOn = true;
                    await track.applyConstraints({ advanced: [{ torch: true }] });
                    updateFlashUI();
                } else {
                    isFlashOn = false;
                    updateFlashUI();
                }
            } catch(err) { console.log("Torch not supported."); }
        }, 500); 
    } catch(e) { alert("Camera Error. Please allow permissions."); } 
}

async function toggleFlash() {
    if (!currentStream) return;
    const track = currentStream.getVideoTracks()[0];
    try {
        const capabilities = track.getCapabilities();
        if (capabilities.torch) {
            isFlashOn = !isFlashOn;
            await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
            updateFlashUI();
        } else {
            alert("Flashlight not supported on this camera lens.");
        }
    } catch(err) { console.error("Error toggling flash", err); }
}

function updateFlashUI() {
    const btn = document.getElementById("toggleFlashBtn");
    if(btn) {
        btn.innerText = isFlashOn ? "💡" : "🔦";
        btn.style.background = isFlashOn ? "rgba(255, 255, 255, 0.4)" : "rgba(255,255,255,0.15)";
    }
}

async function openCamera(m){ 
    currentMode = m; 
    const mod = document.getElementById("cameraModal");
    if(mod) { mod.classList.add("active"); await startCamera(); }
}

function closeCamera(){ 
    const mod = document.getElementById("cameraModal");
    if(mod) mod.classList.remove("active"); 
    if(currentStream) currentStream.getTracks().forEach(t => t.stop()); 
}

async function switchCamera() { 
    currentFacing = currentFacing === "environment" ? "user" : "environment"; 
    await startCamera(); 
}

if(document.getElementById('closeCameraBtn')) document.getElementById('closeCameraBtn').onclick = closeCamera;
if(document.getElementById('switchCameraBtn')) document.getElementById('switchCameraBtn').onclick = switchCamera;
if(document.getElementById('capturePhotoBtn')) document.getElementById('capturePhotoBtn').onclick = capturePhoto;
if(document.getElementById('toggleFlashBtn')) document.getElementById('toggleFlashBtn').onclick = toggleFlash;
if(document.getElementById('closePreviewBtn')) document.getElementById('closePreviewBtn').onclick = () => { document.getElementById('photoViewer').classList.remove('active'); };
if(document.getElementById('clearMathImgBtn')) document.getElementById('clearMathImgBtn').onclick = clearMathImage;
if(document.getElementById('openMathCameraBtn')) document.getElementById('openMathCameraBtn').onclick = () => openCamera('math');
if(document.getElementById('sendMathBtn')) document.getElementById('sendMathBtn').onclick = executeMathFlow;
if(document.getElementById('sendSearchBtn')) document.getElementById('sendSearchBtn').onclick = runGroqSearch;

function capturePhoto(){ 
    const video = document.getElementById("cameraVideo");
    const captureCanvas = document.getElementById("captureCanvas");
    let w = video.videoWidth; let h = video.videoHeight; if(w > 1500) { h *= 1500/w; w = 1500; } 
    captureCanvas.width = w; captureCanvas.height = h; captureCanvas.getContext("2d").drawImage(video, 0, 0, w, h); 
    capturedImage = captureCanvas.toDataURL("image/jpeg", 0.7); 
    
    if(currentMode === 'qa') { qaImages.push(capturedImage); updateQaImageCount(); } 
    else if (currentMode === 'math') { 
        const chip = document.getElementById("mathPreviewChip");
        if(chip) { chip.style.display = "block"; chip.style.backgroundImage = `url(${capturedImage})`; }
    } 
    else if (currentMode === 'translate') { 
        const status = document.getElementById("imageStatus");
        if(status) { status.style.display = "block"; status.innerText="📸 Captured!"; }
        if(document.getElementById("viewBtn_trans")) document.getElementById("viewBtn_trans").disabled = false; 
        if(document.getElementById("extractBtn_trans")) document.getElementById("extractBtn_trans").disabled = false; 
    } 
    closeCamera(); 
}
function viewPhoto(){ 
    const pv = document.getElementById("photoViewer");
    if(pv) { document.getElementById("previewImage").src = capturedImage; pv.classList.add("active"); }
}

// --- 8. TTS (TEXT TO SPEECH) ---
const ttsPlayer = document.getElementById('ttsPlayer'); let ttsUtterance = null; let isPaused = false; let isDragging = false; let initialX, initialY;
if(ttsPlayer) {
    ttsPlayer.addEventListener("touchstart", dragStart, {passive: false}); ttsPlayer.addEventListener("touchmove", drag, {passive: false});
    window.addEventListener("mouseup", dragEnd); window.addEventListener("touchend", dragEnd); window.addEventListener("mousemove", drag);
    
    document.getElementById('ttsPlayBtn').onclick = toggleTTS;
    document.getElementById('ttsStopBtn').onclick = stopTTS;
    document.getElementById('ttsCloseBtn').onclick = closeTTS;
}

function dragStart(e) { if (e.target.closest('.ttsBtn')) return; let rect = ttsPlayer.getBoundingClientRect(); initialX = (e.type === "touchstart" ? e.touches[0].clientX : e.clientX) - rect.left; initialY = (e.type === "touchstart" ? e.touches[0].clientY : e.clientY) - rect.top; isDragging = true; }
function dragEnd() { isDragging = false; } 
function drag(e) { if (isDragging && ttsPlayer) { e.preventDefault(); let x = e.type === "touchmove" ? e.touches[0].clientX : e.clientX; let y = e.type === "touchmove" ? e.touches[0].clientY : e.clientY; let nx = x - initialX; let ny = y - initialY; ttsPlayer.style.left = nx + "px"; ttsPlayer.style.top = ny + "px"; ttsPlayer.style.right = "auto"; ttsPlayer.style.bottom = "auto"; ttsPlayer.style.transform = "none"; } } 

let currentSpeakingElement = null;

function speakText(id) { 
    const el = document.getElementById(id); if(!el) return; 
    let text = el.innerText.replace(/<[^>]*>?/gm, '').replace(/[\$\\]/g, ' ').replace(/\*\*/g, '').replace(/&&/g, ' '); 
    window.speechSynthesis.cancel(); 
    ttsUtterance = new SpeechSynthesisUtterance(text); 
    
    // Default to Hindi TTS voice
    let langCode = 'hi-IN'; 
    
    if (id === 'translatedText' && document.getElementById("targetLang")) {
        const val = document.getElementById("targetLang").value.toLowerCase();
        if(val.includes('english')) langCode = 'en-US';
        else if(val.includes('french')) langCode = 'fr-FR';
        else if(val.includes('spanish')) langCode = 'es-ES';
        else if(val.includes('german')) langCode = 'de-DE';
        else if(val.includes('japanese')) langCode = 'ja-JP';
    } else if (id === 'translatedImageText' && document.getElementById("imageTargetLang")) {
        const val = document.getElementById("imageTargetLang").value.toLowerCase();
        if(val.includes('english')) langCode = 'en-US';
        else if(val.includes('french')) langCode = 'fr-FR';
        else if(val.includes('spanish')) langCode = 'es-ES';
        else if(val.includes('german')) langCode = 'de-DE';
        else if(val.includes('japanese')) langCode = 'ja-JP';
    }
    
    ttsUtterance.lang = langCode; 
    
    currentSpeakingElement = el; 
    el.style.border = "2px solid var(--accent)"; 
    ttsUtterance.onend = () => { document.getElementById('ttsPlayBtn').innerText = '▶️'; if(currentSpeakingElement) currentSpeakingElement.style.border = "1px solid rgba(255,255,255,.05)"; }; 
    window.speechSynthesis.speak(ttsUtterance); 
    isPaused = false; 
    document.getElementById('ttsPlayBtn').innerText = '⏸️'; 
    if(ttsPlayer) ttsPlayer.style.display = 'flex'; 
}

function toggleTTS() { if(!ttsUtterance) return; if (isPaused) { window.speechSynthesis.resume(); isPaused = false; document.getElementById('ttsPlayBtn').innerText = '⏸️'; } else { window.speechSynthesis.pause(); isPaused = true; document.getElementById('ttsPlayBtn').innerText = '▶️'; } }
function stopTTS() { window.speechSynthesis.cancel(); isPaused = false; document.getElementById('ttsPlayBtn').innerText = '▶️'; if(currentSpeakingElement) currentSpeakingElement.style.border = "1px solid rgba(255,255,255,.05)"; }
function closeTTS() { stopTTS(); if(ttsPlayer) ttsPlayer.style.display = 'none'; }

// --- 9. CROSS-PAGE HISTORY ENGINE ---
function saveHistorySafe() { try { localStorage.setItem('aiHistory', JSON.stringify(appHistory)); } catch(e) { let freed = false; for(let i = appHistory.length - 1; i >= 0; i--) { if(appHistory[i].image) { appHistory[i].image = null; freed = true; break; } } if(freed) saveHistorySafe(); else { appHistory.pop(); saveHistorySafe(); } } }

function saveToHistory(type, question, answer, img = null) { 
    let temp = isProcessing; isProcessing = false; 
    fetch("/api/groq-search", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({prompt:`Generate 2-4 word title for: ${question.substring(0,50)}`})}).then(r=>r.json()).then(d => { 
        isProcessing = temp; let t = (d.text||'').replace(/[^a-zA-Z0-9\s]/g, '').trim().substring(0,35); 
        appHistory.unshift({ id: Date.now(), type, title: t||'Saved Item', question, answer, image: img }); 
        saveHistorySafe(); 
    }).catch(() => { 
        isProcessing = temp; appHistory.unshift({ id: Date.now(), type, title: 'Saved Item', question, answer, image: img }); 
        saveHistorySafe(); 
    }); 
}

function renderHistory() { 
    const list = document.getElementById('historyList'); if(!list) return; 
    if(appHistory.length === 0) return list.innerHTML = "<div style='color:var(--muted); text-align:center;'>No history saved yet.</div>"; 
    list.innerHTML = appHistory.map(item => `<div class="wordItem" style="display:flex; justify-content:space-between; align-items:center;" onclick="viewHistory(${item.id})"><div><div class="wordTitle">${item.title}</div><div class="wordMeaning">${item.type.toUpperCase()} ${item.image ? '📸' : ''}</div></div><div style="display:flex; gap:10px; align-items:center;"><button class="actionBtnSmall green" onclick="restoreSession(event, ${item.id})">🔄</button><button class="actionBtnSmall blue" onclick="quickDownload(event, ${item.id})">📥</button><button class="actionBtnSmall red" onclick="deleteHistoryItem(event, ${item.id})">🗑️</button></div></div>`).join(''); 
}

function restoreSession(e, id) { 
    if(e) e.stopPropagation(); 
    const item = appHistory.find(i => i.id == id); if(!item) return; 
    
    let targetPage = '';
    if(item.type === 'math') targetPage = 'maths.html';
    else if(item.type === 'search') targetPage = 'search.html';
    else if(item.type === 'translation') targetPage = 'image.html'; 
    else if(item.type === 'qa') targetPage = 'qa.html';

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    if (currentPage !== targetPage && targetPage !== '') {
        window.location.href = `${targetPage}?restore=${id}`;
        return;
    }

    closeHistory(); 
    if(item.type === 'math') { 
        const hist = document.getElementById("mathChatHistory");
        if(hist) {
            hist.innerHTML = ''; 
            if(item.image) { 
                capturedImage = item.image; 
                const chip = document.getElementById("mathPreviewChip");
                if(chip) { chip.style.display = "block"; chip.style.backgroundImage = `url(${capturedImage})`; }
            } 
            appendUserBubble(item.question, item.image, "mathChatHistory");
            let loadingId = appendAiLoading("mathChatHistory");
            updateAiBubble(loadingId, item.answer);
        }
    } 
    else if (item.type === 'search') { 
        const hist = document.getElementById("searchChatHistory");
        if(hist) {
            hist.innerHTML = '';
            appendUserBubble(item.question, null, "searchChatHistory");
            let loadingId = appendAiLoading("searchChatHistory");
            updateAiBubble(loadingId, item.answer);
        }
    }
}

let currentViewingHistoryId = null;
function viewHistory(id) { const item = appHistory.find(i => i.id === id); if(!item) return; currentViewingHistoryId = id; document.getElementById('histTitle').innerText = item.title; document.getElementById('histQuestion').innerHTML = item.question.replace(/\n/g, '<br>'); document.getElementById('histAnswer').innerHTML = item.answer.replace(/\n/g, '<br>'); document.getElementById('historyModal').classList.add('active'); if(window.MathJax) { MathJax.typesetClear([document.getElementById('histQuestion'), document.getElementById('histAnswer')]); MathJax.typesetPromise([document.getElementById('histQuestion'), document.getElementById('histAnswer')]); } }
function closeHistory() { const mod = document.getElementById('historyModal'); if(mod) mod.classList.remove('active'); closeTTS(); }
function clearAllHistory() { if(confirm("Clear ALL?")) { appHistory = []; saveHistorySafe(); renderHistory(); } }
function deleteHistoryItem(e, id) { e.stopPropagation(); if(confirm("Delete item?")) { appHistory = appHistory.filter(i => i.id !== id); saveHistorySafe(); renderHistory(); } }
function quickDownload(e, id) { e.stopPropagation(); const item = appHistory.find(i => i.id === id); if(item) triggerFileDownload(item); }
function downloadHistoryFile() { const item = appHistory.find(i => i.id === currentViewingHistoryId); if(item) triggerFileDownload(item); }
function triggerFileDownload(item) { let q = item.question.replace(/<[^>]*>?/gm, ''); let a = item.answer.replace(/<[^>]*>?/gm, ''); const b = new Blob([`Title: ${item.title}\n\n--- INPUT ---\n${q}\n\n--- OUTPUT ---\n${a}`], { type: "text/plain" }); const l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `AI_${item.title}.txt`; l.click(); }

// --- 10. VOICE TRANSLATOR LOGIC ---
let recognition; let isRecording = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) { 
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition; 
    recognition = new SpeechRec(); recognition.continuous = false; recognition.interimResults = true; 
    recognition.onstart = () => { isRecording = true; const mic = document.getElementById("micBtn"); if(mic) mic.classList.add("recording"); }; 
    recognition.onresult = (event) => { let tr = ""; for (let i = 0; i < event.results.length; i++) tr += event.results[i][0].transcript; const inp = document.getElementById("inputText"); if(inp) inp.value = tr; }; 
    recognition.onerror = () => stopRecording(); recognition.onend = () => stopRecording(); 
}
function toggleRecording() { if (!recognition) return alert("Not supported on this browser."); if (isRecording) recognition.stop(); else { recognition.lang = document.getElementById("voiceSourceLang").value; document.getElementById("inputText").value = ""; recognition.start(); } }
function stopRecording() { isRecording = false; const mic = document.getElementById("micBtn"); if(mic) mic.classList.remove("recording"); }

async function runTranslation(){ 
    const txt = document.getElementById("inputText").value.trim(); const lang = document.getElementById("targetLang").value; if(!txt) return; 
    setStatusLoading("translatedTextStatus", "Translating..."); 
    document.getElementById("translatedTextStatus").style.display = "block";
    try{ 
        let r = await callGeminiText(null, `Translate exactly to ${lang}:\n${txt}`); 
        document.getElementById("translatedText").innerText = r.replace(/\*/g, ''); 
        document.getElementById("speakTransBtn").style.display = "flex"; 
        document.getElementById("translatedTextStatus").style.display = "none";
        saveToHistory('translation', txt, r, null);
    }catch(e){ 
        document.getElementById("translatedTextStatus").style.display = "none";
        document.getElementById("translatedText").innerText = "❌ " + e.message; 
    } 
}

// --- 11. IMAGE TRANSLATOR LOGIC ---
async function processImageText(m){ 
    if(!capturedImage) return; 
    setStatusLoading("imageStatus", "Extracting text..."); 
    document.getElementById("imageStatus").style.display = "block"; 
    try { 
        const r = await callGeminiVision(capturedImage, "Extract all text exactly as written.", 0); 
        document.getElementById("imageExtractedText").value = r.replace(/\*/g, ''); 
        document.getElementById("imageStatus").innerHTML = "✅ Extraction Complete."; 
    } catch(e) { document.getElementById("imageStatus").innerHTML = "❌ Error: " + e.message; } 
}

async function translateExtractedText(){ 
    const txt = document.getElementById("imageExtractedText").value.trim(); 
    const lang = document.getElementById("imageTargetLang").value; if(!txt) return; 
    document.getElementById("translatedImageText").innerText = "Translating..."; 
    try { 
        let t = await callGeminiText(null, `Translate to ${lang}:\n\n${txt}`); 
        document.getElementById("translatedImageText").innerText = t.replace(/\*/g, ''); 
        saveToHistory('translation', txt, t, capturedImage); 
        document.getElementById("speakImgTransBtn").style.display = "flex"; 
    } catch(e) { document.getElementById("translatedImageText").innerText = "❌ " + e.message; } 
}

// --- 12. DOCUMENT QA LOGIC ---
function compressImageFile(file) { return new Promise((resolve) => { const reader = new FileReader(); reader.onload = function(event) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); const MAX_WIDTH = 1500; const MAX_HEIGHT = 1500; let width = img.width; let height = img.height; if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } } canvas.width = width; canvas.height = height; canvas.getContext("2d").drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL("image/jpeg", 0.7)); }; img.src = event.target.result; }; reader.readAsDataURL(file); }); }

function updateQaImageCount() { document.getElementById('fileListDisplay').innerText = `${qaImages.length} pages ready`; document.getElementById('extractBtn_qa').disabled = qaImages.length === 0; }
function clearQaImages() { qaImages = []; updateQaImageCount(); document.getElementById('qaStatus').innerText = "Ready"; qaContextText = ""; document.getElementById('qaContextBox').innerText = "Context will appear here..."; }
async function handleMultiUpload(e) { const files = e.target.files; for(let i=0; i<files.length; i++) { qaImages.push(await compressImageFile(files[i])); } updateQaImageCount(); }

async function extractMultiImages() { 
    if(qaImages.length===0) return; 
    setStatusLoading("qaStatus", "Reading Document..."); 
    document.getElementById("qaStatus").style.display = "block"; 
    qaContextText = ""; 
    for(let i=0; i<qaImages.length; i++) { 
        try { 
            let t = isProcessing; isProcessing = false; 
            const r = await callGeminiVision(qaImages[i], "Read all text on this page.", 0); 
            isProcessing = t; 
            if(r) qaContextText += `\n--- PAGE ${i+1} ---\n` + r; 
        } catch(e) { qaContextText += `\n--- PAGE ${i+1} ERROR ---\n`; } 
    } 
    document.getElementById('qaContextBox').innerText = qaContextText ? qaContextText.substring(0, 300) + "..." : "No text found."; 
    document.getElementById('qaStatus').innerText = "✅ Read Successfully!"; 
}

async function askDocument() { 
    const q = document.getElementById('qaQuestionInput').value; 
    if(!q || !qaContextText) return; 
    document.getElementById("qaAnswerBox").innerHTML = '<div class="spinner"></div> Analyzing...'; 
    try { 
        let a = await callGeminiText("Answer based ONLY on the provided document text. CRITICAL RULE: You MUST always reply in HINDI by default. ONLY reply in another language if the user explicitly asks (e.g., 'talk in English').", `Document Text:\n${qaContextText}\n\nQuestion: ${q}`); 
        document.getElementById('qaAnswerBox').innerHTML = a.replace(/\n/g, '<br>').replace(/\*/g,''); 
        document.getElementById("speakQaBtn").style.display = "flex"; 
        saveToHistory('qa', q, a, null);
    } catch(e) { document.getElementById('qaAnswerBox').innerText = "❌ " + e.message; } 
}

// Ensure functions are available globally to HTML onClick handlers
window.toggleSidebar = toggleSidebar;
window.openCamera = openCamera;
window.closeCamera = closeCamera;
window.switchCamera = switchCamera;
window.capturePhoto = capturePhoto;
window.viewPhoto = viewPhoto;
window.clearMathImage = clearMathImage;
window.viewLoadedImage = viewLoadedImage;
window.executeMathFlow = executeMathFlow;
window.runGroqSearch = runGroqSearch;
window.speakText = speakText;
window.closeHistory = closeHistory;
window.clearAllHistory = clearAllHistory;
window.deleteHistoryItem = deleteHistoryItem;
window.quickDownload = quickDownload;
window.downloadHistoryFile = downloadHistoryFile;
window.restoreSession = restoreSession;
window.viewHistory = viewHistory;
window.toggleRecording = toggleRecording;
window.runTranslation = runTranslation;
window.processImageText = processImageText;
window.translateExtractedText = translateExtractedText;
window.clearQaImages = clearQaImages;
window.handleMultiUpload = handleMultiUpload;
window.extractMultiImages = extractMultiImages;
window.askDocument = askDocument;
window.toggleFlash = toggleFlash;
