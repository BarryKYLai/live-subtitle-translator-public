import { GoogleGenAI, Modality } from '@google/genai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, '.env'), 'utf8');
const apiKey = envText.split('\n').find(l => l.startsWith('GEMINI_API_KEY='))
  ?.replace('GEMINI_API_KEY=', '').trim();
if (!apiKey) { console.error('找不到 GEMINI_API_KEY'); process.exit(1); }

const MODELS = [
  'gemini-2.0-flash-live-001',
  'gemini-live-2.5-flash-preview',
  'gemini-2.5-flash-live-001',
];
const VERSIONS = ['v1alpha', 'v1beta'];

for (const version of VERSIONS) {
  for (const model of MODELS) {
    const label = `${version} / ${model}`;
    process.stdout.write(`測試 ${label} ... `);
    const result = await new Promise((resolve) => {
      const ai = new GoogleGenAI({ apiKey, apiVersion: version });
      const timer = setTimeout(() => resolve('timeout'), 6000);
      ai.live.connect({
        model,
        config: { responseModalities: [Modality.TEXT] },
        callbacks: {
          onopen:    ()  => { /* 只代表 WS 連上，還不算成功 */ },
          onmessage: (m) => {
            if (m.setupComplete !== undefined) {
              clearTimeout(timer);
              resolve('✅ setupComplete');
            }
          },
          onerror: (e) => { clearTimeout(timer); resolve(`❌ error: ${e?.message?.split('\n')[0] || e}`); },
          onclose: (e) => { clearTimeout(timer); resolve(`❌ closed: ${e?.reason?.slice(0, 80) || '(no reason)'}`); },
        },
      }).then(s => { setTimeout(() => { try { s.close(); } catch {} }, 100); })
        .catch(e => { clearTimeout(timer); resolve(`❌ connect threw: ${e?.message}`); });
    });
    console.log(result);
  }
}
