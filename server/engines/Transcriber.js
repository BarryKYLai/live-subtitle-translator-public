/**
 * Abstract Transcriber interface.
 * Input:  base64-encoded PCM16 audio at 16 kHz via sendAudio()
 * Output: { original, translated, isFinal } emitted through onTranscript callback
 */
class Transcriber {
  constructor({ apiKey, track, sourceLanguage, targetLanguage, onTranscript }) {
    if (new.target === Transcriber) throw new Error('Transcriber is abstract');
    this.apiKey = apiKey;
    this.track = track;
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
    this.onTranscript = onTranscript;
  }

  /** Open connection / initialise session. Returns Promise. */
  async connect() { throw new Error('connect() not implemented'); }

  /** Send a base64 PCM16 audio chunk to the engine. */
  sendAudio(_base64PCM) { throw new Error('sendAudio() not implemented'); }

  /** Tear down the session cleanly. */
  close() { throw new Error('close() not implemented'); }
}

module.exports = Transcriber;
