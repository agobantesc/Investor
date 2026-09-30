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

/* ── fuentes de NIVEL (ronda 2026-09-30: el IPSA de la casa se despegó ~5% de la canasta desde el 17-09) ── */
async function txt(url, extra) {
  const r = await fetch(url, { headers: Object.assign({ "User-Agent": BUA, Accept: "text/html,application/json,*/*", "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" }, extra || {}), redirect: "follow" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
const pnum = s => { s = ("" + s).trim(); if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, ""); return +s; };
async function googleFin(sym) {
  const h = await txt(`https://www.google.com/finance/quote/${sym}?hl=en`);
  const m = /data-last-price="([\d.]+)"/.exec(h), pc = /Previous close<\/div>[\s\S]{0,200}?>([\d,]+\.\d+)</.exec(h);
  const ts = /data-last-normal-market-timestamp="(\d+)"/.exec(h);
  if (!m) throw new Error("sin data-last-price (" + h.length + " bytes)");
  const d = ts ? new Date(+ts[1] * 1000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" }) : "hoy";
  console.log(`    google ${sym}: último ${m[1]} (${d}) · cierre anterior ${pc ? pc[1] : "?"}`);
  return { [d]: +(+m[1]).toFixed(2) };
}
async function cnbcBars(sym) {
  const hoy = new Date(), d1 = new Date(Date.now() - 400 * 86400e3);
  const f = x => x.toISOString().slice(0, 10).replace(/-/g, "") + "000000";
  const j = JSON.parse(await txt(`https://ts-api.cnbc.com/harmony/app/bars/${encodeURIComponent(sym)}/1D/${f(d1)}/${f(hoy)}/adjusted/EST5EDT.json`, { Accept: "application/json" }));
  const b = j?.barData?.priceBars || [];
  const out = {};
  for (const x of b) { const d = ("" + x.tradeTime).slice(0, 8); const c = +x.close; if (c > 0) out[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = +c.toFixed(2); }
  if (!Object.keys(out).length) throw new Error("sin barras (" + JSON.stringify(j).slice(0, 140) + ")");
  return out;
}
async function cnbcQuote(sym) {
  const j = JSON.parse(await txt(`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(sym)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`, { Accept: "application/json" }));
  const q = j?.FormattedQuoteResult?.FormattedQuote?.[0];
  if (!q || !q.last) throw new Error("sin quote (" + JSON.stringify(j).slice(0, 140) + ")");
  console.log(`    cnbc ${sym}: ${q.name} · last ${q.last} · prev ${q.previous_day_closing} · ${q.last_time}`);
  return { [("" + q.last_time).slice(0, 10)]: pnum(q.last) };
}
async function ftHist(s) {
  const h = await txt(`https://markets.ft.com/data/indices/tearsheet/historical?s=${encodeURIComponent(s)}`);
  const xid = /xid&quot;:&quot;(\d+)|"xid":"(\d+)|data-mod-config="[^"]*?xid[^0-9]+(\d+)/.exec(h);
  const px = /mod-ui-data-list__value">([\d,]+\.\d+)</.exec(h);
  if (px) console.log(`    ft ${s}: precio en ficha ${px[1]} · xid ${xid ? (xid[1] || xid[2] || xid[3]) : "?"}`);
  if (!xid) throw new Error("sin xid (" + h.length + " bytes)");
  const id = xid[1] || xid[2] || xid[3];
  const hoy = new Date(), d1 = new Date(Date.now() - 360 * 86400e3), f = x => x.toISOString().slice(0, 10).replace(/-/g, "/");
  const j = JSON.parse(await txt(`https://markets.ft.com/data/equities/ajax/get-historical-prices?startDate=${f(d1)}&endDate=${f(hoy)}&symbol=${id}`, { Accept: "application/json" }));
  const out = {};
  const re = /<span class="mod-ui-hide-small-below">([^<]+)<\/span>[\s\S]*?<\/td>(?:<td[^>]*>([^<]*)<\/td>){4}/g;
  let m; while ((m = re.exec(j.html || ""))) { const d = new Date(m[1] + " 12:00 UTC"); if (!isNaN(d)) out[d.toISOString().slice(0, 10)] = pnum(m[2]); }
  if (!Object.keys(out).length) throw new Error("tabla vacía (" + ("" + (j.html || "")).slice(0, 120) + ")");
  return out;
}

/* canasta cap-ponderada de las acciones de la base (los precios SÍ son reales): careo de retornos día a día */
let basket = {};
try {
  const cl = JSON.parse(readFileSync("data/closes.json", "utf8")), fj = JSON.parse(readFileSync("data/fundamentals.json", "utf8")).byTicker || {};
  const sh = {}; for (const [t, f] of Object.entries(fj)) if (f && f.mcap > 0 && f.px > 0) sh[t] = f.mcap / f.px;
  let prev = null;
  for (const d of cl.days || []) {
    const px = d.prices || {};
    if (prev) { let a = 0, b = 0; for (const t in sh) if (px[t] > 0 && prev[t] > 0) { a += sh[t] * px[t]; b += sh[t] * prev[t]; } if (b > 0) basket[d.date] = a / b - 1; }
    if (Object.keys(px).length >= 20) prev = px;
  }
} catch (e) {}
function careoDiario(tag, map) {
  const dts = Object.keys(map).sort().slice(-26);
  const filas = [];
  for (let i = 1; i < dts.length; i++) {
    const r = (map[dts[i]] / map[dts[i - 1]] - 1) * 100, b = basket[dts[i]] != null ? basket[dts[i]] * 100 : null;
    filas.push(`${dts[i]} ${map[dts[i]]} (${r >= 0 ? "+" : ""}${r.toFixed(2)}% | canasta ${b == null ? "—" : (b >= 0 ? "+" : "") + b.toFixed(2) + "%"} | base ${synth[dts[i]] ? synth[dts[i]].v : "—"})`);
  }
  console.log(`    día a día ${tag}:\n      ` + filas.join("\n      "));
}

const CANDIDATOS = [
  ["wsj/mw michelangelo INDEX/CL/XSGO/IPSA", () => michelangelo("INDEX/CL/XSGO/IPSA"), true],
  ["wsj/mw michelangelo INDEX/CL/XSGO/SPIPSA", () => michelangelo("INDEX/CL/XSGO/SPIPSA"), true],
  ["wsj/mw michelangelo INDEX/CL//IPSA", () => michelangelo("INDEX/CL//IPSA"), true],
  ["google finance SPIPSA:INDEXSTGO", () => googleFin("SPIPSA:INDEXSTGO")],
  ["google finance IPSA:INDEXSTGO", () => googleFin("IPSA:INDEXSTGO")],
  ["cnbc barras .SPIPSA", () => cnbcBars(".SPIPSA"), true],
  ["cnbc barras .IPSA", () => cnbcBars(".IPSA"), true],
  ["cnbc quote .SPIPSA", () => cnbcQuote(".SPIPSA")],
  ["cnbc quote .IPSA", () => cnbcQuote(".IPSA")],
  ["ft IPSA:SGO", () => ftHist("IPSA:SGO"), true],
  ["ft SPIPSA:SGO", () => ftHist("SPIPSA:SGO"), true],
  ["investing financialdata 40802", investingHist, true],
  ["chart ^IPSA 1y (línea base)", () => chart("^IPSA", "1y"), true],
  ["chart ^SPIPSA 1y", () => chart("^SPIPSA", "1y"), true],
  ["quote v7 ^IPSA (línea base)", () => quoteV7("^IPSA")],
  ["twelvedata IPSA", () => twelveData("IPSA")],
];
console.log(`SONDA IPSA · ${new Date().toISOString()} · base actual: ${Object.keys(synth).length} días con índice (${Object.values(synth).filter(x => x.s).length} sintéticos)`);
for (const [tag, fn, dia] of CANDIDATOS) {
  try { const m = await fn(); analiza(tag, m); if (dia && Object.keys(m).length > 5) careoDiario(tag, m); }
  catch (e) { console.log(`✗ ${tag}: ${String((e && e.message) || e).slice(0, 160)}`); }
  await new Promise(r => setTimeout(r, 400));
}
console.log("FIN DE LA SONDA");
