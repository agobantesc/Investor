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

   DOS CAPAS INDEPENDIENTES:
   · CUENTAS (users.json en el disco): la puerta REAL de Investor. El servidor guarda
     las contraseñas con PBKDF2 · 210.000 iteraciones, verifica el ingreso, cuenta los
     intentos fallidos y bloquea la cuenta. La primera cuenta —la de administrador— se
     crea con el SYNC_TOKEN: "todavía no hay cuentas" no es una credencial, y sin esa
     exigencia el primero que llegara a una URL pública se quedaría con el servicio.
   · (Ya NO hay "puerta del sitio" con HTTP Basic Auth. Era el diálogo NATIVO del navegador que
     pedía usuario y contraseña antes de abrir la app; sin sesión propia, reaparecía solo y obligaba a
     entrar dos veces. Se ELIMINÓ del código: aunque AUTH_USER / AUTH_PASS sigan definidas en el
     panel de Render, el servidor las ignora. El acceso lo controla solo la sesión de Investor.)
   · CAJA FUERTE (SYNC_TOKEN): protege la API de respaldos aunque alguien pasara la
     puerta. Se define en el panel de Render y se pega una vez en Investor
     (⚙ Configuración → Respaldo → Nube). Sin token válido: 401.

   SEGURIDAD WEB (todas las respuestas):
   · Cabeceras: Content-Security-Policy (la app con NONCE por respuesta: un <script> inyectado no corre),
     X-Content-Type-Options: nosniff, X-Frame-Options: DENY / frame-ancestors 'none', Referrer-Policy,
     Permissions-Policy, Cross-Origin-Opener-Policy y, detrás de HTTPS, Strict-Transport-Security.
   · Ingreso: límite por IP, por cuenta+IP y por cuenta; misma respuesta y misma demora exista o no el
     usuario; largos máximos; cambiar la contraseña cierra las demás sesiones.
   · REGISTRO DE SEGURIDAD (seguridad.log en el disco + log de Render): ingresos correctos y fallidos,
     bloqueos y cambios de cuentas, con la IP. Nunca contraseñas ni tokens. El administrador lo ve en
     ⚙ Configuración → Accesos.
   · Errores 500 genéricos hacia afuera; el detalle queda solo en el registro.

   /api/health queda SIEMPRE accesible (Render lo consulta para saber si el servicio está
   vivo): dice que está en pie y si hay respaldo, nunca su contenido ni datos de las cuentas.
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
// variables de la antigua puerta Basic Auth: solo para AVISAR en el log que quedaron en el panel (se ignoran)
const GATE_RESTOS = ["AUTH_USER", "AUTH_PASS"].filter(k => (process.env[k] || "").trim());
const BK_DIR = path.join(DATA_DIR, "backups");
const LATEST = path.join(DATA_DIR, "latest.json");
const MAX_BODY = 30 * 1024 * 1024;   // 30 MB de respaldo como máximo (holgado: los reales pesan cientos de KB)
const KEEP = 40;                     // versiones históricas que se conservan en el disco

fs.mkdirSync(BK_DIR, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, cabeceras(res._req, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" }));
  res.end(body);
}
function sendFile(res, file, cacheable) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJSON(res, 404, { error: "no encontrado" });
    res.writeHead(200, cabeceras(res._req, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": cacheable ? "public, max-age=300" : "no-store" }));
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
/* ═══════════════════ CABECERAS DE SEGURIDAD ═══════════════════ */
function esHttps(req) { return String((req && req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim() === "https"; }
function cabeceras(req, extra) {
  const h = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    // por defecto (JSON, archivos de datos): nada ejecutable, nada embebible
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  };
  // HSTS solo detrás de HTTPS (Render): por HTTP plano el navegador lo ignora y en local estorbaría
  if (esHttps(req)) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return Object.assign(h, extra || {});
}
/* CSP de la APP. Scripts SOLO con el nonce de esta respuesta: la app tiene dos <script> propios y ningún
   manejador en línea ni eval, así que todo lo que un atacante lograra inyectar como HTML queda inerte.
   style-src admite 'unsafe-inline' porque la app pinta con estilos en línea (no ejecutan código).
   connect-src https: porque la app consulta varias fuentes públicas de mercado; lo que se cierra es
   http plano, objetos, iframes, workers, <base> y que otro sitio la embeba. */
function cspApp(nonce, https) {
  return ["default-src 'self'", `script-src 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:", "font-src 'self' data:", "connect-src 'self' https:",
    "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "manifest-src 'self'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].concat(https ? ["upgrade-insecure-requests"] : []).join("; ");
}
let _app = { mtime: 0, html: "" };
function sendApp(req, res) {
  const f = path.join(ROOT, "index.html");
  try { const st = fs.statSync(f); if (st.mtimeMs !== _app.mtime) _app = { mtime: st.mtimeMs, html: fs.readFileSync(f, "utf8") }; }
  catch (e) { return sendJSON(res, 404, { error: "no encontrado" }); }
  const nonce = crypto.randomBytes(16).toString("base64");
  const buf = Buffer.from(_app.html.replace(/<script>/g, `<script nonce="${nonce}">`), "utf8");
  res.writeHead(200, cabeceras(req, { "Content-Type": MIME[".html"], "Content-Length": buf.length, "Cache-Control": "no-store", "Content-Security-Policy": cspApp(nonce, esHttps(req)) }));
  res.end(req.method === "HEAD" ? undefined : buf);
}

/* ═══════════════════ IP REAL ═══════════════════
   Render pasa por Cloudflare: CF-Connecting-IP / True-Client-IP las fija el borde (el cliente no puede
   falsearlas). Sin ellas se usa X-Forwarded-For y, al final, la conexión. Si alguien falseara el XFF solo
   esquivaría el límite POR IP: el límite POR CUENTA sigue en pie. */
function ipDe(req) {
  const h = (req && req.headers) || {};
  const c = String(h["cf-connecting-ip"] || h["true-client-ip"] || "").trim();
  if (c) return c.slice(0, 64);
  const xff = String(h["x-forwarded-for"] || "").split(",").map(x => x.trim()).filter(Boolean);
  if (xff.length) return xff[0].slice(0, 64);
  return String((req && req.socket && req.socket.remoteAddress) || "?").slice(0, 64);
}

/* ═══════════════════ REGISTRO DE SEGURIDAD ═══════════════════
   Una línea JSON por evento en el disco persistente (y en el log de Render). Los campos se arman a mano
   en cada llamada —nunca se vuelca un cuerpo de petición— y además se filtra cualquier clave que huela a
   secreto. Un nombre de usuario que NO existe no se guarda (suele ser una contraseña tipeada en el campo
   equivocado): queda como "(no existe)". Se rota a los 2 MB conservando el archivo anterior. */
const SEC_LOG = path.join(DATA_DIR, "seguridad.log"), SEC_MAX = 2 * 1024 * 1024;
function registrar(req, ev, datos) {
  const r = Object.assign({ ts: new Date().toISOString(), ev, ip: req ? ipDe(req) : null }, datos || {});
  if (req && req.headers) r.ua = String(req.headers["user-agent"] || "").slice(0, 160);
  for (const k of Object.keys(r)) if (/pass|token|hash|salt|clave|secret/i.test(k)) delete r[k];
  const linea = JSON.stringify(r);
  console.log("[seguridad] " + linea);
  try { if (fs.statSync(SEC_LOG).size > SEC_MAX) fs.renameSync(SEC_LOG, SEC_LOG + ".1"); } catch (e) {}
  try { fs.appendFileSync(SEC_LOG, linea + "\n"); } catch (e) {}
}
function registroLeer(n) {
  const leer = f => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean); } catch (e) { return []; } };
  const lineas = leer(SEC_LOG + ".1").concat(leer(SEC_LOG)).slice(-n);
  return lineas.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).reverse();
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
  try { return backupResumen0(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (e) { return { carteras: 0, precios: 0, dias: 0, tieneDatos: false, error: true }; }
}
/* el mismo resumen, sobre un objeto ya leído (los datos de una cuenta viven dentro de un sobre con `rev`) */
function backupResumen0(j) {
  try {
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
/* ═══════════════════ CUENTAS EN EL SERVIDOR ═══════════════════
   Para poder entrar a Investor desde CUALQUIER equipo, las cuentas no pueden vivir en el navegador: viven
   aquí, en el disco persistente. El servidor es quien verifica la contraseña — el navegador nunca recibe el
   hash — y quien cuenta los intentos fallidos, que es donde el bloqueo significa algo (si lo contara el
   navegador bastaría con abrir una ventana nueva).
   · Contraseñas con PBKDF2-SHA256, 600.000 iteraciones (lo que recomienda OWASP hoy) y sal por usuario,
     calculado FUERA del hilo principal (un ingreso no congela el servidor). Las cuentas con hash de
     210.000 se re-cifran solas la próxima vez que su dueño entra. Comparación en tiempo constante.
   · Intentos: 5 fallos desde una misma IP contra una cuenta → esa IP queda fuera de esa cuenta 15 min;
     20 fallos desde una IP (a cualquier cuenta) → esa IP fuera 15 min; 25 fallos contra una cuenta desde
     cualquier lado → la cuenta 15 min. Así un atacante desde un solo equipo NO puede bloquearte a ti.
   · Sesión = token aleatorio de 32 bytes con caducidad; se guarda en el disco para sobrevivir reinicios. */
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESS_FILE = path.join(DATA_DIR, "sessions.json");
const PBKDF2_IT = 600000, PBKDF2_IT_LEGADO = 210000, PBKDF2_LEN = 32;
const BLOQUEO_MS = 15 * 60 * 1000;
const LIM_CUENTA_IP = 5, LIM_IP = 20, LIM_CUENTA = 25;
const MAX_USER = 64, MAX_NOMBRE = 80, MAX_PASS = 256;
const SESION_MS = 12 * 60 * 60 * 1000;          // 12 h de validez
/* El archivo de sesiones guarda SOLO los tokens vivos. Los INGRESOS sí quedan en el registro de seguridad
   (más arriba): sin él no hay forma de ver si alguien está probando contraseñas. */
/* contadores de intentos en memoria (se reinician con el servicio; el de la CUENTA vive en users.json) */
const fallosIp = new Map(), fallosCuentaIp = new Map(), fallosFantasma = new Map();
function contar(mapa, k, lim, ahora) {
  const e = mapa.get(k) || { n: 0, desde: ahora, hasta: 0 };
  if (ahora - e.desde > BLOQUEO_MS) { e.n = 0; e.desde = ahora; }
  e.n++;
  if (e.n >= lim) { e.hasta = ahora + BLOQUEO_MS; e.n = 0; e.desde = ahora; }
  mapa.set(k, e);
  return e;
}
const frenado = (mapa, k, ahora) => { const e = mapa.get(k); return e && e.hasta > ahora ? e.hasta : 0; };
setInterval(() => { const a = Date.now(); for (const m of [fallosIp, fallosCuentaIp, fallosFantasma]) for (const [k, e] of m) if (e.hasta < a && a - e.desde > BLOQUEO_MS) m.delete(k); }, 10 * 60 * 1000).unref();
/* largos y caracteres de lo que llega: usuario, nombre y contraseña acotados y sin caracteres de control */
function camposOK(j, conPass) {
  const ctrl = /[\u0000-\u001f\u007f]/;
  if (j.user != null && (String(j.user).trim().length > MAX_USER || ctrl.test(String(j.user)))) return `el usuario admite hasta ${MAX_USER} caracteres, sin caracteres de control`;
  if (j.name != null && (String(j.name).trim().length > MAX_NOMBRE || ctrl.test(String(j.name)))) return `el nombre admite hasta ${MAX_NOMBRE} caracteres, sin caracteres de control`;
  if (conPass && j.pass != null && String(j.pass).length > MAX_PASS) return `la contraseña admite hasta ${MAX_PASS} caracteres`;
  return null;
}

/* ═══════════════════ DATOS DE CADA CUENTA ═══════════════════
   La cuenta ya viajaba; los datos no. Entrar desde otro equipo dejaba la app vacía y había que restaurar a
   mano un respaldo pegando el SYNC_TOKEN. Aquí el estado completo de Investor de cada cuenta vive en el
   disco, atado a su sesión: entras con tu usuario y tus inversiones están ahí, al día.

   REVISIÓN (`rev`): cada guardado incrementa un número. Quien sube manda cuál creía que era el último; si no
   coincide, el servidor RECHAZA con 409 en vez de pisar. Es lo que evita que un equipo con datos de hace una
   semana borre el trabajo del equipo que sí está al día — no se pueden fusionar dos estados, pero sí se puede
   negar a perder uno en silencio.
   Cada versión anterior queda en el disco (las últimas VER_KEEP): el camino de vuelta si algo sale mal. */
const UD_DIR = path.join(DATA_DIR, "userdata");
const UD_KEEP = 20;
const UID_RE = /^[\w-]{1,64}$/;
function udArchivo(uid) { return path.join(UD_DIR, uid + ".json"); }
function udLeer(uid) {
  const v = leerJSON(udArchivo(uid), null);
  return (v && typeof v === "object" && v.payload) ? v : { rev: 0, savedAt: null, payload: null };
}
function udMeta(uid) {
  const v = udLeer(uid);
  let bytes = 0; try { bytes = fs.statSync(udArchivo(uid)).size; } catch (e) {}
  return { rev: v.rev || 0, savedAt: v.savedAt || null, bytes, hayDatos: !!v.payload };
}
/* las versiones viejas de ESTA cuenta, de la más nueva a la más vieja */
function udVersiones(uid) {
  let arch = [];
  try { arch = fs.readdirSync(UD_DIR).filter(f => f.indexOf(uid + ".v") === 0 && f.endsWith(".json")).sort().reverse(); } catch (e) {}
  return arch.map(f => {
    const full = path.join(UD_DIR, f);
    let bytes = 0, savedAt = null;
    try { const st = fs.statSync(full); bytes = st.size; savedAt = st.mtime.toISOString(); } catch (e) {}
    const j = leerJSON(full, null);
    return Object.assign({ file: f, rev: (j && j.rev) || 0, savedAt, bytes }, backupResumen0((j && j.payload) || null));
  });
}
function udPodar(uid) {
  try {
    const v = fs.readdirSync(UD_DIR).filter(f => f.indexOf(uid + ".v") === 0 && f.endsWith(".json")).sort();
    while (v.length > UD_KEEP) { try { fs.unlinkSync(path.join(UD_DIR, v.shift())); } catch (e) {} }
  } catch (e) {}
}
function udEscribir(uid, payload, rev) {
  fs.mkdirSync(UD_DIR, { recursive: true });
  const reg = { rev, savedAt: new Date().toISOString(), payload };
  const body = JSON.stringify(reg);
  const f = udArchivo(uid), tmp = f + ".tmp";
  fs.writeFileSync(tmp, body); fs.renameSync(tmp, f);                       // escritura atómica
  fs.writeFileSync(path.join(UD_DIR, uid + ".v" + String(rev).padStart(6, "0") + ".json"), body);
  udPodar(uid);
  return reg;
}

function leerJSON(f, porDefecto) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return porDefecto; } }
function escribirJSON(f, v) { try { const t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); return true; } catch (e) { return false; } }
function usersLeer() { const v = leerJSON(USERS_FILE, null); return Array.isArray(v) ? v : []; }
function usersEscribir(v) { return escribirJSON(USERS_FILE, v); }
function sesLeer() { const v = leerJSON(SESS_FILE, null); return { tokens: (v && typeof v === "object" && v.tokens) ? v.tokens : {} }; }   // un `log` de una versión anterior se descarta al primer guardado
function sesEscribir(v) { return escribirJSON(SESS_FILE, v); }

function pwHash(pass, salt, it) {
  return new Promise((ok, mal) => crypto.pbkdf2(String(pass).slice(0, MAX_PASS), salt, it, PBKDF2_LEN, "sha256", (e, k) => e ? mal(e) : ok(k.toString("hex"))));
}
async function pwNueva(pass) { const salt = crypto.randomBytes(16).toString("hex"); return { salt, hash: await pwHash(pass, salt, PBKDF2_IT), it: PBKDF2_IT }; }
async function pwVerificar(pass, u) {
  try {
    const h = Buffer.from(await pwHash(pass, u.salt, +u.it || PBKDF2_IT_LEGADO), "hex"), g = Buffer.from(u.hash, "hex");
    return h.length === g.length && crypto.timingSafeEqual(h, g);
  } catch (e) { return false; }
}
/* para un usuario que NO existe se hace el mismo trabajo, con una sal fija del proceso: misma demora */
const SAL_FANTASMA = crypto.randomBytes(16).toString("hex");
async function pwFantasma(pass) { try { await pwHash(pass, SAL_FANTASMA, PBKDF2_IT); } catch (e) {} return false; }
/* MISMA política que el navegador: el cliente la aplica para no hacer viajes de más, pero esta es la que manda */
const PW_MIN = 10;
const PW_OBVIAS = ["contrasena", "contraseña", "password", "investor", "12345678", "qwerty", "admin", "bolsa", "chile", "inversion", "inversión", "1234567890", "abcdefghij"];
function pwPolitica(pw, usuario, nombre) {
  const p = String(pw || ""), fallos = [];
  if (p.length < PW_MIN) fallos.push(`al menos ${PW_MIN} caracteres`);
  if (p.length > MAX_PASS) fallos.push(`no más de ${MAX_PASS} caracteres`);
  const clases = [/[a-záéíóúñ]/, /[A-ZÁÉÍÓÚÑ]/, /\d/, /[^\w\sáéíóúñÁÉÍÓÚÑ]/].filter(r => r.test(p)).length;
  if (clases < 3) fallos.push("mezclar al menos 3 de: minúsculas, MAYÚSCULAS, números y símbolos");
  if (/^(.)\1+$/.test(p)) fallos.push("no repetir el mismo carácter");
  const bajo = p.toLowerCase();
  if (PW_OBVIAS.some(x => bajo.includes(x))) fallos.push("no contener palabras evidentes");
  const u = String(usuario || "").trim().toLowerCase();
  if (u.length >= 3 && bajo.includes(u)) fallos.push("no contener tu usuario");
  for (const t of String(nombre || "").trim().toLowerCase().split(/\s+/)) {
    if (t.length >= 4 && bajo.includes(t)) { fallos.push("no contener tu nombre"); break; }
  }
  return { ok: fallos.length === 0, fallos };
}
const slug = u => String(u || "").trim().toLowerCase();
function usuarioPublico(u) {
  return { id: u.id, user: u.user, name: u.name, role: u.role, ns: u.ns, creado: u.creado, activo: u.activo !== false, ultimo: u.ultimo || null };
}
function sesionNueva(u) {
  const S = sesLeer(), token = crypto.randomBytes(32).toString("hex");
  const ahora = Date.now();
  S.tokens[token] = { uid: u.id, ini: ahora, exp: ahora + SESION_MS };
  sesEscribir(S);
  return token;
}
function sesionDe(req) {
  const h = String(req.headers["x-investor-session"] || "");
  if (!h) return null;
  const S = sesLeer(), t = S.tokens[h];
  if (!t) return null;
  if (Date.now() > t.exp) { delete S.tokens[h]; sesEscribir(S); return null; }
  const u = usersLeer().find(x => x.id === t.uid);
  if (!u || u.activo === false) return null;
  return { token: h, user: u };
}
function sesionCerrar(token) {
  const S = sesLeer();
  if (S.tokens[token]) delete S.tokens[token];
  sesEscribir(S);
}
/* cierra TODAS las sesiones de una cuenta (salvo, opcionalmente, la que hace el cambio) — tras un cambio
   de contraseña, quien la hubiera robado queda fuera aunque tuviera una sesión abierta */
function sesionesCerrarDe(uid, salvo) {
  const S = sesLeer(); let n = 0;
  for (const t of Object.keys(S.tokens)) if (S.tokens[t].uid === uid && t !== salvo) { delete S.tokens[t]; n++; }
  if (n) sesEscribir(S);
  return n;
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
  res._req = req;   // las cabeceras de seguridad (HSTS) dependen de la petición
  try { atender(req, res); }
  catch (e) {
    registrar(req, "error_500", { ruta: String(req.url || "").slice(0, 120), detalle: String((e && e.message) || e).slice(0, 200) });
    if (!res.headersSent) sendJSON(res, 500, { error: "error interno del servidor" });
  }
});
function atender(req, res) {
  let u;
  try { u = new URL(req.url, "http://x"); } catch (e) { return sendJSON(res, 400, { error: "ruta inválida" }); }
  const p = u.pathname;

  /* ── SALUD: siempre accesible (Render la consulta sin credenciales para saber si el servicio vive).
     Además de "en pie" dice si hay respaldo y cuándo se guardó (la app lo usa al abrir para ofrecer la
     restauración); nunca entrega el contenido, que exige token o sesión. ── */
  if (p === "/api/health") {
    // lo mínimo: que está en pie y si hay un respaldo que ofrecer (la app lo pregunta en un navegador vacío).
    // Ni la fecha ni si el token está configurado: eso no le sirve a nadie que no sea el dueño.
    return sendJSON(res, 200, { ok: true, app: "investor", hasBackup: backupMeta().hasBackup });
  }

  /* ── REGISTRO DE SEGURIDAD: solo administrador con sesión ── */
  if (p === "/api/seguridad") {
    const s = sesionDe(req);
    if (!s) return sendJSON(res, 401, { error: "sesión no válida o expirada" });
    if (s.user.role !== "admin") { registrar(req, "acceso_denegado", { uid: s.user.id, ruta: p }); return sendJSON(res, 403, { error: "solo el administrador puede ver el registro" }); }
    if (req.method !== "GET") return sendJSON(res, 405, { error: "método no permitido" });
    const n = Math.max(1, Math.min(1000, +u.searchParams.get("n") || 300));
    return sendJSON(res, 200, { eventos: registroLeer(n) });
  }

  /* ── DATOS DE LA CUENTA ── lo que hace que Investor se pueda usar desde cualquier equipo. La llave es la
     SESIÓN (tu usuario y contraseña), no el SYNC_TOKEN: pedir el token aquí obligaría a llevarlo encima de
     viaje, que es justo lo que había que quitar de en medio. Cada cuenta solo alcanza lo suyo. ── */
  if (p === "/api/data" || p === "/api/data/meta" || p === "/api/data/versions") {
    const s = sesionDe(req);
    if (!s) return sendJSON(res, 401, { error: "sesión no válida o expirada" });
    const uid = String(s.user.id || "");
    if (!UID_RE.test(uid)) return sendJSON(res, 400, { error: "cuenta inválida" });

    if (p === "/api/data/meta" && req.method === "GET") return sendJSON(res, 200, udMeta(uid));
    if (p === "/api/data/versions" && req.method === "GET") return sendJSON(res, 200, { versions: udVersiones(uid) });

    if (p === "/api/data" && req.method === "GET") {
      const v = (u.searchParams.get("v") || "").trim();
      if (v) {
        // una versión anterior de ESTA cuenta: el nombre se valida y se ancla al uid, nada de rutas ajenas
        if (!/^[\w-]{1,64}\.v\d{6}\.json$/.test(v) || v.indexOf(uid + ".v") !== 0)
          return sendJSON(res, 400, { error: "versión inválida" });
        const j = leerJSON(path.join(UD_DIR, v), null);
        if (!j) return sendJSON(res, 404, { error: "esa versión no existe" });
        return sendJSON(res, 200, { rev: j.rev || 0, savedAt: j.savedAt || null, payload: j.payload || null });
      }
      return sendJSON(res, 200, udLeer(uid));
    }

    if (p === "/api/data" && req.method === "PUT") {
      let size = 0; const chunks = [];
      req.on("data", c => { size += c.length; if (size > MAX_BODY) { sendJSON(res, 413, { error: "los datos son demasiado grandes" }); req.destroy(); } else chunks.push(c); });
      req.on("end", () => {
        if (res.writableEnded) return;
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return sendJSON(res, 400, { error: "JSON inválido" }); }
        const pl = j && j.payload;
        if (!pl || pl._app !== "portfolio-dashboard" || !pl.clients) return sendJSON(res, 400, { error: "no parecen datos de Investor" });
        const act = udLeer(uid), rev = act.rev || 0;
        const base = +j.rev;
        // CONFLICTO: este equipo partió de una revisión que ya no es la última. Se rechaza en vez de pisar —
        // que es exactamente lo que pasaba antes, en silencio y sin que nadie se enterara.
        if (!(base >= 0) || base !== rev)
          return sendJSON(res, 409, { error: "los datos del servidor cambiaron desde otro equipo", rev, savedAt: act.savedAt, resumen: backupResumen0(act.payload) });
        let reg = null;
        try { reg = udEscribir(uid, pl, rev + 1); }
        catch (e) { registrar(req, "error_500", { ruta: p, detalle: String(e.message).slice(0, 200) }); return sendJSON(res, 500, { error: "no se pudieron guardar los datos en el servidor" }); }
        return sendJSON(res, 200, { ok: true, rev: reg.rev, savedAt: reg.savedAt });
      });
      return;
    }
    return sendJSON(res, 405, { error: "método no permitido" });
  }

  /* ── CUENTAS ── entran antes que la caja fuerte: para iniciar sesión no se puede exigir el SYNC_TOKEN
     (nadie lo tiene en un equipo nuevo). Lo que protege esta zona es la contraseña del usuario y, si está
     activada, la puerta del sitio. ── */
  if (p.startsWith("/api/auth/") || p === "/api/users" || p.startsWith("/api/users/")) {
    const leerCuerpo = cb => {
      let n = 0; const ch = [];
      req.on("data", c => { n += c.length; if (n > 1e6) { sendJSON(res, 413, { error: "cuerpo demasiado grande" }); req.destroy(); } else ch.push(c); });
      req.on("end", () => { if (res.writableEnded) return;
        let j = null; try { j = JSON.parse(Buffer.concat(ch).toString("utf8") || "{}"); } catch (e) { return sendJSON(res, 400, { error: "JSON inválido" }); }
        if (!j || typeof j !== "object" || Array.isArray(j)) return sendJSON(res, 400, { error: "se esperaba un objeto JSON" });
        Promise.resolve().then(() => cb(j)).catch(e => {
          registrar(req, "error_500", { ruta: p, detalle: String((e && e.message) || e).slice(0, 200) });
          if (!res.headersSent) sendJSON(res, 500, { error: "error interno del servidor" });
        }); });
    };
    const users = usersLeer();

    /* ¿hay cuentas? Lo consulta la pantalla de entrada para saber si toca CREAR el administrador o ENTRAR */
    if (p === "/api/auth/estado" && req.method === "GET")
      return sendJSON(res, 200, { hayCuentas: users.length > 0, servidor: true, minPass: PW_MIN });

    /* PRIMER ADMINISTRADOR: solo cuando todavía no hay ninguna cuenta Y con el TOKEN del servidor.
       Sin el token, en una URL pública el primero que llegara se quedaría con la cuenta de administrador —
       "aún no hay cuentas" no es una credencial. El token lo tiene quien administra el servicio (panel de
       Render → SYNC_TOKEN), y ya está pegado en Investor para los respaldos. */
    if (p === "/api/auth/bootstrap" && req.method === "POST") {
      if (users.length) return sendJSON(res, 409, { error: "ya existe al menos una cuenta" });
      if (!TOKEN) return sendJSON(res, 503, { error: "SYNC_TOKEN no está configurado en el servidor (panel de Render → Environment)" });
      if (!authOK(req)) { registrar(req, "bootstrap_rechazado", {}); return sendJSON(res, 401, { error: "para crear la primera cuenta hace falta el token del servidor (⚙ Configuración → Respaldo → Nube)" }); }
      return leerCuerpo(async j => {
        const mal = camposOK(j, true); if (mal) return sendJSON(res, 400, { error: mal });
        const user = String(j.user || "").trim(), name = String(j.name || "").trim() || user;
        if (user.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        const pol = pwPolitica(j.pass, user, name);
        if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
        const { salt, hash, it } = await pwNueva(j.pass);
        if (usersLeer().length) return sendJSON(res, 409, { error: "ya existe al menos una cuenta" });   // carrera entre dos altas simultáneas
        const u = { id: "u" + crypto.randomBytes(6).toString("hex"), user, name, role: "admin", ns: "",
          salt, hash, it, creado: new Date().toISOString(), activo: true, intentos: 0, bloqueadoHasta: 0 };
        usersEscribir([u]);
        registrar(req, "cuenta_creada", { uid: u.id, user: u.user, role: "admin", via: "bootstrap" });
        const token = sesionNueva(u);
        return sendJSON(res, 200, { token, user: usuarioPublico(u) });
      });
    }

    /* ENTRAR — el servidor verifica, cuenta intentos y frena. La respuesta es la MISMA exista o no el
       usuario (texto, código y demora): así no sirve para averiguar qué cuentas hay. */
    if (p === "/api/auth/login" && req.method === "POST") {
      return leerCuerpo(async j => {
        const ip = ipDe(req), ahora = Date.now();
        const nombre = String(j.user == null ? "" : j.user), clave = String(j.pass == null ? "" : j.pass);
        const k = slug(nombre).slice(0, MAX_USER);
        const us = usersLeer();
        const i = us.findIndex(x => slug(x.user) === k);
        const u = i >= 0 ? us[i] : null;
        const quien = u ? { uid: u.id, user: u.user } : { user: "(no existe)" };
        const frenar = (motivo, hasta) => {
          registrar(req, "login_frenado", Object.assign({ motivo }, quien));
          return sendJSON(res, 429, { error: "demasiados intentos fallidos", minutos: Math.max(1, Math.ceil((hasta - ahora) / 60000)) });
        };
        // 1) frenos vigentes: IP, cuenta+IP y cuenta (real o fantasma, con el mismo trato)
        let h = frenado(fallosIp, ip, ahora); if (h) return frenar("ip", h);
        h = frenado(fallosCuentaIp, k + "|" + ip, ahora); if (h) return frenar("cuenta_ip", h);
        h = u ? (+u.bloqueadoHasta > ahora ? +u.bloqueadoHasta : 0) : frenado(fallosFantasma, k, ahora); if (h) return frenar("cuenta", h);
        // 2) verificación (largos fuera de rango = fallo, sin calcular nada raro)
        const largoOK = nombre.length <= MAX_USER && clave.length <= MAX_PASS;
        const ok = (u && u.activo !== false && largoOK) ? await pwVerificar(clave, u) : await pwFantasma(largoOK ? clave : "");
        const us2 = usersLeer(), u2 = u ? us2.find(x => x.id === u.id) : null;   // re-leer: la verificación es asíncrona
        if (!ok || (u && !u2)) {
          contar(fallosIp, ip, LIM_IP, ahora);
          const ci = contar(fallosCuentaIp, k + "|" + ip, LIM_CUENTA_IP, ahora);
          let hc = 0;
          if (u2) {
            u2.intentos = (u2.intentos || 0) + 1;
            if (u2.intentos >= LIM_CUENTA) { u2.bloqueadoHasta = ahora + BLOQUEO_MS; u2.intentos = 0; hc = u2.bloqueadoHasta; }
            usersEscribir(us2);
          } else hc = (contar(fallosFantasma, k, LIM_CUENTA, ahora).hasta > ahora) ? ahora + BLOQUEO_MS : 0;
          registrar(req, "login_fallido", Object.assign({ suspendida: !!(u && u.activo === false) || undefined }, quien));
          const hasta = Math.max(ci.hasta > ahora ? ci.hasta : 0, hc, frenado(fallosIp, ip, ahora));
          if (hasta) { registrar(req, "bloqueo", Object.assign({ minutos: Math.ceil(BLOQUEO_MS / 60000) }, quien)); return sendJSON(res, 429, { error: "demasiados intentos fallidos", minutos: Math.ceil(BLOQUEO_MS / 60000) }); }
          return sendJSON(res, 401, { error: "usuario o contraseña incorrectos" });
        }
        fallosCuentaIp.delete(k + "|" + ip);
        u2.intentos = 0; u2.bloqueadoHasta = 0; u2.ultimo = new Date().toISOString();
        // migración silenciosa del hash a las iteraciones vigentes, ahora que se tiene la contraseña correcta
        if ((+u2.it || PBKDF2_IT_LEGADO) < PBKDF2_IT) { const n = await pwNueva(clave); u2.salt = n.salt; u2.hash = n.hash; u2.it = n.it; }
        usersEscribir(us2);
        registrar(req, "login_ok", { uid: u2.id, user: u2.user });
        const token = sesionNueva(u2);
        return sendJSON(res, 200, { token, user: usuarioPublico(u2) });
      });
    }

    /* quién soy (con el token de sesión) */
    if (p === "/api/auth/me" && req.method === "GET") {
      const s = sesionDe(req);
      if (!s) return sendJSON(res, 401, { error: "sesión no válida o expirada" });
      return sendJSON(res, 200, { user: usuarioPublico(s.user) });
    }
    if (p === "/api/auth/logout" && req.method === "POST") {
      const s = sesionDe(req);
      if (s) { sesionCerrar(s.token); registrar(req, "logout", { uid: s.user.id, user: s.user.user }); }
      return sendJSON(res, 200, { ok: true });
    }
    /* cambiar MI contraseña / mis datos (exige la contraseña actual) */
    if (p === "/api/auth/me" && (req.method === "PATCH" || req.method === "POST")) {
      const s = sesionDe(req);
      if (!s) return sendJSON(res, 401, { error: "sesión no válida o expirada" });
      return leerCuerpo(async j => {
        const mal = camposOK(j, true); if (mal) return sendJSON(res, 400, { error: mal });
        const u0 = usersLeer().find(x => x.id === s.user.id);
        if (!u0) return sendJSON(res, 404, { error: "cuenta no encontrada" });
        const nuevoUser = j.user != null ? String(j.user).trim() : u0.user;
        if (nuevoUser.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        let nueva = null;
        if (j.pass) {
          if (String(j.passActual || "").length > MAX_PASS || !(await pwVerificar(j.passActual, u0))) {
            registrar(req, "cambio_clave_rechazado", { uid: u0.id, user: u0.user });
            return sendJSON(res, 403, { error: "la contraseña actual no es correcta" });
          }
          const pol = pwPolitica(j.pass, nuevoUser, j.name != null ? j.name : u0.name);
          if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
          nueva = await pwNueva(j.pass);
        }
        const us = usersLeer(), u = us.find(x => x.id === s.user.id);   // re-leer tras lo asíncrono
        if (!u) return sendJSON(res, 404, { error: "cuenta no encontrada" });
        if (us.some(x => x.id !== u.id && slug(x.user) === slug(nuevoUser))) return sendJSON(res, 409, { error: "ese usuario ya existe" });
        const cambios = [];
        if (nueva) { u.salt = nueva.salt; u.hash = nueva.hash; u.it = nueva.it; cambios.push("contraseña"); }
        if (u.user !== nuevoUser) cambios.push("usuario");
        u.user = nuevoUser;
        if (j.name != null) { const nn = String(j.name).trim() || nuevoUser; if (nn !== u.name) cambios.push("nombre"); u.name = nn; }
        usersEscribir(us);
        const cerradas = nueva ? sesionesCerrarDe(u.id, s.token) : 0;
        if (cambios.length) registrar(req, nueva ? "clave_cambiada" : "cuenta_modificada", { uid: u.id, user: u.user, por: u.id, cambios, sesionesCerradas: cerradas || undefined });
        return sendJSON(res, 200, { user: usuarioPublico(u), sesionesCerradas: cerradas });
      });
    }

    /* ── gestión de cuentas: SOLO administrador ── */
    const ses = sesionDe(req);
    const esAdmin = !!(ses && ses.user.role === "admin");
    if (p === "/api/users" || p.startsWith("/api/users/")) {
      if (!ses) return sendJSON(res, 401, { error: "sesión no válida o expirada" });
      if (!esAdmin) { registrar(req, "acceso_denegado", { uid: ses.user.id, ruta: p }); return sendJSON(res, 403, { error: "solo el administrador puede gestionar los accesos" }); }
    }
    if (p === "/api/users" && req.method === "GET")
      return sendJSON(res, 200, { users: usersLeer().map(usuarioPublico) });

    if (p === "/api/users" && req.method === "POST") {
      return leerCuerpo(async j => {
        const mal = camposOK(j, true); if (mal) return sendJSON(res, 400, { error: mal });
        const user = String(j.user || "").trim(), name = String(j.name || "").trim() || user;
        if (user.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        if (usersLeer().some(x => slug(x.user) === slug(user))) return sendJSON(res, 409, { error: "ese usuario ya existe" });
        const pol = pwPolitica(j.pass, user, name);
        if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
        const role = j.role === "admin" ? "admin" : "inv";
        const id = "u" + crypto.randomBytes(6).toString("hex");
        const { salt, hash, it } = await pwNueva(j.pass);
        const us = usersLeer();
        if (us.some(x => slug(x.user) === slug(user))) return sendJSON(res, 409, { error: "ese usuario ya existe" });
        const u = { id, user, name, role, ns: role === "admin" ? "" : id, salt, hash, it,
          creado: new Date().toISOString(), activo: true, intentos: 0, bloqueadoHasta: 0 };
        us.push(u); usersEscribir(us);
        registrar(req, "cuenta_creada", { uid: u.id, user: u.user, role, por: ses.user.id });
        return sendJSON(res, 200, { user: usuarioPublico(u) });
      });
    }
    const mUser = /^\/api\/users\/([\w-]+)$/.exec(p);
    if (mUser && (req.method === "PATCH" || req.method === "POST")) {
      return leerCuerpo(async j => {
        const mal = camposOK(j, true); if (mal) return sendJSON(res, 400, { error: mal });
        let nueva = null;
        if (j.pass) {
          const u0 = usersLeer().find(x => x.id === mUser[1]);
          if (!u0) return sendJSON(res, 404, { error: "cuenta no encontrada" });
          const pol = pwPolitica(j.pass, j.user != null ? String(j.user).trim() : u0.user, j.name != null ? j.name : u0.name);
          if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
          nueva = await pwNueva(j.pass);
        }
        const us = usersLeer(), u = us.find(x => x.id === mUser[1]);
        if (!u) return sendJSON(res, 404, { error: "cuenta no encontrada" });
        const antes = { user: u.user, name: u.name, role: u.role, activo: u.activo !== false };
        const admins = us.filter(x => x.role === "admin" && x.activo !== false);
        const nuevoUser = j.user != null ? String(j.user).trim() : u.user;
        if (nuevoUser.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        if (us.some(x => x.id !== u.id && slug(x.user) === slug(nuevoUser))) return sendJSON(res, 409, { error: "ese usuario ya existe" });
        if ((j.role && j.role !== u.role && u.role === "admin") || (j.activo === false && u.role === "admin")) {
          if (admins.length <= 1) return sendJSON(res, 409, { error: "es la única cuenta de administrador" });
        }
        if (nueva) { u.salt = nueva.salt; u.hash = nueva.hash; u.it = nueva.it; u.intentos = 0; u.bloqueadoHasta = 0; }
        u.user = nuevoUser;
        if (j.name != null) u.name = String(j.name).trim() || nuevoUser;
        if (j.role) { u.role = j.role === "admin" ? "admin" : "inv"; u.ns = u.role === "admin" ? "" : u.id; }
        if (j.activo != null) u.activo = !!j.activo;
        if (j.desbloquear) { u.intentos = 0; u.bloqueadoHasta = 0; }
        usersEscribir(us);
        // contraseña reseteada o cuenta suspendida: fuera todas sus sesiones (salvo la de quien hace el cambio)
        const cerradas = (nueva || u.activo === false) ? sesionesCerrarDe(u.id, ses.token) : 0;
        const cambios = [];
        if (nueva) cambios.push("contraseña");
        if (antes.user !== u.user) cambios.push("usuario");
        if (antes.name !== u.name) cambios.push("nombre");
        if (antes.role !== u.role) cambios.push("papel:" + u.role);
        if (antes.activo !== (u.activo !== false)) cambios.push(u.activo === false ? "suspendida" : "reactivada");
        if (j.desbloquear) cambios.push("desbloqueada");
        if (cambios.length) registrar(req, "cuenta_modificada", { uid: u.id, user: u.user, por: ses.user.id, cambios, sesionesCerradas: cerradas || undefined });
        return sendJSON(res, 200, { user: usuarioPublico(u) });
      });
    }
    if (mUser && req.method === "DELETE") {
      const us = usersLeer(), u = us.find(x => x.id === mUser[1]);
      if (!u) return sendJSON(res, 404, { error: "cuenta no encontrada" });
      if (u.role === "admin" && us.filter(x => x.role === "admin" && x.activo !== false).length <= 1)
        return sendJSON(res, 409, { error: "es la única cuenta de administrador" });
      usersEscribir(us.filter(x => x.id !== u.id));
      const S = sesLeer();
      Object.keys(S.tokens).forEach(t => { if (S.tokens[t].uid === u.id) delete S.tokens[t]; });
      sesEscribir(S);
      registrar(req, "cuenta_eliminada", { uid: u.id, user: u.user, por: ses.user.id });
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 404, { error: "endpoint no existe" });
  }

  /* ── API ── */
  if (p.startsWith("/api/")) {
    if (!TOKEN) return sendJSON(res, 503, { error: "SYNC_TOKEN no está configurado en el servidor (panel de Render → Environment)" });
    if (!authOK(req)) { registrar(req, "token_rechazado", { ruta: p, conToken: !!req.headers["x-investor-token"] }); return sendJSON(res, 401, { error: "token requerido o incorrecto (header x-investor-token)" }); }
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
        } catch (e) { registrar(req, "error_500", { ruta: p, detalle: String(e.message).slice(0, 200) }); return sendJSON(res, 500, { error: "no se pudo guardar el respaldo en el servidor" }); }
        return sendJSON(res, 200, Object.assign({ ok: true }, backupMeta()));
      });
      return;
    }
    return sendJSON(res, 404, { error: "endpoint no existe" });
  }

  /* ── estáticos (solo GET, whitelist) ── */
  if (req.method !== "GET" && req.method !== "HEAD") return sendJSON(res, 405, { error: "método no permitido" });
  if (p === "/" || p === "/index.html") return sendApp(req, res);
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
}

server.listen(PORT, () => {
  console.log("Investor sirviendo en :" + PORT);
  console.log("  disco de respaldos : " + DATA_DIR + (process.env.DATA_DIR ? " (persistente)" : " (local, solo pruebas)"));
  console.log("  SYNC_TOKEN         : " + (TOKEN ? "configurado" : "⚠ FALTA (la API de respaldos responderá 503)"));
  console.log("  acceso             : sesión interna de Investor (sin diálogo Basic Auth del navegador)");
  if (GATE_RESTOS.length) console.log("  ℹ " + GATE_RESTOS.join(" y ") + " siguen en el panel de Render: se IGNORAN (puedes borrarlas)");
});
