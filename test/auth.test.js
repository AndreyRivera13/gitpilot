// Prueba E2E de autenticación por token (GIT_ASKPASS), incluso con HOME con espacios.
// Servidor que siempre responde 401 y registra el header Authorization; git debe reintentar con user:token del perfil
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { createApi } = require('../src/main/api');
const seen = [];
const srv = http.createServer((req, res) => {
  seen.push(req.headers.authorization || null);
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); res.end('no');
});
srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'home con espacio-'));
  process.env.HOME = fakeHome;
  const store = new Store(path.join(fakeHome, 'Library', 'Application Support', 'GitPilot'), null);
  const { api } = createApi({ store });
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'r-'));
  await api['repo.init'](repo, {});
  await api['git.addRemote'](repo, 'origin', `http://127.0.0.1:${port}/x.git`);
  const p = await api['profile.save']({ label: 'T', name: 'n', email: 'e@e.co', tokenUser: 'brayam', token: 'TOKEN123' });
  await api['repo.setProfile'](repo, p.id);
  await api['git.fetch'](repo, {}).catch((e) => console.log('fetch (esperado fallar):', e.message.split('\n')[0]));
  const expected = 'Basic ' + Buffer.from('brayam:TOKEN123').toString('base64');
  console.log('headers vistos:', JSON.stringify(seen));
  console.log(seen.includes(expected) ? 'OK: git usó user/token del perfil vía askpass' : 'FALLO: no llegó el token');
  srv.close(); process.exit(seen.includes(expected) ? 0 : 1);
});
