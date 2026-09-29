#!/bin/bash
# Crea un repositorio de demostración con historia interesante (ramas, merges, tags, remoto)
set -e
D=${1:-/tmp/gp/demo}
rm -rf "$D" "$D-remote.git"
git init -q --bare -b main "$D-remote.git"
git init -q -b main "$D"
cd "$D"
git config user.name "Brayam Oliveros"; git config user.email "brayam@empresa.com"
c() { echo "$2" >> "$1"; git add "$1"; git commit -q -m "$3"; }
c README.md "# Demo" "Commit inicial"
c app.js "console.log('hola')" "Agrega app.js"
git tag v0.1.0
git checkout -q -b develop
c app.js "// develop" "Prepara rama develop"
git checkout -q -b feature/login
c login.js "login()" "feat: pantalla de login"
c login.js "validate()" "feat: validación de login"
git checkout -q develop
c api.js "api()" "feat: cliente API"
git merge -q --no-ff feature/login -m "Merge branch 'feature/login' into develop"
git checkout -q -b feature/pagos
c pagos.js "pagar()" "feat: módulo de pagos"
git checkout -q develop
c docs.md "docs" "docs: actualiza documentación"
git checkout -q main
git merge -q --no-ff develop -m "Release 0.2.0"
git tag -a v0.2.0 -m "Versión 0.2.0"
git checkout -q -b hotfix/typo
c README.md "fix typo" "fix: corrige typo"
git checkout -q main
git merge -q --no-ff hotfix/typo -m "Merge hotfix/typo"
git checkout -q develop
c app.js "// otra" "refactor: limpia app.js"
git remote add origin "$D-remote.git"
git push -q -u origin main develop feature/login 2>/dev/null
git push -q --tags 2>/dev/null
git stash list >/dev/null
# cambios locales
echo "cambio local" >> app.js
echo "nuevo archivo" > notas.txt
seq 1 30 | sed 's/^/linea /' > largo.txt; git add largo.txt; git commit -q -m "agrega largo.txt"
sed -i 's/linea 3$/linea 3 CAMBIADA/; s/linea 25$/linea 25 CAMBIADA/' largo.txt
echo listo
