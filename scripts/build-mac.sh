#!/bin/bash
# Compila GitPilot como GitPilot.app para tu Mac.
#   ./scripts/build-mac.sh            -> genera release/mac*/GitPilot.app
#   ./scripts/build-mac.sh --install  -> además lo copia a /Applications
#   ./scripts/build-mac.sh --dmg      -> genera el instalador .dmg (arm64 + x64)
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js (20 o superior). Instálalo con:  brew install node"; exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "Falta git. Instálalo con:  xcode-select --install"; exit 1
fi

echo "==> Instalando dependencias"
npm install

if [ "$1" = "--dmg" ]; then
  echo "==> Generando .dmg"
  npm run dist
  echo "Listo: revisa la carpeta release/"
  exit 0
fi

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then FLAG="--arm64"; else FLAG="--x64"; fi
echo "==> Compilando GitPilot.app ($ARCH)"
npm run build:ui
npx electron-builder --mac --dir $FLAG

APP=$(ls -d release/mac*/GitPilot.app 2>/dev/null | head -1)
if [ -z "$APP" ]; then echo "No se encontró GitPilot.app en release/"; exit 1; fi
xattr -cr "$APP" 2>/dev/null || true
echo "==> App generada: $APP"

if [ "$1" = "--install" ]; then
  echo "==> Copiando a /Applications"
  rm -rf "/Applications/GitPilot.app"
  cp -R "$APP" /Applications/
  xattr -cr /Applications/GitPilot.app 2>/dev/null || true
  echo "Listo. Ábrela desde Launchpad o con:  open -a GitPilot"
fi
