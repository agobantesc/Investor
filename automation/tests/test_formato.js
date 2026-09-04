/* test_formato.js — CALIDAD VISUAL MEDIDA, NO PROMETIDA.
   Barre las vistas de Investor leyendo el texto RENDERIZADO y fija cuatro invariantes de presentación:
   porcentajes con COMA decimal (como se escribe en Chile), ni un NaN/undefined a la vista, ninguna fecha
   en formato ISO y ningún campo de monto sin separador de miles. Cualquier formateador nuevo que imprima
   con punto, o un campo de plata sin formato, hace fallar esta ronda al día siguiente. */
const { abrirApp, crearMarcador } = require("./_harness");

const VISTAS = [
  ["inicio", "home"], ["inv", "seguimiento"], ["inv", "operar"], ["inv", "historial"], ["inv", "contabilidad"],
  ["eval", "crear"], ["eval", "comparativa"], ["eval", "capm"], ["eval", "multifactor"], ["eval", "fundamentos"], ["eval", "detalle"],
  ["montecarlo", "montecarlo"], ["markowitz", "markowitz"], ["sim", "sim"], ["sim", "cambios"], ["sim", "comparador"],
  ["activa", "activa"], ["perfil", "perfil"], ["datos", "base"], ["datos", "cargar"], ["datos", "cierre"],
  ["proyectos", "proyectos"], ["mercados", "panel"]
];

(async () => {
  const M = crearMarcador();
  const { navegador, pagina, erroresPagina } = await abrirApp();
  const acc = { pct: [], rotos: [], iso: [], montos: [], vistas: 0, err: [] };

  for (const [m, g] of VISTAS) {
    const r = await pagina.evaluate(([mm, gg]) => {
      modulo = mm; page = gg;
      try { render(); } catch (e) { return { err: mm + "/" + gg + ": " + e.message }; }
      const res = { pct: [], rotos: [], iso: [], montos: [] };
      // campos donde se ingresa PLATA: deben llevar separador de miles (data-mnt los formatea)
      document.querySelectorAll("#main input").forEach(inp => {
        if (["date", "checkbox", "radio", "password", "color", "file"].indexOf(inp.type) >= 0) return;
        if (inp.dataset.mnt != null) return;
        const et = ((inp.closest("label") || {}).textContent || "") + " " + (inp.placeholder || "") + " " + (inp.id || "");
        const esMonto = /monto|capital|aporte|precio|amount|CLP|\$|patrimonio|caja|invertir/i.test(et)
          && !/%|años|acciones|cantidad|β|beta|tasa|prima|yield|día|meses|url|key|token/i.test(et);
        if (esMonto) res.montos.push({ v: mm + "/" + gg, id: inp.id || "(sin id)", et: et.trim().replace(/\s+/g, " ").slice(0, 50) });
      });
      // texto renderizado, nodo por nodo (textContent pega números vecinos y genera falsos positivos)
      const ver = n => {
        if (n.nodeType === 3) {
          const t = n.textContent;
          const p = t.match(/-?\d+\.\d+\s*%/g);
          if (p) p.slice(0, 2).forEach(x => res.pct.push({ v: mm + "/" + gg, txt: x, ctx: t.trim().replace(/\s+/g, " ").slice(0, 60) }));
          if (/NaN|undefined|\[object/.test(t)) res.rotos.push({ v: mm + "/" + gg, txt: t.trim().slice(0, 60) });
          if (/\b\d{4}-\d{2}-\d{2}\b/.test(t) && !/T\d{2}:/.test(t)) res.iso.push({ v: mm + "/" + gg, txt: t.trim().slice(0, 60) });
        } else if (n.nodeType === 1 && !/SCRIPT|STYLE|INPUT|TEXTAREA/.test(n.tagName)) Array.from(n.childNodes).forEach(ver);
      };
      ver(document.getElementById("main"));
      return res;
    }, [m, g]);
    if (r.err) { acc.err.push(r.err); continue; }
    acc.vistas++;
    ["pct", "rotos", "iso", "montos"].forEach(k => acc[k].push(...r[k]));
  }

  const uniq = a => { const v = new Set(), o = []; a.forEach(x => { const k = JSON.stringify(x); if (!v.has(k)) { v.add(k); o.push(x); } }); return o; };
  const P = uniq(acc.pct), R = uniq(acc.rotos), I = uniq(acc.iso), Mo = uniq(acc.montos);

  M.ok("1-VISTAS-QUE-RENDERIZAN", acc.err.length === 0 && acc.vistas === VISTAS.length, { vistas: acc.vistas, err: acc.err.slice(0, 3) });
  M.ok("2-PORCENTAJES-CON-COMA", P.length === 0, P.slice(0, 6));
  M.ok("3-SIN-NAN-NI-UNDEFINED", R.length === 0, R.slice(0, 6));
  M.ok("4-SIN-FECHAS-ISO-VISIBLES", I.length === 0, I.slice(0, 6));
  M.ok("5-MONTOS-CON-FORMATO", Mo.length === 0, Mo.slice(0, 6));
  // ── 7. las TABLAS LARGAS ganan scroll propio con cabecera fija; las cortas no se tocan ──
  const t7 = await pagina.evaluate(() => {
    const out = {};
    for (const [m, g] of [["inv", "historial"], ["inv", "contabilidad"]]) {
      modulo = m; page = g; render();
      out[g] = Array.from(document.querySelectorAll("#main .tw")).map(t => ({
        alta: t.classList.contains("tw-alta"),
        scrollea: t.scrollHeight > t.clientHeight + 2,
        fija: t.querySelector("thead th") ? getComputedStyle(t.querySelector("thead th")).position === "sticky" : null
      }));
    }
    return out;
  });
  const larga = t7.historial[0], cortas = t7.contabilidad.filter(x => !x.alta);
  M.ok("7-TABLAS-LARGAS-CON-CABECERA-FIJA",
    larga && larga.alta && larga.scrollea && larga.fija === true && cortas.length > 0 && cortas.every(x => !x.scrollea && x.fija !== "sticky"), t7);

  M.ok("6-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));

  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
