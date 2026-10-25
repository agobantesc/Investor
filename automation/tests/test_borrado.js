/* test_borrado.js — UN DÍA QUE LA FUENTE DESCARTA SE VA DE VERDAD (TAMBIÉN DE LAS CARTERAS).
   La auditoría encontró que la orden `borrar` de la fuente solo limpiaba la base: los seguimientos tenían el
   día corrupto estampado como cierre real y, en la misma sincronización, saveProjects→pricedbIngestProjects
   lo devolvía a la base. Para las acciones EN CARTERA el día malo nunca se iba (σ, peor día, drawdown y β
   contaminados). Además se borraban cierres de planilla que la fuente no juzgó. Esta ronda, con la app real
   y la base real, siembra una foto mala (+12% en todo, como el 01-09-2026) y fija:
     · tras la orden, el día no queda ni en la base ni como cierre real en los seguimientos;
     · no vuelve con un guardado ni con la sincronización siguiente;
     · lo cargado por planilla fuera del universo de la fuente, y lo anclado a mano, se respetan;
     · cuando la fuente vuelve a traer el día (cierres confirmados), vuelve entero;
     · lo mismo con un día calco que descarta el saneo. */
const { abrirApp, crearMarcador, CL } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp({ dias: 120 });
  const r = await pagina.evaluate(async D => {
    window.alert = () => {}; window.confirm = () => true;
    const sync = async J => { const _f = window.fetch; window.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(J)) }); try { await autopxSync(false); } finally { window.fetch = _f; } };
    const W = PF.weeks, f = W[W.length - 30].date, prev = W[W.length - 31].date;
    const real = { BCI: PRICEDB.px.BCI[f], COLBUN: PRICEDB.px.COLBUN[f] };
    const peorDia = () => { const IM = invMetrics(); return +(Math.max(...IM.series.map((s, i) => i ? Math.abs((s.val - (s.inflow || 0)) / IM.series[i - 1].val - 1) : 0)) * 100).toFixed(2); };
    const limpio = peorDia();
    // 1) la foto mala llega: todas las acciones +12% ese día (la base y los seguimientos la toman)
    const malo = JSON.parse(JSON.stringify(D)); const dM = malo.days.find(x => x.date === f);
    Object.keys(dM.prices).forEach(t => { dM.prices[t] = +(dM.prices[t] * 1.12).toFixed(2); });
    // una acción de planilla (fuera del universo de la fuente) y un cierre anclado a mano, el mismo día
    PRICEDB.px.BICECORP = { [prev]: 31000, [f]: 31200 }; PRICEDB.tickers.BICECORP = { n: "BICECORP" };
    await sync(malo);
    pricedbUpsertDay(f, null, { CCU: 6100 });   // corrección manual anclada
    const contaminado = { base: PRICEDB.px.BCI[f], semana: (W.find(w => w.date === f) || {}).prices.BCI, peor: peorDia() };
    // 2) la fuente lo descarta: el día sale sin precios y con la orden borrar
    const orden = JSON.parse(JSON.stringify(D)); const dO = orden.days.find(x => x.date === f); dO.prices = {};
    orden.borrar = { [f]: "precios" };
    await sync(orden);
    const wF = () => PF.weeks.filter(w => w.date === f && !w.qty);
    const tras = { base: PRICEDB.px.BCI[f] ?? null, frescoEnSemana: wF().some(w => (w.fresh || []).includes("BCI")), precioSemana: (wF()[0] || {}).prices.BCI,
      cierreAnterior: PRICEDB.px.BCI[prev], serie: consolidatedSeries().tick.BCI[f] ?? null, peor: peorDia(),
      planilla: PRICEDB.px.BICECORP[f] ?? null, anclado: PRICEDB.px.CCU[f] ?? null };
    // 3) un guardado (pricedbIngestProjects) y otra sincronización sin la orden: no vuelve
    saveProjects();
    const sinOrden = JSON.parse(JSON.stringify(orden)); delete sinOrden.borrar; await sync(sinOrden);
    const despues = { base: PRICEDB.px.BCI[f] ?? null, frescoEnSemana: wF().some(w => (w.fresh || []).includes("BCI")) };
    // 4) la fuente vuelve a traer el día con sus cierres (confirmados por el consenso): vuelve entero
    await sync(D);
    const vuelve = { base: PRICEDB.px.BCI[f], real: real.BCI, frescoEnSemana: wF().some(w => (w.fresh || []).includes("BCI")), semana: (wF()[0] || {}).prices.BCI, lapida: typeof pdLapida === "function" ? pdLapida(f, "BCI") : null };
    // 5) día CALCO (todas las acciones repiten exacto el cierre anterior) que llegó a los seguimientos: el saneo
    //    lo descarta y ya no vuelve con un guardado
    const g = W[W.length - 12].date, g0 = W[W.length - 13].date;
    Object.keys(PRICEDB.px).forEach(t => { if (PRICEDB.px[t][g] != null && PRICEDB.px[t][g0] != null) PRICEDB.px[t][g] = PRICEDB.px[t][g0]; });
    pricedbApplyToProjects(); pricedbSanitize(); saveProjects();
    const calco = { base: PRICEDB.px.BCI[g] ?? null, fresco: PF.weeks.filter(w => w.date === g && !w.qty).some(w => (w.fresh || []).includes("BCI")) };
    return { f, limpio, contaminado, tras, despues, vuelve, calco };
  }, CL);
  M.ok("1-LA-FOTO-MALA-CONTAMINABA", r.contaminado.base > r.vuelve.real * 1.1 && r.contaminado.semana === r.contaminado.base && r.contaminado.peor > r.limpio, r.contaminado);
  M.ok("2-LA-ORDEN-LIMPIA-BASE-Y-SEGUIMIENTOS", r.tras.base === null && !r.tras.frescoEnSemana && r.tras.precioSemana === r.tras.cierreAnterior && r.tras.serie === null && r.tras.peor <= r.limpio + 0.01,
    { tras: r.tras, peorLimpio: r.limpio });
  M.ok("3-NO-VUELVE-CON-UN-GUARDADO-NI-OTRA-SINCRONIZACION", r.despues.base === null && !r.despues.frescoEnSemana, r.despues);
  M.ok("4-SE-RESPETA-LA-PLANILLA-Y-LO-ANCLADO", r.tras.planilla === 31200 && r.tras.anclado === 6100, { planilla: r.tras.planilla, anclado: r.tras.anclado });
  M.ok("5-CUANDO-LA-FUENTE-LO-TRAE-VUELVE", r.vuelve.base === r.vuelve.real && r.vuelve.frescoEnSemana && r.vuelve.semana === r.vuelve.real && !r.vuelve.lapida, r.vuelve);
  M.ok("6-UN-DIA-CALCO-TAMPOCO-VUELVE", r.calco.base === null && !r.calco.fresco, r.calco);
  M.ok("7-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
