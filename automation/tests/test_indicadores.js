/* test_indicadores.js — INDICADORES DE MERCADO Y FRESCURA DEL DATO.
   Nace de un problema real: mindicador.cl dejó de publicar el IPC (último dato 01-12-2025, verificado
   desde el runner con automation/probe-ipc.mjs) y la app lo mostraba como una cifra más. Esta ronda fija
   que un indicador ABANDONADO por su fuente se distinga del que solo va con retraso, tanto en pantalla
   como ante el agente, para que nadie lea un dato de hace meses como la cifra vigente. */
const { abrirApp, ir, crearMarcador } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp();

  // fija tres indicadores con antigüedades conocidas: al día, con retraso y abandonado por la fuente
  await pagina.evaluate(() => {
    const hoy = new Date();
    const menos = d => new Date(hoy.getTime() - d * 864e5).toISOString().slice(0, 10);
    MIND = {
      dolar: { valor: 933.47, fecha: menos(0), unidad: "Pesos" },      // al día
      utm:   { valor: 71721, fecha: menos(50), unidad: "Pesos" },      // retraso (límite 35)
      ipc:   { valor: -0.2, fecha: menos(277), unidad: "Porcentaje" }  // abandonado (límite 45 → >90)
    };
    mindTs = new Date().toISOString();
  });
  await ir(pagina, "mercados", "panel");

  // ── 1. el ESTADO de cada indicador se clasifica bien ──
  const t1 = await pagina.evaluate(() => ({
    dolar: mindEstado("dolar"), utm: mindEstado("utm"), ipc: mindEstado("ipc")
  }));
  M.ok("1-ESTADO-POR-ANTIGUEDAD",
    !t1.dolar.viejo && !t1.dolar.abandonado && t1.utm.viejo && !t1.utm.abandonado && t1.ipc.viejo && t1.ipc.abandonado, t1);

  // ── 2. la TARJETA lo dice: el abandonado no se presenta como cifra vigente ──
  const t2 = await pagina.evaluate(() => {
    const halla = etq => Array.from(document.querySelectorAll("#main .mkt-tile")).find(t => (t.querySelector(".mkt-name") || {}).textContent === etq);
    const ipc = halla("IPC (var. mensual)"), utm = halla("UTM"), dol = halla("Dólar observado");
    const leer = t => t ? { txt: t.innerText.replace(/\n/g, " · "), apagado: !!t.querySelector('.mkt-val [style*="opacity"]') } : null;
    return { ipc: leer(ipc), utm: leer(utm), dolar: leer(dol) };
  });
  M.ok("2-LA-TARJETA-DISTINGUE-ABANDONADO",
    t2.ipc && /sin publicar/i.test(t2.ipc.txt) && t2.ipc.apagado
    && t2.utm && /⚠/.test(t2.utm.txt) && !/sin publicar/i.test(t2.utm.txt)
    && t2.dolar && !/⚠|sin publicar/i.test(t2.dolar.txt), t2);

  // ── 3. el AGENTE recibe la advertencia y la antigüedad de cada dato ──
  const t3 = await pagina.evaluate(() => {
    const j = JSON.parse(cpRunTool("get_market_indicators", {}));
    const ipc = j.indicadores["IPC (var. mensual)"], utm = j.indicadores["UTM"], dol = j.indicadores["Dólar observado"];
    return {
      ipcVigente: ipc.vigente, ipcAdv: !!ipc.advertencia, ipcDias: ipc.dias_de_antiguedad,
      utmVigente: utm.vigente, dolarSinMarca: dol.vigente === undefined,
      sinPublicar: j.sin_publicar || null
    };
  });
  M.ok("3-EL-AGENTE-NO-PUEDE-CITARLO-COMO-VIGENTE",
    t3.ipcVigente === false && t3.ipcAdv && t3.ipcDias > 200 && typeof t3.utmVigente === "string" && t3.dolarSinMarca && /IPC/.test(t3.sinPublicar || ""), t3);

  // ── 4. la CMF queda enganchada como fuente oficial opcional, sin key no molesta ──
  const t4 = await pagina.evaluate(() => ({
    sinKey: CMF_KEY === "",
    hayFuncion: typeof cmfSerie === "function",
    mapa: Object.keys(CMF_MAP).sort().join(","),
    // guardar una key la deja disponible para el próximo refresco (no se consulta red en la prueba)
    guarda: (() => { try { CMF_KEY = "prueba"; localStorage.setItem("inv_cmf_key", "prueba"); const v = localStorage.getItem("inv_cmf_key"); CMF_KEY = ""; localStorage.removeItem("inv_cmf_key"); return v === "prueba"; } catch (e) { return false; } })()
  }));
  M.ok("4-CMF-COMO-FUENTE-OFICIAL-OPCIONAL",
    t4.sinKey && t4.hayFuncion && t4.mapa === "dolar,euro,ipc,uf,utm" && t4.guarda, t4);

  M.ok("5-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
