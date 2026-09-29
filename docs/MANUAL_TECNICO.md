# GitPilot — Manual técnico

## 1. Visión general

GitPilot es una app de escritorio **Electron + React (Vite)**. No usa librerías Git (`libgit2`, `isomorphic-git`…): ejecuta el **binario `git` real** del sistema y parsea su salida. Así el comportamiento es idéntico al de la terminal (hooks, config, credenciales, submódulos, etc.).

```
┌──────────────── Electron ────────────────┐
│  Renderer (React, sandbox, sin Node)     │
│    src/renderer/**                       │
│         │  window.gitpilot.call()        │
│  Preload (contextBridge)                 │
│    src/preload/preload.js                │
│         │  ipcRenderer.invoke('api')     │
│  Main (Node)                             │
│    main.js → api.js → git.js / gitflow.js│
│                       profiles.js        │
│                       exec.js → git ssh  │
└──────────────────────────────────────────┘
```

- **Sin dependencias de runtime** (`"dependencies": {}`): todo lo que necesita el proceso principal es Node + Electron. React/Vite son de build.
- El renderer corre con `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` y una CSP estricta (`script-src 'self'`).

## 2. Estructura del proyecto

```
GitPilot/
├─ package.json            scripts, config de electron-builder
├─ vite.config.js          build del renderer → dist/
├─ build/                  icon.png, afterPack.js (firma ad-hoc en macOS)
├─ scripts/                build-mac.sh, make-demo-repo.sh, make-icon.py
├─ docs/                   manuales
├─ src/
│  ├─ main/                proceso principal (CommonJS, sin build)
│  │  ├─ main.js           ventana, menú, IPC, diálogos nativos
│  │  ├─ api.js            tabla única de métodos + watchers de archivos
│  │  ├─ git.js            todas las operaciones git
│  │  ├─ gitflow.js        Gitflow nativo
│  │  ├─ profiles.js       cuentas: identidad, SSH, token, askpass
│  │  ├─ store.js          persistencia JSON + cifrado de secretos
│  │  ├─ exec.js           spawn de git/ssh, log de operaciones, errores
│  │  ├─ parsers.js        parsers puros (status, log, diff, blame…)
│  │  └─ web-bridge.js     puente WebSocket solo para desarrollo/pruebas
│  ├─ preload/preload.js   expone window.gitpilot
│  └─ renderer/            React (JSX)
│     ├─ App.jsx           pestañas, bienvenida, modales globales
│     ├─ api.js            cliente: IPC (Electron) o WebSocket (modo web)
│     ├─ lib/graph.mjs     algoritmo de carriles del grafo
│     └─ components/       RepoView, Graph, Sidebar, DiffView, …
└─ test/                   backend.test.js, graph.test.mjs, auth.test.js
```

## 3. Comandos de desarrollo

| Comando | Qué hace |
|---|---|
| `npm install` | Instala dependencias (Electron, Vite, electron-builder…). |
| `npm start` | Compila el renderer y abre la app (producción local). |
| `npm run dev` | Vite en `:5173` + Electron con recarga (`GITPILOT_DEV=1`). |
| `npm run dev:web` | Vite + **puente web**: abre `http://localhost:5173` en un navegador con el mismo backend. Útil para depurar UI o automatizar pruebas. |
| `npm test` | Pruebas de backend, grafo y autenticación. |
| `npm run dist:dir` / `dist` | `.app` sin empaquetar / `.dmg` (arm64 + x64). |
| `./scripts/build-mac.sh [--install\|--dmg]` | Build guiado para Mac. |
| `./scripts/make-demo-repo.sh /ruta` | Crea un repo de ejemplo con ramas, merges y tags. |

## 4. Capa de API (IPC)

`api.js` construye un objeto plano `{ 'nombre.metodo': async (...args) => data }`. Espacios de nombres:

| Prefijo | Contenido |
|---|---|
| `app.*` | estado global, ajustes, sesión (pestañas), registro de operaciones, diálogos nativos |
| `repo.*` | abrir / init / clone / quitar, asignar perfil, identidad efectiva, probar auth, watch |
| `profile.*` | CRUD de perfiles, llaves SSH (listar/generar/leer pública), probar SSH, identidad global |
| `git.*` | todas las operaciones de `git.js` (primer argumento siempre la ruta del repo) |
| `flow.*` | `status`, `init`, `start`, `finish`, `publish` |

**Transporte.** `main.js` registra un único `ipcMain.handle('api', (e, method, args))` que responde `{ ok, data }` o `{ ok:false, error }` (los errores son texto en español ya listo para mostrar). El preload expone `window.gitpilot.call(method, args)`, `onEvent(cb)` y `onMenu(cb)`. Eventos del main → renderer: `log` (cada comando), `repo-changed` (watcher), `progress` (clone).

**Modo web.** `web-bridge.js` expone la misma tabla por WebSocket en `127.0.0.1:5174` (solo loopback). `renderer/api.js` decide en runtime: si existe `window.gitpilot` usa IPC, si no, WebSocket. Nunca se empaqueta ni se carga en la app de producción (`files` de electron-builder solo incluye `main.js`, módulos y `dist`).

**Agregar una operación nueva:** (1) función en `git.js` y exportarla, (2) añadir su nombre a `gitMethods` en `api.js`, (3) llamarla con `call('git.miOperacion', repo, …)`, (4) test en `backend.test.js`.

## 5. Módulos del main

### 5.1 `exec.js`
`run(args, opts)` → `{stdout, stderr, code}`. Puntos clave:
- Usa `spawn` (sin shell) → los argumentos no se interpretan; no hay inyección por nombres de rama/archivo.
- Entorno base: `LC_ALL=C` (mensajes en inglés estables para interpretarlos), `GIT_TERMINAL_PROMPT=0` (nunca se queda colgado pidiendo credenciales), `GIT_EDITOR=true`, `GIT_OPTIONAL_LOCKS=0` (los `status` no escriben el índice → no se disparan bucles con el watcher) y `PATH` ampliado con `/opt/homebrew/bin`, `/usr/local/bin` (las apps lanzadas desde Finder no heredan el PATH de la terminal).
- Añade `-c core.quotepath=false -c color.ui=false`.
- Todo comando se registra en un buffer circular (500) y se emite como evento `log` (pestaña *Registro de operaciones*). Las URL con credenciales se ofuscan.
- `GitError` lleva `code`, `args`, `stdout`, `stderr`; el `message` es el stderr de git.

### 5.2 `parsers.js`
Funciones puras, sin I/O (por eso son fáciles de probar):
- `parseStatus`: `git status --porcelain=v2 -b -z` → `{branch, staged[], unstaged[], conflicts[]}` (maneja renombres y entradas `u`).
- `parseLog`: formato con separadores `\x1f` (campo) y `\x1e` (registro), `--decorate=full` para distinguir `refs/heads`, `refs/remotes`, `tag:` sin ambigüedad.
- `parseRefs` (`for-each-ref` con `upstream:track`), `parseStashes`, `parseCommitFiles` (une `--name-status -z` y `--numstat -z`), `parseBlame` (`--line-porcelain`), `parseSubmodules`.
- `parseDiff`: diff unificado → `[{path, status, binary, hunks:[{header, oldStart, …, lines:[{t,s,o,n}]}], header[]}]`.
- `buildPatch(file, hunkIdx, selectedLines, mode)`: ver 6.2.
- `parseConflicts`: divide un archivo con marcadores `<<<<<<<`/`|||||||`/`=======`/`>>>>>>>` en segmentos.

### 5.3 `git.js`
Fábrica `createGit({getAuthEnv, getSettings})`. Cada función recibe `repo` primero. Los comandos de red se marcan con `{net:true}` y reciben el entorno de autenticación del perfil del repo.

Decisiones relevantes:
- `merge/rebase/cherryPick/revert/pull/stashApply/stashPop` usan `allowFail` y `mergeResult()`: si el código de salida ≠ 0 **y** hay conflictos en `status`, devuelven `{ok:false, conflicts:n}` (no es un error, la UI abre el resolvedor); si no hay conflictos, lanzan el error real.
- **Protección de cambios locales**: `mergeResult()` clasifica el fallo de git con `DIRTY_RE` ("would be overwritten", "unstaged changes"…, excluyendo archivos sin seguimiento) y devuelve `{ok:false, dirty:true}` sin haber tocado nada. `merge/rebase/pull` aceptan `{autostash:true}` (usa `--autostash` nativo de git ≥ 2.27); `checkout` lanza un error con `dirty=true` (serializado por IPC/puente) y con `{autostash:true}` hace `stash push -u` → checkout → `stash pop`, conservando el stash si el pop choca. `status.autostash` refleja `.git/MERGE_AUTOSTASH`. La UI (`withStash` en `RepoView.jsx`) pregunta y reintenta con autostash; nunca hay autostash por defecto.
- `repoState()` detecta operaciones en curso mirando `MERGE_HEAD`, `rebase-merge|rebase-apply`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` en `git rev-parse --absolute-git-dir` (funciona con worktrees y submódulos).
- `opContinue/opAbort/opSkip` eligen el subcomando según `repoState()`.
- `unstage` en repos sin commits usa `git rm --cached` (donde `reset` no aplica).
- `checkout(target,{remote:true})` crea la rama local con `--track` si no existe.
- `getDiff` cubre: working tree, índice (`--cached`), archivo sin seguimiento (`--no-index /dev/null`), commit (`show -m --first-parent --root`, correcto para merges y commits raíz) y rango `from..to`. Fuerza `--src-prefix=a/ --dst-prefix=b/` para ignorar `diff.mnemonicPrefix` del usuario.
- Los stashes se inspeccionan como commits (`stash@{n}`).
- `rawCommand` parte la línea respetando comillas y ejecuta con `net:true` (usa credenciales del perfil).

### 5.4 `gitflow.js`
Implementación propia, compatible con la configuración de **git-flow-avh** (`gitflow.branch.master|develop`, `gitflow.prefix.feature|release|hotfix|support|versiontag`), de modo que repos ya inicializados con `git flow init` son reconocidos.
- `start`: feature/release desde `develop`, hotfix desde `main`.
- `finish` es **idempotente y reanudable**: cada paso comprueba si ya está hecho (`merge-base --is-ancestor`, existencia del tag). Si un merge produce conflictos devuelve `{ok:false, conflict:true}`; el usuario resuelve, confirma el merge y vuelve a ejecutar `finish`.
  - feature → `develop` (`--no-ff`, o squash).
  - release/hotfix → `main` (`--no-ff`) → tag anotado → **el tag se fusiona en `develop`** (igual que git-flow: así `main` queda como ancestro de `develop`) → borra la rama.
  - Rechaza ejecutarse con operación en curso o con cambios sin commitear.
- `push` opcional de `main`, `develop`, tags y borrado de la rama remota.

### 5.5 `profiles.js` y `store.js` (cuentas)
Modelo de perfil: `{id, label, name, email, sshKey, host, tokenUser, token(cifrado), color}`. Los repos guardan `profileId`. Persistencia en `~/Library/Application Support/GitPilot/gitpilot.json` (permisos `0600`).

**Asignar perfil a repo** (`assignToRepo`): escribe en la config **local** `user.name`, `user.email` y, si hay llave, `core.sshCommand`. Nunca modifica `--global`, salvo la acción explícita *Usar como identidad global*. Al quitar el perfil solo se elimina `core.sshCommand` si fue puesto por la app (patrón `ssh -i "…" -o IdentitiesOnly=yes`).

**Autenticación en operaciones de red** (`authEnv(repo)`), inyectada por comando (no queda en disco):
- **SSH**: `GIT_SSH_COMMAND='ssh -i "<llave>" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes'`. `IdentitiesOnly` evita que el agente ofrezca *otra* llave y autentique con la cuenta equivocada; `BatchMode` evita cuelgues por prompts.
- **Token HTTPS**: `GIT_ASKPASS=<script>` + `GITPILOT_USER`/`GITPILOT_TOKEN` en el entorno del proceso hijo. El script (`~/.gitpilot/askpass.sh`, modo 0700) solo imprime esas variables. Además `GIT_CONFIG_COUNT/KEY_0/VALUE_0` fija `credential.helper=` vacío para que **el Keychain del sistema no pise al token del perfil**.
  > **Gotcha verificado:** git ejecuta `GIT_ASKPASS` sin comillas → una ruta con espacios (p. ej. `~/Library/Application Support/…`) falla con *"cannot exec"*. Por eso el script vive en `~/.gitpilot/` (o `/tmp/gitpilot-<uid>` si el home tuviera espacios). Está cubierto por `test/auth.test.js`.

**Secretos:** el token se cifra con `safeStorage` de Electron (Keychain de macOS) → prefijo `enc:`. El renderer **nunca** recibe el token (`listProfiles` lo reemplaza por `hasToken`). Sin Keychain (modo web de pruebas) cae a `b64:` (ofuscación, **no** seguro; solo para desarrollo).

**Llaves:** `generateSshKey` ejecuta `ssh-keygen -t ed25519 -N ""` en `~/.ssh/id_ed25519_<etiqueta>` y **se niega a sobrescribir** una existente. `testSsh` corre `ssh -T git@host` y evalúa la respuesta.

### 5.6 `api.js` — watchers
`fs.watch(repo, {recursive:true})` (FSEvents en macOS), filtrando `.git/objects`, `.git/logs`, `node_modules/` y `*.lock`; de `.git/` solo pasan `HEAD`, `index`, `refs`, `MERGE_HEAD`, etc. Debounce de 450 ms → evento `repo-changed`. El renderer refresca además al recuperar el foco de la ventana.

## 6. Renderer

### 6.1 Estructura de estado
`App.jsx` (pestañas, modales globales: perfiles, ajustes, clonar) → `RepoView.jsx` (una instancia por repo activo, con `key={path}`): carga en paralelo `status`, `refs`, `flow.status`, `identity`, `submodules` y `log`, y contiene todas las **acciones** (`A.*`), menús contextuales y los modales locales (conflictos, blame, historial, remotos). Cada acción pasa por `run(label, fn)`, que muestra la barra de progreso, atrapa errores en un *toast* y recarga el estado. Un `busyRef` evita refrescos del watcher mientras hay una operación en curso.

`ui.jsx` es un pequeño framework de diálogos: `ui.confirm()`, `ui.form({fields})` (texto, textarea, select, checkbox, ruta con selector), `ui.menu()` (contextual) y toasts, todos basados en promesas.

### 6.2 Grafo (`lib/graph.mjs`, `Graph.jsx`)
Entrada: commits en orden topológico por fecha (`--date-order`) con sus padres. Algoritmo de **carriles**: se mantiene un arreglo `lanes[i] = sha esperado`. Para cada commit: (1) sus carriles son los que lo esperan (varios si es punto de convergencia); (2) las líneas de los demás carriles “pasan de largo”; (3) el primer padre hereda el carril, los otros padres reutilizan un carril que ya los espera o abren uno nuevo (con color nuevo). Devuelve por fila `{lane, color, hasTop, incoming[], through[], outgoing[], isMerge}` y el ancho máximo.

Render: **virtualizado por ventana** (solo se montan las filas visibles ± 8) con un `<svg>` pequeño por fila (líneas rectas y curvas Bézier + círculo). La paginación carga de a 800 commits. Los cambios locales se modelan como un commit falso `WIP` cuyo padre es `HEAD`.

### 6.3 Staging por hunk y por línea
1. `getDiff` → `parseDiff` genera hunks con líneas indexadas.
2. La UI envía `{file, hunk, lines?, mode}` con `mode ∈ stage | unstage | discard`.
3. El backend **vuelve a calcular el diff** (no confía en datos viejos), y `buildPatch` genera un parche con la cabecera del archivo y el hunk transformado:
   - *stage* (aplica al índice): las líneas `+` no seleccionadas se descartan; las `-` no seleccionadas pasan a contexto.
   - *unstage/discard* (se aplican con `-R`): las `+` no seleccionadas pasan a contexto; las `-` no seleccionadas se descartan.
   - Los marcadores `\ No newline at end of file` siguen a la línea que acompañan.
4. Se recalculan los contadores del encabezado `@@` y se aplica con `git apply --recount --whitespace=nowarn [--cached] [-R]` por stdin.

### 6.4 Conflictos
`git.conflictFile` devuelve el contenido con marcadores y los segmentos (`parseConflicts`). La UI compone el archivo final según la elección por bloque (`ours`, `theirs`, `both`, `both-rev`) o el texto editado a mano, lo escribe y hace `git add`. “Usar mío/entrante” de archivo completo usa `git checkout --ours|--theirs` + `add`. Cuando `status.conflicts` queda vacío se habilita `opContinue`.

## 7. Pruebas

`npm test` ejecuta:
- **`backend.test.js`** (26 pruebas, incluye la protección de cambios locales: merge sin/con choque, abortar con cambios locales, autostash con conflicto, rebase y checkout) sobre repos reales temporales: init/commit, stage/unstage/discard, hunks y líneas, ramas y merge, conflictos (resolver, abortar, `theirs`), cherry-pick/revert/reset, rebase, stash, tags, remotos (push -u, fetch, pull ff-only/rebase, borrar rama remota, checkout de remota), amend/blame/historial/búsqueda, Gitflow completo (feature, release+tag, hotfix, finish con conflicto reanudable), perfiles (identidad por repo sin tocar la global, secretos, askpass), clone con progreso, consola y errores.
- **`graph.test.mjs`**: asignación de carriles (lineal, merge, convergencia).
- **`auth.test.js`**: servidor HTTP que responde 401 y comprueba que git reintenta con `Authorization: Basic user:token` del perfil (con HOME con espacios).

Verificación de UI hecha con Playwright contra `npm run dev:web`/`dist` (capturas de grafo, diff unificado/dividido, staging por línea, conflictos, perfiles, Gitflow, consola, clone) y arranque real de Electron bajo Xvfb (preload + IPC + carga de `dist/index.html`).

**No verificado en el entorno de desarrollo** (no había macOS ni `ssh`): empaquetado `.dmg`/`.app` con electron-builder y firma ad-hoc, `safeStorage` con Keychain real, generación/uso de llaves SSH contra un servidor real (`generateSshKey` se omite en el test si falta `ssh-keygen`). El primer `./scripts/build-mac.sh` en tu Mac es la prueba de esos puntos.

## 8. Empaquetado (macOS)

`electron-builder` (config en `package.json → build`): `appId co.oliveros.gitpilot`, objetivo `dmg` para `arm64` y `x64`, icono `build/icon.png` (1024², convertido a `.icns` automáticamente). `identity: null` desactiva la firma con certificado; el hook `build/afterPack.js` aplica **firma ad-hoc** (`codesign --force --deep --sign -`), necesaria para que un binario arm64 modificado arranque en Apple Silicon. Sin certificado de Apple Developer + notarización, Gatekeeper mostrará el aviso la primera vez (ver manual de usuario, `xattr -cr`). Para distribuir a terceros habría que firmar y notarizar (`mac.identity`, `notarize`).

Regenerar el icono: `python3 scripts/make-icon.py` (requiere Pillow).

## 9. Seguridad — resumen

- Renderer aislado (sandbox, sin Node, CSP estricta); todo pasa por una API explícita.
- Procesos hijos con `spawn` sin shell.
- Tokens cifrados con Keychain, nunca enviados al renderer ni escritos en `.git/config`; entran solo por variables de entorno del proceso hijo.
- Las rutas de archivos leídos/escritos (`readWorkFile`, `writeWorkFile`) se validan para permanecer dentro del repo.
- `openExternal` solo acepta `http(s)://`.
- El puente web escucha solo en `127.0.0.1` y no forma parte del build de producción.

## 10. Limitaciones y posibles mejoras

- Rebase interactivo gráfico, `git bisect`, worktrees y LFS no tienen UI (se pueden usar desde la consola/terminal).
- Diffs sin resaltado de sintaxis; sin comparación de dos commits arbitrarios en la UI (el backend ya soporta `from..to` en `getDiff`).
- Pull requests / issues de GitHub, GitLab o Azure DevOps no están integrados.
- Firma con `passphrase` de SSH: se asume `ssh-agent` (por `BatchMode`).
- Ideas: autoasignar perfil según el host de la URL remota, atajos de teclado adicionales, tema claro.
