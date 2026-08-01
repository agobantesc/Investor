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
     AUTH_USER   → (opcional) usuario de la puerta de entrada del SITIO
     AUTH_PASS   → (opcional) contraseña de esa puerta

   DOS CAPAS INDEPENDIENTES:
   · PUERTA DEL SITIO (HTTP Basic Auth, opcional): si defines AUTH_USER y AUTH_PASS,
     el navegador pide usuario y contraseña ANTES de mostrar nada — ni la página ni
     los datos. Es el diálogo nativo del navegador, así que tu gestor de contraseñas
     lo recuerda. Si NO las defines, el sitio queda público como antes (la app se ve
     vacía para un desconocido, porque los datos viven en el navegador de cada uno).
   · CAJA FUERTE (SYNC_TOKEN): protege la API de respaldos aunque alguien pasara la
     puerta. Se define en el panel de Render y se pega una vez en Investor
     (⚙ Configuración → Respaldo → Nube). Sin token válido: 401.

   /api/health queda SIEMPRE accesible sin credenciales (Render lo consulta para saber
   si el servicio está vivo; si lo bloqueáramos, Render lo reiniciaría en bucle). Sin
   autenticar responde lo mínimo — solo que está en pie, ningún dato del respaldo.
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
const AUTH_USER = (process.env.AUTH_USER || "").trim();
const AUTH_PASS = process.env.AUTH_PASS || "";
const GATE_ON = !!(AUTH_USER && AUTH_PASS);   // la puerta se activa solo si AMBAS están definidas
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
/* comparación de secretos en tiempo constante (no filtra por timing).
   El largo se compara aparte porque timingSafeEqual exige buffers del mismo tamaño. */
function secretEq(recibido, esperado) {
  const a = Buffer.from(String(recibido || ""), "utf8"), b = Buffer.from(String(esperado || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
/* token de la caja fuerte (header x-investor-token) */
function authOK(req) {
  if (!TOKEN) return false;
  return secretEq(req.headers["x-investor-token"], TOKEN);
}
/* PUERTA DEL SITIO · HTTP Basic Auth. Devuelve true si puede pasar (o si la puerta está apagada).
   Se comparan usuario Y contraseña en tiempo constante, y siempre ambos, para no filtrar cuál falló. */
function gateOK(req) {
  if (!GATE_ON) return true;
  const h = String(req.headers["authorization"] || "");
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(h.trim());
  if (!m) return false;
  let dec = "";
  try { dec = Buffer.from(m[1], "base64").toString("utf8"); } catch (e) { return false; }
  const i = dec.indexOf(":");
  if (i < 0) return false;
  const okU = secretEq(dec.slice(0, i), AUTH_USER);
  const okP = secretEq(dec.slice(i + 1), AUTH_PASS);
  return okU && okP;
}
function pedirCredenciales(res) {
  const body = JSON.stringify({ error: "acceso restringido: se requieren usuario y contraseña" });
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Investor", charset="UTF-8"',
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store"
  });
  res.end(body);
}
function backupMeta() {
  let savedAt = null, bytes = 0;
  try { const st = fs.statSync(LATEST); savedAt = st.mtime.toISOString(); bytes = st.size; } catch (e) {}
  let versions = 0; try { versions = fs.readdirSync(BK_DIR).filter(f => f.endsWith(".json")).length; } catch (e) {}
  return { hasBackup: savedAt != null, savedAt, bytes, versions };
}
/* ¿cuánto trae un respaldo? Se usa para distinguir un respaldo REAL de uno vacío sin descargarlo entero:
   así la app puede ofrecer "restaurar la última versión CON datos" cuando la última quedó en blanco. */
function backupResumen(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const cs = (j && j.clients) || {};
    let carteras = 0, precios = 0, dias = 0;
    for (const id of Object.keys(cs)) {
      const o = cs[id] || {};
      if (Array.isArray(o.pf_projects_v1)) carteras += o.pf_projects_v1.length;
      const px = o.inv_pricedb_v1;
      if (px && px.px) precios += Object.keys(px.px).length;
      if (px && px.ipsa) dias = Math.max(dias, Object.keys(px.ipsa).length);
    }
    return { carteras, precios, dias, tieneDatos: carteras > 0 || precios > 0 || dias > 0 };
  } catch (e) { return { carteras: 0, precios: 0, dias: 0, tieneDatos: false, error: true }; }
}
const VER_RE = /^backup-[\w.\-]+\.json$/;   // nombre de versión aceptable (sin travesía de directorios)
function listVersions() {
  let files = [];
  try { files = fs.readdirSync(BK_DIR).filter(f => VER_RE.test(f)).sort().reverse(); } catch (e) {}
  return files.map(f => {
    const full = path.join(BK_DIR, f);
    let bytes = 0, savedAt = null;
    try { const st = fs.statSync(full); bytes = st.size; savedAt = st.mtime.toISOString(); } catch (e) {}
    return Object.assign({ file: f, savedAt, bytes }, backupResumen(full));
  });
}
function pruneVersions() {
  try {
    const files = fs.readdirSync(BK_DIR).filter(f => VER_RE.test(f)).sort();
    // la versión CON DATOS más reciente nunca se descarta: es la red de seguridad si el último respaldo
    // quedó en blanco (navegador recién estrenado). Sin este resguardo, una racha de respaldos vacíos la
    // empujaría fuera de las 40 y no habría nada a lo que volver.
    let salvada = null;
    for (let i = files.length - 1; i >= 0; i--) {
      if (backupResumen(path.join(BK_DIR, files[i])).tieneDatos) { salvada = files[i]; break; }
    }
    let n = files.length, i = 0;
    while (n > KEEP && i < files.length) {
      const f = files[i++];
      if (f === salvada) continue;
      try { fs.unlinkSync(path.join(BK_DIR, f)); n--; } catch (e) {}
    }
  } catch (e) {}
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  /* ── SALUD: siempre accesible (Render la consulta sin credenciales para saber si el servicio vive).
     Sin autenticar informa solo que está en pie; el detalle del respaldo exige pasar la puerta. ── */
  if (p === "/api/health") {
    const base = { ok: true, app: "investor", gate: GATE_ON ? "on" : "off" };
    if (GATE_ON && !gateOK(req)) return sendJSON(res, 200, base);
    const m = backupMeta();
    return sendJSON(res, 200, Object.assign(base, { tokenConfigured: !!TOKEN, hasBackup: m.hasBackup, savedAt: m.savedAt }));
  }

  /* ── PUERTA DEL SITIO: todo lo demás (app, datos y API) exige credenciales si está activada ── */
  if (!gateOK(req)) return pedirCredenciales(res);

  /* ── API ── */
  if (p.startsWith("/api/")) {
    if (!TOKEN) return sendJSON(res, 503, { error: "SYNC_TOKEN no está configurado en el servidor (panel de Render → Environment)" });
    if (!authOK(req)) return sendJSON(res, 401, { error: "token requerido o incorrecto (header x-investor-token)" });
    if (p === "/api/backup/meta" && req.method === "GET") return sendJSON(res, 200, backupMeta());
    /* HISTORIAL: las versiones guardadas en el disco, de la más nueva a la más vieja, con lo que trae cada
       una. Es el camino de vuelta cuando el último respaldo quedó vacío. */
    if (p === "/api/backup/versions" && req.method === "GET") return sendJSON(res, 200, { versions: listVersions() });
    if (p === "/api/backup" && req.method === "GET") {
      const v = (u.searchParams.get("v") || "").trim();
      if (v) {
        if (!VER_RE.test(v)) return sendJSON(res, 400, { error: "nombre de versión inválido" });
        const f = path.join(BK_DIR, v);
        if (!fs.existsSync(f)) return sendJSON(res, 404, { error: "esa versión ya no está en el disco" });
        return sendFile(res, f, false);
      }
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
  console.log("  puerta del sitio   : " + (GATE_ON ? ("ACTIVA · usuario «" + AUTH_USER + "»") : "abierta (define AUTH_USER y AUTH_PASS para exigir contraseña)"));
  if (!GATE_ON && (AUTH_USER || AUTH_PASS)) console.log("  ⚠ la puerta necesita AMBAS: falta " + (AUTH_USER ? "AUTH_PASS" : "AUTH_USER"));
});
