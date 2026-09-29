// Cliente de la API: usa el preload de Electron (IPC) o, en modo web de pruebas, un WebSocket.
const electron = typeof window !== 'undefined' ? window.gitpilot : null;
export const isElectron = !!electron;

let ws = null;
let nextId = 1;
const pending = new Map();
const eventListeners = new Set();
let openPromise = null;

function connectWs() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    ws = new WebSocket('ws://127.0.0.1:5174');
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('No se pudo conectar con el puente web (npm run dev:web).'));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.event) { eventListeners.forEach((l) => l(msg.event, msg.payload)); return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
    };
    ws.onclose = () => { openPromise = null; };
  });
  return openPromise;
}

export async function call(method, ...args) {
  if (electron) {
    const r = await electron.call(method, args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }
  await connectWs();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, args }));
  });
}

export function onEvent(cb) {
  if (electron) return electron.onEvent(cb);
  eventListeners.add(cb);
  connectWs().catch(() => {});
  return () => eventListeners.delete(cb);
}

export function onMenu(cb) {
  if (electron) return electron.onMenu(cb);
  return () => {};
}
