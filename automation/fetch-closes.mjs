#!/usr/bin/env node
/**
 * fetch-closes.mjs — obtiene los cierres diarios de las acciones del IPSA (Bolsa de Santiago)
 * desde Yahoo Finance y escribe data/closes.json con el formato que Investor sincroniza:
 *
 *   { "updatedAt": "...", "days": [ { "date": "YYYY-MM-DD", "ipsa": 6543.2, "prices": { "BCI": 60800, ... } } ] }
 *
 * Sin dependencias (Node 18+). Uso: node automation/fetch-closes.mjs
 * Ajusta el mapa TICKERS si agregas/cambias acciones (clave = ticker en Investor, valor = símbolo Yahoo).
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { TICKERS } from "./tickers.mjs";   // universo IPSA compartido con fetch-fundamentals.mjs
const IPSA_SYMBOL = "^IPSA";
// Rango a bajar. Por defecto ~2 semanas (rellena días perdidos; la fusión de Investor es por celda, no duplica).
// Para POBLAR MASIVAMENTE la base una vez, ejecútalo con un rango largo: RANGE=2y node automation/fetch-closes.mjs
// (o desde GitHub → Actions → Run workflow con range=2y). Valores válidos de Yahoo: 10d, 1mo, 6mo, 1y, 2y, 5y, max.
const DAYS_BACK = (() => {
  const r = process.env.RANGE || process.argv[2] || "10d";
  if (!/^(\d+(d|mo|y)|max)$/.test(r)) { console.error(`Rango inválido "${r}" (usa 10d, 1mo, 6mo, 1y, 2y, 5y o max)`); process.exit(1); }
  return r;
})();

// segundos que cubre el rango pedido (para el modo period1/period2, más fiable en índices que ?range)
function rangeSeconds() {
  const m = /^(\d+)(d|mo|y)$/.exec(DAYS_BACK);
  if (!m) return 6 * 365 * 86400; // "max" → ~6 años
  const n = +m[1], u = m[2];
  return n * (u === "d" ? 86400 : u === "mo" ? 30 * 86400 : 365 * 86400);
}
async function chart(symbol, usePeriod) {
  const q = usePeriod
    ? `period1=${Math.floor(Date.now() / 1000) - rangeSeconds()}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`
    : `range=${DAYS_BACK}&interval=1d`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${q}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (investor-closes)" } });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`${symbol}: sin datos`);
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  // los ÍNDICES (^IPSA) suelen traer `quote.close` casi todo null y el valor real en `adjclose`:
  // por eso el backfill del IPSA venía con 1 solo día. Se usa adjclose como respaldo por punto.
  const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
  const out = {};
  ts.forEach((t, i) => {
    let c = closes[i];
    if (c == null || !isFinite(c) || c <= 0) c = adj[i];
    if (c == null || !isFinite(c) || c <= 0) return;
    // fecha en horario de Santiago (los cierres son del día bursátil local)
    const d = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    out[d] = +(+c).toFixed(2);
  });
  return out;
}

const byDate = {}; // date -> {ipsa, prices:{}}
const errors = [];

// ARCHIVO ACUMULADO: parte del closes.json existente para que cada corrida SUME al histórico en vez de
// reemplazarlo. Sin esto, la corrida diaria (10d) truncaba el archivo de 2 años al día siguiente del
// backfill, y un backfill (2y) borraba los valores diarios del IPSA que Yahoo solo entrega el mismo día.
// Lo nuevo manda por celda (acción × fecha); lo que la corrida no trae, se conserva.
try {
  const prev = JSON.parse(readFileSync("data/closes.json", "utf8"));
  for (const d of prev.days || []) {
    if (!d || !d.date) continue;
    const e = (byDate[d.date] ??= { date: d.date, prices: {} });
    if (d.ipsa != null && isFinite(+d.ipsa) && +d.ipsa > 0) e.ipsa = +d.ipsa;
    for (const [t, v] of Object.entries(d.prices || {})) if (isFinite(+v) && +v > 0) e.prices[t] = +v;
  }
  console.log(`Archivo previo: ${Object.keys(byDate).length} día(s) conservado(s) como base.`);
} catch (e) { console.log("Sin archivo previo utilizable (primera corrida)."); }

// HISTÓRICO del IPSA: Yahoo NO publica la historia del ^IPSA vía chart (solo el último valor), así que se
// intenta una CADENA de fuentes hasta juntar historia; cada intento queda registrado en ipsaSources del JSON.
function parseCloseCsv(txt, tag) {
  const lines = (txt || "").trim().split(/\r?\n/);
  if (lines.length < 2 || !/^date,/i.test(lines[0])) throw new Error(`${tag}: respuesta inesperada (${(lines[0] || "").slice(0, 40)})`);
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(","), d = c[0], v = +c[4];   // Date,Open,High,Low,Close[,...]
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && isFinite(v) && v > 0) out[d] = +v.toFixed(2);
  }
  if (!Object.keys(out).length) throw new Error(`${tag}: CSV sin filas válidas`);
  return out;
}
async function yahooDownloadIpsa() {
  const t2 = Math.floor(Date.now() / 1000), t1 = t2 - rangeSeconds();
  const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/download/%5EIPSA?period1=${t1}&period2=${t2}&interval=1d&events=history`,
    { headers: { "User-Agent": "Mozilla/5.0 (investor-closes)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCloseCsv(await res.text(), "yahoo dl");
}
async function ipsaFromStooq() {
  const ms = Date.now(), fmt = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const raw = `https://stooq.com/q/d/l/?s=%5Eipsa&i=d&d1=${fmt(ms - rangeSeconds() * 1000)}&d2=${fmt(ms + 86400e3)}`;
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  // Stooq sirve HTML (bloqueo) a las IPs de los runners: se intenta directo y vía proxies públicos (el mismo
  // truco que usa la app en el navegador para el petróleo de Stooq). allorigins /get envuelve en JSON.
  const routes = [
    ["stooq.com", raw, null, null],
    ["stooq.pl", raw.replace("stooq.com", "stooq.pl"), null, null],
    ["allorigins", "https://api.allorigins.win/get?url=" + encodeURIComponent(raw), null, (t) => (JSON.parse(t).contents || "")],
    ["corsproxy", "https://corsproxy.io/?url=" + encodeURIComponent(raw), { Origin: "https://stooq.com", Referer: "https://stooq.com/" }, null],
    ["codetabs", "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(raw), null, null],
  ];
  const fails = [];
  for (const [tag, url, xh, unwrap] of routes) {
    try {
      const res = await fetch(url, { headers: Object.assign({ "User-Agent": UA, "Accept": "text/csv,text/plain,application/json,*/*" }, xh || {}) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let txt = await res.text();
      if (unwrap) txt = unwrap(txt);
      return parseCloseCsv(txt, tag);
    } catch (e) { fails.push(`${tag}=${String((e && e.message) || e).slice(0, 60)}`); await new Promise(r => setTimeout(r, 400)); }
  }
  throw new Error(fails.join(" | "));
}
const IPSA_SOURCES = [
  ["yahoo ^IPSA range", () => chart(IPSA_SYMBOL)],
  ["yahoo ^IPSA period", () => chart(IPSA_SYMBOL, true)],
  ["yahoo ^SPIPSA", () => chart("^SPIPSA", true)],
  ["yahoo download csv", yahooDownloadIpsa],
  ["stooq", ipsaFromStooq],
];
const ipsaSources = [];
{
  let ipsa = {};
  for (const [tag, fn] of IPSA_SOURCES) {
    try {
      const got = await fn();
      ipsaSources.push(`${tag}: ${Object.keys(got).length} día(s)`);
      ipsa = Object.assign({}, got, ipsa);   // lo ya obtenido (p.ej. el valor de HOY de Yahoo) manda sobre lo nuevo
      if (Object.keys(ipsa).length >= 10) break;
    } catch (e) { ipsaSources.push(`${tag}: ${String((e && e.message) || e).slice(0, 90)}`); }
    await new Promise(r => setTimeout(r, 300));
  }
  const nIpsa = Object.keys(ipsa).length;
  for (const [d, v] of Object.entries(ipsa)) (byDate[d] ??= { date: d, prices: {} }).ipsa = v;
  console.log(`IPSA: ${nIpsa} día(s). Fuentes → ${ipsaSources.join(" · ")}`);
  if (nIpsa < 10) errors.push("IPSA histórico incompleto (" + nIpsa + " día/s) — " + ipsaSources.join(" · "));
}

for (const [tick, sym] of Object.entries(TICKERS)) {
  try {
    const px = await chart(sym);
    for (const [d, v] of Object.entries(px)) ((byDate[d] ??= { date: d, prices: {} }).prices[tick] = v);
  } catch (e) { errors.push(String(e.message || e)); }
  await new Promise(r => setTimeout(r, 350)); // cortesía con la API
}

// Si el run ocurre con la Bolsa de Santiago ABIERTA (antes de ~17:00 hora de Chile), el dato de HOY es un
// valor intradía, no un cierre: se descarta. El run programado (18:05 Chile) trae el cierre real del día.
const scHour = +new Date().toLocaleString("en-US", { timeZone: "America/Santiago", hour: "2-digit", hour12: false });
const todaySc = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
if (scHour < 17 && byDate[todaySc]) {
  delete byDate[todaySc];
  console.log(`Descartado ${todaySc}: mercado aún abierto (valor intradía, no cierre).`);
}

const days = Object.values(byDate)
  .filter(d => Object.keys(d.prices).length || d.ipsa != null)
  .sort((a, b) => (a.date < b.date ? -1 : 1));

if (!days.length) { console.error("Sin datos. Errores:", errors); process.exit(1); }

const ipsaDays = days.filter(d => d.ipsa != null).length;
const tickerSet = new Set();
days.forEach(d => Object.keys(d.prices || {}).forEach(t => tickerSet.add(t)));
mkdirSync("data", { recursive: true });
writeFileSync("data/closes.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "Yahoo Finance (.SN) + fuentes IPSA", ipsaSources, errors, days }, null, 1));
console.log(`OK: ${days.length} día(s) (${days[0].date} → ${days[days.length - 1].date}) · ${tickerSet.size} acciones · IPSA en ${ipsaDays} día(s). Errores: ${errors.length ? errors.join("; ") : "ninguno"}`);
