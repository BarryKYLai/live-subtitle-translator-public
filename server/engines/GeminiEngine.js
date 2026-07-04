const cfg = require('../config');
const mode = cfg.GEMINI_MODE.toLowerCase();
module.exports = mode === 'live'
  ? require('./GeminiLiveEngine')
  : require('./GeminiChunkEngine');
