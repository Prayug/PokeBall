#!/usr/bin/env bash
# Bundles src/ into dist/index.html. The animated sprite strips it loads on demand live next to
# it in dist/sprites3d/ (written by build_sprites3d.py), so ship that folder with the page. The 3D
# models in dist/models3d/ are not in git: `npm run models` downloads them.
# Needs esbuild: set ESBUILD to its path, or it runs `npx esbuild@0.24.0`.
set -euo pipefail
cd "$(dirname "$0")/.."
ESB="${ESBUILD:-npx --yes esbuild@0.24.0}"
[ -d node_modules/three ] || npm install --no-audit --no-fund
$ESB src/app.js --bundle --format=iife --minify --target=es2020 --charset=utf8 --outfile=dist/app.js --log-level=warning
node -e '
const fs = require("fs");
const html0 = fs.readFileSync("src/index.html", "utf8");
const theme = fs.existsSync("src/theme.css") ? fs.readFileSync("src/theme.css", "utf8") : "";
const html = theme ? html0.replace("</style>", () => theme + "\n</style>") : html0;
const js = fs.readFileSync("dist/app.js", "utf8").replace(/<\/script/gi, "<\\/script");
const server = process.env.POKEBALL_SERVER || "";
const prelude = "<script>globalThis.POKEBALL_SERVER=" + JSON.stringify(server) + ";</script>";
fs.writeFileSync("dist/index.html", html.replace("<!--APP-->", () => prelude + "<script>" + js + "</script>"));
console.log("dist/index.html", (fs.statSync("dist/index.html").size / 1024).toFixed(0) + " KB");
'
[ -d dist/models3d ] || echo 'dist/models3d/ is missing: run "npm run models" to download the 3D models'
if compgen -G 'booth/*.mp3' > /dev/null; then mkdir -p dist/booth && cp booth/*.mp3 dist/booth/; fi
