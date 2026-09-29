'use strict';
/**
 * Puente WebSocket SOLO PARA DESARROLLO/PRUEBAS: permite abrir la UI en un navegador
 * normal (npm run dev:web) usando el mismo backend que Electron.
 * Escucha únicamente en 127.0.0.1.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { Store } = require('./store');
const { createApi } = require('./api');

const PORT = +(process.env.GITPILOT_BRIDGE_PORT || 5174);
const dir = process.env.GITPILOT_DATA || path.join(os.tmpdir(), 'gitpilot-web-data');
fs.mkdirSync(dir, { recursive: true });
const store = new Store(dir, null);
const clients = new Set();
const core = createApi({
  store,
  emit: (name, payload) => { const m = JSON.stringify({ event: name, payload }); clients.forEach((c) => c.readyState === 1 && c.send(m)); },
});

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    const fn = core.api[msg.method];
    if (!fn) return ws.send(JSON.stringify({ id: msg.id, ok: false, error: 'Método desconocido: ' + msg.method }));
    try {
      const data = await fn(...(msg.args || []));
      ws.send(JSON.stringify({ id: msg.id, ok: true, data: data === undefined ? null : data }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: e.message || String(e) }));
    }
  });
});
console.log(`[gitpilot] puente web en ws://127.0.0.1:${PORT}  (datos: ${dir})`);
