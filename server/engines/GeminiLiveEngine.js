const { GoogleGenAI, Modality } = require('@google/genai');
const Transcriber = require('./Transcriber');
const cfg = require('../config');

const MODEL            = cfg.GEMINI_LIVE_MODEL;
const SETUP_TIMEOUT_MS = cfg.SETUP_TIMEOUT_MS;

function buildSystemPrompt(src) {
  const common = `The speaker may use Traditional Chinese (zh-TW) or Vietnamese (vi), and occasionally mix in English terms (especially IT/AI vocabulary).
Determine which language the speaker is using, transcribe it, then translate to the other language.
Reply in this exact format — two lines, no other text:
[ZH] <Traditional Chinese text>
[VI] <Vietnamese text>
If the speaker says Chinese, [ZH] is the transcription (always in Traditional Chinese) and [VI] is the translation.
If the speaker says Vietnamese, [VI] is the transcription and [ZH] is the translation (always in Traditional Chinese).
English terms should be kept as-is in both lines.
If no clear speech is detected, output nothing.`;

  if (src === 'zh-TW') {
    return `You are a real-time transcription and translation assistant.
This audio channel is primarily Traditional Chinese (zh-TW), but the speaker may occasionally switch to Vietnamese or use English terms.
${common}`;
  }
  return `You are a real-time transcription and translation assistant.
This audio channel is primarily Vietnamese (vi), but the speaker may occasionally switch to Chinese or use English terms.
${common}`;
}

class GeminiLiveEngine extends Transcriber {
  constructor(opts) {
    super(opts);
    this._session = null;
    this._ready   = false;
    this._settled = false;
    this._pending = [];
    this._accText = '';
    this._isMic   = this.sourceLanguage === 'zh-TW';
  }

  connect() {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this._settled) { this._settled = true; reject(new Error(`[${this.track}] setup timed out`)); }
      }, SETUP_TIMEOUT_MS);

      try {
        const ai = new GoogleGenAI({ apiKey: this.apiKey, apiVersion: 'v1alpha' });
        this._session = await ai.live.connect({
          model: MODEL,
          config: {
            responseModalities: [Modality.TEXT],
            systemInstruction: buildSystemPrompt(this.sourceLanguage),
          },
          callbacks: {
            onopen: () => console.log(`[GeminiLiveEngine:${this.track}] WS connected`),
            onmessage: (msg) => {
              if (msg.setupComplete !== undefined && !this._settled) {
                this._settled = true;
                this._ready   = true;
                clearTimeout(timer);
                for (const c of this._pending) this._sendNow(c);
                this._pending = [];
                resolve();
              }
              this._handleMessage(msg);
            },
            onerror: (err) => {
              console.error(`[GeminiLiveEngine:${this.track}] error:`, err?.message || err);
              if (!this._settled) { this._settled = true; clearTimeout(timer); reject(err); }
            },
            onclose: (ev) => {
              console.log(`[GeminiLiveEngine:${this.track}] closed:`, ev?.reason || '');
              this._ready = false;
              if (!this._settled) { this._settled = true; clearTimeout(timer); reject(new Error(ev?.reason || 'closed')); }
            },
          },
        });
      } catch (err) {
        if (!this._settled) { this._settled = true; clearTimeout(timer); reject(err); }
      }
    });
  }

  _handleMessage(msg) {
    const parts = msg.serverContent?.modelTurn?.parts;
    if (parts) {
      for (const p of parts) {
        if (p.text) {
          this._accText += p.text;
          const parsed = this._parse(this._accText);
          if (parsed.original || parsed.translated) {
            this.onTranscript({ ...parsed, isFinal: false });
          }
        }
      }
    }
    if (msg.serverContent?.turnComplete) {
      const parsed = this._parse(this._accText);
      if (parsed.original || parsed.translated) {
        this.onTranscript({ ...parsed, isFinal: true });
      }
      this._accText = '';
    }
  }

  sendAudio(base64PCM) {
    if (!this._ready) { this._pending.push(base64PCM); return; }
    this._sendNow(base64PCM);
  }

  _sendNow(base64PCM) {
    if (!this._session || !this._ready) return;
    try {
      this._session.sendRealtimeInput({
        audio: { data: base64PCM, mimeType: 'audio/pcm;rate=16000' }
      });
    } catch (err) {
      console.error(`[GeminiLiveEngine:${this.track}] sendAudio error:`, err.message);
    }
  }

  _parse(text) {
    const zh = text.match(/\[ZH\]\s*([^\n\[]+)/)?.[1]?.trim() ?? '';
    const vi = text.match(/\[VI\]\s*([^\n\[]+)/)?.[1]?.trim() ?? '';
    return this._isMic
      ? { original: zh, translated: vi }
      : { original: vi, translated: zh };
  }

  close() {
    this._ready = false;
    if (this._session) {
      try { this._session.close(); } catch {}
      this._session = null;
    }
  }
}

module.exports = GeminiLiveEngine;
