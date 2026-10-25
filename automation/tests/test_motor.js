/* test_motor.js — EL MOTOR DE LA CARTERA, CONTRA UNA RECOMPUTACIÓN INDEPENDIENTE.
   Rehace a mano, desde los eventos de la cartera y los cierres de la base (sin llamar al motor), las acciones
   en poder, el valor de cada posición, el valor total y el retorno TWR, y exige que el motor de la app
   (invMetrics) entregue exactamente lo mismo. Si un cambio del motor altera un número que se usa para invertir,
   esta ronda lo detecta. */
const { abrirApp, ir, crearMarcador } = require("./_harness");
(async () => {
  const { navegador, pagina, erroresPagina } = await abrirApp({ dias: 120 });
  await ir(pagina, "inv", "seguimiento");
  const r = await pagina.evaluate(() => {
    const IM = invMetrics(), W = PF.weeks, last = W[W.length - 1];
    // recomputación INDEPENDIENTE desde los eventos y la base de precios (sin usar el motor)
    const sh = Object.assign({}, W[0].qty); let costo = Object.keys(sh).reduce((a, t) => a + sh[t] * W[0].prices[t], 0), aportado = costo, divs = 0, ventas = 0;
    const costoT = {}; Object.keys(sh).forEach(t => costoT[t] = sh[t] * W[0].prices[t]);
    W.forEach((w, i) => { const e = w.ev; if (!e || i === 0) return;
      if (e.kind === "inject") { aportado += e.amount; for (const [t, m] of Object.entries(e.alloc || {})) { const q = m / w.prices[t]; sh[t] = (sh[t] || 0) + q; costoT[t] = (costoT[t] || 0) + m; } }
      if (e.kind === "trade" && e.side === "sell") { const pm = costoT[e.t] / sh[e.t]; costoT[e.t] -= pm * e.shares; sh[e.t] -= e.shares; ventas += e.shares * e.price; }
      if (e.kind === "div") divs += e.amount; });
    const px = t => { const S = consolidatedSeries(); const m = S.tick[t]; const ds = Object.keys(m).filter(d => d <= last.date).sort(); return m[ds[ds.length - 1]]; };
    const filas = Object.keys(sh).map(t => { const p = IM.perStock.find(x => x.hd.t === t);
      return { t, accionesInd: +sh[t].toFixed(4), accionesApp: p ? +p.sh.toFixed(4) : null, valorInd: Math.round(sh[t] * px(t)), valorApp: p ? Math.round(p.val) : null }; });
    const valorInd = filas.reduce((a, f) => a + f.valorInd, 0), valorApp = IM.perStock.reduce((a, p) => a + (p.val || 0), 0);
    // TWR independiente: encadena el retorno diario de la cartera neteando el aporte del día
    let twr = 1, prevV = null; const Sx = consolidatedSeries();
    const sh2 = Object.assign({}, W[0].qty);
    W.forEach((w, i) => { const e = w.ev; let flujo = 0;
      if (i > 0 && e && e.kind === "inject") { for (const [t, m] of Object.entries(e.alloc || {})) sh2[t] = (sh2[t] || 0) + m / w.prices[t]; flujo = e.amount; }
      if (i > 0 && e && e.kind === "trade" && e.side === "sell") { sh2[e.t] -= e.shares; flujo = -e.shares * e.price; }
      if (i > 0 && e && e.kind === "div") flujo = -e.amount;
      const v = Object.keys(sh2).reduce((a, t) => a + sh2[t] * w.prices[t], 0);
      if (prevV != null) twr *= (v - flujo) / prevV;
      prevV = v; });
    return { filas, valorInd: Math.round(valorInd), valorApp: Math.round(valorApp), difValor: +(valorApp - valorInd).toFixed(0),
      twrInd: +((twr - 1) * 100).toFixed(3), twrApp: IM.last ? +((IM.last.ret) * 100).toFixed(3) : null, aportado: Math.round(aportado), divs, errores: 0 };
  });
  const M = crearMarcador();
  M.ok("1-ACCIONES-EN-PODER", r.filas.every(f => Math.abs(f.accionesInd - f.accionesApp) < 1e-3), r.filas.map(f => [f.t, f.accionesInd, f.accionesApp]));
  M.ok("2-VALOR-POR-POSICION", r.filas.every(f => Math.abs(f.valorInd - f.valorApp) <= 1), r.filas.map(f => [f.t, f.valorInd, f.valorApp]));
  M.ok("3-VALOR-TOTAL", Math.abs(r.difValor) <= 1, { independiente: r.valorInd, app: r.valorApp });
  M.ok("4-RETORNO-TWR", r.twrApp != null && Math.abs(r.twrInd - r.twrApp) < 0.01, { independiente: r.twrInd, app: r.twrApp });
  // ── 6. una compra registrada CON ATRASO deja el mismo precio de compra que registrada el día: el costo es
  //      exactamente el monto bruto ingresado (la comisión va aparte), cualquiera sea la fecha ──
  const t6 = await pagina.evaluate(() => {
    window.alert = () => {}; window.confirm = () => true;
    const dts = PF.weeks.map(w => w.date), f = dts[dts.length - 6];
    const a = invMetrics().perStock.find(x => x.hd.t === "BCI"), sh0 = a.sh, c0 = a.buy * a.sh;
    modulo = "inv"; page = "operar"; opState.side = "buy"; opState.tkr = "BCI"; opState.qty = "2"; opState.monto = "127000"; opState.date = f; render();
    document.getElementById("optkr").value = "BCI"; document.getElementById("opqty").value = "2"; document.getElementById("opmonto").value = "127000"; document.getElementById("opdate").value = f;
    const aviso = (document.getElementById("opfee") || {}).textContent || "";
    opDo();
    const b = invMetrics().perStock.find(x => x.hd.t === "BCI");
    return { fecha: f, pCompra: +b.buy.toFixed(4), esperado: +((c0 + 127000) / (sh0 + 2)).toFixed(4), acciones: +b.sh.toFixed(4), avisaComision: /comisi[óo]n/i.test(aviso) && /bruto/i.test(aviso) };
  });
  M.ok("6-COMPRA-CON-ATRASO-MISMO-COSTO", Math.abs(t6.pCompra - t6.esperado) < 1e-3 && t6.avisaComision, t6);
  M.ok("5-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
