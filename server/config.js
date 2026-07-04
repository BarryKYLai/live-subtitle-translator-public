// Non-secret tuneable parameters with sensible defaults.
// Every value here can be overridden by a same-named environment variable
// (set in .env or your shell).  .env should ONLY contain secrets.

const defaults = {
  PORT:             3000,
  GEMINI_MODE:      'chunk',   // 'chunk' or 'live'

  // ── Gemini model names ──────────────────────────────────────────────────────
  GEMINI_CHUNK_MODEL: 'gemini-2.5-flash',
  GEMINI_LIVE_MODEL:  'gemini-2.0-flash-live-001',

  // ── Chunk engine: silence detection ─────────────────────────────────────────
  SAMPLE_RATE:      16000,
  MIN_SECONDS:      2,         // min seconds of audio before allowing silence-flush
  MAX_SECONDS:      12,        // force flush at this length
  SILENCE_RMS:      500,       // RMS below this = silence (per-chunk)
  SILENCE_MS:       600,       // ms of silence before flushing a segment

  // ── Voice-activity gate (noise filter) ──────────────────────────────────────
  VOICE_MIN_MS:     150,       // consecutive above-threshold ms to start a segment
  MIN_SEND_SECONDS: 1.0,       // segments shorter than this are discarded
  MIN_AVG_RMS:      400,       // whole-segment average RMS must exceed this
  MAX_ZCR:          0.20,      // zero-crossing rate above this = likely noise
  OVERLAP_SECONDS:  0.5,       // seconds of overlap between consecutive chunks

  // ── Live engine ─────────────────────────────────────────────────────────────
  SETUP_TIMEOUT_MS: 15000,
};

// Build config: defaults ← environment variable overrides
const config = {};
for (const [key, fallback] of Object.entries(defaults)) {
  const env = process.env[key];
  if (env !== undefined && env !== '') {
    // Coerce to same type as default
    config[key] = typeof fallback === 'number' ? Number(env) : env;
  } else {
    config[key] = fallback;
  }
}

module.exports = config;
