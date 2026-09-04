/* _harness.js — cimiento común de las pruebas de Investor.
   Abre index.html en Chromium, deja la app con DATOS REALES (la base de cierres y los fundamentos del
   repo) y una cartera de prueba construida sobre esas mismas fechas y precios: nunca datos demo.
   Las pruebas viven en el REPO (no en un scratchpad) porque el contenedor de trabajo se recicla y una
   sesión anterior perdió 55 suites que solo existían fuera de git. */
const { chromium } = require(process.env.PW_CORE || "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core");
const { readFileSync } = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const CHROME = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CL = JSON.parse(readFileSync(path.join(RAIZ, "data/closes.json"), "utf8"));
const FU = JSON.parse(readFileSync(path.join(RAIZ, "data/fundamentals.json"), "utf8"));

/* marcador de resultados: cada prueba llama ok(nombre, condición, detalle) y al final resumen() */
function crearMarcador() {
  const fallos = [];
  let n = 0;
  return {
    ok(nombre, cond, detalle) {
      n++;
      if (!cond) fallos.push(nombre);
      console.log(`${nombre} ${cond ? "OK" : "FALLA"} ${detalle === undefined ? "" : (typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 320)}`);
    },
    resumen() {
      console.log(`RESUMEN ${fallos.length ? "CON FALLOS" : "TODO OK"} ${JSON.stringify({ total: n, ok: n - fallos.length, fallan: fallos })}`);
      return fallos.length;
    }
  };
}

/* abre la app con la base real cargada y una cartera de prueba de `meses` meses de seguimiento */
async function abrirApp(opts) {
  const o = opts || {};
  const navegador = await chromium.launch({ executablePath: CHROME });
  const pagina = await navegador.newPage({ viewport: { width: o.ancho || 1500, height: o.alto || 1100 } });
  const erroresPagina = [];
  pagina.on("pageerror", e => erroresPagina.push(e.message));
  await pagina.goto("file://" + path.join(RAIZ, "index.html"));
  await pagina.waitForTimeout(400);
  await pagina.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await pagina.reload();
  await pagina.waitForTimeout(700);
  await pagina.evaluate(async D => {
    AUTH = { enabled: false }; lsSet("inv_auth_v1", AUTH); authShow(false);
    window.alert = () => {}; window.confirm = () => true;
    AUTOPX_URL = "https://x.test/c.json";
    const _f = window.fetch;
    window.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(D.CL)) });
    await autopxSync(false);
    window.fetch = _f;
    systemAnalysisRefresh();
    FDATA = fundSanitize(JSON.parse(JSON.stringify(D.FU)));
    // cartera de prueba: 3 acciones reales, con las ÚLTIMAS fechas y precios de la base
    const S = consolidatedSeries(), dts = Object.keys(S.ipsaMap).sort(), px = (t, f) => S.tick[t][f];
    const F = dts.slice(-D.dias);
    const hs = [["BCI", 18], ["COLBUN", 9000], ["ENELCHILE", 12000]];
    const weeks = F.map((d, i) => {
      const w = { date: d, ipsa: S.ipsaMap[d], prices: hs.reduce((a, [t]) => (a[t] = px(t, d), a), {}), fresh: hs.map(([t]) => t), ipsaFresh: true };
      if (i === 0) w.qty = hs.reduce((a, [t, q]) => (a[t] = q, a), {});
      return w;
    });
    // eventos repartidos: un aporte, una venta y un dividendo (para ejercitar toda la contabilidad)
    if (weeks.length > 40) {
      weeks[20].ev = { kind: "inject", amount: 400000, alloc: { BCI: 400000 } };
      weeks[30].ev = { kind: "trade", t: "COLBUN", side: "sell", shares: 2000, price: px("COLBUN", F[30]) };
      weeks[35].ev = { kind: "div", amount: 85000 };
    }
    PROJECTS.length = 0;
    PROJECTS.push({
      id: 9990, name: "Cartera de prueba", date: F[0], amount: 3e6,
      holdings: hs.map(([t, q]) => ({ t, n: t, s: "S", c: "#1E5FD1", w: 1 / 3, b: 1, monto: q * px(t, F[0]) })),
      weeks, links: { analyses: [], scenarios: [], primary: null },
      bp: 1, erCapm: 10, sig: 20, sharpe: 1, corrAvg: .3, freq: "diario"
    });
    saveProjects(); activeId = 9990; syncProj();
    try { projSyncReal(PF); } catch (e) {}
  }, { CL, FU, dias: o.dias || 75 });
  return { navegador, pagina, erroresPagina };
}

/* navega a un módulo/página y espera al render */
async function ir(pagina, mod, pg) {
  await pagina.evaluate(([m, g]) => { modulo = m; if (g) page = g; render(); }, [mod, pg]);
  await pagina.waitForTimeout(180);
}

module.exports = { abrirApp, ir, crearMarcador, RAIZ, CL, FU };
