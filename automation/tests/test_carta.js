/* test_carta.js — INFORME DE RECOMENDACIÓN.
   Fija el contrato del documento que va a manos de un cliente: tres secciones (Ranking de inversión,
   Fundamentos, Veredicto) y NADA de glosario (se retiró a pedido), cifras exactas al motor y coherencia
   del veredicto con su propia regla (score mínimo, margen de seguridad y precio de compra).
   Desde la ronda del ÍNDICE DE INVERSIÓN fija además que el informe se ordena por ese índice —calidad del
   negocio + precio de hoy— y no por el Investor Score a secas: el orden tiene que MOVERSE con el precio,
   que era justamente el reclamo ("siempre elige las mismas acciones"). */
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
      des: /Ranking de inversi[óo]n/i.test(txt), fund: /Fundamentos/i.test(txt), ver: /Veredicto/i.test(txt)
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

  // ── 6. la TABLA 1 es el ranking: ordenada por el índice, con las dos mitades a la vista ──
  const t6 = await pagina.evaluate(h => {
    const d = new DOMParser().parseFromString(h, "text/html");
    const tab = d.querySelector(".ct-tab");
    const cab = Array.from(tab.querySelectorAll("thead th")).map(x => x.textContent.trim());
    const filas = Array.from(tab.querySelectorAll("tbody tr")).map(tr => {
      const c = tr.querySelectorAll("td");
      return { t: c[1].textContent.trim(), ix: +c[2].textContent.trim(), cal: +c[3].textContent.trim() };
    });
    const D = cartaRecoData();
    const difs = [];
    if (filas.length !== D.top.length) difs.push("filas " + filas.length + "≠" + D.top.length);
    filas.forEach((f, i) => {
      const e = D.top[i]; if (!e) return;
      if (f.t !== e.r.t) difs.push("orden " + (i + 1) + ": " + f.t + "≠" + e.r.t);
      if (f.ix !== e.rank) difs.push(f.t + " índice " + f.ix + "≠" + e.rank);
      if (f.cal !== e.r.score) difs.push(f.t + " calidad " + f.cal + "≠" + e.r.score);
      if (i && f.ix > filas[i - 1].ix) difs.push("índice desordenado en " + f.t);
    });
    return { difs, cab, primeras: filas.slice(0, 3) };
  }, doc.html);
  M.ok("6-TABLA-1-ORDENADA-POR-EL-INDICE",
    t6.difs.length === 0 && /[ÍI]ndice/.test(t6.cab[2] || "") && /Calidad/.test(t6.cab[3] || "") && /Precio/.test(t6.cab[4] || ""), t6);

  // ── 7. el PRECIO entra en escala ABSOLUTA (+30% ⇒ 100 · a valor justo ⇒ 50 · −30% ⇒ 0) y el índice
  //      es exactamente la mezcla del enfoque; sin valorización triangulada, el precio no puntúa ──
  const t7 = await pagina.evaluate(() => {
    const anclas = [[0.3, 100], [0.15, 75], [0, 50], [-0.15, 25], [-0.3, 0], [-1.5, 0], [2, 100]]
      .filter(([m, e]) => cartaPrecioScore(m) !== e).map(([m]) => m);
    const D = cartaRecoData(), E = D.enfoqueDef, malas = [];
    D.todas.forEach(x => {
      if (x.r.ivN < 2 && x.qPre != null) malas.push(x.r.t + ": precio sin triangular puntúa igual");
      if (x.qPre != null && x.qPre !== cartaPrecioScore(x.mos)) malas.push(x.r.t + ": precio fuera de escala");
      const esp = Math.round(x.r.score * E.cal + (x.qPre == null ? 50 : x.qPre) * E.pre);
      if (x.rank !== esp) malas.push(x.r.t + ": índice " + x.rank + "≠" + esp);
    });
    return { anclas, malas: malas.slice(0, 5), enfoque: D.enfoque, pesos: [E.cal, E.pre] };
  });
  M.ok("7-EL-PRECIO-PESA-EN-ESCALA-ABSOLUTA", t7.anclas.length === 0 && t7.malas.length === 0, t7);

  // ── 8. el ENFOQUE manda: cambiarlo reordena el informe (esto es lo que lo saca de la inmovilidad) ──
  const t8 = await pagina.evaluate(() => {
    const previo = cartaEnfoque;
    const orden = k => { cartaEnfoque = k; return cartaRecoData().top.map(x => x.r.t); };
    const cal = orden("calidad"), opo = orden("oportunidad"), eq = orden("equilibrado");
    cartaEnfoque = previo;
    const sc = investorScore().rows.slice(0, 10).map(r => r.t);
    const comunes = (a, b) => a.filter(t => b.indexOf(t) >= 0).length;
    return {
      cambia: cal.join() !== opo.join(),
      // el enfoque de calidad se pega al Investor Score; el de oportunidad se despega de él
      calPegado: comunes(cal, sc) >= comunes(opo, sc),
      rotaVsScore: comunes(opo, sc) < 10 || opo.join() !== sc.join(),
      cal: cal.slice(0, 4), opo: opo.slice(0, 4), eq: eq.slice(0, 4), score: sc.slice(0, 4)
    };
  });
  M.ok("8-EL-ENFOQUE-REORDENA-EL-INFORME", t8.cambia && t8.calPegado && t8.rotaVsScore, t8);

  // ── 9. el selector del enfoque está en el Home, junto al botón que genera el informe ──
  const t9 = await pagina.evaluate(() => {
    modulo = "inicio"; page = "home"; render();
    const btns = Array.from(document.querySelectorAll("[data-cartaenf]"));
    const antes = cartaEnfoque;
    const otro = btns.map(b => b.dataset.cartaenf).find(k => k !== antes);
    btns.find(b => b.dataset.cartaenf === otro).click();
    const guardado = cartaEnfoque, persistido = lsGet("inv_carta_enfoque");
    const marcado = Array.from(document.querySelectorAll("[data-cartaenf]")).filter(b => b.classList.contains("on")).map(b => b.dataset.cartaenf);
    // se deja como estaba: las demás rondas no heredan el cambio
    document.querySelector('[data-cartaenf="' + antes + '"]').click();
    return {
      n: btns.length, juntoAlBoton: !!(btns[0] && btns[0].closest(".isc-head") && document.querySelector(".isc-head [data-cartareco]")),
      cambia: guardado === otro, persiste: persistido === otro, marcado, vuelve: cartaEnfoque === antes
    };
  });
  M.ok("9-EL-ENFOQUE-SE-ELIGE-Y-SE-GUARDA",
    t9.n === 3 && t9.juntoAlBoton && t9.cambia && t9.persiste && t9.marcado.length === 1 && t9.vuelve, t9);

  M.ok("10-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
