/* test_home_curva.js — CURVA "Rentabilidad neta en el tiempo" del Home.
   La curva no marcaba el cero (pasaba signBase:0 pero la línea de referencia seguía en 100, la base de las
   series base-100), así que no había forma de ver a simple vista cuándo se estuvo en pérdida. Esta ronda
   fija la línea del cero y el relleno partido por ella: verde por encima, ROJO por debajo. */
const { abrirApp, ir, crearMarcador } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp();
  await ir(pagina, "inicio", "home");

  // ── 1. la curva existe y su serie CRUZA el cero (si no, no habría nada que distinguir) ──
  const t1 = await pagina.evaluate(() => {
    const g = window.__mg_mgret;
    if (!g) return { err: "sin geometría de la curva" };
    const v = g.series[0].vals.filter(x => x != null && isFinite(x));
    return { n: v.length, min: Math.min(...v), max: Math.max(...v), cruza: Math.min(...v) < 0 && Math.max(...v) > 0 };
  });
  M.ok("1-LA-CURVA-CRUZA-EL-CERO", !t1.err && t1.cruza, t1);

  // ── 2. la LÍNEA DEL CERO se dibuja donde corresponde (y no en 100) ──
  const t2 = await pagina.evaluate(() => {
    const svg = document.getElementById("mgret");
    const g = window.__mg_mgret;
    // y del valor 0 según la propia geometría del gráfico (interpolando dos puntos conocidos)
    const vs = g.series[0].vals, ys = g.pys[0];
    let i0 = -1, i1 = -1;
    for (let i = 0; i < vs.length; i++) { if (vs[i] == null) continue; if (i0 < 0) i0 = i; else { i1 = i; if (vs[i] !== vs[i0]) break; } }
    const b = (ys[i1] - ys[i0]) / (vs[i1] - vs[i0]);
    const y0 = ys[i0] - vs[i0] * b;
    const lineas = Array.from(svg.querySelectorAll("line")).map(l => ({ y: +l.getAttribute("y1"), w: +(l.getAttribute("stroke-width") || 1) }));
    const cero = lineas.find(l => Math.abs(l.y - y0) < 1.2 && l.w >= 1.5);
    return { yCero: +y0.toFixed(1), hay: !!cero, ancho: cero ? cero.w : null };
  });
  M.ok("2-LINEA-DEL-CERO-EN-SU-LUGAR", t2.hay, t2);

  // ── 3. el RELLENO está partido por el cero: verde arriba, rojo abajo, recortados en la misma línea ──
  const t3 = await pagina.evaluate(() => {
    const svg = document.getElementById("mgret");
    const areas = Array.from(svg.querySelectorAll("path[clip-path]")).map(p => ({ fill: p.getAttribute("fill"), clip: p.getAttribute("clip-path") }));
    const rects = {};
    svg.querySelectorAll("clipPath").forEach(c => { const r = c.querySelector("rect"); rects[c.id] = { y: +r.getAttribute("y"), h: +r.getAttribute("height") }; });
    const verde = areas.find(a => a.fill === green), rojo = areas.find(a => a.fill === red);
    const idV = verde && verde.clip.replace(/[^#]*#|\)/g, ""), idR = rojo && rojo.clip.replace(/[^#]*#|\)/g, "");
    return {
      hayVerde: !!verde, hayRojo: !!rojo,
      // el recorte rojo empieza justo donde termina el verde: el color cambia EXACTAMENTE en el cero
      pegan: idV && idR ? Math.abs((rects[idV].y + rects[idV].h) - rects[idR].y) < 0.6 : false,
      rojoAbajo: idV && idR ? rects[idR].y > rects[idV].y : false,
      rojoConAlto: idR ? rects[idR].h > 2 : false
    };
  });
  M.ok("3-RELLENO-PARTIDO-POR-EL-CERO", t3.hayVerde && t3.hayRojo && t3.pegan && t3.rojoAbajo && t3.rojoConAlto, t3);

  // ── 4. el corte coincide con la línea del cero medida en el bloque 2 ──
  const t4 = await pagina.evaluate(yCero => {
    const svg = document.getElementById("mgret");
    const rojo = Array.from(svg.querySelectorAll("path[clip-path]")).find(p => p.getAttribute("fill") === red);
    const id = rojo.getAttribute("clip-path").replace(/[^#]*#|\)/g, "");
    const r = svg.querySelector("#" + CSS.escape(id) + " rect") || document.getElementById(id).querySelector("rect");
    return { corte: +r.getAttribute("y"), esperado: yCero };
  }, t2.yCero);
  M.ok("4-EL-COLOR-CAMBIA-EN-EL-CERO", Math.abs(t4.corte - t4.esperado) < 1.2, t4);

  // ── 5. el subtítulo lo explica (el color no se adivina) ──
  const t5 = await pagina.evaluate(() => {
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => /Rentabilidad neta en el tiempo/.test((c.querySelector(".hd .ct") || {}).textContent || ""));
    const sub = (card.querySelector(".hd .cs") || {}).textContent || "";
    return { explica: /rojo bajo ella/i.test(sub) && /verde sobre la l[íi]nea/i.test(sub), sub: sub.slice(0, 100) };
  });
  M.ok("5-EL-SUBTITULO-EXPLICA-EL-COLOR", t5.explica, t5);

  M.ok("6-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
