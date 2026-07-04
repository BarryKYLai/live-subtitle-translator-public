const { GoogleGenerativeAI } = require('@google/generative-ai');
const Transcriber = require('./Transcriber');
const cfg = require('../config');

const MODEL         = cfg.GEMINI_CHUNK_MODEL;
const SAMPLE_RATE   = cfg.SAMPLE_RATE;
const MIN_SECONDS   = cfg.MIN_SECONDS;
const MAX_SECONDS   = cfg.MAX_SECONDS;
const SILENCE_RMS   = cfg.SILENCE_RMS;
const SILENCE_MS    = cfg.SILENCE_MS;
const VOICE_MIN_MS     = cfg.VOICE_MIN_MS;
const MIN_SEND_SECONDS = cfg.MIN_SEND_SECONDS;
const MIN_AVG_RMS      = cfg.MIN_AVG_RMS;
const MAX_ZCR          = cfg.MAX_ZCR;
const OVERLAP_SECONDS  = cfg.OVERLAP_SECONDS;

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

function buildWav(pcm16Buf) {
  const dataLen = pcm16Buf.length;
  const header  = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1,  20);  // PCM
  header.writeUInt16LE(1,  22);  // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);  // byteRate
  header.writeUInt16LE(2,  32);  // blockAlign
  header.writeUInt16LE(16, 34);  // bitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm16Buf]);
}

function rms(buf) {
  if (buf.length < 2) return 0;
  let sum = 0;
  const n = Math.floor(buf.length / 2);
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

// Zero-crossing rate: fraction of consecutive samples that cross zero
function zcr(buf) {
  const n = Math.floor(buf.length / 2);
  if (n < 2) return 0;
  let crossings = 0;
  let prev = buf.readInt16LE(0);
  for (let i = 1; i < n; i++) {
    const cur = buf.readInt16LE(i * 2);
    if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
    prev = cur;
  }
  return crossings / (n - 1);
}

class GeminiEngine extends Transcriber {
  constructor(opts) {
    super(opts);
    this._model        = null;
    this._chunks       = [];
    this._totalSamples = 0;
    this._silenceTimer = null;
    this._busy         = false;
    this._isMic        = this.sourceLanguage === 'zh-TW';
    // Track consecutive voiced ms for VOICE_MIN_MS gate
    this._voicedMs     = 0;
    this._speechStarted = false;
  }

  connect() {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    this._model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: buildSystemPrompt(this.sourceLanguage),
    });
    console.log(`[GeminiEngine:${this.track}] chunk mode ready (${MIN_SECONDS}-${MAX_SECONDS}s)`);
    console.log(`[GeminiEngine:${this.track}] voice gate: VOICE_MIN_MS=${VOICE_MIN_MS} MIN_SEND_SECONDS=${MIN_SEND_SECONDS} MIN_AVG_RMS=${MIN_AVG_RMS} MAX_ZCR=${MAX_ZCR} SILENCE_RMS=${SILENCE_RMS} OVERLAP=${OVERLAP_SECONDS}s`);
    return Promise.resolve();
  }

  sendAudio(base64PCM) {
    const buf = Buffer.from(base64PCM, 'base64');
    const chunkRms = rms(buf);
    const chunkDurMs = (buf.length / 2 / SAMPLE_RATE) * 1000;

    // Voice-duration gate: require consecutive voiced frames before accumulating
    if (chunkRms >= SILENCE_RMS) {
      this._voicedMs += chunkDurMs;
    } else {
      this._voicedMs = 0;
      if (!this._speechStarted) {
        // Still silent, haven't started speech — don't accumulate
        return;
      }
    }

    if (!this._speechStarted) {
      if (this._voicedMs >= VOICE_MIN_MS) {
        this._speechStarted = true;
      } else {
        return; // Not enough consecutive voiced frames yet
      }
    }

    this._chunks.push(buf);
    this._totalSamples += buf.length / 2;

    const seconds = this._totalSamples / SAMPLE_RATE;
    if (seconds >= MAX_SECONDS) {
      this._flush();
      return;
    }
    if (seconds >= MIN_SECONDS && chunkRms < SILENCE_RMS) {
      if (!this._silenceTimer) {
        this._silenceTimer = setTimeout(() => this._flush(), SILENCE_MS);
      }
    } else {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  flushNow() {
    this._flush();
  }

  async _flush() {
    clearTimeout(this._silenceTimer);
    this._silenceTimer = null;
    this._voicedMs      = 0;
    this._speechStarted = false;
    if (this._chunks.length === 0 || this._busy) return;

    const pcm  = Buffer.concat(this._chunks);

    // Keep tail as overlap for next chunk (reduces boundary word loss)
    const overlapBytes = Math.floor(OVERLAP_SECONDS * SAMPLE_RATE) * 2;
    if (overlapBytes > 0 && pcm.length > overlapBytes) {
      const tail = pcm.subarray(pcm.length - overlapBytes);
      this._chunks       = [Buffer.from(tail)];
      this._totalSamples = tail.length / 2;
    } else {
      this._chunks       = [];
      this._totalSamples = 0;
    }

    const seconds = pcm.length / 2 / SAMPLE_RATE;
    const avgRms  = rms(pcm);
    const avgZcr  = zcr(pcm);
    const tag     = `[GeminiEngine:${this.track}]`;

    // Gate 1: minimum duration
    if (seconds < MIN_SEND_SECONDS) {
      console.log(`${tag} DISCARD | dur=${seconds.toFixed(2)}s < MIN_SEND_SECONDS=${MIN_SEND_SECONDS} | avgRMS=${avgRms.toFixed(0)} zcr=${avgZcr.toFixed(4)}`);
      return;
    }

    // Gate 2: average energy too low
    if (avgRms < MIN_AVG_RMS) {
      console.log(`${tag} DISCARD | avgRMS=${avgRms.toFixed(0)} < MIN_AVG_RMS=${MIN_AVG_RMS} | dur=${seconds.toFixed(2)}s zcr=${avgZcr.toFixed(4)}`);
      return;
    }

    // Gate 3: zero-crossing rate too high (likely noise, not speech)
    if (avgZcr > MAX_ZCR) {
      console.log(`${tag} DISCARD | zcr=${avgZcr.toFixed(4)} > MAX_ZCR=${MAX_ZCR} | dur=${seconds.toFixed(2)}s avgRMS=${avgRms.toFixed(0)}`);
      return;
    }

    const sendTime = Date.now();
    console.log(`${tag} SEND    | dur=${seconds.toFixed(2)}s avgRMS=${avgRms.toFixed(0)} zcr=${avgZcr.toFixed(4)}`);
    this._busy = true;

    try {
      const wav    = buildWav(pcm);
      const result = await this._model.generateContent([
        { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
        'Transcribe and translate.',
      ]);
      const latency = ((Date.now() - sendTime) / 1000).toFixed(2);
      const text   = result.response.text().trim();
      if (text) {
        const parsed = this._parse(text);
        if (parsed.original || parsed.translated) {
          console.log(`${tag} RESULT  | latency=${latency}s`);
          this.onTranscript({ ...parsed, isFinal: true });
        }
      }
    } catch (err) {
      console.error(`${tag} error:`, err.message);
    } finally {
      this._busy = false;
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
    clearTimeout(this._silenceTimer);
    this._silenceTimer  = null;
    this._chunks        = [];
    this._model         = null;
    this._voicedMs      = 0;
    this._speechStarted = false;
  }
}

module.exports = GeminiEngine;
