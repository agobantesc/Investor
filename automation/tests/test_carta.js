/* test_carta.js — INFORME DE RECOMENDACIÓN.
   Fija el contrato del documento que va a manos de un cliente: tres secciones (Desempeño, Fundamentos,
   Veredicto) y NADA de glosario (se retiró a pedido), cifras exactas al motor y coherencia del veredicto
   con su propia regla (score mínimo, margen de seguridad y precio de compra). */
const { abrirApp, crearMarcador } = require("./_harness");

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp();

  // el informe se genera en una ventana nueva: se captura su HTML sin abrir nada
  const doc = await pagina.evaluate(() => {
    let html = "";
    const _o = window.open;
    window.open = () => ({ document: { write: h => { html = h; }, close: () => {} }, focus: () => {} });
    try { genCartaReco(); } catch (e) { return { err: String(e.message || e) }; }
    window.open = _o;
    const D = cartaRecoData();
    return { html, n: D ? D.top.length : 0, comprar: D ? D.comprar.length : 0 };
  });
  M.ok("1-EL-INFORME-SE-EMITE", !doc.err && doc.html && doc.html.length > 2000, { err: doc.err, bytes: doc.html ? doc.html.length : 0, top: doc.n });

  // ── 2. TRES secciones y ni rastro del glosario ──
  const t2 = await pagina.evaluate(h => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const titulos = Array.from(d.querySelectorAll(".ct-block .ct-h, .ct-block h2, .ct-bt")).map(x => x.textContent.trim());
    const txt = d.body.innerText || d.body.textContent || "";
    return {
      titulos: titulos.slice(0, 8),
      diceGlosario: /glosario/i.test(txt),
      hayGloHTML: !!d.querySelector(".ct-glo,.ct-g"),
      secciones: (h.match(/class="ct-block/g) || []).length,
      // las tres preguntas del informe siguen presentes
      des: /Desempe[ñn]o/i.test(txt), fund: /Fundamentos/i.test(txt), ver: /Veredicto/i.test(txt)
    };
  }, doc.html);
  M.ok("2-SIN-GLOSARIO-Y-CON-LAS-TRES-SECCIONES",
    !t2.diceGlosario && !t2.hayGloHTML && t2.secciones === 3 && t2.des && t2.fund && t2.ver, t2);

  // ── 3. las cifras salen del MOTOR (no se recalculan en el documento) ──
  const t3 = await pagina.evaluate(() => {
    const D = cartaRecoData(), sc = investorScore();
    const difs = [];
    D.top.forEach(x => {
      const f = sc.rows.find(z => z.t === x.r.t);
      if (!f) { difs.push(x.r.t + " sin fila de score"); return; }
      if (f.sig !== x.r.sig || f.beta !== x.r.beta || f.sharpe !== x.r.sharpe) difs.push(x.r.t + " riesgo distinto del score");
      // el margen se deriva del par precio/valor que el informe exhibe
      if (x.px > 0 && x.val > 0 && Math.abs(x.mos - (1 - x.px / x.val)) > 1e-9) difs.push(x.r.t + " margen incoherente");
    });
    return { difs, n: D.top.length };
  });
  M.ok("3-LAS-CIFRAS-SALEN-DEL-MOTOR", t3.difs.length === 0 && t3.n === 10, t3);

  // ── 4. el VEREDICTO cumple su propia regla y el sobreprecio nunca sale negativo ──
  const t4 = await pagina.evaluate(() => {
    const D = cartaRecoData();
    const malas = [];
    D.comprar.forEach(x => { if (!(x.r.score >= CARTA_SCORE_MIN && x.mos > 0)) malas.push("recomendada sin cumplir regla: " + x.r.t); });
    D.noComprar.forEach(x => {
      if (!x.motivo) malas.push("descartada sin motivo: " + x.r.t);
      const m = /cuesta (-?[\d.,]+)% más/.exec(x.motivo || "");
      if (m) {
        const dicho = +m[1].replace(".", "").replace(",", ".");
        if (!(dicho > 0)) malas.push("sobreprecio negativo: " + x.r.t + " → " + dicho);
        const real = (x.px / x.val - 1) * 100;
        if (Math.abs(dicho - real) > 1) malas.push("sobreprecio descuadrado: " + x.r.t);
      }
    });
    return { malas, comprar: D.comprar.length, no: D.noComprar.length };
  });
  M.ok("4-VEREDICTO-COHERENTE-CON-SU-REGLA", t4.malas.length === 0, t4);

  // ── 5. el documento no lleva controles de interfaz ni cifras rotas ──
  const t5 = await pagina.evaluate(h => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const txt = d.body.innerText || d.body.textContent || "";
    return {
      controles: d.querySelectorAll("button,select,input").length,
      rotos: (txt.match(/NaN|undefined|\[object/g) || []).slice(0, 4),
      iso: (txt.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).slice(0, 4),
      puntoPct: (txt.match(/\d+\.\d+\s*%/g) || []).slice(0, 4)
    };
  }, doc.html);
  M.ok("5-DOCUMENTO-LIMPIO", t5.controles === 0 && !t5.rotos.length && !t5.iso.length && !t5.puntoPct.length, t5);

  M.ok("6-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
