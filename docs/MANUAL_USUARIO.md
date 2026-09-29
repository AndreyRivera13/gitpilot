# GitPilot — Manual de usuario

GitPilot es un cliente Git de escritorio para macOS (estilo Fork / Sourcetree / GitKraken) hecho a la medida: maneja **varias cuentas de Git** (correos, llaves SSH, tokens), **varios repositorios en pestañas**, grafo de commits, Gitflow y prácticamente todo lo que hace `git`.

---

## 1. Instalación

Requisitos en tu Mac: **Node.js 20+** (`brew install node`) y **git** (`xcode-select --install`).

Desde la carpeta `GitPilot`:

| Quiero… | Comando |
|---|---|
| Probarla ya, sin empaquetar | `npm install && npm start` |
| Generar `GitPilot.app` e instalarla en Aplicaciones | `./scripts/build-mac.sh --install` |
| Generar solo la `.app` (queda en `release/`) | `./scripts/build-mac.sh` |
| Generar el instalador `.dmg` | `./scripts/build-mac.sh --dmg` |

**Primera vez que la abres:** la app no está firmada por Apple (es tuya). Si macOS dice que "no se puede abrir" o que "está dañada":

```bash
xattr -cr /Applications/GitPilot.app
```

o clic derecho sobre la app → *Abrir* → *Abrir*.

---

## 2. Conceptos básicos

- **Pestañas**: cada repositorio abierto es una pestaña arriba. El puntito de color de la pestaña es el color del perfil de cuenta asignado.
- **Barra izquierda**: ramas locales, remotos, tags, stashes, submódulos y Gitflow.
- **Centro**: el grafo de commits (o el diff cuando abres un archivo).
- **Derecha**: *Cambios locales* (preparar y hacer commit) o el detalle del commit seleccionado.
- **Arriba a la derecha**: el chip de **perfil** — con él cambias de cuenta para ese repo.

---

## 3. Configurar tus cuentas (lo primero que debes hacer)

Menú **👤 Perfiles** (o `⌘,`).

Un perfil = *nombre + correo + credenciales*. Crea uno por cada cuenta (por ejemplo "Trabajo" y "Personal"):

1. **Nombre del perfil** y **color** (solo para identificarlo).
2. **Nombre y correo** → son el `user.name` y `user.email` con los que se firmarán tus commits.
3. **Credenciales** (usa la que corresponda a cómo clonas el repo):
   - **Llave SSH** (remotos `git@github.com:…`): elige una existente de `~/.ssh`, examina otra, o pulsa **Generar** para crear una nueva `ed25519`. Al generarla, la llave pública queda copiada al portapapeles: pégala en GitHub/GitLab/Azure DevOps → *SSH keys*. Usa **Probar SSH** para verificar (escribe el host, ej. `github.com`).
   - **Token (HTTPS)** (remotos `https://…`): usuario + token de acceso personal (PAT). Se guarda **cifrado con el Keychain de macOS**; nunca se muestra de nuevo.

> **Importante:** la llave SSH del perfil se usa *solo* en los comandos de red de los repos que tengan ese perfil, sin tocar tu `~/.ssh/config`. Si tu llave tiene passphrase, cárgala antes en el agente: `ssh-add --apple-use-keychain ~/.ssh/tu_llave`.

### Asignar un perfil a un repositorio

Con el repo abierto, pulsa el **chip de perfil** (arriba a la derecha) y elige la cuenta. Eso:

- escribe `user.name` / `user.email` en la config **local** de ese repo (no toca tu git global),
- usa la llave/token de ese perfil para `fetch`, `pull`, `push` y `clone`.

Puedes cambiarlo cuando quieras. También hay **Probar conexión con el remoto** en el mismo menú.

### Identidad global (opcional)

En *Perfiles → Usar como identidad global* se cambia `git config --global user.name/user.email`. Es una acción explícita con confirmación; el cambio por repositorio es el recomendado.

---

## 4. Abrir, clonar e inicializar repositorios

- **Abrir** (`⌘O`): elige una carpeta que ya sea repositorio.
- **Clonar** (`⇧⌘O` o botón *Clonar*): URL, carpeta destino, **cuenta a usar** (se le asigna al repo), rama y submódulos opcionales. Verás el progreso.
- **Inicializar**: convierte una carpeta en repo nuevo (`git init`) con la rama inicial que elijas.
- **Cerrar pestaña**: `⌘W` o la ✕ de la pestaña. Solo cierra la pestaña; no borra nada.

---

## 5. Trabajo diario

### Ver el estado y hacer commit
1. Pulsa **✔ Commit** en la barra superior (o la fila **"Cambios locales"** arriba del grafo). También aparece un aviso con botón cuando estás mirando otro commit y tienes cambios pendientes. Tras un merge, pull, rebase o cherry-pick, GitPilot te lleva solo a esta vista.
2. Los archivos aparecen en **Sin preparar**. Usa **＋** por archivo o **Preparar todo**. Con **−** los quitas de *Preparados*.
3. Haz clic en un archivo para ver su **diff**.
4. Escribe el resumen (ideal ≤ 72 caracteres) y opcionalmente una descripción.
5. **Commit** o `⌘↵`. Si no preparaste nada, el botón cambia a **Preparar todo y commit (N)** y lo hace en un paso.
6. Si el commit falla (hook de pre-commit, firma GPG, identidad…), el motivo queda **visible en el formulario** hasta que lo cierres; con hooks puedes reintentar con `--no-verify`.

Opciones al pie del formulario:
- **Enmendar último** (`--amend`): reabre el mensaje del último commit. Si ya lo habías publicado, tendrás que hacer push forzado.
- **Push después**: hace push justo después del commit.
- **--no-verify**: omite los hooks de pre-commit.

Debajo del formulario siempre ves **con qué identidad** vas a firmar (`Commit como Nombre <correo>`). Si es la equivocada, pulsa *Cambiar*.

### Preparar por partes (hunks y líneas)
En el diff de un archivo **sin preparar**:
- **Preparar hunk** / **Descartar** por bloque.
- Marca las casillas de líneas sueltas (`+` / `−`) y pulsa **Preparar N líneas**.
- En un archivo **preparado**: **Quitar hunk** o quitar solo líneas.
- Cambia entre vista **Unificado** y **Dividido**, ignora espacios en blanco y ajusta las líneas de contexto arriba del diff.

### Descartar cambios
Botón ↩ por archivo (o ↩ para todo). Siempre pide confirmación: **no se puede deshacer**.

### Fetch, Pull y Push
| Botón | Qué hace |
|---|---|
| **Fetch** (`⇧⌘F`) | Trae novedades de todos los remotos (`--all --prune --tags`). |
| **Pull** (`⇧⌘L`) | Trae e integra. La flechita ▾ permite elegir **merge**, **rebase** o **solo fast-forward**. Si tus cambios locales chocan, te pregunta antes de guardarlos en stash. El número naranja indica cuántos commits vas atrás. |
| **Push** (`⇧⌘P`) | Publica la rama actual. Si no tiene upstream, lo crea (`-u`). El número indica cuántos commits vas adelante. La flechita ▾ ofrece `--force-with-lease` y push de todos los tags. |

---

## 6. El grafo de commits

- Cada color es una línea de historia; los círculos huecos son **commits de merge**; el círculo punteado arriba son tus **cambios locales**.
- **Clic** en un commit → detalle a la derecha (autor, correo, padres, archivos con +/−). Clic en un archivo → su diff.
- **Flechas ↑/↓** navegan entre commits.
- **Doble clic** en una etiqueta de rama → checkout.
- **Clic derecho** en un commit: checkout (HEAD desasociado), nueva rama/tag aquí, cherry-pick, revert, merge, rebase, reset (`--soft/--mixed/--hard`), copiar SHA.
- **Todas las ramas**: desmárcalo para ver solo lo alcanzable desde la rama actual.
- **Buscar**: por mensaje, autor o SHA (parcial).
- **Cargar más commits** al final si el historial es largo.
- Las etiquetas: azul = rama local (☁ = también está en el remoto), gris = rama remota, amarillo = tag.

---

## 7. Ramas

En la barra izquierda (clic derecho sobre una rama):
- **Checkout** (o doble clic), **Merge en la rama actual**, **Rebase de la rama actual sobre esta**.
- **Push…**, **Definir upstream…**, **Renombrar…**, **Eliminar** (si tiene commits sin fusionar te lo advierte).
- **Nueva rama** con el botón *Rama* o el ＋ de la sección: eliges desde dónde y si te cambias a ella.
- Las ramas remotas: doble clic o clic derecho → **Checkout** (crea la rama local con seguimiento); **Eliminar del remoto**.
- Los nombres con `/` (ej. `feature/login`) se agrupan en carpetas.

**Merge** te deja elegir: fast-forward si se puede, siempre commit de merge (`--no-ff`), squash, o solo fast-forward.

---

## 8. Conflictos

**Tus cambios locales nunca se descartan solos.** Merge, pull, rebase y cambio de rama primero se intentan tal cual (git conserva tus cambios si no chocan). Si git se niega porque un archivo que tocaste también cambia en la operación, GitPilot **no hace nada** y te pregunta: *"Guardar, continuar y restaurar"* guarda tus cambios en un stash, hace la operación y los vuelve a aplicar. Si al reaplicarlos chocan, siguen a salvo en **Stashes** (panel izquierdo) y te avisa. Mientras un merge con conflictos está en curso tras un auto-stash, tus cambios quedan guardados y **vuelven solos al completar o abortar** el merge (lo indica el formulario).

Cuando un merge / rebase / cherry-pick / revert / pull / stash genera conflictos:

1. Aparece un aviso naranja en *Cambios locales* y se abre (o puedes abrir) **Resolver conflictos**.
2. Para cada archivo, por cada bloque en conflicto elige **Mío**, **Entrante**, **Ambos** (o **Ambos ↺** con el orden invertido). También puedes usar *Todos los bloques*, *Todo el archivo → mío/entrante*, o **Editar a mano**.
3. **Guardar y marcar resuelto**.
4. Cuando no queden archivos: **Continuar / completar** (hace el commit del merge o sigue el rebase).
5. **Abortar operación** deshace todo y vuelve al estado anterior.

En un rebase o cherry-pick también hay **Omitir** para saltar el commit actual.

---

## 9. Stash, tags y remotos

- **Stash** (botón *Stash*): guarda tus cambios (con mensaje, incluyendo sin seguimiento, o manteniendo lo preparado). Clic derecho en un stash: **Aplicar**, **Aplicar y eliminar (pop)**, **Crear rama**, **Eliminar**. Al hacer clic en un stash ves sus archivos y diffs.
- **Tags** (botón *Tag*): ligero o anotado (si escribes mensaje); puedes publicarlo al crear. Clic derecho: checkout, publicar, eliminar (local y/o remoto).
- **Remotos** (botón *Remotos* o el ⚙ de la sección): añadir, editar URL, renombrar, eliminar y **Probar conexión**.
- **Submódulos**: se listan en la barra izquierda; ⟳ inicializa/actualiza.

---

## 10. Gitflow

Panel **Gitflow** en la barra izquierda (no necesita `git flow` instalado).

1. **Inicializar Gitflow…**: define rama de producción (`main`), de desarrollo (`develop`, se crea si falta) y prefijos (`feature/`, `release/`, `hotfix/`, prefijo del tag de versión). Requiere al menos un commit. Es compatible con la config de git-flow-avh (`gitflow.*`).
2. **+ feature / + release / + hotfix**: crea la rama desde `develop` (feature, release) o desde `main` (hotfix).
3. **✔ (Finalizar)** en una rama de flujo:
   - **feature** → merge `--no-ff` en `develop` (opción squash) y borra la rama.
   - **release / hotfix** → merge en `main`, crea el **tag**, mezcla el tag en `develop` y borra la rama.
   - Opciones: conservar la rama, mensaje del tag, y publicar (push de `main`, `develop` y tags).
4. Clic derecho en una rama de flujo: **Publicar (push -u)**, checkout, finalizar.

Si al finalizar hay **conflictos**: resuélvelos, completa el merge y vuelve a pulsar *Finalizar*: retoma donde se quedó (no repite pasos ya hechos).

---

## 11. Consola y registro

Botón **Consola**:
- **Consola**: escribe cualquier comando git (`git log --oneline -5`, con o sin la palabra `git`). Flecha ↑/↓ recorre el historial. Usa las credenciales del perfil del repo.
- **Registro de operaciones**: todos los comandos que GitPilot ejecutó, con hora, duración y errores. Ideal para entender qué pasó o aprender el comando equivalente.

---

## 12. Otras funciones

- **Historial de un archivo** y **Blame** (quién cambió cada línea): desde el diff o clic derecho en un archivo.
- **Añadir a .gitignore** (clic derecho en un archivo sin seguimiento).
- **Mostrar en Finder** / **Copiar ruta**.
- La app **se actualiza sola** cuando cambian archivos o ramas (por ejemplo, si haces commit desde la terminal) y al volver a enfocar la ventana.
- **Ajustes** (⚙): ruta del ejecutable `git` y modo de pull por defecto.

### Atajos

| Atajo | Acción |
|---|---|
| `⌘O` / `⇧⌘O` | Abrir / Clonar |
| `⌘W` | Cerrar pestaña |
| `⇧⌘F` / `⇧⌘L` / `⇧⌘P` | Fetch / Pull / Push |
| `⌘R` | Refrescar |
| `⌘,` | Perfiles de cuenta |
| `⌘↵` (en el mensaje) | Hacer commit |
| `↑` `↓` (en el grafo) | Commit anterior / siguiente |
| `Esc` | Cerrar diálogo o menú |

---

## 13. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| **"Permission denied (publickey)"** | La llave del perfil no está registrada en la plataforma o el perfil del repo es otro. Revisa el chip de perfil, usa *Probar SSH* y confirma que la llave pública esté en tu cuenta. |
| SSH falla sin mensaje claro con llave que tiene passphrase | GitPilot no puede pedir la passphrase. Cárgala en el agente: `ssh-add --apple-use-keychain ~/.ssh/tu_llave`. |
| **"Authentication failed"** por HTTPS | Token vencido o sin permisos (necesita acceso de repositorio). Edítalo en *Perfiles*. El *usuario* debe ser el correcto (en Azure DevOps puede ser cualquiera). |
| El commit sale con el correo equivocado | Mira *Commit como…* antes de confirmar. Cambia el perfil del repo con el chip. Los commits ya hechos no se modifican (usa *Enmendar último* si es el más reciente y no lo publicaste). |
| "Tus cambios locales se sobrescribirían" al cambiar de rama o hacer merge/pull | GitPilot te ofrece guardarlos en stash y restaurarlos. Nada se pierde; si al restaurar chocan, están en *Stashes*. |
| "Creo que se me borraron cambios" tras un merge | Revisa el panel **Stashes**: si hubo auto-stash, ahí están (`git stash list` también). Durante un merge con conflictos se restauran al completarlo o abortarlo. |
| El push es rechazado (*non-fast-forward*) | Alguien subió antes. Haz **Pull** (merge o rebase) y vuelve a hacer Push. Solo usa *force-with-lease* si sabes que reescribiste tu propia rama. |
| macOS dice que la app está dañada / no se puede abrir | `xattr -cr /Applications/GitPilot.app` (ver sección 1). |
| "No se encontró el ejecutable git" | Instala git con `xcode-select --install` o indica la ruta en *Ajustes*. |
| No aparece un cambio hecho por fuera | Pulsa ⟳ (o `⌘R`). |

---

## 14. Limitaciones conocidas

- El **rebase interactivo** (reordenar/fusionar commits) no tiene interfaz gráfica todavía; puedes lanzarlo con `git rebase -i` desde tu terminal.
- La consola ejecuta comandos git **no interactivos** (no abre editores ni pide contraseñas).
- No hay resaltado de sintaxis en los diffs.
- Al inspeccionar un stash se ven los archivos *rastreados*; los archivos sin seguimiento guardados con él se restauran al aplicarlo, pero no se listan en el detalle.
