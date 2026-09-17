/* test_seguimiento.js — ENCABEZADO DEL PROYECTO EN SEGUIMIENTO.
   El encabezado describía la cartera del PRIMER día (los pesos y montos de la compra inicial) aunque
   después se hubiera comprado, vendido o movido el precio. Esta ronda fija que describa la cartera de HOY:
   pesos y valores actuales, posiciones liquidadas fuera, y el total cuadrado con el motor. */
const { abrirApp, ir, crearMarcador } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp();
  await ir(pagina, "inv", "seguimiento");

  // ── 1. los CHIPS salen del valor actual de cada posición, no de la compra inicial ──
  const t1 = await pagina.evaluate(() => {
    const num = s => parseFloat(("" + s).replace(/[^\d,.\-−]/g, "").replace(/\./g, "").replace(",", ".").replace("−", "-")) || 0;
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => (c.querySelector(".hd .ct") || {}).textContent === PF.name);
    const chips = Array.from(card.querySelectorAll(".altchip")).map(c => {
      const m = /^(\S+)\s+(\d+)%\s*·\s*(.+)$/.exec(c.textContent.trim());
      return m ? { t: m[1], pct: +m[2], val: num(m[3]) } : { crudo: c.textContent.trim() };
    });
    const IM = invMetrics();
    const vivas = IM.perStock.filter(x => x.sh > 0 && x.val > 0);
    const tot = vivas.reduce((a, x) => a + x.val, 0);
    const esperado = vivas.slice().sort((a, b) => b.val - a.val)
      .map(x => ({ t: x.hd.t, pct: Math.round(x.val / tot * 100), val: Math.round(x.val) }));
    // el valor del primer día, para probar que NO es lo que se muestra
    const b0 = PF.weeks[0];
    const inicial = b0 && b0.qty ? Object.keys(b0.qty).reduce((a, t) => a + (b0.qty[t] || 0) * (b0.prices[t] || 0), 0) : 0;
    const difs = [];
    if (chips.length !== esperado.length) difs.push("chips " + chips.length + "≠" + esperado.length);
    chips.forEach((c, i) => {
      const e = esperado[i]; if (!e) return;
      if (c.t !== e.t) difs.push("orden: " + c.t + "≠" + e.t);
      if (c.pct !== e.pct) difs.push(c.t + " peso " + c.pct + "≠" + e.pct);
      if (Math.abs(c.val - e.val) > 1) difs.push(c.t + " valor " + c.val + "≠" + e.val);
    });
    return { difs, chips, totalHoy: Math.round(tot), totalInicial: Math.round(inicial) };
  });
  M.ok("1-CHIPS-CON-LA-COMPOSICION-DE-HOY", t1.difs.length === 0 && t1.chips.length > 0, t1);

  // ── 2. y esa composición NO es la del primer día (el fixture vendió parte de una posición) ──
  M.ok("2-YA-NO-ES-LA-COMPRA-INICIAL", Math.abs(t1.totalHoy - t1.totalInicial) > 1,
    { hoy: t1.totalHoy, inicial: t1.totalInicial });

  // ── 3. una posición LIQUIDADA desaparece del encabezado (sigue en el historial) ──
  const t3 = await pagina.evaluate(() => {
    const IM = invMetrics();
    const viva = IM.perStock.find(x => x.sh > 0 && x.val > 0);
    // se vende TODO lo que queda de esa acción y se vuelve a mirar el encabezado
    const w = PF.weeks[PF.weeks.length - 1];
    PF.weeks.push({ date: w.date, ipsa: w.ipsa, prices: Object.assign({}, w.prices), fresh: (w.fresh || []).slice(), ipsaFresh: true,
      ev: { kind: "trade", t: viva.hd.t, side: "sell", shares: viva.sh, price: w.prices[viva.hd.t] } });
    saveProjects(); syncProj(); render();
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => (c.querySelector(".hd .ct") || {}).textContent === PF.name);
    const tickers = Array.from(card.querySelectorAll(".altchip")).map(c => c.textContent.trim().split(/\s+/)[0]);
    PF.weeks.pop(); saveProjects(); syncProj(); render();   // se deshace: las demás rondas siguen con la cartera original
    return { vendida: viva.hd.t, tickers };
  });
  M.ok("3-LA-POSICION-LIQUIDADA-DESAPARECE", t3.tickers.indexOf(t3.vendida) < 0 && t3.tickers.length > 0, t3);

  // ── 4. el SUBTÍTULO habla de hoy y su total cuadra con los chips ──
  const t4 = await pagina.evaluate(() => {
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => (c.querySelector(".hd .ct") || {}).textContent === PF.name);
    const sub = (card.querySelector(".hd .cs") || {}).textContent || "";
    const IM = invMetrics();
    const tot = IM.perStock.filter(x => x.sh > 0 && x.val > 0).reduce((a, x) => a + x.val, 0);
    return {
      sub: sub.slice(0, 120),
      diceHoy: /en cartera hoy/.test(sub),
      sinObjetivoViejo: !/objetivo \$/.test(sub),
      conTotal: sub.indexOf(fmtCLP(tot)) >= 0
    };
  });
  M.ok("4-SUBTITULO-DESCRIBE-LA-CARTERA-DE-HOY", t4.diceHoy && t4.sinObjetivoViejo && t4.conTotal, t4);

  M.ok("5-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
