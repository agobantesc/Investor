/* test_home_ops.js — TARJETA "Resultados, operaciones y comisiones" del Home.
   Cuatro pestañas que muestran SOLO lo suyo (Resultados · Neto · Operaciones · Comisiones), el resultado
   mensual medido con TWR —de modo que un aporte grande no se disfrace de ganancia— y la geometría del
   gráfico: barras que se ensanchan cuando hay pocos meses y etiquetas que jamás pisan su barra. */
const { abrirApp, ir, crearMarcador } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp();
  await ir(pagina, "inicio", "home");

  // ── 1. el MOTOR mensual: encadenar los meses reproduce la curva completa y los pesos cuadran ──
  const t1 = await pagina.evaluate(() => {
    const mt = managedTotalSeries(), mr = homeMonthlyReturns(mt);
    const acum = mr.reduce((a, r) => a * (1 + r.pct / 100), 1) * 100;
    let flujos = 0; for (let k = 1; k < mt.dates.length; k++) flujos += (mt.flows && mt.flows[k]) || 0;
    const clp = mr.reduce((a, r) => a + r.clp, 0);
    const gTotal = mt.totals[mt.totals.length - 1] - mt.totals[0] - flujos;
    return { meses: mr.length, encadena: Math.abs(acum - mt.ret100[mt.ret100.length - 1]) < 0.05, cuadran: Math.abs(clp - gTotal) < 0.5, clp: Math.round(clp), gTotal: Math.round(gTotal) };
  });
  M.ok("1-MOTOR-MENSUAL-CUADRA", t1.meses > 1 && t1.encadena && t1.cuadran, t1);

  // ── 2. un APORTE grande a mitad de mes NO se disfraza de ganancia (oráculo a mano) ──
  const t2 = await pagina.evaluate(() => {
    const f3 = 0.90 / (0.95 * 0.98);   // el mercado cae exactamente −10% en el mes
    const mt = { dates: ["2026-03-02", "2026-03-10", "2026-03-20", "2026-03-31"], totals: [1000000, 950000, 1431000, 1431000 * f3], flows: [1000000, 0, 500000, 0], feesD: [0, 0, 0, 0] };
    const m = homeMonthlyReturns(mt)[0];
    const ingenua = ((mt.totals[3] - 500000) / mt.totals[0] - 1) * 100;
    // y un paso que cruza de mes pertenece al mes que RECIBE el cierre
    const m2 = homeMonthlyReturns({ dates: ["2026-04-28", "2026-05-05"], totals: [1000000, 1030000], flows: [1000000, 0], feesD: [0, 0] });
    return { pct: +m.pct.toFixed(6), ingenua: +ingenua.toFixed(2), ap: m.ap, cruce: m2.length === 1 && m2[0].key === "2026-05" && Math.abs(m2[0].pct - 3) < 1e-9 };
  });
  M.ok("2-APORTE-NO-CONTAMINA-EL-RESULTADO", Math.abs(t2.pct + 10) < 1e-6 && t2.ap === 500000 && t2.cruce, t2);

  // ── 3. CUATRO pestañas y cada una con sus propios tiles ──
  const t3 = await pagina.evaluate(async () => {
    const card = () => Array.from(document.querySelectorAll("#main .card")).find(c => /Resultados, operaciones y comisiones/.test((c.querySelector(".hd .ct") || {}).textContent || ""));
    const seg = card().querySelectorAll("[data-opsview]").length;
    const porVista = {};
    for (const v of ["resultados", "neto", "operaciones", "comisiones"]) {
      homeOpsView = v; render();
      porVista[v] = Array.from(card().querySelectorAll(".tile .l")).map(e => e.textContent.trim());
    }
    homeOpsView = "resultados"; render();
    return { seg, porVista };
  });
  const esperados = {
    resultados: "Resultado,Mejor mes,Peor mes,Meses al alza",
    neto: "Neto total,Resultado,Dividendos,Comisiones",
    operaciones: "Operaciones,Comprado,Rescatado,Neto invertido",
    comisiones: "Comisiones,Costo medio,Mes más caro,Por operación"
  };
  M.ok("3-CADA-PESTANA-MUESTRA-LO-SUYO",
    t3.seg === 4 && Object.keys(esperados).every(k => t3.porVista[k].join(",") === esperados[k]), t3.porVista);

  // ── 4. el NETO es resultado + dividendos − comisiones, mes a mes y en el total ──
  const t4 = await pagina.evaluate(() => {
    homeOpsView = "neto"; render(); attachOpsHover("mgops");
    const g = window.__ob_mgops, mr = homeMonthlyReturns(managedTotalSeries()), os = homeOpsSeries();
    const difs = [];
    mr.forEach(r => {
      const i = g.mks.indexOf(r.key); if (i < 0) return difs.push("falta " + r.key);
      const esp = +(r.clp + (g.rows[i].div || 0) - (g.rows[i].fee || 0)).toFixed(2);
      if (Math.abs(g.neto[i] - esp) > 0.01) difs.push(r.key + " " + g.neto[i] + "≠" + esp);
    });
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => /Resultados, operaciones/.test((c.querySelector(".hd .ct") || {}).textContent || ""));
    const tile = {}; card.querySelectorAll(".tile").forEach(t => { tile[t.querySelector(".l").textContent.trim()] = t.querySelector(".v").textContent.trim(); });
    const tot = mr.reduce((a, r) => a + r.clp, 0) + os.tDiv - os.tFee;
    const esp = (tot >= 0 ? "+" : "−") + fmtCLP(Math.abs(tot));
    if (tile["Neto total"] !== esp) difs.push("tile «" + tile["Neto total"] + "»≠«" + esp + "»");
    return { difs, netoTotal: tile["Neto total"] };
  });
  M.ok("4-NETO-CUADRA-CON-SU-DEFINICION", t4.difs.length === 0, t4);

  // ── 5. GEOMETRÍA: barras anchas con pocos meses y ninguna etiqueta encima de su barra ──
  const t5 = await pagina.evaluate(() => {
    homeOpsView = "resultados"; render();
    const svg = document.querySelector("#mgops"), g = window.__ob_mgops;
    const barras = Array.from(svg.querySelectorAll("[data-mr]"));
    const anchoEsp = Math.min(90, g.step * 0.5);
    const etiquetas = Array.from(svg.querySelectorAll("text[stroke]"));
    const difs = [];
    barras.forEach(b => {
      const bb = b.getBBox();
      if (bb.width < anchoEsp - 1.5) difs.push("barra angosta " + Math.round(bb.width));
      const cx = bb.x + bb.width / 2;
      const t = etiquetas.find(e => Math.abs(+e.getAttribute("x") - cx) < 1.5);
      if (t) { const tb = t.getBBox(); if (!(tb.y + tb.height <= bb.y + 0.6 || tb.y >= bb.y + bb.height - 0.6)) difs.push("etiqueta pisa su barra: " + t.textContent); }
    });
    return { difs, barras: barras.length, anchoEsp: Math.round(anchoEsp) };
  });
  M.ok("5-BARRAS-ANCHAS-Y-ETIQUETAS-LIBRES", t5.difs.length === 0 && t5.barras > 0, t5);

  M.ok("6-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
