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
/* ═══════════════════ CUENTAS EN EL SERVIDOR ═══════════════════
   Para poder entrar a Investor desde CUALQUIER equipo, las cuentas no pueden vivir en el navegador: viven
   aquí, en el disco persistente. El servidor es quien verifica la contraseña — el navegador nunca recibe el
   hash — y quien cuenta los intentos fallidos, que es donde el bloqueo significa algo (si lo contara el
   navegador bastaría con abrir una ventana nueva).
   · Contraseñas con PBKDF2-SHA256, 210.000 iteraciones y sal por usuario. Comparación en tiempo constante.
   · 5 intentos fallidos → 15 minutos de bloqueo de esa cuenta.
   · Sesión = token aleatorio de 32 bytes con caducidad; se guarda en el disco para sobrevivir reinicios. */
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESS_FILE = path.join(DATA_DIR, "sessions.json");
const PBKDF2_IT = 210000, PBKDF2_LEN = 32;
const MAX_INTENTOS = 5, BLOQUEO_MS = 15 * 60 * 1000;
const SESION_MS = 12 * 60 * 60 * 1000;          // 12 h de validez
/* NO se lleva registro de entradas: el archivo de sesiones guarda SOLO los tokens vivos, que son lo que
   hace falta para mantener la sesión abierta entre recargas y reinicios. Un historial de quién entró y
   cuándo no lo pidió nadie y es dato personal que no aporta a decidir una inversión. */

function leerJSON(f, porDefecto) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return porDefecto; } }
function escribirJSON(f, v) { try { const t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); return true; } catch (e) { return false; } }
function usersLeer() { const v = leerJSON(USERS_FILE, null); return Array.isArray(v) ? v : []; }
function usersEscribir(v) { return escribirJSON(USERS_FILE, v); }
function sesLeer() { const v = leerJSON(SESS_FILE, null); return { tokens: (v && typeof v === "object" && v.tokens) ? v.tokens : {} }; }   // un `log` de una versión anterior se descarta al primer guardado
function sesEscribir(v) { return escribirJSON(SESS_FILE, v); }

function pwHash(pass, salt) { return crypto.pbkdf2Sync(String(pass), salt, PBKDF2_IT, PBKDF2_LEN, "sha256").toString("hex"); }
function pwNueva(pass) { const salt = crypto.randomBytes(16).toString("hex"); return { salt, hash: pwHash(pass, salt), it: PBKDF2_IT }; }
function pwVerificar(pass, u) {
  try {
    const h = Buffer.from(pwHash(pass, u.salt), "hex"), g = Buffer.from(u.hash, "hex");
    return h.length === g.length && crypto.timingSafeEqual(h, g);
  } catch (e) { return false; }
}
/* MISMA política que el navegador: el cliente la aplica para no hacer viajes de más, pero esta es la que manda */
const PW_MIN = 10;
const PW_OBVIAS = ["contrasena", "contraseña", "password", "investor", "12345678", "qwerty", "admin", "bolsa", "chile", "inversion", "inversión", "1234567890", "abcdefghij"];
function pwPolitica(pw, usuario, nombre) {
  const p = String(pw || ""), fallos = [];
  if (p.length < PW_MIN) fallos.push(`al menos ${PW_MIN} caracteres`);
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

  /* ── CUENTAS ── entran antes que la caja fuerte: para iniciar sesión no se puede exigir el SYNC_TOKEN
     (nadie lo tiene en un equipo nuevo). Lo que protege esta zona es la contraseña del usuario y, si está
     activada, la puerta del sitio. ── */
  if (p.startsWith("/api/auth/") || p === "/api/users" || p.startsWith("/api/users/")) {
    const leerCuerpo = cb => {
      let n = 0; const ch = [];
      req.on("data", c => { n += c.length; if (n > 1e6) { sendJSON(res, 413, { error: "cuerpo demasiado grande" }); req.destroy(); } else ch.push(c); });
      req.on("end", () => { if (res.writableEnded) return;
        let j = null; try { j = JSON.parse(Buffer.concat(ch).toString("utf8") || "{}"); } catch (e) { return sendJSON(res, 400, { error: "JSON inválido" }); }
        cb(j || {}); });
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
      if (!authOK(req)) return sendJSON(res, 401, { error: "para crear la primera cuenta hace falta el token del servidor (⚙ Configuración → Respaldo → Nube)" });
      return leerCuerpo(j => {
        const user = String(j.user || "").trim(), name = String(j.name || "").trim() || user;
        if (user.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        const pol = pwPolitica(j.pass, user, name);
        if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
        const { salt, hash, it } = pwNueva(j.pass);
        const u = { id: "u" + crypto.randomBytes(6).toString("hex"), user, name, role: "admin", ns: "",
          salt, hash, it, creado: new Date().toISOString(), activo: true, intentos: 0, bloqueadoHasta: 0 };
        usersEscribir([u]);
        const token = sesionNueva(u);
        return sendJSON(res, 200, { token, user: usuarioPublico(u) });
      });
    }

    /* ENTRAR — el servidor verifica, cuenta intentos y bloquea */
    if (p === "/api/auth/login" && req.method === "POST") {
      return leerCuerpo(j => {
        const us = usersLeer();
        const i = us.findIndex(x => slug(x.user) === slug(j.user));
        const ahora = Date.now();
        if (i >= 0 && us[i].bloqueadoHasta && ahora < us[i].bloqueadoHasta) {
          return sendJSON(res, 429, { error: "cuenta bloqueada", minutos: Math.max(1, Math.ceil((us[i].bloqueadoHasta - ahora) / 60000)) });
        }
        const u = i >= 0 ? us[i] : null;
        const ok = u && u.activo !== false && pwVerificar(j.pass, u);
        if (!ok) {
          if (u) {
            u.intentos = (u.intentos || 0) + 1;
            if (u.intentos >= MAX_INTENTOS) { u.bloqueadoHasta = ahora + BLOQUEO_MS; u.intentos = 0; }
            usersEscribir(us);
            if (u.bloqueadoHasta && ahora < u.bloqueadoHasta)
              return sendJSON(res, 429, { error: "cuenta bloqueada", minutos: Math.ceil(BLOQUEO_MS / 60000) });
            return sendJSON(res, 401, { error: "usuario o contraseña incorrectos", restantes: Math.max(0, MAX_INTENTOS - u.intentos) });
          }
          return sendJSON(res, 401, { error: "usuario o contraseña incorrectos" });
        }
        u.intentos = 0; u.bloqueadoHasta = 0; u.ultimo = new Date().toISOString();
        usersEscribir(us);
        const token = sesionNueva(u);
        return sendJSON(res, 200, { token, user: usuarioPublico(u) });
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
      if (s) sesionCerrar(s.token);
      return sendJSON(res, 200, { ok: true });
    }
    /* cambiar MI contraseña / mis datos (exige la contraseña actual) */
    if (p === "/api/auth/me" && (req.method === "PATCH" || req.method === "POST")) {
      const s = sesionDe(req);
      if (!s) return sendJSON(res, 401, { error: "sesión no válida o expirada" });
      return leerCuerpo(j => {
        const us = usersLeer(), u = us.find(x => x.id === s.user.id);
        if (!u) return sendJSON(res, 404, { error: "cuenta no encontrada" });
        const nuevoUser = j.user != null ? String(j.user).trim() : u.user;
        if (nuevoUser.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        if (us.some(x => x.id !== u.id && slug(x.user) === slug(nuevoUser))) return sendJSON(res, 409, { error: "ese usuario ya existe" });
        if (j.pass) {
          if (!pwVerificar(j.passActual, u)) return sendJSON(res, 403, { error: "la contraseña actual no es correcta" });
          const pol = pwPolitica(j.pass, nuevoUser, j.name != null ? j.name : u.name);
          if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
          const n = pwNueva(j.pass); u.salt = n.salt; u.hash = n.hash; u.it = n.it;
        }
        u.user = nuevoUser;
        if (j.name != null) u.name = String(j.name).trim() || nuevoUser;
        usersEscribir(us);
        return sendJSON(res, 200, { user: usuarioPublico(u) });
      });
    }

    /* ── gestión de cuentas: SOLO administrador ── */
    const ses = sesionDe(req);
    const esAdmin = !!(ses && ses.user.role === "admin");
    if (p === "/api/users" || p.startsWith("/api/users/")) {
      if (!ses) return sendJSON(res, 401, { error: "sesión no válida o expirada" });
      if (!esAdmin) return sendJSON(res, 403, { error: "solo el administrador puede gestionar los accesos" });
    }
    if (p === "/api/users" && req.method === "GET")
      return sendJSON(res, 200, { users: usersLeer().map(usuarioPublico) });

    if (p === "/api/users" && req.method === "POST") {
      return leerCuerpo(j => {
        const us = usersLeer();
        const user = String(j.user || "").trim(), name = String(j.name || "").trim() || user;
        if (user.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        if (us.some(x => slug(x.user) === slug(user))) return sendJSON(res, 409, { error: "ese usuario ya existe" });
        const pol = pwPolitica(j.pass, user, name);
        if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
        const role = j.role === "admin" ? "admin" : "inv";
        const id = "u" + crypto.randomBytes(6).toString("hex");
        const { salt, hash, it } = pwNueva(j.pass);
        const u = { id, user, name, role, ns: role === "admin" ? "" : id, salt, hash, it,
          creado: new Date().toISOString(), activo: true, intentos: 0, bloqueadoHasta: 0 };
        us.push(u); usersEscribir(us);
        return sendJSON(res, 200, { user: usuarioPublico(u) });
      });
    }
    const mUser = /^\/api\/users\/([\w-]+)$/.exec(p);
    if (mUser && (req.method === "PATCH" || req.method === "POST")) {
      return leerCuerpo(j => {
        const us = usersLeer(), u = us.find(x => x.id === mUser[1]);
        if (!u) return sendJSON(res, 404, { error: "cuenta no encontrada" });
        const admins = us.filter(x => x.role === "admin" && x.activo !== false);
        const nuevoUser = j.user != null ? String(j.user).trim() : u.user;
        if (nuevoUser.length < 2) return sendJSON(res, 400, { error: "el usuario debe tener al menos 2 caracteres" });
        if (us.some(x => x.id !== u.id && slug(x.user) === slug(nuevoUser))) return sendJSON(res, 409, { error: "ese usuario ya existe" });
        if ((j.role && j.role !== u.role && u.role === "admin") || (j.activo === false && u.role === "admin")) {
          if (admins.length <= 1) return sendJSON(res, 409, { error: "es la única cuenta de administrador" });
        }
        if (j.pass) {
          const pol = pwPolitica(j.pass, nuevoUser, j.name != null ? j.name : u.name);
          if (!pol.ok) return sendJSON(res, 400, { error: "contraseña insuficiente", fallos: pol.fallos });
          const n = pwNueva(j.pass); u.salt = n.salt; u.hash = n.hash; u.it = n.it;
          u.intentos = 0; u.bloqueadoHasta = 0;
        }
        u.user = nuevoUser;
        if (j.name != null) u.name = String(j.name).trim() || nuevoUser;
        if (j.role) { u.role = j.role === "admin" ? "admin" : "inv"; u.ns = u.role === "admin" ? "" : u.id; }
        if (j.activo != null) u.activo = !!j.activo;
        if (j.desbloquear) { u.intentos = 0; u.bloqueadoHasta = 0; }
        usersEscribir(us);
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
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 404, { error: "endpoint no existe" });
  }

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
