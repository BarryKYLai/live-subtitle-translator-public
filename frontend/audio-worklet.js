/**
 * PCM processor AudioWorklet — collects float32 samples and posts batches
 * to the main thread for conversion + forwarding to the relay.
 * Batch size 4096 ≈ 256 ms at 16 kHz.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._batch = 4096;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
    while (this._buf.length >= this._batch) {
      this.port.postMessage(this._buf.splice(0, this._batch));
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
