/* test_historial.js — LA COMPRA INICIAL ES EL PUNTO DE PARTIDA, Y LO QUE PAGASTE NO ES UN CIERRE.
   La auditoría multiagente encontró que, desde el Historial, se podía dejar la cartera sin su punto de partida
   (una operación movida antes de la compra, la compra movida después, o la fila «Compra» borrada): las
   cantidades se volvían a sembrar desde los montos, con ganancias inventadas. Y que el precio de la compra
   inicial entraba a la serie de mercado como si fuera el cierre del día. Esta ronda fija, sobre la app real
   con la base de cierres real:
     · nada queda antes de la compra inicial y la fila «Compra» no se borra con registros después;
     · mover la compra hacia adelante quita los cierres de antes de comprar y la deja primera;
     · editar la compra no pide las acciones incorporadas después (y no las duplica);
     · una operación el día de la compra se valoriza a lo pagado (día 0 = costo total, base del TWR);
     · el precio de la compra no reemplaza el cierre real ni entra a la base;
     · una compra con fecha pasada de una acción nueva se valoriza ya al cierre de hoy;
     · corregir solo la cantidad de una operación no ancla cierres en la base. */
const { abrirApp, ir, crearMarcador } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp({ dias: 120 });
  await ir(pagina, "inv", "ingreso");
  await pagina.evaluate(() => {
    window.__msgs = [];
    window.alert = m => { window.__msgs.push("A:" + m); };
    window.confirm = m => { window.__msgs.push("C:" + m); return true; };
    const snap = { w: JSON.stringify(PF.weeks), h: JSON.stringify(PF.holdings), db: JSON.stringify(PRICEDB) };
    window.__reset = () => { PF.weeks = JSON.parse(snap.w); PF.holdings = JSON.parse(snap.h); PRICEDB = JSON.parse(snap.db); editIdx = null; syncProj(); window.__msgs = []; modulo = "inv"; page = "ingreso"; render(); };
    // abre el editor del registro i, cambia lo indicado y guarda (como el usuario: campos del formulario + botón)
    window.__editar = (i, cambios) => {
      editIdx = i; page = "ingreso"; render();
      const c = cambios || {};
      if (c.fecha) document.getElementById("wdate").value = c.fecha;
      if (c.campos) Object.entries(c.campos).forEach(([sel, v]) => { const el = document.querySelector(sel); if (el) el.value = v; });
      document.getElementById("savew").click();
    };
    window.__base = () => { const IM = invMetrics(); return { fecha: PF.weeks[0].date, qty: !!PF.weeks[0].qty,
      acciones: Object.fromEntries(IM.perStock.map(p => [p.hd.t, +p.sh.toFixed(4)])), aporte: Math.round(IM.last.aport != null ? IM.last.aport : 0), ganancia: Math.round(IM.last.val - (IM.last.aport || 0)) }; };
  });

  // ── 1. una operación no puede quedar antes de la compra inicial ──
  const t1 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, iop = W.findIndex((w, i) => i > 0 && w.ev), antes = JSON.stringify(W), b0 = __base();
    const d = new Date(W[0].date + "T12:00:00"); d.setDate(d.getDate() - 3); const f = d.toISOString().slice(0, 10);
    __editar(iop, { fecha: f });
    return { aviso: __msgs.some(m => /anterior al inicio de la cartera/.test(m)), intacto: JSON.stringify(PF.weeks) === antes, base: __base(), b0 };
  });
  M.ok("1-NINGUNA-OPERACION-ANTES-DE-LA-COMPRA", t1.aviso && t1.intacto && t1.base.qty && t1.base.aporte === t1.b0.aporte, t1);

  // ── 2. cambiar la fecha de una operación reordena ya, y la compra sigue primera ──
  const t2 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, iop = W.findIndex((w, i) => i > 0 && w.ev && w.ev.kind === "trade"), f = W[iop + 6].date;
    __editar(iop, { fecha: f });
    const ds = PF.weeks.map(w => w.date), ordenado = ds.every((d, i) => i === 0 || ds[i - 1] <= d);
    return { ordenado, primeraEsCompra: !!PF.weeks[0].qty, movida: PF.weeks.some(w => w.ev && w.ev.kind === "trade" && w.date === f), avisos: __msgs.length };
  });
  M.ok("2-CAMBIO-DE-FECHA-REORDENA-YA", t2.ordenado && t2.primeraEsCompra && t2.movida && t2.avisos === 0, t2);

  // ── 3. la compra inicial hacia adelante: quita los cierres de antes de comprar; con una operación antes, no ──
  const t3 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, n0 = W.length, f = W[5].date, b0 = __base();   // quedan antes los registros 1..4
    __editar(0, { fecha: f });
    const r = { fecha: PF.weeks[0].date, fechaPedida: f, qty: !!PF.weeks[0].qty, quitados: n0 - PF.weeks.length, confirmo: __msgs.some(m => /^C:.*se quitan/s.test(m)),
      nadaAntes: PF.weeks.every(w => w.date >= f), accionesIguales: JSON.stringify(__base().acciones) === JSON.stringify(b0.acciones) };
    // ahora más allá de la primera operación: se niega
    __reset(); const iop = PF.weeks.findIndex((w, i) => i > 0 && w.ev), antes = JSON.stringify(PF.weeks);
    __editar(0, { fecha: PF.weeks[iop + 1].date });
    r.bloqueaConOperacion = __msgs.some(m => /hay una operación anterior/.test(m)) && JSON.stringify(PF.weeks) === antes;
    return r;
  });
  M.ok("3-COMPRA-HACIA-ADELANTE", t3.fecha === t3.fechaPedida && t3.qty && t3.quitados === 4 && t3.confirmo && t3.nadaAntes && t3.accionesIguales && t3.bloqueaConOperacion, t3);

  // ── 4. la fila «Compra» no se elimina mientras haya registros después ──
  const t4 = await pagina.evaluate(() => {
    __reset(); const antes = JSON.stringify(PF.weeks); page = "historial"; render();
    const b = document.querySelector('[data-del="0"]'); if (b) b.click();
    return { boton: !!b, aviso: __msgs.some(m => /No se puede eliminar mientras haya registros/.test(m)), intacto: JSON.stringify(PF.weeks) === antes };
  });
  M.ok("4-LA-COMPRA-NO-SE-BORRA", t4.boton && t4.aviso && t4.intacto, t4);

  // ── 5. editar la compra con una acción incorporada después: no se pide, no se duplica ──
  const t5 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, f = W[50].date;
    modulo = "inv"; page = "operar"; opState.side = "buy"; opState.tkr = "CHILE"; opState.qty = "1000"; opState.monto = "140000"; opState.date = f; render();
    document.getElementById("optkr").value = "CHILE"; document.getElementById("opqty").value = "1000"; document.getElementById("opmonto").value = "140000"; document.getElementById("opdate").value = f;
    opDo();
    const a = __base();
    editIdx = 0; page = "ingreso"; render();
    const pideChile = !!document.querySelector('.qinp[data-qt="CHILE"]');
    const mBci = document.querySelector('.minp[data-mt="BCI"]'), nuevoMonto = Math.round(mntNum(mBci)) + 1000;
    mBci.value = String(nuevoMonto);
    document.getElementById("savew").click();
    const b = __base(), cBci = PF.weeks[0].qty.BCI * PF.weeks[0].prices.BCI;
    return { pideChile, alertas: __msgs.filter(m => m[0] === "A"), chileAntes: a.acciones.CHILE, chileDespues: b.acciones.CHILE, compraSinChile: PF.weeks[0].qty.CHILE == null,
      costoBci: Math.round(cBci), esperado: nuevoMonto };
  });
  M.ok("5-EDITAR-COMPRA-NO-PIDE-NI-DUPLICA-LO-POSTERIOR", !t5.pideChile && t5.alertas.length === 0 && t5.chileAntes === 1000 && t5.chileDespues === 1000 && t5.compraSinChile && Math.abs(t5.costoBci - t5.esperado) <= 1, t5);

  // ── 6. operación el MISMO día de la compra: el día 0 vale lo pagado (base del TWR) ──
  const t6 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, d0 = W[0].date, p0 = W[0].prices.BCI, pp = Math.round(p0 * 1.03 * 100) / 100;
    const costo0 = Object.keys(W[0].qty).reduce((a, t) => a + W[0].qty[t] * W[0].prices[t], 0);
    modulo = "inv"; page = "operar"; opState.side = "buy"; opState.tkr = "BCI"; opState.qty = "10"; opState.monto = String(Math.round(pp * 10)); opState.date = d0; render();
    document.getElementById("optkr").value = "BCI"; document.getElementById("opqty").value = "10"; document.getElementById("opmonto").value = String(Math.round(pp * 10)); document.getElementById("opdate").value = d0;
    opDo();
    pricedbApplyToProjects();   // la sincronización siguiente no lo deshace
    const IM = invMetrics(), ops = PF.weeks.filter(w => w.date === d0 && w.ev), u = ops[ops.length - 1];
    const dia0 = IM.series.filter(s => s.date === d0).pop();
    return { registro: { fresh: u.fresh, precioBci: u.prices.BCI, precioCompra: p0 }, valorDia0: Math.round(dia0.val), costoTotal: Math.round(costo0 + Math.round(pp * 10)) };
  });
  M.ok("6-OPERACION-EL-DIA-DE-LA-COMPRA-VALE-LO-PAGADO", t6.registro.fresh.length === 0 && t6.registro.precioBci === t6.registro.precioCompra && Math.abs(t6.valorDia0 - t6.costoTotal) <= 1, t6);

  // ── 7. lo que pagaste no es un cierre: ni en la serie de mercado ni en la base ──
  const t7 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, d0 = W[0].date, cierre = PRICEDB.px.BCI[d0];
    W[0].prices.BCI = Math.round(cierre * 1.02 * 100) / 100;   // compraste 2% sobre el cierre
    const serie = consolidatedSeries().tick.BCI[d0];
    delete PRICEDB.px.BCI[d0]; const ip = PRICEDB.ipsa[d0]; delete PRICEDB.ipsa[d0];   // como si el cierre de hoy aún no saliera
    pricedbIngestProjects();
    return { cierre, compra: W[0].prices.BCI, serie, baseTrasIngerir: PRICEDB.px.BCI[d0] ?? null, ipsaTrasIngerir: PRICEDB.ipsa[d0] ?? null, ipsaEra: ip };
  });
  M.ok("7-LA-COMPRA-NO-ES-UN-CIERRE", t7.serie === t7.cierre && t7.baseTrasIngerir === null && t7.ipsaTrasIngerir === null, t7);

  // ── 8. compra con fecha pasada de una acción NUEVA: valorizada ya al último cierre, no al de la compra ──
  const t8 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, f = W[W.length - 15].date, ult = W[W.length - 1].date, t = "CAP";
    const cierreHoy = PRICEDB.px[t] && PRICEDB.px[t][ult], pxF = PRICEDB.px[t][f], monto = Math.round(pxF * 1.01 * 400);
    modulo = "inv"; page = "operar"; opState.side = "buy"; opState.tkr = t; opState.qty = "400"; opState.monto = String(monto); opState.date = f; render();
    document.getElementById("optkr").value = t; document.getElementById("opqty").value = "400"; document.getElementById("opmonto").value = String(monto); document.getElementById("opdate").value = f;
    opDo();
    const p = invMetrics().perStock.find(x => x.hd.t === t), w = PF.weeks[PF.weeks.length - 1];
    return { fecha: f, ultimo: ult, cierreHoy, precioCompra: monto / 400, valor: Math.round(p.val), esperado: Math.round(400 * cierreHoy), enUltimo: w.prices[t], fresco: (w.fresh || []).indexOf(t) >= 0 };
  });
  M.ok("8-COMPRA-PASADA-SE-VALORIZA-AL-CIERRE-DE-HOY", t8.cierreHoy > 0 && t8.enUltimo === t8.cierreHoy && t8.fresco && Math.abs(t8.valor - t8.esperado) <= 1, t8);

  // ── 9. corregir solo la cantidad de una operación no ancla cierres ni redondea precios ──
  const t9 = await pagina.evaluate(() => {
    __reset(); const W = PF.weeks, iop = W.findIndex((w, i) => i > 0 && w.ev && w.ev.kind === "trade"), w = W[iop], d = w.date;
    // como en el caso auditado: un precio del día derivado de una orden (muchos decimales) y que no es cierre
    // (el día en que aún no sale el cierre de BCI: si la base lo tuviera, la sincronización lo pondría, y es correcto)
    w.prices.BCI = 65498.6111111; w.fresh = (w.fresh || []).filter(t => t !== "BCI"); delete PRICEDB.px.BCI[d];
    const pinsAntes = JSON.stringify(PRICEDB.pin || {}), baseBci = PRICEDB.px.BCI[d] ?? null;
    __editar(iop, { campos: { "#evqty": String((+w.ev.shares) + 100) } });
    const w2 = PF.weeks.find(x => x.ev && x.date === d && x.ev.kind === "trade");
    return { acciones: w2.ev.shares, esperado: (+w.ev.shares) + 100, precioBci: w2.prices.BCI, frescoBci: (w2.fresh || []).indexOf("BCI") >= 0,
      pinsIguales: JSON.stringify(PRICEDB.pin || {}) === pinsAntes, baseBci: PRICEDB.px.BCI[d] ?? null, baseEra: baseBci };
  });
  M.ok("9-CORREGIR-CANTIDAD-NO-ANCLA-CIERRES", t9.acciones === t9.esperado && t9.precioBci === 65498.6111111 && !t9.frescoBci && t9.pinsIguales && t9.baseBci === null, t9);

  M.ok("10-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
