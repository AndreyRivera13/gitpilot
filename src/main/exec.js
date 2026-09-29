'use strict';
/**
 * Ejecución de procesos `git` (y ssh/ssh-keygen). Todo comando pasa por aquí,
 * de modo que se registra en el "Registro de operaciones" de la app.
 */
const { spawn } = require('child_process');

const EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

const settings = { gitPath: 'git' };
const logListeners = new Set();
const history = []; // ring buffer
const MAX_HISTORY = 500;

class GitError extends Error {
  constructor(message, { code, args, stdout, stderr } = {}) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.args = args;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function baseEnv(extra) {
  const cur = process.env.PATH ? process.env.PATH.split(':') : [];
  const merged = [...cur];
  for (const p of EXTRA_PATHS) if (!merged.includes(p)) merged.push(p);
  return {
    ...process.env,
    PATH: merged.join(':'),
    LC_ALL: 'C', // mensajes en inglés para poder interpretarlos de forma estable
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
    GIT_OPTIONAL_LOCKS: '0',
    ...extra,
  };
}

function pushLog(entry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
  for (const l of logListeners) {
    try { l(entry); } catch (_) { /* ignore */ }
  }
}

function redact(args) {
  // No dejar tokens en el log (por si alguien pasa una URL con credenciales)
  return args.map((a) => String(a).replace(/(https?:\/\/)[^@/\s]+@/g, '$1***@'));
}

/**
 * Ejecuta un binario. Devuelve { stdout, stderr, code }.
 * opts: cwd, input, env, allowFail, timeout(ms), raw(bool: stdout como Buffer),
 *       onStderr(fn(line)), bin, silent(bool: no registrar)
 */
function run(args, opts = {}) {
  const bin = opts.bin || settings.gitPath;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const fullArgs = bin === settings.gitPath ? ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args] : args;
    let child;
    try {
      child = spawn(bin, fullArgs, {
        cwd: opts.cwd,
        env: baseEnv(opts.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return reject(new GitError(`No se pudo ejecutar ${bin}: ${e.message}`, { args }));
    }
    const out = [];
    const err = [];
    let timer;
    if (opts.timeout) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, opts.timeout);
    }
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err.push(d);
      if (opts.onStderr) {
        d.toString('utf8').split(/[\r\n]+/).filter(Boolean).forEach((l) => opts.onStderr(l));
      }
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      let msg = e.message;
      if (e.code === 'ENOENT') {
        msg = opts.cwd && !require('fs').existsSync(opts.cwd)
          ? `La carpeta ya no existe: ${opts.cwd}`
          : `No se encontró el ejecutable "${bin}". Instala git (xcode-select --install) o configura la ruta en Ajustes.`;
      }
      reject(new GitError(msg, { args }));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const stdoutBuf = Buffer.concat(out);
      const stdout = opts.raw ? stdoutBuf : stdoutBuf.toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (!opts.silent) {
        pushLog({
          time: Date.now(),
          cwd: opts.cwd || '',
          cmd: `${bin === settings.gitPath ? 'git' : bin} ${redact(args).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
          code,
          ms: Date.now() - started,
          error: code === 0 ? '' : (stderr || (opts.raw ? '' : stdout)).trim().slice(0, 2000),
        });
      }
      if (code !== 0 && !opts.allowFail) {
        const text = (stderr.trim() || (opts.raw ? '' : String(stdout).trim()) || `${bin} terminó con código ${code}`);
        return reject(new GitError(text, { code, args, stdout: opts.raw ? '' : stdout, stderr }));
      }
      resolve({ stdout, stderr, code });
    });
    if (opts.input != null) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

module.exports = {
  run,
  GitError,
  settings,
  baseEnv,
  getHistory: () => history.slice(),
  clearHistory: () => { history.length = 0; },
  onLog: (fn) => { logListeners.add(fn); return () => logListeners.delete(fn); },
};
