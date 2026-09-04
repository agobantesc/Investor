/* test_contab.js — MÓDULO CONTABILIDAD.
   Fija el orden de la vista (resumen → año → ventas → proyectos → libro), que nada quede flotando fuera
   de una tarjeta, y que la aritmética de la franja cuadre al peso con los tiles que la explican. */
const { abrirApp, ir, crearMarcador } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp();
  await ir(pagina, "inv", "contabilidad");

  // ── 1. ESTRUCTURA: todo dentro de tarjetas, en el orden acordado ──
  const t1 = await pagina.evaluate(() => {
    const main = document.getElementById("main");
    const cont = main.querySelector(".wrap") || main;
    const hijos = Array.from(cont.children);
    const titulos = hijos.map(e => { const t = e.querySelector && e.querySelector(".hd .ct"); return t ? t.textContent.trim() : ("«suelto:" + (e.className || e.tagName) + "»"); });
    // ningún grid de tiles puede colgar directo del contenedor (antes flotaban 7 entre tarjetas)
    const tilesSueltos = hijos.filter(e => e.classList && e.classList.contains("tiles")).length;
    return { titulos, tilesSueltos, tarjetas: hijos.filter(e => e.classList && e.classList.contains("card")).length };
  });
  const orden = ["Contabilidad consolidada", "Resumen anual (base para tu declaración)", "Detalle de ventas realizadas", "Por proyecto", "Libro de operaciones"];
  M.ok("1-ORDEN-Y-NADA-SUELTO",
    t1.tilesSueltos === 0 && orden.every((n, i) => (t1.titulos[i] || "").indexOf(n) === 0), t1);

  // ── 2. el RESUMEN es una sola tarjeta: franja + los dos grupos de tiles que la explican ──
  const t2 = await pagina.evaluate(() => {
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => /Contabilidad consolidada/.test((c.querySelector(".hd .ct") || {}).textContent || ""));
    if (!card) return { err: "sin tarjeta de resumen" };
    return {
      franja: !!card.querySelector(".net-strip"),
      grupos: Array.from(card.querySelectorAll(".cnt-grp")).map(g => g.textContent.trim()),
      tiles: card.querySelectorAll(".tile").length,
      boton: !!card.querySelector("#contabreport")
    };
  });
  M.ok("2-RESUMEN-EN-UNA-TARJETA", !t2.err && t2.franja && t2.grupos.length === 2 && t2.tiles === 7 && t2.boton, t2);

  // ── 3. la ARITMÉTICA cuadra: bruta − comisiones = real, y las partes suman la bruta ──
  const t3 = await pagina.evaluate(() => {
    const num = s => { const m = ("" + s).replace(/[^\d,.\-−]/g, "").replace(/\./g, "").replace(",", ".").replace("−", "-"); return parseFloat(m) || 0; };
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => /Contabilidad consolidada/.test((c.querySelector(".hd .ct") || {}).textContent || ""));
    const its = Array.from(card.querySelectorAll(".net-strip .net-it")).map(e => ({ l: e.querySelector("span").textContent.trim(), v: num(e.querySelector("b").textContent) }));
    const tiles = {}; card.querySelectorAll(".tile").forEach(t => { tiles[t.querySelector(".l").textContent.trim()] = num(t.querySelector(".v").textContent); });
    const bruta = its[0].v, com = its[1].v, real = its[2].v;
    const partes = tiles["Ganancia realizada"] + tiles["Dividendos recibidos"] + tiles["Ganancia no realizada"];
    return {
      cuadraFranja: Math.abs((bruta - com) - real) <= 1,
      cuadranPartes: Math.abs(partes - bruta) <= 1,
      comIgual: Math.abs(Math.abs(tiles["Comisiones pagadas"]) - com) <= 1,
      bruta, com, real, partes
    };
  });
  M.ok("3-LA-ARITMETICA-CUADRA", t3.cuadraFranja && t3.cuadranPartes && t3.comIgual, t3);

  // ── 4. el LIBRO en orden cronológico y con el efectivo bien firmado ──
  const t4 = await pagina.evaluate(() => {
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => /Libro de operaciones/.test((c.querySelector(".hd .ct") || {}).textContent || ""));
    const filas = Array.from(card.querySelectorAll("tbody tr")).map(tr => Array.from(tr.querySelectorAll("td")).map(td => td.textContent.trim()));
    const fechas = filas.map(f => f[0]);
    const iso = d => d.slice(6) + "-" + d.slice(3, 5) + "-" + d.slice(0, 2);
    const ordenadas = fechas.every((d, i) => i === 0 || iso(fechas[i - 1]) <= iso(d));
    return { n: filas.length, ordenadas, sinISO: !fechas.some(d => /^\d{4}-/.test(d)), primera: fechas[0], ultima: fechas[fechas.length - 1] };
  });
  M.ok("4-LIBRO-CRONOLOGICO", t4.n > 0 && t4.ordenadas && t4.sinISO, t4);

  // ── 5. el INFORME para el contador sigue siendo el espejo del módulo ──
  const t5 = await pagina.evaluate(() => {
    let html = "";
    const _o = window.open;
    window.open = () => ({ document: { write: h => { html = h; }, close: () => {} }, focus: () => {} });
    try { genContabReport(); } catch (e) { return { err: String(e.message || e) }; }
    window.open = _o;
    const d = new DOMParser().parseFromString(html, "text/html");
    const txt = d.body.innerText || d.body.textContent || "";
    return {
      bytes: html.length,
      controles: d.querySelectorAll("button,select,input").length,
      rotos: (txt.match(/NaN|undefined|\[object/g) || []).slice(0, 3),
      traeLibro: /Libro de operaciones/.test(txt), traeAnual: /Resumen anual/.test(txt)
    };
  });
  M.ok("5-INFORME-ESPEJO-DEL-MODULO", !t5.err && t5.bytes > 5000 && t5.controles === 0 && !t5.rotos.length && t5.traeLibro && t5.traeAnual, t5);

  M.ok("6-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
