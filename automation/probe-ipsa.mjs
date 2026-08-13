#!/usr/bin/env node
/**
 * probe-ipsa.mjs — SONDA de fuentes del IPSA, para correr EN el runner (workflow_dispatch).
 * No escribe nada: solo imprime, por candidato, cuántos días entrega, el rango de fechas,
 * los últimos valores, si viene CONGELADO (rachas de valores idénticos) y cuánto se parece a
 * la reconstrucción sintética actual (correlación de retornos y diferencia máxima de nivel).
 * Con eso se decide QUÉ fuente promover a fetch-closes.mjs con evidencia y no de oído.
 */
import { readFileSync } from "node:fs";
const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

let _yCookie = null, _yCrumb = null;
async function yahooAuth() {
  if (_yCookie && _yCrumb) return;
  for (const u of ["https://fc.yahoo.com/", "https://finance.yahoo.com/"]) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": BUA, Accept: "text/html,*/*" }, redirect: "follow" });
      const sc = r.headers.get("set-cookie");
      if (sc) { const c = sc.split(/,(?=[^;,]+=)/).map(s => s.split(";")[0].trim()).filter(Boolean).join("; "); if (c) { _yCookie = c; break; } }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  if (!_yCookie) throw new Error("sin cookie Yahoo");
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const rc = await fetch(`https://${host}/v1/test/getcrumb`, { headers: { "User-Agent": BUA, Cookie: _yCookie, Accept: "text/plain" } });
      const cr = (await rc.text()).trim();
      if (cr && cr.length <= 40 && !/[<>{}]/.test(cr)) { _yCrumb = cr; return; }
    } catch (e) {}
  }
  throw new Error("sin crumb Yahoo");
}

async function chart(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range || "1y"}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": BUA } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r) throw new Error("sin datos");
  const ts = r.timestamp || [], closes = r.indicators?.quote?.[0]?.close || [], adj = r.indicators?.adjclose?.[0]?.adjclose || [];
  const out = {};
  ts.forEach((t, i) => {
    let c = closes[i]; if (c == null || !isFinite(c) || c <= 0) c = adj[i];
    if (c == null || !isFinite(c) || c <= 0) return;
    out[new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" })] = +(+c).toFixed(2);
  });
  return out;
}
async function quoteV7(symbol) {
  await yahooAuth();
  let last = "";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const res = await fetch(`https://${host}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(_yCrumb)}`, { headers: { "User-Agent": BUA, Cookie: _yCookie, Accept: "application/json" } });
      if (!res.ok) { last = "HTTP " + res.status; continue; }
      const q = (await res.json())?.quoteResponse?.result?.[0];
      const px = q && +q.regularMarketPrice, t = q && +q.regularMarketTime;
      if (!isFinite(px) || px <= 0 || !isFinite(t)) { last = "sin precio/hora"; continue; }
      return { [new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" })]: +px.toFixed(2) };
    } catch (e) { last = String((e && e.message) || e).slice(0, 60); }
  }
  throw new Error(last || "quote falló");
}
async function download(symbol) {
  await yahooAuth();
  const t2 = Math.floor(Date.now() / 1000), t1 = t2 - 365 * 86400;
  let last = "";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${host}/v7/finance/download/${encodeURIComponent(symbol)}?period1=${t1}&period2=${t2}&interval=1d&events=history&crumb=${encodeURIComponent(_yCrumb)}`;
      const res = await fetch(url, { headers: { "User-Agent": BUA, Cookie: _yCookie, Accept: "text/csv,*/*" } });
      if (!res.ok) { last = "HTTP " + res.status; continue; }
      const out = {};
      for (const line of (await res.text()).split(/\r?\n/).slice(1)) {
        const c = line.split(",");
        if (/^\d{4}-\d{2}-\d{2}$/.test(c[0]) && isFinite(+c[4]) && +c[4] > 0) out[c[0]] = +(+c[4]).toFixed(2);
      }
      if (!Object.keys(out).length) throw new Error("CSV vacío");
      return out;
    } catch (e) { last = String((e && e.message) || e).slice(0, 60); }
  }
  throw new Error(last || "download falló");
}
async function twelveData(symbol) {
  const key = process.env.TWELVEDATA_KEY;
  if (!key) throw new Error("sin TWELVEDATA_KEY (secret opcional)");
  const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=400&apikey=${encodeURIComponent(key)}`, { headers: { "User-Agent": BUA } });
  const j = await res.json();
  if (j.status === "error" || !Array.isArray(j.values)) throw new Error((j.message || "sin filas").slice(0, 140));
  const out = {};
  for (const r of j.values) { const d = ("" + r.datetime).slice(0, 10), c = +r.close; if (/^\d{4}-\d{2}-\d{2}$/.test(d) && c > 0) out[d] = +c.toFixed(2); }
  return out;
}

/* WSJ/MarketWatch "michelangelo": el API de charting que usan sus propias páginas, con token público
   (distinto del CSV downloaddatapartial que responde 401). Serie del S&P/CLX IPSA. */
async function michelangelo(key) {
  const ET = "cecc4267a0194af89ca343805a3e57af";
  const body = { Step: "P1D", TimeFrame: "P1Y", EntitlementToken: ET, IncludeMockTick: false, FilterNullSlots: false, FilterClosedPoints: true, IncludeClosedSlots: false, IncludeOfficialClose: true, InjectOpen: false, ShowPreMarket: false, ShowAfterHours: false, UseExtendedTimeFrame: true, WantPriorClose: false, IncludeCurrentQuotes: false, ResetTodaysAfterHoursPercentChange: false, Series: [{ Key: key, Dialect: "Charting", Kind: "Ticker", SeriesId: "s1", DataTypes: ["Last"] }] };
  const url = `https://api.wsj.net/api/michelangelo/timeseries/history?json=${encodeURIComponent(JSON.stringify(body))}&ckey=${ET.slice(0, 10)}`;
  const res = await fetch(url, { headers: { "User-Agent": BUA, Accept: "application/json, text/plain, */*", "Dylan2010.EntitlementToken": ET, Origin: "https://www.marketwatch.com", Referer: "https://www.marketwatch.com/" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  const ticks = j?.TimeInfo?.Ticks || [], pts = j?.Series?.[0]?.DataPoints || [];
  // DIAGNÓSTICO de zona horaria: ticks crudos de los últimos puntos, en ISO y con día de semana
  const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const raw = [];
  for (let i = Math.max(0, ticks.length - 6); i < ticks.length; i++) {
    const dt = new Date(+ticks[i]);
    raw.push(`${dt.toISOString()} (${DOW[dt.getUTCDay()]} UTC · stgo ${dt.toLocaleDateString("en-CA", { timeZone: "America/Santiago" })} ${DOW[+dt.toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(8, 10) ? new Date(dt.toLocaleDateString("en-CA", { timeZone: "America/Santiago" }) + "T12:00:00Z").getUTCDay() : 0]}) v=${pts[i] && pts[i][0]}`);
  }
  console.log("    ticks crudos: " + raw.join(" | "));
  const out = {};
  ticks.forEach((t, i) => {
    const v = pts[i] && +pts[i][0];
    if (!isFinite(v) || v <= 0) return;
    out[new Date(+t).toISOString().slice(0, 10)] = +v.toFixed(2);   // fecha en UTC (el careo dirá si calza)
  });
  if (!Object.keys(out).length) throw new Error("sin puntos (" + JSON.stringify(j).slice(0, 120) + ")");
  return out;
}
/* investing.com moderno: /api/financialdata/historical (distinto del tvc que responde 403). pair 40802 = S&P/CLX IPSA */
async function investingHist() {
  const hoy = new Date(), d1 = new Date(Date.now() - 365 * 86400e3);
  const f = x => x.toISOString().slice(0, 10);
  const url = `https://api.investing.com/api/financialdata/historical/40802?start-date=${f(d1)}&end-date=${f(hoy)}&time-frame=Daily&add-missing-rows=false`;
  const res = await fetch(url, { headers: { "User-Agent": BUA, Accept: "application/json", "domain-id": "www", Origin: "https://www.investing.com", Referer: "https://www.investing.com/" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  const rows = j && j.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error("sin filas (" + JSON.stringify(j).slice(0, 120) + ")");
  const out = {};
  for (const r of rows) {
    const t = +r.rowDateTimestamp || +r.rowDate || 0;
    const c = +(("" + (r.last_close ?? r.last_closeRaw ?? "")).replace(/,/g, ""));
    if (!t || !isFinite(c) || c <= 0) continue;
    out[new Date(t < 2e10 ? t * 1000 : t).toLocaleDateString("en-CA", { timeZone: "America/Santiago" })] = +c.toFixed(2);
  }
  if (!Object.keys(out).length) throw new Error("filas sin cierre");
  return out;
}
/* la base actual (con su IPSA sintético) para el careo */
let synth = {};
try {
  const j = JSON.parse(readFileSync("data/closes.json", "utf8"));
  for (const d of j.days || []) if (d.ipsa > 0) synth[d.date] = { v: +d.ipsa, s: !!d.ipsaSynth };
} catch (e) {}

function analiza(tag, map) {
  const dts = Object.keys(map).sort();
  if (!dts.length) { console.log(`✗ ${tag}: 0 días`); return; }
  // rachas de congelamiento (valores idénticos consecutivos)
  let maxRun = 1, run = 1;
  for (let i = 1; i < dts.length; i++) { if (map[dts[i]] === map[dts[i - 1]]) { run++; if (run > maxRun) maxRun = run; } else run = 1; }
  // careo contra la base actual: correlación de retornos diarios + dif máx de nivel (fechas comunes)
  const comunes = dts.filter(d => synth[d]);
  let corr = null, maxDif = null, difUlt = null;
  if (comunes.length >= 10) {
    const a = [], b = [];
    for (let i = 1; i < comunes.length; i++) {
      const d0 = comunes[i - 1], d1 = comunes[i];
      a.push(map[d1] / map[d0] - 1); b.push(synth[d1].v / synth[d0].v - 1);
    }
    const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
    let sab = 0, sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
    corr = sa > 0 && sb > 0 ? +(sab / Math.sqrt(sa * sb)).toFixed(3) : null;
    maxDif = Math.max(...comunes.map(d => Math.abs(map[d] / synth[d].v - 1) * 100)).toFixed(2) + "%";
    const ult = comunes[comunes.length - 1];
    difUlt = `${ult}: fuente ${map[ult]} vs base ${synth[ult].v} (${((map[ult] / synth[ult].v - 1) * 100).toFixed(2)}%)`;
  }
  const cola = dts.slice(-6).map(d => `${d}=${map[d]}`).join(" · ");
  console.log(`✓ ${tag}: ${dts.length} días (${dts[0]} → ${dts[dts.length - 1]}) · racha máx de valores idénticos: ${maxRun}`);
  console.log(`    últimos: ${cola}`);
  if (corr != null) console.log(`    careo vs base (${comunes.length} fechas comunes): correlación de retornos ${corr} · dif máx de nivel ${maxDif} · ${difUlt}`);
}

const CANDIDATOS = [
  ["wsj/mw michelangelo INDEX/CL/XSGO/IPSA", () => michelangelo("INDEX/CL/XSGO/IPSA")],
  ["wsj/mw michelangelo INDEX/CL/IPSA", () => michelangelo("INDEX/CL/IPSA")],
  ["investing financialdata 40802", investingHist],
  ["chart ^IPSA 1y (línea base)", () => chart("^IPSA", "1y")],
  ["quote v7 ^IPSA (línea base)", () => quoteV7("^IPSA")],
  ["twelvedata IPSA", () => twelveData("IPSA")],
  ["twelvedata SPCLXIPSA", () => twelveData("SPCLXIPSA")],
];
console.log(`SONDA IPSA · ${new Date().toISOString()} · base actual: ${Object.keys(synth).length} días con índice (${Object.values(synth).filter(x => x.s).length} sintéticos)`);
for (const [tag, fn] of CANDIDATOS) {
  try { analiza(tag, await fn()); }
  catch (e) { console.log(`✗ ${tag}: ${String((e && e.message) || e).slice(0, 160)}`); }
  await new Promise(r => setTimeout(r, 400));
}
console.log("FIN DE LA SONDA");
