/**
 * WhisperEngine — placeholder for Stage 2 (local Whisper + LLM translation).
 *
 * Architecture note (from PROJECT_PLAN.md §第二階段):
 *   - Whisper handles transcription only (zh/vi); a separate local LLM does zh↔vi translation.
 *   - Both steps must run in streaming mode to avoid additive latency.
 *   - Use the same Transcriber interface: sendAudio() → onTranscript({ original, translated, isFinal })
 */
const Transcriber = require('./Transcriber');

class WhisperEngine extends Transcriber {
  async connect() {
    throw new Error('WhisperEngine not yet implemented (Stage 2)');
  }
  sendAudio() {}
  close() {}
}

module.exports = WhisperEngine;
