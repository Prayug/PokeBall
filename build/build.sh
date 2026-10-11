#!/usr/bin/env bash
# Bundles src/ into one self-contained dist/index.html.
# Needs esbuild: set ESBUILD to its path, or it runs `npx esbuild@0.24.0`.
set -euo pipefail
cd "$(dirname "$0")/.."
ESB="${ESBUILD:-npx --yes esbuild@0.24.0}"
$ESB src/app.js --bundle --format=iife --minify --target=es2020 --charset=utf8 --outfile=dist/app.js --log-level=warning
node -e '
const fs = require("fs");
const html = fs.readFileSync("src/index.html", "utf8");
const js = fs.readFileSync("dist/app.js", "utf8").replace(/<\/script/gi, "<\\/script");
fs.writeFileSync("dist/index.html", html.replace("<!--APP-->", () => "<script>" + js + "</script>"));
console.log("dist/index.html", (fs.statSync("dist/index.html").size / 1024).toFixed(0) + " KB");
'
