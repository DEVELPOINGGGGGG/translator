/* =======================================================
   AI PRO SUITE - THE ULTIMATE BUILD (V46 - STRICT DICTIONARY FIX)
======================================================= */

let appHistory = [];
try { appHistory = JSON.parse(localStorage.getItem('aiHistory') || '[]'); } catch(e) { appHistory = []; }

let apiTime = 60, visionReqs = parseInt(localStorage.getItem('visionReqs') || '0'), textReqs = parseInt(localStorage.getItem('textReqs') || '0');
let isProcessing = false, capturedImage = null, currentMode = "", qaImages = [], transImages = [], qaContextText = "", isFlashOn = true;
window.latestMathSolution = "";
let availableVoices = [];

// Video Player Variables
let videoSpeed = 0.75, isVideoPaused = false, currentVideoVolume = 1.0;
let videoElapsed = 0, videoTotalEst = 0, videoTickInterval, hideControlsTimer;

function loadVoices() { availableVoices = window.speechSynthesis.getVoices(); }
window.speechSynthesis.onvoiceschanged = loadVoices;

document.addEventListener("DOMContentLoaded", () => {
    loadVoices();
    setInterval(() => {
        apiTime--; if(apiTime <= 0) { apiTime = 60; visionReqs = 0; textReqs = 0; localStorage.setItem('visionReqs', '0'); localStorage.setItem('textReqs', '0'); }
        const t = document.getElementById('apiTimer'); if(t) t.innerText = apiTime + 's'; 
        
        const txtInput = document.getElementById('inputText');
        if(txtInput && document.getElementById('charCount')) document.getElementById('charCount').innerText = txtInput.value.length + " chars";
    }, 1000);
    
    const inputs = [{id:"searchInput", fn:runGroqSearch}, {id:"mathInstructionInput", fn:executeMathFlow}];
    inputs.forEach(i => { const el = document.getElementById(i.id); if(el) el.addEventListener("keypress", (e) => { if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); i.fn(); } }); });
    
    const buttons = [ 
        {id: "sendMathBtn", fn: executeMathFlow}, 
        {id: "sendSearchBtn", fn: runGroqSearch}, 
        {id: "sendQaBtn", fn: askDocument}, 
        {id: "askQaBtn", fn: askDocument},
        {id: "sendImageTransBtn", fn: executeImageTransFlow} 
    ];
    buttons.forEach(b => { const btn = document.getElementById(b.id); if(btn) btn.onclick = b.fn; });

    if(document.getElementById('openImageCameraBtn')) document.getElementById('openImageCameraBtn').onclick = () => openCamera('image_trans');

    if (document.getElementById('historyList')) renderHistory();

    const urlParams = new URLSearchParams(window.location.search);
    const restoreId = urlParams.get('restore');
    if (restoreId) {
        setTimeout(() => restoreSession(null, restoreId), 400);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

// --- UI FEATURES: TOAST NOTIFICATIONS & LIGHTBOX ---
function showToast(msg) {
    let t = document.createElement('div');
    t.innerText = msg;
    t.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:linear-gradient(135deg, #3b82f6, #8b5cf6); color:white; padding:12px 25px; border-radius:30px; box-shadow:0 10px 25px rgba(0,0,0,0.5); z-index:10000; font-weight:600; font-size: 14px; text-align:center; animation:fadeInOut 3s forwards; letter-spacing: 0.5px;";
    document.body.appendChild(t);
    
    if(!document.getElementById('toastStyles')) {
        let s = document.createElement('style'); s.id = 'toastStyles';
        s.innerHTML = "@keyframes fadeInOut { 0%{opacity:0; bottom:10px;} 10%{opacity:1; bottom:30px;} 90%{opacity:1; bottom:30px;} 100%{opacity:0; bottom:10px;} }";
        document.head.appendChild(s);
    }
    setTimeout(() => t.remove(), 3000);
}

function copyToClipboard(textId) {
    const text = document.getElementById(textId).innerText;
    navigator.clipboard.writeText(text).then(() => showToast("✅ Copied to clipboard!"));
}

function viewPhotoFullscreen(src) {
    const viewer = document.getElementById('photoViewer');
    const img = document.getElementById('previewImage');
    if(viewer && img) { img.src = src; viewer.classList.add('active'); }
}

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
    let iH = img ? `<img src="${img}" class="bubble-img" onclick="viewPhotoFullscreen(this.src)" title="Click to expand">` : '';
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

function updateAiBubble(lId, answer) {
    const loadingBubble = document.getElementById(lId);
    if (loadingBubble) {
        const bbl = loadingBubble.querySelector('.bubble');
        bbl.innerHTML = `<div id="text_${lId}">${answer.replace(/\n/g, '<br>')}</div>`;
        window.latestMathSolution = answer; 
        if (window.MathJax) { MathJax.typesetClear([bbl]); MathJax.typesetPromise([bbl]); }
        bbl.insertAdjacentHTML('beforeend', `
            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:10px; padding-top:10px; width:100%;">
                <button class="btn green" style="padding:10px; flex:1; font-size:13px;" onclick="speakAndHighlight('text_${lId}')">🔊 Listen</button>
                <button class="btn blue" style="padding:10px; flex:1; font-size:13px; background:rgb(220,38,38);" onclick="initVideoGui()">▶️ Video Tutor</button>
                <button class="btn" style="padding:10px; flex:0.5; font-size:13px; background:#475569; color:white;" onclick="copyToClipboard('text_${lId}')">📋</button>
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
function speakAndHighlight(elId) {
    const el = document.getElementById(elId); if (!el) return;
    window.speechSynthesis.cancel();
    if(!el.innerHTML.includes('class="word"')) {
        const words = el.innerText.split(/(\s+)/);
        el.innerHTML = words.map(w => w.trim() ? `<span class="word">${w}</span>` : w).join('');
    }
    const spans = el.querySelectorAll('.word');
    const u = new SpeechSynthesisUtterance(Array.from(spans).map(s => s.innerText).join(' '));
    
    const isEnglish = /^[a-zA-Z0-9\s.,!?]+$/.test(el.innerText.substring(0, 50));
    const langCode = isEnglish ? 'en-US' : 'hi-IN';

    if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
    let premium = availableVoices.find(v => (v.name.includes('Google') || v.name.includes('Premium')) && v.lang.includes(langCode.split('-')[0]));
    let fallback = availableVoices.find(v => v.lang.includes(langCode.split('-')[0]));
    if (premium) u.voice = premium; else if (fallback) u.voice = fallback;
    
    u.lang = langCode; u.rate = 1.0; let wIdx = 0;
    u.onboundary = (e) => { if (e.name === 'word') { spans.forEach(s => s.classList.remove('highlighted-word')); if (spans[wIdx]) { spans[wIdx].classList.add('highlighted-word'); wIdx++; } } };
    u.onend = () => { spans.forEach(s => s.classList.remove('highlighted-word')); };
    window.speechSynthesis.speak(u);
}

// --- SMART BILINGUAL MATH SOLVER ---
function clearMathImage(e) { if(e) e.stopPropagation(); capturedImage = null; const chip = document.getElementById("mathPreviewChip"); if(chip) chip.style.display = "none"; }
async function executeMathFlow() {
    const inp = document.getElementById("mathInstructionInput"); if(!inp) return;
    const instruction = inp.value.trim(); if (!capturedImage && !instruction) return;
    
    appendUserBubble(instruction || "Solve this", capturedImage, "mathChatHistory");
    inp.value = ""; let lId = appendAiLoading("mathChatHistory");

    const sysPrompt = `You are a Math Tutor. 
    1. EXPLAIN IN HINDI BY DEFAULT. HOWEVER, if the user asks their question explicitly in English, you MUST answer in English. Match their language.
    2. DO NOT USE ANY MARKDOWN. NO hashtags (#), NO asterisks (*), NO bold text. 
    3. Use ONLY plain words, math numbers, and basic math symbols.
    4. Use LaTeX wrapped in $ ONLY for fractions, squares, and square roots.
    5. NEVER put any text or words inside the $ symbols.`;
    
    try {
        let sol = capturedImage ? await callGeminiVision(capturedImage, `Instruction: ${instruction}. ${sysPrompt}`) : await callGeminiText(sysPrompt, instruction);
        let cleanSol = sol.replace(/[\*&#_]/g, ''); 
        
        window.latestMathSolution = cleanSol;
        updateAiBubble(lId, cleanSol);
        saveToHistory('math', instruction, cleanSol, capturedImage); scrollToBottom("mathScrollArea");
        clearMathImage();
    } catch(e) { const el = document.getElementById(lId); if(el) el.querySelector('.bubble').innerText = "❌ Error: " + e.message; }
}

// --- ULTIMATE MEDIA PLAYER ENGINE ---
function formatTime(sec) {
    let m = Math.floor(sec / 60); let s = Math.floor(sec % 60);
    return (m < 10 ? '0'+m : m) + ':' + (s < 10 ? '0'+s : s);
}

function startVideoTimer(totalChars) {
    clearInterval(videoTickInterval);
    videoElapsed = 0;
    videoTotalEst = Math.max(5, Math.floor(totalChars / (14 * videoSpeed))); 
    document.getElementById('vTimeDisplay').innerText = `00:00 / ${formatTime(videoTotalEst)}`;
    
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
    hideControlsTimer = setTimeout(() => {
        if(!isVideoPaused) { if(top) top.style.opacity = '0'; if(bot) bot.style.opacity = '0'; if(ov) ov.style.cursor = 'none'; }
    }, 3000);
}

function toggleVideoFullscreen() {
    const ov = document.getElementById('videoGuiOverlay');
    if (!document.fullscreenElement) { ov.requestFullscreen().catch(err => { console.log("Fullscreen blocked."); }); } else { document.exitFullscreen(); }
}

function updateVideoVolume(val) { currentVideoVolume = parseFloat(val); resetVideoActivity(); }

function initVideoGui() {
    if(!window.latestMathSolution) return;
    if(screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{});
    
    const ov = document.createElement('div'); ov.id = 'videoGuiOverlay';
    ov.style.cssText = "position:fixed; inset:0; background:radial-gradient(circle, #1e293b 0%, #000000 100%); z-index:9999; display:flex; flex-direction:column; font-family:'Poppins', sans-serif;";
    ov.innerHTML = `
        <div id="vTopBar" style="position:absolute; top:0; left:0; right:0; padding:20px; background:linear-gradient(rgba(0,0,0,0.9), transparent); display:flex; justify-content:space-between; transition: opacity 0.3s; z-index:100;">
            <div style="color:white; font-weight:bold; font-size:18px;">🔴 AI TUTOR LIVE</div>
            <button onclick="exitVideoGui()" style="background:rgba(239, 68, 68, 0.2); border:1px solid var(--red); color:white; padding:5px 15px; border-radius:5px; cursor:pointer;">Exit</button>
        </div>
        <div id="videoDisplayArea" style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:60px 20px; overflow-y:auto; padding-bottom:100px;">
            <div id="videoContent" style="font-size: 24px; color: #fff; line-height:2.0; max-width:800px; width:100%; text-align:left; background:rgba(0,0,0,0.4); padding:30px; border-radius:20px; border:1px solid rgba(255,255,255,0.1); box-shadow:0 10px 40px rgba(0,0,0,0.5);"></div>
        </div>
        <div id="vControlsContainer" style="position:absolute; bottom:0; left:0; right:0; padding:20px; background:linear-gradient(transparent, rgba(0,0,0,0.95)); transition: opacity 0.3s; z-index:100;">
           <div style="width:100%; height:5px; background:rgba(255,255,255,0.2); border-radius:3px; margin-bottom:15px;" id="vProgressBarBg"><div style="height:100%; width:0%; background:#3b82f6; border-radius:3px; transition: width 0.4s ease;" id="vProgressBar"></div></div>
           <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
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
    ov.addEventListener('mousemove', resetVideoActivity); ov.addEventListener('touchstart', resetVideoActivity); ov.addEventListener('click', resetVideoActivity);
    resetVideoActivity(); playFractionVideo();
}

function exitVideoGui() { 
    window.speechSynthesis.cancel(); clearInterval(videoTickInterval); clearTimeout(hideControlsTimer);
    const ov = document.getElementById('videoGuiOverlay'); 
    if(ov) { if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.remove(); }
    if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); 
}

function cycleVideoSpeed() { 
    videoSpeed = videoSpeed === 0.75 ? 1.0 : (videoSpeed === 1.0 ? 1.5 : (videoSpeed === 1.5 ? 2.0 : 0.75)); 
    document.getElementById('vSpeedTxt').innerText = videoSpeed + 'x'; 
    window.speechSynthesis.cancel(); resetVideoActivity(); replayVideo(); 
}

function toggleVideoPause() { 
    const btn = document.getElementById('vPlayBtn'); 
    if(window.speechSynthesis.paused) { window.speechSynthesis.resume(); isVideoPaused = false; btn.innerHTML = "⏸️"; } else if (window.speechSynthesis.speaking) { window.speechSynthesis.pause(); isVideoPaused = true; btn.innerHTML = "▶️"; } 
    resetVideoActivity();
}

function replayVideo() { window.speechSynthesis.cancel(); isVideoPaused = false; document.getElementById('vPlayBtn').innerHTML = "⏸️"; playFractionVideo(); }

async function playFractionVideo() {
    const content = document.getElementById("videoContent"); content.innerHTML = ""; 
    const lines = window.latestMathSolution.split('\n').filter(l => l.trim() !== '');
    startVideoTimer(window.latestMathSolution.length);
    const pBar = document.getElementById('vProgressBar'); if(pBar) pBar.style.width = '0%';
    
    for(let i=0; i<lines.length; i++) {
        if(!document.getElementById('videoGuiOverlay')) return; 
        const lineText = lines[i];
        const cleanSpeech = lineText.replace(/[\$\\]/g, ' ').replace(/frac/g, ' divided by ');
        const isEnglish = /^[a-zA-Z0-9\s.,!?]+$/.test(cleanSpeech.substring(0, 30));
        
        const u = new SpeechSynthesisUtterance(cleanSpeech);
        if(availableVoices.length === 0) availableVoices = window.speechSynthesis.getVoices();
        
        let targetLang = isEnglish ? 'en' : 'hi';
        let premium = availableVoices.find(v => (v.name.includes('Google') || v.name.includes('Premium')) && v.lang.includes(targetLang));
        if (premium) u.voice = premium;
        
        u.lang = isEnglish ? 'en-US' : 'hi-IN'; u.rate = videoSpeed; u.volume = currentVideoVolume; 
        window.speechSynthesis.speak(u);
        
        const lineDiv = document.createElement("div"); 
        lineDiv.style.opacity = 0; lineDiv.style.transform = "translateY(10px)"; lineDiv.style.transition = "all 0.4s ease-out"; 
        lineDiv.innerHTML = lineText; content.appendChild(lineDiv);
        
        if (window.MathJax) { MathJax.typesetClear([lineDiv]); await MathJax.typesetPromise([lineDiv]); }
        
        setTimeout(() => { lineDiv.style.opacity = 1; lineDiv.style.transform = "translateY(0)"; if(content.parentElement) content.parentElement.scrollTop = content.parentElement.scrollHeight; }, 100);
        await new Promise(r => { u.onend = r; setTimeout(r, 4000); }); 
        
        if(pBar) pBar.style.width = (((i + 1) / lines.length) * 100) + '%';
    }
    
    clearInterval(videoTickInterval);
    const playBtn = document.getElementById('vPlayBtn'); if(playBtn) playBtn.innerHTML = "🔄"; 
    resetVideoActivity(); 
}

// --- DEEP SEARCH (STRICTLY HINDI) ---
async function runGroqSearch() {
    const inp = document.getElementById("searchInput"); if(!inp) return;
    const q = inp.value.trim(); if(!q && !capturedImage) return;
    
    appendUserBubble(q || "Analyze this image.", capturedImage, "searchChatHistory"); 
    inp.value = ""; let lId = appendAiLoading("searchChatHistory");
    
    try {
        let ans = "";
        if (capturedImage) {
            ans = await callGeminiVision(capturedImage, "Analyze this image carefully. YOU MUST ANSWER ENTIRELY IN HINDI. \n\nQuery: " + q);
        } else {
            const res = await fetch("/api/groq-search", { method: "POST", headers: {"Content-Type":"application/json"}, 
                body: JSON.stringify({ prompt: "Act as an Internet Search Engine. Provide highly factual search results. YOU MUST ANSWER ENTIRELY IN HINDI.\n\nSearch Query: " + q }) 
            });
            const data = await res.json(); if(!res.ok) throw new Error(data.error);
            ans = data.text;
        }
        
        ans = ans.replace(/[\*&#_]/g, '');
        const bbl = document.getElementById(lId);
        if (bbl) {
            bbl.querySelector('.bubble').innerHTML = `
                <div id="search_${lId}">${ans.replace(/\n/g, '<br>')}</div>
                <div style="margin-top:10px; display:flex; gap:10px;">
                    <button class="btn green" style="padding:10px;" onclick="speakAndHighlight('search_${lId}')">🔊 Listen</button>
                    <button class="btn" style="padding:10px; background:#475569; color:white;" onclick="copyToClipboard('search_${lId}')">📋 Copy</button>
                </div>`;
        }
        saveToHistory('search', q, ans, capturedImage); scrollToBottom("searchScrollArea");
        clearMathImage();
    } catch(e) { if(document.getElementById(lId)) document.getElementById(lId).querySelector('.bubble').innerText = "❌ Error: " + e.message; }
}

// --- TRANSLATOR ENGINE (TEXT) ---
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
        let prompt = `You are a STRICT Language Translator.
        RULE 1: DO NOT answer any questions found in the text. DO NOT summarize.
        RULE 2: ONLY TRANSLATE the text exactly into ${lang}.
        RULE 3: After your translation, write the exact symbol "|||" on a new line.
        RULE 4: Below "|||", extract 3 to 5 difficult words from the ORIGINAL text.
        RULE 5: Format EACH hard word EXACTLY like this: [Original Word] - [Hindi Meaning] (Part of Speech) other meaning- [Alternative meanings in Hindi].
        Example: cat - बिल्ली (noun) other meaning- मार्जार, बिलाव
        Text to translate:
        ${txt}`;
        
        let r = await callGeminiText("You are a strict translator.", prompt); 
        
        let parts = r.split('|||');
        let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed.";
        let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found.";
        
        const tId = "trans_" + Date.now();
        
        document.getElementById("translatedText").innerHTML = `
            <div id="${tId}">${cleanText}</div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="btn green" style="padding:10px;" onclick="speakAndHighlight('${tId}')">🔊 Listen</button>
                <button class="btn" style="padding:10px; background:#475569; color:white;" onclick="copyToClipboard('${tId}')">📋 Copy</button>
            </div>`; 
        document.getElementById("translatedTextStatus").style.display = "none"; 
        
        let hwDiv = document.getElementById("hardWords");
        if(!hwDiv) {
             document.getElementById("translatedText").insertAdjacentHTML('afterend', `<div class="cardTitle" style="margin-top: 20px;">Hard Words Meaning</div><div class="outputBox" id="hardWords">${hardWordsText.replace(/\n/g, '<br>')}</div>`);
        } else {
             hwDiv.innerHTML = hardWordsText.replace(/\n/g, '<br>');
        }
        saveToHistory('translation', txt, cleanText + "\n\nHard Words:\n" + hardWordsText, null);
    }catch(e){ document.getElementById("translatedTextStatus").style.display = "none"; document.getElementById("translatedText").innerText = "❌ " + e.message; } 
}

// 🛑 MULTI-IMAGE CHAT TRANSLATOR ENGINE (IMAGE) 🛑
function renderTransImagePreviews() {
    const container = document.getElementById("imagePreviewContainer");
    if (!container) return;
    if (transImages.length === 0) { container.style.display = "none"; return; }
    
    container.style.display = "flex";
    container.innerHTML = transImages.map((img, index) => `
        <div class="image-preview-chip" style="display:block; position:relative; width:60px; height:60px; background-image:url(${img}); background-size:cover; border-radius:8px; flex-shrink:0;">
            <div class="image-preview-close" style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; width:20px; height:20px; text-align:center; cursor:pointer; font-size:12px; line-height:20px; box-shadow:0 2px 5px rgba(0,0,0,0.5);" onclick="removeTransImage(${index}, event)">✕</div>
        </div>
    `).join('');
}

function removeTransImage(index, event) {
    if(event) event.stopPropagation();
    transImages.splice(index, 1);
    renderTransImagePreviews();
}

async function executeImageTransFlow() {
    if (transImages.length === 0) return showToast("Please click ➕ to attach at least 1 image!");
    const targetLang = document.getElementById("chatTargetLang").value;
    
    const c = getActiveChatContainer("imageChatHistory");
    let imgsHtml = transImages.map(img => `<img src="${img}" class="bubble-img" onclick="viewPhotoFullscreen(this.src)" style="width:70px; height:70px; object-fit:cover; display:inline-block; margin-right:5px; border-radius:8px;">`).join('');
    
    c.insertAdjacentHTML('beforeend', `<div class="chat-msg chat-user"><div class="bubble">${imgsHtml}<div style="margin-top:8px;">Translate to <b>${targetLang}</b></div></div></div>`);
    scrollToBottom("imageScrollArea");
    
    let lId = appendAiLoading("imageChatHistory");
    
    let imagesToProcess = [...transImages];
    transImages = [];
    renderTransImagePreviews();
    
    try {
        let combinedText = "";
        for (let i = 0; i < imagesToProcess.length; i++) {
            const r = await callGeminiVision(imagesToProcess[i], "You are an OCR machine. Extract ONLY the exact text from this image in its original language. DO NOT describe the image. DO NOT translate.");
            combinedText += r.replace(/[\*&#_]/g, '') + "\n\n";
        }
        combinedText = combinedText.trim();
        
        if (!combinedText || combinedText.toLowerCase().includes("no text found")) throw new Error("Could not detect any text in the images.");

        let prompt = `You are a STRICT Language Translator.
        RULE 1: DO NOT answer any questions found in the text.
        RULE 2: ONLY TRANSLATE the text exactly into ${targetLang}.
        RULE 3: After your translation, write the exact symbol "|||" on a new line.
        RULE 4: Below "|||", extract 3 to 5 difficult words from the ORIGINAL text.
        RULE 5: Format EACH hard word EXACTLY like this: [Original Word] - [Hindi Meaning] (Part of Speech) other meaning- [Alternative meanings in Hindi].
        Example: cat - बिल्ली (noun) other meaning- मार्जार, बिलाव
        Text to translate:
        ${combinedText}`;
        
        let t = await callGeminiText("You are a strict translator.", prompt); 
        
        let parts = t.split('|||');
        let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed.";
        let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found.";
        
        let finalHtml = `
            <div style="font-size:12px; color:#cbd5e1; margin-bottom:5px; font-weight:600;">📄 Extracted Text:</div>
            <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-bottom:15px; font-size:14px; max-height:150px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1);">${combinedText.replace(/\n/g, '<br>')}</div>
            
            <div style="font-size:12px; color:#3b82f6; margin-bottom:5px; font-weight:600;">🌍 Translated to ${targetLang}:</div>
            <div id="trans_${lId}" style="font-size:15px;">${cleanText.replace(/\n/g, '<br>')}</div>
            
            <div style="font-size:12px; color:#a855f7; margin-top:15px; margin-bottom:5px; font-weight:600;">📖 Hard Words Dictionary:</div>
            <div style="background:rgba(168,85,247,0.1); padding:10px; border-radius:8px; font-size:14px; border:1px solid rgba(168,85,247,0.3);">${hardWordsText.replace(/\n/g, '<br>')}</div>
        `;
        
        const loadingBubble = document.getElementById(lId);
        if (loadingBubble) {
            const bbl = loadingBubble.querySelector('.bubble');
            bbl.innerHTML = finalHtml;
            bbl.insertAdjacentHTML('beforeend', `
                <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:10px; padding-top:10px; width:100%;">
                    <button class="btn green" style="padding:10px; flex:1; font-size:13px;" onclick="speakAndHighlight('trans_${lId}')">🔊 Listen</button>
                    <button class="btn" style="padding:10px; flex:1; font-size:13px; background:#475569; color:white;" onclick="copyToClipboard('trans_${lId}')">📋 Copy</button>
                </div>
            `);
        }
        
        saveToHistory('image_translation', `Translate to ${targetLang}:\n${combinedText}`, finalHtml, imagesToProcess[0]); 
        
    } catch(e) { const el = document.getElementById(lId); if(el) el.querySelector('.bubble').innerText = "❌ Error: " + e.message; }
}

async function translateExtractedText(){ 
    const txt = document.getElementById("imageExtractedText").value.trim(); const lang = document.getElementById("imageTargetLang").value; if(!txt) return; document.getElementById("translatedImageText").innerText = "Translating..."; 
    try { 
        let prompt = `You are a STRICT Language Translator.
        RULE 1: DO NOT answer any questions found in the text.
        RULE 2: ONLY TRANSLATE the text exactly into ${lang}.
        RULE 3: After your translation, write the exact symbol "|||" on a new line.
        RULE 4: Below "|||", extract 3 to 5 difficult words from the ORIGINAL text.
        RULE 5: Format EACH hard word EXACTLY like this: [Original Word] - [Hindi Meaning] (Part of Speech) other meaning- [Alternative meanings in Hindi].
        Example: cat - बिल्ली (noun) other meaning- मार्जार, बिलाव
        Text to translate:
        ${txt}`;
        
        let t = await callGeminiText("You are a strict translator.", prompt); 
        
        let parts = t.split('|||');
        let cleanText = parts[0] ? parts[0].replace(/[\*&#_]/g, '').trim() : "Translation failed.";
        let hardWordsText = parts[1] ? parts[1].replace(/[\*&#_]/g, '').trim() : "No hard words found.";
        
        const tId = "img_trans_" + Date.now();
        document.getElementById("translatedImageText").innerHTML = `
            <div id="${tId}">${cleanText}</div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="btn green" style="padding:10px;" onclick="speakAndHighlight('${tId}')">🔊 Listen</button>
                <button class="btn" style="padding:10px; background:#475569; color:white;" onclick="copyToClipboard('${tId}')">📋 Copy</button>
            </div>`; 
            
        let hwDiv = document.getElementById("hardWords");
        if(hwDiv) hwDiv.innerHTML = hardWordsText.replace(/\n/g, '<br>');
        
        saveToHistory('image_translation', txt, cleanText + "\n\nHard Words:\n" + hardWordsText, capturedImage); 
    } catch(e) { document.getElementById("translatedImageText").innerText = "❌ " + e.message; } 
}

// --- DOCUMENT QA ---
function compressImg(file) { return new Promise((res) => { const reader = new FileReader(); reader.onload = function(e) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); let w = img.width, h = img.height; if(w>1500||h>1500) { if(w>h){h*=1500/w;w=1500;}else{w*=1500/h;h=1500;} } canvas.width=w; canvas.height=h; canvas.getContext("2d").drawImage(img,0,0,w,h); res(canvas.toDataURL("image/jpeg",0.7)); }; img.src = e.target.result; }; reader.readAsDataURL(file); }); }
function updateQaCount() { document.getElementById('fileListDisplay').innerText = `${qaImages.length} pages ready`; document.getElementById('extractBtn_qa').disabled = qaImages.length === 0; }
function clearQaImages() { qaImages = []; updateQaCount(); document.getElementById('qaStatus').innerText = "Ready"; qaContextText = ""; document.getElementById('qaContextBox').innerText = "Context will appear here..."; }
async function handleMultiUpload(e) { const files = e.target.files; for(let i=0; i<files.length; i++) { qaImages.push(await compressImg(files[i])); } updateQaCount(); }

async function extractMultiImages() { 
    if(qaImages.length===0) return; setStatusLoading("qaStatus", "Reading Doc..."); document.getElementById("qaStatus").style.display = "block"; qaContextText = ""; 
    for(let i=0; i<qaImages.length; i++) { 
        try { 
            const r = await callGeminiVision(qaImages[i], "You are an OCR machine. Extract ONLY the text from this page exactly in its original language. DO NOT describe the image visually. DO NOT translate."); 
            if(r) qaContextText += `\n--- PAGE ${i+1} ---\n` + r.replace(/[\*&#_]/g, ''); 
        } catch(e) {} 
    } 
    document.getElementById('qaContextBox').innerText = qaContextText ? qaContextText.substring(0, 300) + "..." : "No text found."; document.getElementById('qaStatus').innerText = "✅ Read Successfully!"; 
}

async function askDocument() { 
    const q = document.getElementById('qaQuestionInput').value; if(!q || !qaContextText) return; document.getElementById("qaAnswerBox").innerHTML = '<div class="spinner"></div> Analyzing...'; 
    try { 
        let a = await callGeminiText("You are a helpful document assistant.", `Document Text:\n${qaContextText}\n\nQuestion: ${q}\n\nINSTRUCTION: Answer the question based ONLY on the document text. YOU MUST WRITE YOUR ENTIRE ANSWER IN HINDI.`); 
        const clean = a.replace(/[\*&#_]/g,''); const aId = "qa_ans_"+Date.now(); 
        document.getElementById('qaAnswerBox').innerHTML = `
            <div id="${aId}">${clean}</div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="btn green" style="padding:10px;" onclick="speakAndHighlight('${aId}')">🔊 Listen</button>
                <button class="btn" style="padding:10px; background:#475569; color:white;" onclick="copyToClipboard('${aId}')">📋 Copy</button>
            </div>`; 
        saveToHistory('qa', q, clean, null); 
    } catch(e) { document.getElementById('qaAnswerBox').innerText = "❌ " + e.message; } 
}

// --- RESTORED HISTORY SAVING ---
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
                <button class="actionBtnSmall green" onclick="restoreSession(event, ${item.id})" title="Restore">🔄</button>
                <button class="actionBtnSmall blue" onclick="quickDownload(event, ${item.id})" title="Download TXT">📥</button>
                <button class="actionBtnSmall red" onclick="deleteHistoryItem(event, ${item.id})" title="Delete">🗑️</button>
            </div>
        </div>
    `).join(''); 
}

function clearAllHistory() {
    if(confirm("⚠️ Are you sure you want to delete ALL saved history? This cannot be undone.")) { appHistory = []; saveHistorySafe(); renderHistory(); showToast("🗑️ All history has been cleared!"); }
}

function deleteHistoryItem(e, id) { e.stopPropagation(); appHistory = appHistory.filter(i => i.id !== id); saveHistorySafe(); renderHistory(); showToast("Deleted successfully."); }

function cleanLatexForDownload(text) {
    return text.replace(/\\frac{([^}]+)}{([^}]+)}/g, '($1/$2)')
               .replace(/\\times/g, 'x')
               .replace(/\\%/g, '%')
               .replace(/[\$\\]/g, '')
               .replace(/&nbsp;/g, ' ')
               .replace(/<br>/g, '\n');
}

function quickDownload(e, id) { e.stopPropagation(); const item = appHistory.find(i => i.id === id); if(item) triggerFileDownload(item); }
function triggerFileDownload(item) { 
    let q = item.question.replace(/<[^>]*>?/gm, ''); 
    let a = cleanLatexForDownload(item.answer.replace(/<[^>]*>?/gm, '')); 
    const b = new Blob([`Title: ${item.title}\n\n--- INPUT ---\n${q}\n\n--- OUTPUT ---\n${a}`], { type: "text/plain;charset=utf-8" }); 
    const l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `AI_${item.title}.txt`; l.click(); 
    showToast("📥 Download started!");
}

function restoreSession(e, id) { 
    if(e) e.stopPropagation(); const item = appHistory.find(i => i.id == id); if(!item) return; 
    let targetPage = ''; 
    if(item.type === 'math') targetPage = 'maths.html'; 
    else if(item.type === 'search') targetPage = 'search.html'; 
    else if(item.type === 'translation') targetPage = 'translator.html'; 
    else if(item.type === 'image_translation') targetPage = 'image.html'; 
    else if(item.type === 'qa') targetPage = 'qa.html';
    
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    if (currentPage !== targetPage && targetPage !== '') { window.location.href = `${targetPage}?restore=${id}`; return; }
    
    if(item.type === 'math' || item.type === 'search') { 
        let containerId = item.type === 'math' ? "mathChatHistory" : "searchChatHistory";
        document.getElementById(containerId).innerHTML = ''; 
        appendUserBubble(item.question, item.image, containerId); 
        let lId = appendAiLoading(containerId); updateAiBubble(lId, item.answer); 
    } else if (item.type === 'translation' && document.getElementById("inputText")) {
        document.getElementById("inputText").value = item.question;
        document.getElementById("translatedText").innerHTML = item.answer.replace(/\n/g, '<br>');
    } else if (item.type === 'image_translation' && document.getElementById("imageChatHistory")) {
        let containerId = "imageChatHistory";
        document.getElementById(containerId).innerHTML = ''; 
        appendUserBubble(item.question, item.image, containerId); 
        let lId = appendAiLoading(containerId); 
        const bbl = document.getElementById(lId).querySelector('.bubble');
        
        if (item.answer.includes('<div')) { bbl.innerHTML = item.answer; } 
        else { bbl.innerHTML = `<div id="trans_${lId}">${item.answer.replace(/\n/g, '<br>')}</div>`; }
    }
    showToast("🔄 Session Restored");
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
    
    if (currentMode === 'math' || currentMode === 'search') { 
        const chip = document.getElementById("mathPreviewChip"); 
        if(chip) { chip.style.display = "block"; chip.style.backgroundImage = `url(${capturedImage})`; } 
    }
    else if (currentMode === 'image_trans') {
        if(transImages.length >= 3) { showToast("Maximum 3 images allowed!"); } 
        else { transImages.push(capturedImage); renderTransImagePreviews(); }
    }
    else if (currentMode === 'qa') { qaImages.push(capturedImage); updateQaCount(); }
    closeCamera(); 
}

window.toggleSidebar = toggleSidebar; window.openCamera = openCamera; window.closeCamera = closeCamera; window.switchCamera = switchCamera; window.capturePhoto = capturePhoto; window.clearMathImage = clearMathImage; window.executeMathFlow = executeMathFlow; window.speakAndHighlight = speakAndHighlight; window.initVideoGui = initVideoGui; window.exitVideoGui = exitVideoGui; window.cycleVideoSpeed = cycleVideoSpeed; window.toggleVideoPause = toggleVideoPause; window.replayVideo = replayVideo; window.toggleFlash = toggleFlash; window.runTranslation = runTranslation; window.toggleRecording = toggleRecording; window.askDocument = askDocument; window.runGroqSearch = runGroqSearch; window.deleteHistoryItem = deleteHistoryItem; window.quickDownload = quickDownload; window.restoreSession = restoreSession; window.copyToClipboard = copyToClipboard; window.clearAllHistory = clearAllHistory; window.showToast = showToast; window.viewPhotoFullscreen = viewPhotoFullscreen; window.updateVideoVolume = updateVideoVolume; window.toggleVideoFullscreen = toggleVideoFullscreen; window.removeTransImage = removeTransImage; window.executeImageTransFlow = executeImageTransFlow;
