/* test_espacios.js — CADA CUENTA CON SUS DATOS Y SUS CLAVES, MEDIDO CONTRA EL server.js REAL.
   La auditoría encontró que el respaldo y la sincronización leían el espacio del ADMINISTRADOR aunque hubiera
   entrado un inversionista: su cuenta del servidor terminaba guardando la cartera del administrador, lo que él
   registraba nunca subía, y al traer datos en otro equipo se pisaba la cartera del administrador. Las claves
   (SYNC_TOKEN, GitHub, Anthropic, CMF) se compartían entre cuentas del mismo navegador, y el SYNC_TOKEN solo
   abría la caja fuerte completa. Esta prueba fija, con un navegador real y dos equipos:
     · lo que la versión anterior dejó cruzado en el servidor se aparta en cuarentena al arrancar;
     · el inversionista no ve las claves del administrador y sube SU espacio (marcado), no el del admin;
     · el espacio del administrador en ese navegador queda intacto;
     · en otro equipo el inversionista recupera lo suyo y no borra la base de precios común;
     · el servidor rechaza datos sin marca o de otro espacio, y la caja fuerte exige sesión de administrador;
     · en «ver como» no se sube ni se trae nada. */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { chromium } = require(process.env.PW_CORE || "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core");
const { crearMarcador } = require("./_harness");
const RAIZ = path.resolve(__dirname, "../..");
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const PUERTO = 11000 + Math.floor(Math.random() * 80), B = "http://127.0.0.1:" + PUERTO;
const TOKEN = "tok-" + crypto.randomBytes(8).toString("hex");
const DISCO = fs.mkdtempSync(path.join(os.tmpdir(), "inv-esp-"));
const ADM = { id: "uadmin000001", user: "ricardo", pass: "Clave-Del-Dueño-2026!" };
const FAM = { id: "ufam00000001", user: "familia", pass: "Mercado-Propio-31#x" };
const cuenta = (u, role) => { const salt = crypto.randomBytes(16).toString("hex");
  return { id: u.id, user: u.user, name: u.user, role, ns: role === "admin" ? "" : u.id, salt,
    hash: crypto.pbkdf2Sync(u.pass, salt, 600000, 32, "sha256").toString("hex"), it: 600000,
    creado: new Date().toISOString(), activo: true, intentos: 0, bloqueadoHasta: 0 }; };
fs.writeFileSync(path.join(DISCO, "users.json"), JSON.stringify([cuenta(ADM, "admin"), cuenta(FAM, "inv")]));

// lo que había en el disco ANTES de la corrección: el admin con su cartera (sin marca: es suya) y la cuenta
// del inversionista con la cartera del ADMIN adentro (la subía la versión anterior), más dos revisiones viejas
const proyecto = nombre => ({ id: 1 + nombre.length, name: nombre, date: "2026-09-01", amount: 1e6,
  holdings: [{ t: "BCI", n: "BCI", s: "S", c: "#1E5FD1", w: 1, b: 1, monto: 1e6 }], weeks: [],
  links: { analyses: [], scenarios: [], primary: null }, freq: "diario" });
const estado = (nombre, extra) => Object.assign({ _app: "portfolio-dashboard", _v: 2, _date: new Date().toISOString(),
  clients_registry: [{ id: "c_me", name: "Administración", color: "#1E5FD1" }], active_client: "c_me",
  clients: { c_me: { pf_projects_v1: [proyecto(nombre)] } } }, extra || {});
const UD = path.join(DISCO, "userdata"); fs.mkdirSync(UD, { recursive: true });
const sobre = (rev, p) => JSON.stringify({ rev, savedAt: new Date().toISOString(), payload: p });
fs.writeFileSync(path.join(UD, ADM.id + ".json"), sobre(1, estado("CARTERA-ADMIN-SERVIDOR")));
fs.writeFileSync(path.join(UD, ADM.id + ".v000001.json"), sobre(1, estado("CARTERA-ADMIN-SERVIDOR")));
for (const r of [2, 3]) fs.writeFileSync(path.join(UD, FAM.id + ".v00000" + r + ".json"), sobre(r, estado("FUGA-CARTERA-ADMIN")));
fs.writeFileSync(path.join(UD, FAM.id + ".json"), sobre(3, estado("FUGA-CARTERA-ADMIN")));

const pide = async (metodo, ruta, { cuerpo, ses, tok } = {}) => {
  const r = await fetch(B + ruta, { method: metodo, headers: Object.assign({ "cf-connecting-ip": "10.9.0.1" },
    cuerpo ? { "Content-Type": "application/json" } : {}, ses ? { "x-investor-session": ses } : {}, tok ? { "x-investor-token": tok } : {}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text(); let j = null; try { j = JSON.parse(texto); } catch (e) {}
  return { st: r.status, j, texto };
};
const sesion = async u => (await pide("POST", "/api/auth/login", { cuerpo: { user: u.user, pass: u.pass } })).j.token;
const nombres = reg => { const cs = (reg && reg.payload && reg.payload.clients) || {};
  return Object.values(cs).flatMap(o => (o && o.pf_projects_v1 || []).map(p => p.name)); };

/* espera a que se cumpla una condición en la página aunque esta se recargue en el camino */
async function esperar(pg, fn, arg, ms) {
  const fin = Date.now() + (ms || 15000);
  while (Date.now() < fin) {
    try { if (await pg.evaluate(fn, arg)) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}
/* entra por la pantalla de entrada real y espera la sincronización de entrada (y su recarga, si la hay) */
async function entrar(pg, u) {
  await esperar(pg, () => { const g = document.getElementById("authGate"); return !!(g && g.classList.contains("open") && document.getElementById("authUser")); });
  await pg.fill("#authUser", u.user); await pg.fill("#authPass", u.pass);
  await pg.click("#authGo");
  await esperar(pg, x => typeof SESSION !== "undefined" && !!SESSION && SESSION.user === x && !document.getElementById("authGate").classList.contains("open"), u.user);
  await pg.waitForTimeout(1800);
  return esperar(pg, x => typeof SESSION !== "undefined" && !!SESSION && SESSION.user === x && !document.getElementById("authGate").classList.contains("open"), u.user);
}

(async () => {
  const M = crearMarcador();
  const srv = spawn(process.execPath, ["server.js"], { cwd: RAIZ, env: Object.assign({}, process.env, { PORT: String(PUERTO), DATA_DIR: DISCO, SYNC_TOKEN: TOKEN }), stdio: ["ignore", "pipe", "pipe"] });
  let logSrv = ""; srv.stdout.on("data", d => logSrv += d); srv.stderr.on("data", d => logSrv += d);
  for (let i = 0; i < 50; i++) { try { await fetch(B + "/api/health"); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  let nav = null;
  try {
    // ── 1. al arrancar: lo cruzado se aparta (sin borrarlo) y lo del administrador se queda ──
    const cuar = path.join(UD, "cuarentena"), enCuar = fs.existsSync(cuar) ? fs.readdirSync(cuar) : [];
    const sesFam = await sesion(FAM), sesAdm = await sesion(ADM);
    const metaFam = (await pide("GET", "/api/data/meta", { ses: sesFam })).j, versFam = (await pide("GET", "/api/data/versions", { ses: sesFam })).j;
    const viejaFam = await pide("GET", "/api/data?v=" + FAM.id + ".v000003.json", { ses: sesFam });
    const datAdm = (await pide("GET", "/api/data", { ses: sesAdm })).j;
    M.ok("1-LO-CRUZADO-QUEDA-EN-CUARENTENA",
      enCuar.length === 3 && enCuar.every(f => f.indexOf(FAM.id) >= 0) && metaFam.hayDatos === false && versFam.versions.length === 0 && viejaFam.st === 404
      && nombres(datAdm).join() === "CARTERA-ADMIN-SERVIDOR" && /datos apartados/.test(logSrv),
      { enCuarentena: enCuar.length, famHayDatos: metaFam.hayDatos, famVersiones: versFam.versions.length, famVieja: viejaFam.st, admin: nombres(datAdm) });

    // ── 2. el servidor solo guarda lo que es de la cuenta ──
    const put = (ses, rev, extra) => pide("PUT", "/api/data", { ses, cuerpo: { rev, payload: estado("X", extra) } });
    const sinMarca = await put(sesFam, 0), deAdmin = await put(sesFam, 0, { _ns: "" }), deOtro = await put(sesAdm, 1, { _ns: FAM.id });
    M.ok("2-EL-SERVIDOR-RECHAZA-DATOS-DE-OTRO-ESPACIO", sinMarca.st === 400 && /recárgala/.test(sinMarca.j.error) && deAdmin.st === 400 && deOtro.st === 400,
      { sinMarca: [sinMarca.st, sinMarca.j && sinMarca.j.error], deAdmin: deAdmin.st, adminConOtro: deOtro.st });

    // ── 3. la caja fuerte: el token solo ya no basta, y el de un inversionista tampoco ──
    const soloTok = await pide("GET", "/api/backup/meta", { tok: TOKEN }), tokFam = await pide("GET", "/api/backup/meta", { tok: TOKEN, ses: sesFam });
    const tokAdm = await pide("GET", "/api/backup/meta", { tok: TOKEN, ses: sesAdm }), putFam = await pide("PUT", "/api/backup", { tok: TOKEN, ses: sesFam, cuerpo: estado("X") });
    M.ok("3-CAJA-FUERTE-SOLO-CON-SESION-DE-ADMINISTRADOR", soloTok.st === 401 && tokFam.st === 403 && putFam.st === 403 && tokAdm.st === 200,
      { soloToken: soloTok.st, inversionista: tokFam.st, inversionistaSube: putFam.st, administrador: tokAdm.st });

    // ── equipo 1: entra el administrador, trae su cartera y deja sus claves en el navegador ──
    nav = await chromium.launch({ executablePath: CHROME });
    const errores = [];
    const ctx1 = await nav.newContext(), pg = await ctx1.newPage();
    pg.on("pageerror", e => errores.push(e.message));
    await pg.goto(B + "/");
    const okAdm = await entrar(pg, ADM);
    const t4 = await pg.evaluate(T => {
      CLOUD.token = T; cloudSave();
      lsSet("inv_anthropic_key", "sk-ant-CLAVE-DEL-ADMIN");
      localStorage.setItem(ck("inv_autopx_gh"), "ghp_TOKEN_DEL_ADMIN"); localStorage.setItem(ck("inv_cmf_key"), "cmf-CLAVE-DEL-ADMIN");
      return { ns: USER_NS, proyectos: PROJECTS.map(p => p.name) };
    }, TOKEN);
    await pg.evaluate(() => authLock());

    // ── 4. entra el inversionista en el MISMO navegador: nada del administrador a la vista ──
    const okFam = await entrar(pg, FAM);
    const t5 = await pg.evaluate(async () => {
      const r = { ns: USER_NS, proyectos: PROJECTS.map(p => p.name), cloud: CLOUD.token || "", anthropic: cpKey || "", gh: AUTOPX_GH || "", cmf: CMF_KEY || "" };
      // y si roba el SYNC_TOKEN del administrador del almacenamiento del navegador, la caja fuerte igual le dice que no
      const robado = (JSON.parse(localStorage.getItem("inv_cloud_v1") || "{}").token) || "";
      const res = await fetch("/api/backup/meta", { headers: { "x-investor-token": robado, "x-investor-session": srvToken() } });
      r.robadoSirve = res.status; r.tokenEstaba = !!robado;
      return r;
    });
    M.ok("4-EL-INVERSIONISTA-NO-VE-NI-USA-LO-DEL-ADMINISTRADOR",
      okAdm && okFam && t4.ns === "" && t4.proyectos.join() === "CARTERA-ADMIN-SERVIDOR" && t5.ns === FAM.id && t5.proyectos.length === 0
      && !t5.cloud && !t5.anthropic && !t5.gh && !t5.cmf && t5.tokenEstaba && t5.robadoSirve === 403,
      { admin: t4, inversionista: t5 });

    // ── 5. lo que el inversionista registra sube a SU cuenta, marcado con su espacio ──
    const t6 = await pg.evaluate(async () => {
      PROJECTS.push(Object.assign(JSON.parse(JSON.stringify(PROJECTS[0] || {})), { id: 777, name: "CARTERA-DE-FAMILIA", date: "2026-09-01", amount: 5e5,
        holdings: [{ t: "COLBUN", n: "COLBUN", s: "S", c: "#0E8C5E", w: 1, b: 1, monto: 5e5 }], weeks: [], links: { analyses: [], scenarios: [], primary: null }, freq: "diario" }));
      saveProjects();
      const r = await datosSubir(true);
      return { rev: r && r.rev, adminIntacto: (localStorage.getItem("pf_projects_v1__c_me") || "").indexOf("CARTERA-ADMIN-SERVIDOR") >= 0,
        propio: (localStorage.getItem(ckc("pf_projects_v1", "c_me")) || "").indexOf("CARTERA-DE-FAMILIA") >= 0 };
    });
    const datFam = (await pide("GET", "/api/data", { ses: sesFam })).j;
    M.ok("5-SUBE-SU-ESPACIO-Y-NO-TOCA-EL-DEL-ADMINISTRADOR",
      t6.rev === 1 && datFam.payload && datFam.payload._ns === FAM.id && nombres(datFam).join() === "CARTERA-DE-FAMILIA" && t6.adminIntacto && t6.propio,
      { local: t6, servidor: { ns: datFam.payload && datFam.payload._ns, proyectos: nombres(datFam) } });

    // ── 6. otro equipo: recupera lo suyo y no borra la base de precios común de ese navegador ──
    const ctx2 = await nav.newContext(), pg2 = await ctx2.newPage();
    pg2.on("pageerror", e => errores.push(e.message));
    await pg2.goto(B + "/");
    // la base común de ese navegador (la que mantiene la sincronización diaria): se siembra y se recarga
    await pg2.evaluate(() => localStorage.setItem("inv_pricedb_v1__c_me", JSON.stringify({ tickers: { BCI: { n: "BCI" } }, px: { BCI: { "2026-10-01": 68000, "2026-10-02": 68250 } }, ipsa: { "2026-10-01": 10900, "2026-10-02": 10950 } })));
    await pg2.reload();
    const okFam2 = await entrar(pg2, FAM);
    const t7 = await pg2.evaluate(() => ({ ns: USER_NS, proyectos: PROJECTS.map(p => p.name),
      base: (((JSON.parse(localStorage.getItem("inv_pricedb_v1__c_me") || "null") || {}).px || {}).BCI || null) }));
    M.ok("6-OTRO-EQUIPO-TRAE-LO-SUYO-Y-RESPETA-LO-COMUN", okFam2 && t7.ns === FAM.id && t7.proyectos.join() === "CARTERA-DE-FAMILIA" && !!t7.base && t7.base["2026-10-01"] === 68000, t7);

    // ── 7. «ver como»: el administrador mira la interfaz del inversionista sin subir ni traer nada ──
    await pg.evaluate(() => authLock());
    await entrar(pg, ADM);
    // como en el menú de la sesión: primero la lista de cuentas del servidor, después entrar a la de esa persona
    await pg.evaluate(async id => { await srvUsuarios(); verComoIr(id); }, FAM.id);
    await esperar(pg, () => typeof VISTA !== "undefined" && !!VISTA);
    const t8 = await pg.evaluate(async () => ({ vista: !!VISTA, ns: USER_NS, activo: datosActivo(), subir: await datosSubir(true), proyectos: PROJECTS.map(p => p.name), cloud: CLOUD.token || "" }));
    const datAdm2 = (await pide("GET", "/api/data", { ses: sesAdm })).j;
    M.ok("7-VER-COMO-NO-SUBE-NI-TRAE", t8.vista && t8.ns === FAM.id && t8.activo === false && t8.subir === null && t8.proyectos.join() === "CARTERA-DE-FAMILIA" && !t8.cloud
      && nombres(datAdm2).join() === "CARTERA-ADMIN-SERVIDOR",
      { verComo: t8, servidorAdmin: nombres(datAdm2) });

    // ── 8. cambiar de papel cambia de espacio: lo guardado con el anterior se aparta ──
    const promo = await pide("PATCH", "/api/users/" + FAM.id, { ses: sesAdm, cuerpo: { role: "admin" } });
    const metaPromo = (await pide("GET", "/api/data/meta", { ses: sesFam })).j;
    M.ok("8-CAMBIO-DE-PAPEL-APARTA-EL-ESPACIO-ANTERIOR", promo.st === 200 && metaPromo.hayDatos === false && fs.readdirSync(cuar).length === 5,
      { promo: promo.st, hayDatos: metaPromo.hayDatos, enCuarentena: fs.readdirSync(cuar).length });

    M.ok("9-SIN-ERRORES-DE-PAGINA", errores.length === 0, errores.slice(0, 3));
  } catch (e) { M.ok("CRASH", false, String(e && e.stack || e).slice(0, 300)); }
  finally { try { if (nav) await nav.close(); } catch (e) {} srv.kill(); fs.rmSync(DISCO, { recursive: true, force: true }); }
  process.exit(M.resumen() ? 1 : 0);
})();
