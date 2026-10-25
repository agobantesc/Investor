/* test_bot_borrar.js — EL DETECTOR DE DÍAS CORRUPTOS DEL BOT, SOBRE DÍAS REALES DE LA BASE.
   La auditoría encontró que "pico y vuelta" no miraba si el mercado estaba tranquilo (en un pánico con rebote
   borraba los cierres REALES del peor día), que borraba lo que el consenso WSJ+Yahoo-60m acababa de confirmar
   (para siempre, en cada corrida) y que la orden `borrar` vivía hasta la corrida siguiente. Se prueba la lógica
   pura (automation/dias-corruptos.mjs) con tres días reales consecutivos del closes.json del repo, alterados
   solo en lo que cada caso necesita. */
const { readFileSync } = require("fs");
const path = require("path");
const { crearMarcador } = require("./_harness");
const CL = JSON.parse(readFileSync(path.join(__dirname, "../../data/closes.json"), "utf8"));

(async () => {
  const M = crearMarcador();
  const { depurarDiasCorruptos, BORRAR_VIGENCIA_DIAS } = await import(path.join(__dirname, "../dias-corruptos.mjs"));
  const copia = x => JSON.parse(JSON.stringify(x));
  const conPx = CL.days.filter(d => Object.keys(d.prices || {}).length >= 20);
  // tres días reales seguidos con el mercado tranquilo (mediana de la canasta < 1% en ambos tramos)
  const med = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  let k0 = -1;
  for (let k = conPx.length - 40; k > 1; k--) {
    const [a, b, c] = [conPx[k - 1], conPx[k], conPx[k + 1]].map(d => d.prices);
    const r1 = Object.keys(b).filter(t => a[t] > 0).map(t => b[t] / a[t] - 1), r2 = Object.keys(b).filter(t => c[t] > 0).map(t => c[t] / b[t] - 1);
    if (Math.abs(med(r1)) < 0.01 && Math.abs(med(r2)) < 0.01) { k0 = k; break; }
  }
  const tres = () => copia([conPx[k0 - 1], conPx[k0], conPx[k0 + 1]]);
  const B = conPx[k0].date, tks = Object.keys(conPx[k0].prices).filter(t => conPx[k0 - 1].prices[t] > 0 && conPx[k0 + 1].prices[t] > 0);
  const nueve = tks.slice(0, 9), otros = tks.slice(9, 12);
  const foto = ds => { nueve.forEach((t, i) => { ds[1].prices[t] = +(ds[1].prices[t] * (i % 2 ? 0.87 : 1.13)).toFixed(2); }); return ds; };   // foto mala: 9 acciones ±13% y vuelta
  const hoy = new Date().toISOString().slice(0, 10), haceDias = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  // ── 1. una foto mala del upstream con el mercado tranquilo: el día se descarta ──
  const r1 = depurarDiasCorruptos(foto(tres()), { hoy });
  const d1 = r1.days.find(d => d.date === B);
  M.ok("1-FOTO-MALA-SE-DESCARTA", !!r1.borrar[B] && (!d1 || Object.keys(d1.prices).length === 0) && r1.borrarDesde[B] === hoy, { dia: B, borrar: r1.borrar, quedan: d1 ? Object.keys(d1.prices).length : 0 });

  // ── 2. pánico real con rebote (toda la canasta −6% y vuelta): rueda real, no se toca ──
  const p = tres(); Object.keys(p[1].prices).forEach(t => { p[1].prices[t] = +(p[1].prices[t] * 0.94).toFixed(2); });
  const r2 = depurarDiasCorruptos(p, { hoy }), d2 = r2.days.find(d => d.date === B);
  M.ok("2-PANICO-REAL-SE-CONSERVA", Object.keys(r2.borrar).length === 0 && d2 && Object.keys(d2.prices).length === Object.keys(conPx[k0].prices).length, { borrar: r2.borrar, precios: d2 && Object.keys(d2.prices).length });

  // ── 3. lo que el consenso confirma es real: no cuenta como "raro" ──
  const r3 = depurarDiasCorruptos(foto(tres()), { hoy, confirmado: (t, f) => f === B && nueve.includes(t) });
  M.ok("3-LO-CONFIRMADO-NO-SE-BORRA", Object.keys(r3.borrar).length === 0, { borrar: r3.borrar });

  // ── 4. en un día descartado, los cierres confirmados se quedan ──
  const r4 = depurarDiasCorruptos(foto(tres()), { hoy, confirmado: (t, f) => f === B && otros.includes(t) });
  const d4 = r4.days.find(d => d.date === B);
  M.ok("4-DIA-DESCARTADO-CONSERVA-LO-CONFIRMADO", !!r4.borrar[B] && d4 && Object.keys(d4.prices).sort().join() === otros.slice().sort().join(), { quedan: d4 && Object.keys(d4.prices) });

  // ── 5. herencia: vigente se queda con su fecha de alta; vencida o con el día de nuevo confirmado, se cierra ──
  const sinDia = "2026-09-01", conDia = conPx[k0 - 1].date;
  const prev = { [sinDia]: { modo: "precios", desde: haceDias(10) }, "2026-06-02": { modo: "todo", desde: haceDias(BORRAR_VIGENCIA_DIAS + 10) }, [conDia]: { modo: "todo", desde: haceDias(5) } };
  const base5 = tres().filter(d => d.date !== sinDia);
  const r5 = depurarDiasCorruptos(base5, { hoy, borrarPrev: prev });
  M.ok("5-LA-ORDEN-SE-HEREDA-Y-VENCE", r5.borrar[sinDia] === "precios" && r5.borrarDesde[sinDia] === haceDias(10) && !r5.borrar["2026-06-02"] && !r5.borrar[conDia],
    { borrar: r5.borrar, desde: r5.borrarDesde });

  // ── 6. la base real del repo no tiene días que el detector descarte ──
  const r6 = depurarDiasCorruptos(copia(CL.days), { hoy });
  M.ok("6-LA-BASE-REAL-QUEDA-INTACTA", Object.keys(r6.borrar).length === 0, { borrar: r6.borrar });

  process.exit(M.resumen() ? 1 : 0);
})().catch(e => { console.log("CRASH", e.message); process.exit(1); });
