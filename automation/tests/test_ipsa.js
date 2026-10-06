/* test_ipsa.js — EL IPSA DE LA BASE ES EL OFICIAL.
   En septiembre de 2026 la base mostró el IPSA en 10.581,62 el 29-09 cuando el cierre oficial fue 11.055,94
   (−4,3%): el 01-09-2026 la Bolsa de Santiago pasó a publicar el IPSA de MSCI y la serie de WSJ con que se
   encadenaba el índice siguió publicando otra cosa. Los valores mal encadenados quedaron guardados como si
   fueran reales. Esta ronda fija, sobre el archivo que produce el bot y sobre la app:
     · los cierres oficiales verificados están en la base, marcados como oficiales;
     · desde el cambio de proveedor, todo valor es OFICIAL o está marcado como ESTIMADO (nunca "real" a secas);
     · el índice sigue a la canasta de sus propias acciones (un despegue como el de septiembre salta aquí);
     · ningún día "pico y vuelta" (foto corrupta del upstream) sobrevive en la base;
     · la app borra de la base local los días que la fuente descarta. */
const { abrirApp, crearMarcador } = require("./_harness");
const { readFileSync } = require("fs");
const path = require("path");
const CL = JSON.parse(readFileSync(path.join(__dirname, "../../data/closes.json"), "utf8"));
const FU = JSON.parse(readFileSync(path.join(__dirname, "../../data/fundamentals.json"), "utf8")).byTicker || {};
const MSCI_DESDE = "2026-09-01";
// verificados en el runner el 30-09-2026 (Yahoo SPIPSA.SN último cierre S&P · MXIPSAGC.SN cierre anterior)
const OFICIALES = { "2026-08-31": 11315.26, "2026-09-29": 11055.94 };
// TradingView BCS:MXIPSAGC el 30-09-2026: mínimo y máximo del mes (incluye intradía)
const MIN_MES = 11038.39, MAX_MES = 11556.21;

(async () => {
  const M = crearMarcador();
  const dias = CL.days.filter(d => d && d.date);
  const porFecha = Object.fromEntries(dias.map(d => [d.date, d]));

  // ── 1. los cierres oficiales verificados están, con su valor exacto y su sello ──
  const t1 = Object.entries(OFICIALES).map(([f, v]) => ({ f, base: porFecha[f] && porFecha[f].ipsa, ofi: !!(porFecha[f] && porFecha[f].ipsaOfi), ok: !!(porFecha[f] && porFecha[f].ipsa === v && porFecha[f].ipsaOfi) }));
  M.ok("1-CIERRES-OFICIALES-EN-LA-BASE", t1.every(x => x.ok), t1);

  // ── 2. desde el cambio a MSCI todo valor es oficial o está marcado como estimado ──
  const tramo = dias.filter(d => d.date >= MSCI_DESDE && d.ipsa != null);
  const sinSello = tramo.filter(d => !d.ipsaOfi && !d.ipsaSynth).map(d => d.date);
  M.ok("2-TRAMO-MSCI-SIN-VALORES-HUERFANOS", tramo.length > 0 && sinSello.length === 0,
    { dias: tramo.length, oficiales: tramo.filter(d => d.ipsaOfi).length, estimados: tramo.filter(d => d.ipsaSynth).length, sinSello });

  // ── 3. septiembre dentro del rango oficial del mes (lo que el cliente vio en la Bolsa: nunca bajo 11.000) ──
  // hasta el 29-09: el rango se midió la MAÑANA del 30-09, antes de ese cierre (el 30-09 cerró en 10.969,49, oficial)
  const sep = dias.filter(d => d.date >= "2026-09-01" && d.date <= "2026-09-29" && d.ipsa != null).map(d => ({ f: d.date, v: d.ipsa }));
  const fuera = sep.filter(x => x.v < MIN_MES * 0.995 || x.v > MAX_MES * 1.005);   // ±0,5%: los intermedios son estimación
  M.ok("3-SEPTIEMBRE-EN-EL-RANGO-OFICIAL", sep.length >= 15 && fuera.length === 0,
    { n: sep.length, min: Math.min(...sep.map(x => x.v)), max: Math.max(...sep.map(x => x.v)), fuera });

  // ── 4. el índice sigue a la canasta de sus acciones: error de seguimiento diario acotado, mes a mes ──
  const sh = {}; for (const [t, f] of Object.entries(FU)) if (f && f.mcap > 0 && f.px > 0) sh[t] = f.mcap / f.px;
  const conAmbos = dias.filter(d => d.ipsa > 0 && Object.keys(d.prices || {}).length >= 20);
  const porMes = {};
  for (let i = 1; i < conAmbos.length; i++) {
    const a = conAmbos[i - 1], b = conAmbos[i];
    let x = 0, y = 0; for (const t in sh) if (a.prices[t] > 0 && b.prices[t] > 0) { x += sh[t] * b.prices[t]; y += sh[t] * a.prices[t]; }
    if (!(y > 0)) continue;
    (porMes[b.date.slice(0, 7)] ??= []).push((b.ipsa / a.ipsa - 1) - (x / y - 1));
  }
  const malos = Object.entries(porMes).filter(([, v]) => v.length >= 8).map(([m, v]) => {
    const mu = v.reduce((p, q) => p + q, 0) / v.length, sd = Math.sqrt(v.reduce((p, q) => p + (q - mu) ** 2, 0) / v.length);
    const brecha = v.reduce((p, q) => p * (1 + q), 1) - 1;
    return { m, sd: +(sd * 100).toFixed(2), brecha: +(brecha * 100).toFixed(2) };
  }).filter(x => x.sd > 0.5 || Math.abs(x.brecha) > 2.5);
  M.ok("4-EL-INDICE-SIGUE-A-SUS-ACCIONES", malos.length === 0, { mesesFuera: malos, meses: Object.keys(porMes).length });

  // ── 5. ningún día "pico y vuelta" sobrevive (≥5 acciones saltan >4% y lo devuelven al día siguiente) ──
  const cp = dias.filter(d => Object.keys(d.prices || {}).length >= 8);
  const corruptos = [];
  for (let k = 1; k < cp.length - 1; k++) {
    const a = cp[k - 1].prices, b = cp[k].prices, c = cp[k + 1].prices; let n = 0;
    for (const t in b) { if (!(a[t] > 0 && c[t] > 0)) continue; const r1 = b[t] / a[t] - 1, r2 = c[t] / b[t] - 1;
      if (Math.abs(r1) > 0.04 && Math.abs(r2) > 0.04 && Math.sign(r1) !== Math.sign(r2) && Math.abs(c[t] / a[t] - 1) < Math.abs(r1) / 2) n++; }
    if (n >= 5) corruptos.push(cp[k].date + " (" + n + ")");
  }
  M.ok("5-SIN-DIAS-CORRUPTOS", corruptos.length === 0, { corruptos, borrar: CL.borrar || null });

  // ── 6. la APP: muestra el último cierre de la base, avisa del cambio a MSCI y borra lo que la fuente descarta ──
  const { navegador, pagina, erroresPagina } = await abrirApp();
  const t6 = await pagina.evaluate(async D => {
    modulo = "inicio"; page = "home"; render();
    const card = Array.from(document.querySelectorAll("#main .card")).find(c => /IPSA · índice de referencia/.test((c.querySelector(".hd .ct") || {}).textContent || ""));
    const val = card ? ((card.querySelector(".ipsa-val") || {}).textContent || "") : "";
    const num = +val.replace(/[^\d,]/g, "").replace(",", ".");
    const ds = Object.keys(PRICEDB.ipsa).sort(), ult = ds[ds.length - 1];
    const sub = card ? ((card.querySelector(".hd .cs") || {}).textContent || "") : "";
    // borrado: se siembra un día corrupto en la base local y se sincroniza una fuente que lo descarta
    const f0 = "2026-09-01";
    PRICEDB.px.BCI = PRICEDB.px.BCI || {}; PRICEDB.px.BCI[f0] = 1; PRICEDB.ipsa[f0] = 1;
    const J = JSON.parse(JSON.stringify(D)); J.borrar = Object.assign({}, J.borrar || {}, { [f0]: "todo" });
    const _f = window.fetch; window.fetch = async () => ({ ok: true, json: async () => J });
    await autopxSync(false); window.fetch = _f;
    // el IPSA de ese día: si la fuente trae un OFICIAL, queda ese (el valor sembrado se va); si no, nada
    const dF = (D.days || []).find(x => x.date === f0), esperado = dF && dF.ipsa != null ? dF.ipsa : null;
    return { num, ult, baseUlt: PRICEDB.ipsa[ult], msci: /MSCI/.test(sub), quedoPx: PRICEDB.px.BCI[f0] != null,
      ipsaDia: PRICEDB.ipsa[f0] ?? null, esperado };
  }, CL);
  M.ok("6-APP-MUESTRA-EL-OFICIAL-Y-BORRA-LO-DESCARTADO",
    Math.abs(t6.num - t6.baseUlt) < 0.01 && t6.msci && !t6.quedoPx && t6.ipsaDia === t6.esperado, t6);

  M.ok("7-SIN-ERRORES-DE-PAGINA", erroresPagina.length === 0, erroresPagina.slice(0, 3));
  await navegador.close();
  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
