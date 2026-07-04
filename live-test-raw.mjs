import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, '.env'), 'utf8');
const apiKey = envText.split('\n').find(l => l.startsWith('GEMINI_API_KEY='))
  ?.replace('GEMINI_API_KEY=', '').trim();
if (!apiKey) { console.error('找不到 GEMINI_API_KEY'); process.exit(1); }

const MODELS = ['gemini-2.0-flash-live-001', 'gemini-live-2.5-flash-preview'];
const VERSIONS = ['v1alpha', 'v1beta'];

for (const version of VERSIONS) {
  for (const model of MODELS) {
    console.log(`\n=== ${version} / ${model} ===`);
    await new Promise((resolve) => {
      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { ws.close(); resolve(); }, 6000);

      ws.on('open', () => {
        console.log('  WS connected — sending setup...');
        ws.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ['TEXT'] }
          }
        }));
      });

      ws.on('message', (data) => {
        const text = data.toString();
        console.log('  MSG:', text.slice(0, 300));
        try {
          const parsed = JSON.parse(text);
          if (parsed.setupComplete !== undefined) {
            console.log('  ✅ setupComplete received!');
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        } catch {}
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timer);
        console.log(`  closed: code=${code} reason=${reason.toString().slice(0, 100)}`);
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        console.log('  error:', err.message);
        resolve();
      });
    });
  }
}
