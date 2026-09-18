#!/usr/bin/env node
/**
 * Phase 1 web shell build:
 *   src/ui/*.ts  --esbuild-->  web/app.bundle.js
 *   web/styles.css + bundle    -->  dist-web/index.html (tek dosya)
 *
 * Tek dosya çıktısı, artifact olarak yayınlanabilmesi için gerekli
 * (harici script/stylesheet yüklenmiyor).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "web/styles.css"), "utf8");
const js = readFileSync(resolve(root, "web/app.bundle.js"), "utf8");

const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Otomasyon — Phase 1</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script>
${js}
</script>
</body>
</html>
`;

mkdirSync(resolve(root, "dist-web"), { recursive: true });
writeFileSync(resolve(root, "dist-web/index.html"), html, "utf8");
console.log("dist-web/index.html yazıldı (" + Math.round(html.length / 1024) + " KB)");
