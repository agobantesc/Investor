/* test_seguridad.js — SEGURIDAD DEL SERVIDOR, MEDIDA CONTRA EL server.js REAL.
   Levanta el servidor en un puerto local con un disco temporal y lo ataca como lo haría alguien de afuera:
     · cabeceras de seguridad en la app, en JSON y en archivos; HSTS solo detrás de HTTPS;
     · la app corre bajo su CSP sin una sola violación (incluido el informe en ventana nueva) y un script
       inyectado NO se ejecuta;
     · el ingreso no delata qué usuarios existen (misma respuesta y demora);
     · frenos por cuenta+IP, por IP y por cuenta — y un atacante desde UNA IP no puede bloquear al dueño;
     · largos máximos; cambiar la contraseña cierra las demás sesiones; los hashes viejos migran solos;
     · el registro de seguridad anota lo importante, solo lo ve el administrador y no guarda secretos;
     · los errores 500 no filtran detalles internos. */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { chromium } = require(process.env.PW_CORE || "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core");
const { crearMarcador } = require("./_harness");
const RAIZ = path.resolve(__dirname, "../..");
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const PUERTO = 10900 + Math.floor(Math.random() * 80), B = "http://127.0.0.1:" + PUERTO;
const TOKEN = "tok-" + crypto.randomBytes(8).toString("hex");
const ADMIN = "ricardo", CLAVE_ADMIN = "Clave-Del-Dueño-2026!", CLAVE_NUEVA = "Otra-Clave-Segura-77#";
const DISCO = fs.mkdtempSync(path.join(os.tmpdir(), "inv-seg-"));

// un administrador sembrado con el hash VIEJO (210.000 iteraciones): debe migrar al entrar
const sal = crypto.randomBytes(16).toString("hex");
fs.writeFileSync(path.join(DISCO, "users.json"), JSON.stringify([{
  id: "uadmin000001", user: ADMIN, name: "Ricardo", role: "admin", ns: "", salt: sal,
  hash: crypto.pbkdf2Sync(CLAVE_ADMIN, sal, 210000, 32, "sha256").toString("hex"), it: 210000,
  creado: new Date().toISOString(), activo: true, intentos: 0, bloqueadoHasta: 0 }]));

const pide = async (metodo, ruta, { cuerpo, ip, ses, tok, h } = {}) => {
  const t0 = Date.now();
  const r = await fetch(B + ruta, { method: metodo, headers: Object.assign({ "cf-connecting-ip": ip || "10.0.0.1" },
    cuerpo ? { "Content-Type": "application/json" } : {}, ses ? { "x-investor-session": ses } : {}, tok ? { "x-investor-token": tok } : {}, h || {}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text(); let j = null; try { j = JSON.parse(texto); } catch (e) {}
  return { st: r.status, j, texto, ms: Date.now() - t0, h: r.headers };
};
const entrar = (user, pass, ip) => pide("POST", "/api/auth/login", { cuerpo: { user, pass }, ip });

(async () => {
  const M = crearMarcador();
  const srv = spawn(process.execPath, ["server.js"], { cwd: RAIZ, env: Object.assign({}, process.env, { PORT: String(PUERTO), DATA_DIR: DISCO, SYNC_TOKEN: TOKEN }), stdio: ["ignore", "pipe", "pipe"] });
  let logSrv = ""; srv.stdout.on("data", d => logSrv += d); srv.stderr.on("data", d => logSrv += d);
  for (let i = 0; i < 50; i++) { try { await fetch(B + "/api/health"); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  try {
    // ── 1. cabeceras en la app, en JSON y en archivos de datos ──
    const app = await pide("GET", "/"), js = await pide("GET", "/api/health"), dat = await pide("GET", "/data/closes.json");
    const csp = app.h.get("content-security-policy") || "";
    const nonce = (/'nonce-([^']+)'/.exec(csp) || [])[1];
    const scripts = (app.texto.match(/<script nonce="([^"]+)">/g) || []).map(x => /"([^"]+)"/.exec(x)[1]);
    const comunes = r => r.h.get("x-content-type-options") === "nosniff" && r.h.get("x-frame-options") === "DENY" && !!r.h.get("referrer-policy") && !!r.h.get("permissions-policy");
    const t1 = { nonce: !!nonce, scriptsConNonce: scripts.length, todosConEseNonce: scripts.every(x => x === nonce),
      sinScriptSinNonce: !/<script>/.test(app.texto), cspDura: /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && !/'unsafe-inline'[^;]*;?\s*$/.test(csp.split(";").find(x => /script-src/.test(x)) || "") && !/unsafe-eval/.test(csp),
      appOK: comunes(app), jsonOK: comunes(js) && /default-src 'none'/.test(js.h.get("content-security-policy") || ""), datosOK: comunes(dat),
      sinHstsEnHttp: !app.h.get("strict-transport-security") };
    const otroNonce = (/'nonce-([^']+)'/.exec((await pide("GET", "/")).h.get("content-security-policy") || "") || [])[1];
    t1.nonceCambia = otroNonce && otroNonce !== nonce;
    M.ok("1-CABECERAS-DE-SEGURIDAD", Object.values(t1).every(Boolean) && t1.scriptsConNonce === 2, t1);

    const https = await pide("GET", "/", { h: { "x-forwarded-proto": "https" } });
    M.ok("2-HSTS-DETRAS-DE-HTTPS", /max-age=31536000/.test(https.h.get("strict-transport-security") || "") && /upgrade-insecure-requests/.test(https.h.get("content-security-policy") || ""),
      { hsts: https.h.get("strict-transport-security") });

    // ── 3. la app corre bajo la CSP sin violaciones, el informe también, y un script inyectado NO corre ──
    const nav = await chromium.launch({ executablePath: CHROME });
    const ctx = await nav.newContext();
    const violaciones = [], errores = [];
    const vigila = pg => { pg.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) violaciones.push(m.text().slice(0, 160)); }); pg.on("pageerror", e => errores.push(e.message)); };
    const pg = await ctx.newPage(); vigila(pg);
    ctx.on("page", p2 => vigila(p2));
    await pg.goto(B + "/"); await pg.waitForTimeout(900);
    const t3 = await pg.evaluate(async () => {
      try { AUTH = { enabled: false }; lsSet("inv_auth_v1", AUTH); authShow(false); } catch (e) {}
      // datos REALES servidos por el propio servidor (mismo origen: la CSP los permite)
      window.alert = () => {};
      AUTOPX_URL = location.origin + "/data/closes.json"; await autopxSync(false);
      try { FDATA = fundSanitize(await (await fetch("/data/fundamentals.json")).json()); } catch (e) {}
      try { systemAnalysisRefresh(); } catch (e) {}
      for (const [m, g] of [["inicio", "home"], ["inv", "seguimiento"], ["datos", "base"], ["mercados", "panel"]]) { modulo = m; page = g; try { render(); } catch (e) { return { err: m + ": " + e.message }; } }
      // intento de XSS: un manejador en línea y un <script> creado a mano, sin nonce
      window.__pwn1 = 0; window.__pwn2 = 0;
      const d = document.createElement("div"); d.innerHTML = '<img src="data:image/png;base64,AAAA" onerror="window.__pwn1=1">'; document.body.appendChild(d);
      const s = document.createElement("script"); s.textContent = "window.__pwn2=1"; document.body.appendChild(s);
      await new Promise(r => setTimeout(r, 300));
      return { nonce: !!CSP_NONCE, pwn1: window.__pwn1, pwn2: window.__pwn2 };
    });
    // el informe: abre una ventana que HEREDA la CSP; su script de paginación debe correr
    const [inf] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null), pg.evaluate(() => { try { genCartaReco(); } catch (e) { return e.message; } })]);
    let informe = null;
    if (inf) { await inf.waitForTimeout(1200); informe = await inf.evaluate(() => ({ paginas: document.querySelectorAll(".rp-page").length, scripts: document.scripts.length })); }
    const xssBloqueado = violaciones.filter(v => /inline event handler|inline script|script-src/i.test(v));
    const otrasViol = violaciones.filter(v => xssBloqueado.indexOf(v) < 0);
    M.ok("3-APP-E-INFORME-BAJO-LA-CSP-Y-XSS-BLOQUEADO",
      !t3.err && t3.nonce && t3.pwn1 === 0 && t3.pwn2 === 0 && xssBloqueado.length >= 2 && otrasViol.length === 0 && errores.length === 0 && (informe == null || informe.paginas >= 1),
      { t3, informe, violacionesInesperadas: otrasViol.slice(0, 3), xssBloqueado: xssBloqueado.length, errores: errores.slice(0, 3) });
    await nav.close();

    // ── 4. /api/health mínimo ──
    M.ok("4-HEALTH-MINIMO", JSON.stringify(Object.keys(js.j).sort()) === JSON.stringify(["app", "hasBackup", "ok"]), js.j);

    // ── 5. el ingreso NO delata si el usuario existe ──
    const a = await entrar(ADMIN, "Mala-Clave-1234!", "10.1.0.1"), b = await entrar("nadie-xyz", "Mala-Clave-1234!", "10.1.0.2");
    const a2 = await entrar(ADMIN, "Mala-Clave-1234!", "10.1.0.3"), b2 = await entrar("nadie-xyz", "Mala-Clave-1234!", "10.1.0.4");
    const msA = Math.min(a.ms, a2.ms), msB = Math.min(b.ms, b2.ms);
    M.ok("5-MISMA-RESPUESTA-EXISTA-O-NO", a.st === 401 && b.st === 401 && a.texto === b.texto && msB > msA * 0.5,
      { existe: [a.st, a.texto], noExiste: [b.st, b.texto], ms: { existe: msA, noExiste: msB } });

    // ── 6. el hash viejo migró al entrar bien ──
    const ok1 = await entrar(ADMIN, CLAVE_ADMIN, "10.2.0.1");
    const reg = JSON.parse(fs.readFileSync(path.join(DISCO, "users.json"), "utf8")).find(x => x.user === ADMIN);
    M.ok("6-HASH-MIGRA-A-600K", ok1.st === 200 && reg.it === 600000 && (await entrar(ADMIN, CLAVE_ADMIN, "10.2.0.2")).st === 200, { st: ok1.st, it: reg.it });
    const sesAdmin = ok1.j.token;

    // ── 7. 5 fallos desde UNA IP contra el dueño: esa IP queda fuera… pero el dueño entra desde la suya ──
    const r7 = []; for (let i = 0; i < 6; i++) r7.push((await entrar(ADMIN, "Mala-Clave-9999!", "66.6.6.6")).st);
    const desdeAtacante = await entrar(ADMIN, CLAVE_ADMIN, "66.6.6.6"), desdeDueno = await entrar(ADMIN, CLAVE_ADMIN, "10.2.0.9");
    M.ok("7-UNA-IP-NO-PUEDE-BLOQUEAR-AL-DUENO", r7.slice(0, 4).every(x => x === 401) && r7[4] === 429 && desdeAtacante.st === 429 && desdeDueno.st === 200,
      { atacante: r7, conClaveBuena: desdeAtacante.st, dueno: desdeDueno.st });

    // ── 8. 20 fallos desde una IP contra cuentas variadas: la IP queda fuera ──
    const r8 = []; for (let i = 0; i < 21; i++) r8.push((await entrar("u" + i, "Mala-Clave-1111!", "77.7.7.7")).st);
    M.ok("8-FRENO-POR-IP", r8.slice(0, 19).every(x => x === 401) && r8[19] === 429 && r8[20] === 429, { r8: r8.join(",") });

    // ── 9. 25 fallos contra una cuenta desde IPs distintas: la cuenta se bloquea (ataque distribuido) ──
    const alta = await pide("POST", "/api/users", { ses: sesAdmin, cuerpo: { user: "victima", name: "Víctima", pass: "Segura-Clave-55!x", role: "inv" } });
    const r9 = []; for (let i = 0; i < 25; i++) r9.push((await entrar("victima", "Mala-Clave-2222!", "20.0." + i + ".1")).st);
    const tras = await entrar("victima", "Segura-Clave-55!x", "30.3.3.3");
    // y una cuenta INEXISTENTE recibe el mismo trato (si no, el bloqueo delataría cuáles existen)
    const r9b = []; for (let i = 0; i < 25; i++) r9b.push((await entrar("fantasma", "Mala-Clave-2222!", "21.0." + i + ".1")).st);
    M.ok("9-FRENO-POR-CUENTA-Y-MISMO-TRATO-A-INEXISTENTES", alta.st === 200 && r9[24] === 429 && tras.st === 429 && r9b[24] === 429 && r9.join() === r9b.join(),
      { alta: alta.st, real: r9.slice(-3), fantasma: r9b.slice(-3), conClaveBuena: tras.st });

    // ── 10. largos máximos ──
    const largos = [
      (await pide("POST", "/api/users", { ses: sesAdmin, cuerpo: { user: "x".repeat(65), pass: "Larga-Pero-Bien-1!" } })).st,
      (await pide("POST", "/api/users", { ses: sesAdmin, cuerpo: { user: "okuser", name: "n".repeat(81), pass: "Larga-Pero-Bien-1!" } })).st,
      (await pide("POST", "/api/users", { ses: sesAdmin, cuerpo: { user: "okuser", pass: "Aa1!" + "x".repeat(260) } })).st,
      (await pide("POST", "/api/users", { ses: sesAdmin, cuerpo: { user: "con\u0000nulo", pass: "Larga-Pero-Bien-1!" } })).st,
      (await entrar("y".repeat(5000), "z", "40.4.4.4")).st
    ];
    M.ok("10-LARGOS-MAXIMOS", largos.slice(0, 4).every(x => x === 400) && largos[4] === 401, { largos });

    // ── 11. cambiar la contraseña cierra las DEMÁS sesiones (la propia sigue) ──
    const s2 = (await entrar(ADMIN, CLAVE_ADMIN, "10.5.0.1")).j.token;
    const cambio = await pide("PATCH", "/api/auth/me", { ses: sesAdmin, cuerpo: { passActual: CLAVE_ADMIN, pass: CLAVE_NUEVA } });
    const otra = await pide("GET", "/api/auth/me", { ses: s2 }), propia = await pide("GET", "/api/auth/me", { ses: sesAdmin });
    M.ok("11-CAMBIO-DE-CLAVE-CIERRA-OTRAS-SESIONES", cambio.st === 200 && cambio.j.sesionesCerradas >= 1 && otra.st === 401 && propia.st === 200,
      { cambio: cambio.st, cerradas: cambio.j && cambio.j.sesionesCerradas, otra: otra.st, propia: propia.st });

    // ── 12. el registro: anota lo importante, solo para el admin, sin secretos ──
    await pide("POST", "/api/users", { ses: sesAdmin, cuerpo: { user: "okinv", name: "Inv", pass: "Mercado-Ok-44!x", role: "inv" } });
    const tokInv = (await entrar("okinv", "Mercado-Ok-44!x", "10.8.8.8")).j.token;
    const vInv = await pide("GET", "/api/seguridad", { ses: tokInv }), vAdm = await pide("GET", "/api/seguridad?n=1000", { ses: sesAdmin });
    const evs = (vAdm.j && vAdm.j.eventos) || [];
    const tipos = new Set(evs.map(e => e.ev));
    const crudo = fs.readFileSync(path.join(DISCO, "seguridad.log"), "utf8") + logSrv;
    const secretos = [CLAVE_ADMIN, CLAVE_NUEVA, "Mala-Clave-1234!", "Segura-Clave-55!x", TOKEN, sesAdmin, s2, tokInv].filter(x => crudo.indexOf(x) >= 0).length;
    const noExiste = evs.some(e => e.ev === "login_fallido" && e.user === "(no existe)") && !/nadie-xyz/.test(crudo);
    const conIp = evs.filter(e => /login/.test(e.ev)).every(e => e.ip && e.ip !== "?");
    M.ok("12-REGISTRO-DE-SEGURIDAD", vInv.st === 403 && vAdm.st === 200 && ["login_ok", "login_fallido", "login_frenado", "bloqueo", "cuenta_creada", "clave_cambiada", "acceso_denegado"].every(t => tipos.has(t)) && secretos === 0 && noExiste && conIp,
      { inv: vInv.st, admin: vAdm.st, n: evs.length, tipos: [...tipos], secretosEnLog: secretos, noExisteAnonimo: noExiste, conIp });

    // ── 13. errores 500 genéricos: sin rutas ni mensajes internos ──
    fs.rmSync(path.join(DISCO, "userdata"), { recursive: true, force: true }); fs.writeFileSync(path.join(DISCO, "userdata"), "no soy carpeta");
    const e500 = await pide("PUT", "/api/data", { ses: sesAdmin, cuerpo: { rev: 0, payload: { _app: "portfolio-dashboard", clients: {} } } });
    const fuga = new RegExp(DISCO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|ENOTDIR|EEXIST|ENOENT|errno|at \\w+ \\(").test(e500.texto);
    const anotado = ((await pide("GET", "/api/seguridad", { ses: sesAdmin })).j.eventos || []).some(e => e.ev === "error_500");
    M.ok("13-ERRORES-500-GENERICOS", e500.st === 500 && !fuga && anotado, { st: e500.st, cuerpo: e500.texto.slice(0, 120), anotado });

    // ── 14. lo que no es de la app no se sirve ──
    const no = [await pide("GET", "/server.js"), await pide("GET", "/data/../server.js"), await pide("GET", "/users.json"), await pide("POST", "/")].map(r => r.st);
    M.ok("14-SOLO-SE-SIRVE-LA-APP", no[0] === 404 && no[1] === 404 && no[2] === 404 && no[3] === 405, { no });
  } catch (e) { M.ok("CRASH", false, String(e && e.stack || e).slice(0, 300)); }
  finally { srv.kill(); fs.rmSync(DISCO, { recursive: true, force: true }); }
  process.exit(M.resumen() ? 1 : 0);
})();
