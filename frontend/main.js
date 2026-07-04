/* eslint-disable no-undef */
const WS_URL = `ws://${location.host}`;
const COLOR_MIC = '#4A9EFF';  // blue  — me (zh-TW)
const COLOR_TAB = '#FF6B6B';  // coral — them (vi)

let audioCtx = null;
let micStream = null;
let tabStream = null;
let tabVad = null;
let ws = null;
let isRunning = false;

// One DOM element per track for the current partial subtitle
const partials = { mic: null, tab: null };

const startBtn  = document.getElementById('startBtn');
const stopBtn   = document.getElementById('stopBtn');
const statusEl  = document.getElementById('status');
const hintEl    = document.getElementById('hint');
const subtitlesEl = document.getElementById('subtitles');

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);

// ── Main flow ─────────────────────────────────────────────────────────────────

async function start() {
  startBtn.disabled = true;
  setStatus('連接 relay…');

  try {
    ws = new WebSocket(WS_URL);
    ws.onmessage = handleMessage;
    ws.onerror   = () => setStatus('WebSocket 錯誤，relay 是否已啟動？');
    ws.onclose   = () => { if (isRunning) { setStatus('連線中斷'); stop(); } };
    await waitOpen(ws);

    setStatus('授權麥克風…');
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    setStatus('請選擇分頁（務必勾選「分享分頁音訊」）…');
    tabStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { systemAudio: 'include', suppressLocalAudioPlayback: false }
    });

    // Stop capturing if user ends the screen share
    const videoTrack = tabStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.addEventListener('ended', stop);

    setStatus('初始化音訊處理…');
    audioCtx = new AudioContext({ sampleRate: 16000 });
    await audioCtx.audioWorklet.addModule('audio-worklet.js');

    // Mic pipeline (zh-TW)
    const micAudio = micStream.getAudioTracks()[0];
    if (micAudio) setupPipeline(new MediaStream([micAudio]), 'mic');

    // Tab audio pipeline (vi) — with Silero VAD
    const tabAudio = tabStream.getAudioTracks()[0];
    if (tabAudio) {
      await setupTabVAD(new MediaStream([tabAudio]));
    } else {
      setStatus('⚠️ 沒有收到分頁音訊！請重試並確認勾選「分享分頁音訊」');
      cleanup();
      startBtn.disabled = false;
      return;
    }

    isRunning = true;
    stopBtn.disabled = false;
    hintEl.style.display = 'none';
    setStatus('字幕中 — 等待語音…');

  } catch (err) {
    console.error(err);
    setStatus('錯誤: ' + err.message);
    cleanup();
    startBtn.disabled = false;
  }
}

async function setupTabVAD(stream) {
  const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/';
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

  tabVad = await vad.MicVAD.new({
    getStream: async () => stream,
    positiveSpeechThreshold: 0.3,
    minSpeechMs: 400,
    preSpeechPadMs: 300,
    redemptionMs: 600,
    baseAssetPath: CDN_BASE,
    onnxWASMBasePath: ORT_BASE,

    onSpeechStart: () => {
      console.log('[VAD:tab] speech start');
    },

    onSpeechEnd: (audio) => {
      // audio is Float32Array at 16kHz — VAD already segmented speech
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const pcm16 = floatToPCM16(audio);
      console.log(`[VAD:tab] speech end — ${(audio.length / 16000).toFixed(2)}s`);
      ws.send(JSON.stringify({ type: 'audio', track: 'tab', data: bufToBase64(pcm16.buffer), flush: true }));
    },
  });

  tabVad.start();
  console.log('[VAD:tab] Silero VAD active on tab audio');
}

function setupPipeline(stream, track) {
  const source  = audioCtx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor');

  worklet.port.onmessage = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const pcm16 = floatToPCM16(e.data);
    ws.send(JSON.stringify({ type: 'audio', track, data: bufToBase64(pcm16.buffer) }));
  };

  source.connect(worklet);
  // intentionally NOT connecting worklet to destination — avoids playback echo
}

function stop() {
  cleanup();
  setStatus('已停止');
  startBtn.disabled = false;
  stopBtn.disabled  = true;
  partials.mic = null;
  partials.tab = null;
}

function cleanup() {
  isRunning = false;
  if (tabVad)    { tabVad.destroy(); tabVad = null; }
  if (ws)        { ws.close();  ws = null; }
  if (audioCtx)  { audioCtx.close(); audioCtx = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (tabStream) { tabStream.getTracks().forEach(t => t.stop()); tabStream = null; }
}

// ── WebSocket messages ────────────────────────────────────────────────────────

function handleMessage(event) {
  const msg = JSON.parse(event.data);

  if (msg.type === 'ready') {
    setStatus('字幕中 — 等待語音…');
    return;
  }
  if (msg.type === 'error') {
    setStatus('引擎錯誤: ' + msg.message);
    return;
  }
  if (msg.type === 'transcript') {
    renderSubtitle(msg);
  }
}

// ── Subtitle rendering ────────────────────────────────────────────────────────

function renderSubtitle({ track, original, translated, isFinal }) {
  if (!original && !translated) return;

  const isMic  = track === 'mic';
  const color  = isMic ? COLOR_MIC : COLOR_TAB;

  if (!isFinal) {
    if (!partials[track]) {
      const el = document.createElement('div');
      el.className = `subtitle partial ${track}`;
      subtitlesEl.appendChild(el);
      partials[track] = el;
    }
    partials[track].innerHTML = subtitleHTML(original, translated, color);
    scrollBottom();
    return;
  }

  // Final — remove partial, append permanent block
  if (partials[track]) { partials[track].remove(); partials[track] = null; }
  const el = document.createElement('div');
  el.className = `subtitle final ${track}`;
  el.innerHTML = subtitleHTML(original, translated, color);
  subtitlesEl.appendChild(el);
  scrollBottom();
}

function subtitleHTML(original, translated, color) {
  let html = `<div class="subtitle-block" style="border-left-color:${color}">`;
  if (original)   html += `<div class="line original" style="color:${color}">${esc(original)}</div>`;
  if (translated) html += `<div class="line translated">${esc(translated)}</div>`;
  html += '</div>';
  return html;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function floatToPCM16(floatArr) {
  const out = new Int16Array(floatArr.length);
  for (let i = 0; i < floatArr.length; i++) {
    const s = Math.max(-1, Math.min(1, floatArr[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function esc(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scrollBottom() {
  subtitlesEl.scrollTop = subtitlesEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function waitOpen(socket) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) { resolve(); return; }
    socket.addEventListener('open',  resolve, { once: true });
    socket.addEventListener('error', reject,  { once: true });
  });
}
