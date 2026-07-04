require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const GeminiEngine = require('./engines/GeminiEngine');

const PORT = cfg.PORT;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('[relay] GEMINI_API_KEY not set — copy .env.example to .env and fill in the key');
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, '../frontend')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs) => {
  console.log('[relay] client connected');

  const send = (obj) => {
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.send(JSON.stringify(obj));
    }
  };

  const micEngine = new GeminiEngine({
    apiKey: GEMINI_API_KEY,
    track: 'mic',
    sourceLanguage: 'zh-TW',
    targetLanguage: 'vi',
    onTranscript: (r) => send({ type: 'transcript', track: 'mic', ...r })
  });

  const tabEngine = new GeminiEngine({
    apiKey: GEMINI_API_KEY,
    track: 'tab',
    sourceLanguage: 'vi',
    targetLanguage: 'zh-TW',
    onTranscript: (r) => send({ type: 'transcript', track: 'tab', ...r })
  });

  Promise.all([micEngine.connect(), tabEngine.connect()])
    .then(() => {
      console.log('[relay] both Gemini sessions ready');
      send({ type: 'ready' });
    })
    .catch((err) => {
      console.error('[relay] Gemini init failed:', err.message);
      send({ type: 'error', message: 'Gemini 初始化失敗: ' + err.message });
    });

  clientWs.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'audio') {
      if (msg.track === 'mic') micEngine.sendAudio(msg.data);
      else if (msg.track === 'tab') {
        tabEngine.sendAudio(msg.data);
        if (msg.flush) tabEngine.flushNow();
      }
    }
  });

  clientWs.on('close', () => {
    console.log('[relay] client disconnected');
    micEngine.close();
    tabEngine.close();
  });

  clientWs.on('error', (err) => console.error('[relay] client ws error:', err.message));
});

server.listen(PORT, () => {
  console.log(`[relay] http://localhost:${PORT}`);
});
