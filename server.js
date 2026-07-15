#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Investor · servidor mínimo para Render (Node ≥18, SIN dependencias)

   Qué hace:
   1. Sirve la app (index.html) y los datos del repo (/data/closes.json, etc.).
   2. API de RESPALDOS en el disco persistente de Render, protegida por token:
        GET  /api/health        → estado del servicio (público, sin datos)
        GET  /api/backup/meta   → fecha/tamaño/versiones del último respaldo [token]
        GET  /api/backup        → devuelve el último respaldo completo (JSON) [token]
        PUT  /api/backup        → guarda un respaldo (versiona y conserva 40) [token]

   Configuración por variables de entorno:
     PORT        → puerto (Render lo inyecta solo)
     DATA_DIR    → carpeta del disco persistente (Render: /var/data)
     SYNC_TOKEN  → token secreto que la app envía en el header x-investor-token

   El token se define UNA vez en el panel de Render (Environment → SYNC_TOKEN) y
   se pega UNA vez en Investor (⚙ Configuración → Respaldo → Nube). Sin token
   válido, la API de respaldos responde 401 y nadie puede leer ni escribir.
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +(process.env.PORT || 10000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "cloud-data");
const TOKEN = (process.env.SYNC_TOKEN || "").trim();
const BK_DIR = path.join(DATA_DIR, "backups");
const LATEST = path.join(DATA_DIR, "latest.json");
const MAX_BODY = 30 * 1024 * 1024;   // 30 MB de respaldo como máximo (holgado: los reales pesan cientos de KB)
const KEEP = 40;                     // versiones históricas que se conservan en el disco

fs.mkdirSync(BK_DIR, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}
function sendFile(res, file, cacheable) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJSON(res, 404, { error: "no encontrado" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": cacheable ? "public, max-age=300" : "no-store" });
    fs.createReadStream(file).pipe(res);
  });
}
/* comparación de token en tiempo constante (no filtra por timing) */
function authOK(req) {
  if (!TOKEN) return false;
  const t = String(req.headers["x-investor-token"] || "");
  const a = Buffer.from(t), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function backupMeta() {
  let savedAt = null, bytes = 0;
  try { const st = fs.statSync(LATEST); savedAt = st.mtime.toISOString(); bytes = st.size; } catch (e) {}
  let versions = 0; try { versions = fs.readdirSync(BK_DIR).filter(f => f.endsWith(".json")).length; } catch (e) {}
  return { hasBackup: savedAt != null, savedAt, bytes, versions };
}
function pruneVersions() {
  try {
    const files = fs.readdirSync(BK_DIR).filter(f => f.endsWith(".json")).sort();
    while (files.length > KEEP) { const f = files.shift(); try { fs.unlinkSync(path.join(BK_DIR, f)); } catch (e) {} }
  } catch (e) {}
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  /* ── API ── */
  if (p === "/api/health") return sendJSON(res, 200, Object.assign({ ok: true, app: "investor", tokenConfigured: !!TOKEN }, (() => { const m = backupMeta(); return { hasBackup: m.hasBackup, savedAt: m.savedAt }; })()));
  if (p.startsWith("/api/")) {
    if (!TOKEN) return sendJSON(res, 503, { error: "SYNC_TOKEN no está configurado en el servidor (panel de Render → Environment)" });
    if (!authOK(req)) return sendJSON(res, 401, { error: "token requerido o incorrecto (header x-investor-token)" });
    if (p === "/api/backup/meta" && req.method === "GET") return sendJSON(res, 200, backupMeta());
    if (p === "/api/backup" && req.method === "GET") {
      if (!fs.existsSync(LATEST)) return sendJSON(res, 404, { error: "aún no hay respaldos en el servidor" });
      return sendFile(res, LATEST, false);
    }
    if (p === "/api/backup" && (req.method === "PUT" || req.method === "POST")) {
      let size = 0; const chunks = [];
      req.on("data", c => { size += c.length; if (size > MAX_BODY) { sendJSON(res, 413, { error: "respaldo demasiado grande" }); req.destroy(); } else chunks.push(c); });
      req.on("end", () => {
        if (res.writableEnded) return;
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return sendJSON(res, 400, { error: "JSON inválido" }); }
        if (!j || j._app !== "portfolio-dashboard" || !j.clients) return sendJSON(res, 400, { error: "no parece un respaldo de Investor" });
        const body = JSON.stringify(j);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        try {
          fs.mkdirSync(BK_DIR, { recursive: true });                          // por si el disco se montó limpio
          const tmp = LATEST + ".tmp";
          fs.writeFileSync(tmp, body); fs.renameSync(tmp, LATEST);           // escritura atómica del "último"
          fs.writeFileSync(path.join(BK_DIR, "backup-" + stamp + ".json"), body);  // versión histórica
          pruneVersions();
        } catch (e) { return sendJSON(res, 500, { error: "no se pudo escribir en el disco: " + e.message }); }
        return sendJSON(res, 200, Object.assign({ ok: true }, backupMeta()));
      });
      return;
    }
    return sendJSON(res, 404, { error: "endpoint no existe" });
  }

  /* ── estáticos (solo GET, whitelist) ── */
  if (req.method !== "GET" && req.method !== "HEAD") return sendJSON(res, 405, { error: "método no permitido" });
  if (p === "/" || p === "/index.html") return sendFile(res, path.join(ROOT, "index.html"), false);
  if (p === "/favicon.ico") return sendFile(res, path.join(ROOT, "assets", "investor.ico"), true);
  if (p.startsWith("/data/")) {
    const base = path.basename(p);                       // sin traversal: solo el nombre del archivo
    if (/^[\w.\-]+\.(json|csv)$/.test(base)) return sendFile(res, path.join(ROOT, "data", base), true);
  }
  if (p.startsWith("/assets/")) {
    const base = path.basename(p);
    if (/^[\w.\-]+\.(ico|png|svg)$/.test(base)) return sendFile(res, path.join(ROOT, "assets", base), true);
  }
  return sendJSON(res, 404, { error: "no encontrado" });
});

server.listen(PORT, () => {
  console.log("Investor sirviendo en :" + PORT);
  console.log("  disco de respaldos : " + DATA_DIR + (process.env.DATA_DIR ? " (persistente)" : " (local, solo pruebas)"));
  console.log("  SYNC_TOKEN         : " + (TOKEN ? "configurado" : "⚠ FALTA (la API de respaldos responderá 503)"));
});
