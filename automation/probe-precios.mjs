#!/usr/bin/env node
/**
 * probe-precios.mjs — SONDA de fuentes ALTERNATIVAS de cierres de acciones, para correr en el runner.
 * No escribe nada. Para cada acción del universo compara contra la base (data/closes.json):
 *   A) Yahoo diario (period1/period2) — la fuente actual, ¿corrigió los días malos?
 *   B) Yahoo INTRADÍA 60m — el cierre del día = el último precio de la sesión (fuente independiente
 *      de la barra diaria, que es justo la que trajo los días corruptos)
 *   C) WSJ/MarketWatch michelangelo — serie diaria de la acción
 * Mide cuánto calza cada fuente con la base en días NORMALES (para saber si es confiable) y muestra lo
 * que cada una dice para los días SIN dato. Con eso se decide qué promover a fetch-closes.mjs.
 */
import { readFileSync } from "node:fs";
import { TICKERS } from "./tickers.mjs";
const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DESDE = "2026-07-01";
const base = JSON.parse(readFileSync("data/closes.json", "utf8")).days.filter(d => d.date >= DESDE);
const nAcc = Math.max(...base.map(d => Object.keys(d.prices).length));
const HUECOS = base.filter(d => Object.keys(d.prices).length < nAcc).map(d => d.date);
const BX = Object.fromEntries(base.map(d => [d.date, d.prices]));
const stgo = t => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

async function yahoo(sym, interval) {
  const p1 = Math.floor(Date.parse(DESDE + "T00:00:00Z") / 1000) - 86400, p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=${interval}&includePrePost=false`, { headers: { "User-Agent": BUA } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const x = (await r.json())?.chart?.result?.[0];
  const ts = x?.timestamp || [], c = x?.indicators?.quote?.[0]?.close || [], v = x?.indicators?.quote?.[0]?.volume || [];
  const out = {}, vol = {};
  ts.forEach((t, i) => { if (c[i] > 0) { const d = stgo(t); out[d] = +c[i].toFixed(4); vol[d] = (vol[d] || 0) + (v[i] || 0); } });   // intradía: el último de la sesión pisa a los anteriores
  return { out, vol };
}
async function wsj(code) {
  const ET = "cecc4267a0194af89ca343805a3e57af";
  const body = { Step: "P1D", TimeFrame: "P6M", EntitlementToken: ET, IncludeMockTick: false, FilterNullSlots: false, FilterClosedPoints: true, IncludeClosedSlots: false, IncludeOfficialClose: true, InjectOpen: false, ShowPreMarket: false, ShowAfterHours: false, UseExtendedTimeFrame: true, WantPriorClose: false, IncludeCurrentQuotes: false, ResetTodaysAfterHoursPercentChange: false, Series: [{ Key: "STOCK/CL/XSGO/" + code, Dialect: "Charting", Kind: "Ticker", SeriesId: "s1", DataTypes: ["Last"] }] };
  const r = await fetch(`https://api.wsj.net/api/michelangelo/timeseries/history?json=${encodeURIComponent(JSON.stringify(body))}&ckey=${ET.slice(0, 10)}`, { headers: { "User-Agent": BUA, Accept: "application/json", "Dylan2010.EntitlementToken": ET, Origin: "https://www.marketwatch.com", Referer: "https://www.marketwatch.com/" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json(); const ticks = j?.TimeInfo?.Ticks || [], pts = j?.Series?.[0]?.DataPoints || [];
  const out = {}; ticks.forEach((t, i) => { const v = pts[i] && +pts[i][0]; if (v > 0) out[new Date(+t).toISOString().slice(0, 10)] = v; });
  if (!Object.keys(out).length) throw new Error("sin puntos");
  return { out };
}
// careo: en días con dato en la base, ¿cuántos calzan dentro de 0,15%?
function careo(src) {
  let n = 0, ok = 0; const malos = [];
  return (t) => {
    for (const d of Object.keys(src).sort()) { const b = BX[d] && BX[d][t]; if (!(b > 0)) continue; n++; if (Math.abs(src[d] / b - 1) <= 0.0015) ok++; else if (malos.length < 3) malos.push(`${d}: ${src[d]} vs ${b}`); }
    return { n, ok, pct: n ? +(ok / n * 100).toFixed(1) : null, malos };
  };
}
console.log(`SONDA PRECIOS · ${new Date().toISOString()} · ${nAcc} acciones · días con faltantes desde ${DESDE}: ${HUECOS.join(", ")}`);
const resumen = { A: [], B: [], C: [] };
for (const [t, sym] of Object.entries(TICKERS)) {
  const fila = { t };
  const prueba = async (k, fn) => { try { const r = await fn(); fila[k] = { ...careo(r.out)(t), huecos: Object.fromEntries(HUECOS.map(d => [d, r.out[d] ?? null])), vol: r.vol ? Object.fromEntries(HUECOS.map(d => [d, r.vol[d] ?? null])) : undefined }; resumen[k].push(fila[k].pct); } catch (e) { fila[k] = { err: String(e.message || e).slice(0, 60) }; } };
  await prueba("A", () => yahoo(sym, "1d"));
  await prueba("B", () => yahoo(sym, "60m"));
  const code = sym.replace(/\.SN$/, "");
  await prueba("C", async () => { for (const c of [code, code.replace("-", "."), code.replace("-", "")]) { try { return await wsj(c); } catch (e) {} } throw new Error("sin serie WSJ"); });
  const linea = k => fila[k].err ? `${k}: ✗ ${fila[k].err}` : `${k}: calza ${fila[k].ok}/${fila[k].n} (${fila[k].pct}%)${fila[k].malos.length ? " · difiere " + fila[k].malos.join(" | ") : ""}`;
  console.log(`\n■ ${t} (${sym})\n   ${linea("A")}\n   ${linea("B")}\n   ${linea("C")}`);
  for (const d of HUECOS) {
    const b = BX[d] && BX[d][t];
    console.log(`   ${d}: base ${b ?? "—"} · A ${fila.A.huecos ? fila.A.huecos[d] ?? "—" : "✗"} · B ${fila.B.huecos ? fila.B.huecos[d] ?? "—" : "✗"}${fila.B.vol && fila.B.vol[d] != null ? " (vol " + fila.B.vol[d] + ")" : ""} · C ${fila.C.huecos ? fila.C.huecos[d] ?? "—" : "✗"}`);
  }
  await new Promise(r => setTimeout(r, 250));
}
const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
console.log(`\nRESUMEN calce mediano con la base · A Yahoo diario ${med(resumen.A)}% · B Yahoo 60m ${med(resumen.B)}% · C WSJ ${med(resumen.C)}% (acciones con serie: ${resumen.A.length}/${resumen.B.length}/${resumen.C.length})`);
console.log("FIN DE LA SONDA");
