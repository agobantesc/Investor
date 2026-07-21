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
const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// Yahoo protege el endpoint de historia (v7/download) con cookie + crumb. Se obtiene la cookie de una página de
// Yahoo y luego el crumb ligado a ella; con eso, download SÍ entrega la historia real del ^IPSA (que el chart no da).
let _yCookie = null, _yCrumb = null;
async function yahooAuth() {
  if (_yCookie && _yCrumb) return;
  for (const u of ["https://fc.yahoo.com/", "https://finance.yahoo.com/", "https://finance.yahoo.com/quote/%5EIPSA/history"]) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": BUA, "Accept": "text/html,*/*" }, redirect: "follow" });
      const sc = r.headers.get("set-cookie");
      if (sc) { const c = sc.split(/,(?=[^;,]+=)/).map(s => s.split(";")[0].trim()).filter(Boolean).join("; "); if (c) { _yCookie = c; break; } }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  if (!_yCookie) throw new Error("sin cookie Yahoo");
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const rc = await fetch(`https://${host}/v1/test/getcrumb`, { headers: { "User-Agent": BUA, "Cookie": _yCookie, "Accept": "text/plain" } });
      const cr = (await rc.text()).trim();
      if (cr && cr.length <= 40 && !/[<>{}]/.test(cr)) { _yCrumb = cr; return; }
    } catch (e) {}
  }
  throw new Error("sin crumb Yahoo");
}
async function yahooCrumbDownload(symbol) {
  await yahooAuth();
  const t2 = Math.floor(Date.now() / 1000), t1 = t2 - rangeSeconds();
  let last = "";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${host}/v7/finance/download/${encodeURIComponent(symbol)}?period1=${t1}&period2=${t2}&interval=1d&events=history&crumb=${encodeURIComponent(_yCrumb)}`;
      const res = await fetch(url, { headers: { "User-Agent": BUA, "Cookie": _yCookie, "Accept": "text/csv,*/*" } });
      if (!res.ok) { last = `HTTP ${res.status}`; continue; }
      return parseCloseCsv(await res.text(), "yahoo crumb");
    } catch (e) { last = String((e && e.message) || e).slice(0, 50); }
  }
  throw new Error(last || "download falló");
}
async function ipsaFromStooq() {
  const ms = Date.now(), fmt = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const raw = `https://stooq.com/q/d/l/?s=%5Eipsa&i=d&d1=${fmt(ms - rangeSeconds() * 1000)}&d2=${fmt(ms + 86400e3)}`;
  // Stooq sirve HTML (bloqueo) a las IPs de los runners: se intenta directo y vía VARIOS proxies públicos (el mismo
  // truco que usa la app en el navegador). allorigins /get y whateverorigin envuelven en JSON; /raw es texto plano.
  const routes = [
    ["stooq.com", raw, null, null],
    ["stooq.pl", raw.replace("stooq.com", "stooq.pl"), null, null],
    ["allorigins/raw", "https://api.allorigins.win/raw?url=" + encodeURIComponent(raw), null, null],
    ["allorigins/get", "https://api.allorigins.win/get?url=" + encodeURIComponent(raw), null, (t) => (JSON.parse(t).contents || "")],
    ["codetabs", "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(raw), null, null],
    ["corsproxy", "https://corsproxy.io/?url=" + encodeURIComponent(raw), { Origin: "https://stooq.com", Referer: "https://stooq.com/" }, null],
    ["thingproxy", "https://thingproxy.freeboard.io/fetch/" + raw, null, null],
    ["whateverorigin", "https://www.whateverorigin.org/get?url=" + encodeURIComponent(raw), null, (t) => { try { return JSON.parse(t).contents || ""; } catch (e) { return ""; } }],
  ];
  const fails = [];
  for (const [tag, url, xh, unwrap] of routes) {
    try {
      const res = await fetch(url, { headers: Object.assign({ "User-Agent": BUA, "Accept": "text/csv,text/plain,application/json,*/*" }, xh || {}) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let txt = await res.text();
      if (unwrap) txt = unwrap(txt);
      return parseCloseCsv(txt, tag);
    } catch (e) { fails.push(`${tag}=${String((e && e.message) || e).slice(0, 40)}`); await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error(fails.join(" | "));
}
async function ipsaFromMarketWatch() {
  // MarketWatch descarga CSV histórico de índices. S&P/CLX IPSA = "spipsa" (countrycode=cl). Fecha MM/DD/YYYY.
  const mm = (d) => `${("0" + (d.getMonth() + 1)).slice(-2)}/${("0" + d.getDate()).slice(-2)}/${d.getFullYear()}`;
  const p1 = new Date(Date.now() - rangeSeconds() * 1000), p2 = new Date();
  const url = `https://www.marketwatch.com/investing/index/spipsa/downloaddatapartial?countrycode=cl&startdate=${encodeURIComponent(mm(p1) + " 00:00:00")}&enddate=${encodeURIComponent(mm(p2) + " 23:59:59")}&frequency=p1d&csvdownload=true&downloadpartial=false&newdates=false`;
  const res = await fetch(url, { headers: { "User-Agent": BUA, "Accept": "text/csv,*/*", "Referer": "https://www.marketwatch.com/investing/index/spipsa?countrycode=cl" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/), out = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/); if (c.length < 5) continue;
    const m = /^"?(\d{2})\/(\d{2})\/(\d{4})/.exec(c[0]), v = +(("" + c[4]).replace(/["\s,]/g, ""));
    if (m && isFinite(v) && v > 0) out[`${m[3]}-${m[1]}-${m[2]}`] = +v.toFixed(2);
  }
  if (!Object.keys(out).length) throw new Error("CSV MW sin filas");
  return out;
}
async function ipsaFromInvesting() {
  // API no oficial de investing.com. pair_id del S&P/CLX IPSA = 40802. Devuelve [ts_ms, o, h, l, c, ...].
  const url = `https://api.investing.com/api/financialdata/40802/historical/chart/?interval=P1D&pointscount=520`;
  const res = await fetch(url, { headers: { "User-Agent": BUA, "Accept": "application/json", "domain-id": "www", "Referer": "https://www.investing.com/indices/ipsa-historical-data" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json(), data = j && j.data; if (!Array.isArray(data)) throw new Error("sin data");
  const out = {};
  for (const row of data) { const c = +row[4]; if (!isFinite(c) || c <= 0) continue; out[new Date(row[0]).toISOString().slice(0, 10)] = +c.toFixed(2); }
  if (!Object.keys(out).length) throw new Error("investing sin filas");
  return out;
}
async function ipsaFromTwelveData() {
  // Fuente REAL de respaldo con API key gratuita (opcional): secret TWELVEDATA_KEY en GitHub. Si no está, se salta.
  const key = process.env.TWELVEDATA_KEY; if (!key) throw new Error("sin TWELVEDATA_KEY (opcional)");
  const res = await fetch(`https://api.twelvedata.com/time_series?symbol=IPSA&interval=1day&outputsize=800&apikey=${encodeURIComponent(key)}`, { headers: { "User-Agent": BUA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json(), vals = j && j.values; if (!Array.isArray(vals)) throw new Error((j && j.message) ? String(j.message).slice(0, 50) : "sin values");
  const out = {};
  for (const r of vals) { const d = r.datetime, c = +r.close; if (/^\d{4}-\d{2}-\d{2}/.test(d || "") && isFinite(c) && c > 0) out[d.slice(0, 10)] = +c.toFixed(2); }
  if (!Object.keys(out).length) throw new Error("TD sin filas");
  return out;
}
/* ═════════ PRECISIÓN DE CIERRES (para cuadrar con el corredor, p.ej. BTG Pactual) ═════════
   Yahoo entrega el ÚLTIMO PRECIO TRANSADO del día, que puede diferir del CIERRE OFICIAL que fija la
   subasta de cierre de la Bolsa de Santiago — y ese cierre oficial es el que usa la cartola del corredor.
   Para eliminar esa diferencia se agregan DOS capas que PISAN a Yahoo, por celda (acción × fecha):
     1) EODHD (https://eodhd.com, pagada ~US$20/mes plan All World, secret EODHD_KEY): historia diaria con
        cierres oficiales de la Bolsa de Santiago (.SN). Si el secret no está, la capa se omite sin romper nada.
     2) CIERRE OFICIAL del sitio de la Bolsa de Santiago (gratis): el resumen del día del propio sitio
        (PRECIO_CIERRE por nemo + valor del IPSA) pisa el dato de HOY. Endpoint no documentado: si cambia,
        el log del workflow lo muestra y las otras capas siguen funcionando.
   Prioridad final por celda: Bolsa oficial (hoy) > EODHD > Yahoo. Cada valor pisado queda registrado en
   'ajustesDeFuente' dentro del JSON (transparencia y diagnóstico de cuánto difería Yahoo). */
const ADJUST_LOG = [];
function logAdjust(t, date, de, a, fuente) {
  if (de == null || a == null || de === a) return;
  if (ADJUST_LOG.length < 60) ADJUST_LOG.push({ t, date, de, a, dif_pct: +(((a - de) / de) * 100).toFixed(2), fuente });
}
function numOf(row, keys) { for (const k of keys) { const v = row?.[k]; if (v != null && v !== "" && isFinite(+v) && +v > 0) return +v; } return null; }
function strOf(row, keys) { for (const k of keys) { const v = row?.[k]; if (typeof v === "string" && v.trim()) return v.trim().toUpperCase(); } return null; }
// nemo oficial en la Bolsa = símbolo Yahoo sin ".SN" (BSANTANDER, LTM, SQM-B, …)
const NEMO_OF = {}; for (const [t, sym] of Object.entries(TICKERS)) NEMO_OF[t] = sym.replace(/\.SN$/, "");

// SELFTEST=1 node automation/fetch-closes.mjs → prueba las funciones puras sin tocar la red (CI/desarrollo)
if (process.env.SELFTEST) {
  const row = { NEMO: " bci ", PRECIO_CIERRE: "64477.5", ULTIMO_PRECIO: 64400 };
  if (strOf(row, ["NEMO"]) !== "BCI") throw new Error("strOf");
  if (numOf(row, ["PRECIO_CIERRE", "ULTIMO_PRECIO"]) !== 64477.5) throw new Error("numOf prioridad");
  if (numOf({ X: 0, Y: "" }, ["X", "Y"]) !== null) throw new Error("numOf descarta 0/vacío");
  logAdjust("BCI", "2026-07-17", 100, 101, "test"); logAdjust("BCI", "2026-07-17", 100, 100, "test"); logAdjust("BCI", "2026-07-17", null, 101, "test");
  if (ADJUST_LOG.length !== 1 || ADJUST_LOG[0].dif_pct !== 1) throw new Error("logAdjust");
  if (NEMO_OF.SANTANDER !== "BSANTANDER" || NEMO_OF.LATAM !== "LTM" || NEMO_OF["SQM-B"] !== "SQM-B") throw new Error("NEMO_OF");
  ADJUST_LOG.length = 0;
  console.log("SELFTEST OK"); process.exit(0);
}

// Orden: primero el valor de HOY (chart, fiable), luego las fuentes de HISTORIA real. El merge conserva lo ya
// obtenido (el valor de hoy) sobre lo nuevo, así nunca se pierde el cierre del día. Yahoo dejó de servir historia
// de índices (chart=1 día, download=401), por eso se priorizan MarketWatch / investing.com / Twelve Data / Stooq.
// v7 quote con cookie+crumb: el MISMO camino que usa fetch-fundamentals (que sí funciona a diario desde el
// runner) — entrega el valor y la HORA de la última sesión del ^IPSA aunque el chart esté rezagado días.
async function ipsaFromYahooQuote() {
  await yahooAuth();
  let last = "";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const res = await fetch(`https://${host}/v7/finance/quote?symbols=%5EIPSA&crumb=${encodeURIComponent(_yCrumb)}`, { headers: { "User-Agent": BUA, Cookie: _yCookie, Accept: "application/json" } });
      if (!res.ok) { last = "HTTP " + res.status; continue; }
      const j = await res.json();
      const q = j && j.quoteResponse && j.quoteResponse.result && j.quoteResponse.result[0];
      const px = q && +q.regularMarketPrice, t = q && +q.regularMarketTime;
      if (!isFinite(px) || px <= 0 || !isFinite(t) || t <= 0) { last = "quote sin precio/hora"; continue; }
      const d = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
      return { [d]: +px.toFixed(2) };
    } catch (e) { last = String((e && e.message) || e).slice(0, 50); }
  }
  throw new Error(last || "v7 quote sin ^IPSA");
}
const IPSA_SOURCES = [
  ["yahoo quote ^IPSA", ipsaFromYahooQuote],
  ["yahoo ^IPSA hoy", () => chart(IPSA_SYMBOL)],
  ["marketwatch spipsa", ipsaFromMarketWatch],
  ["investing 40802", ipsaFromInvesting],
  ["twelvedata IPSA", ipsaFromTwelveData],
  ["stooq", ipsaFromStooq],
  ["yahoo ^IPSA period", () => chart(IPSA_SYMBOL, true)],
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
    } catch (e) { ipsaSources.push(`${tag}: ${String((e && e.message) || e).slice(0, 180)}`); }
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

/* ── CAPA 2 · EODHD (pagada, opcional): historia con cierres OFICIALES — pisa a Yahoo por celda ── */
if (process.env.EODHD_KEY) {
  const key = process.env.EODHD_KEY;
  const from = new Date(Date.now() - rangeSeconds() * 1000).toISOString().slice(0, 10);
  let ok = 0; const fails = [];
  for (const [tick, sym] of Object.entries(TICKERS)) {
    const code = NEMO_OF[tick] + ".SN";
    try {
      const r = await fetch(`https://eodhd.com/api/eod/${encodeURIComponent(code)}?api_token=${encodeURIComponent(key)}&period=d&fmt=json&from=${from}`, { headers: { "User-Agent": BUA, Accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const arr = await r.json();
      if (!Array.isArray(arr)) throw new Error("respuesta no-lista");
      let n = 0;
      for (const row of arr) {
        const d = ("" + row.date).slice(0, 10), c = +row.close;   // 'close' = cierre oficial SIN ajustar (el de la cartola)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isFinite(c) || c <= 0) continue;
        const e = (byDate[d] ??= { date: d, prices: {} });
        logAdjust(tick, d, e.prices[tick], +c.toFixed(2), "EODHD");
        e.prices[tick] = +c.toFixed(2); n++;
      }
      if (n) ok++;
    } catch (e) { fails.push(tick + "=" + String((e && e.message) || e).slice(0, 40)); }
    await new Promise(r => setTimeout(r, 150));
  }
  // IPSA del índice, si el plan lo incluye (si no, las fuentes de índice ya cubiertas siguen mandando)
  try {
    const r = await fetch(`https://eodhd.com/api/eod/IPSA.INDX?api_token=${encodeURIComponent(key)}&period=d&fmt=json&from=${from}`, { headers: { "User-Agent": BUA, Accept: "application/json" } });
    if (r.ok) { const arr = await r.json(); if (Array.isArray(arr)) for (const row of arr) { const d = ("" + row.date).slice(0, 10), c = +row.close; if (/^\d{4}-\d{2}-\d{2}$/.test(d) && isFinite(c) && c > 0) { const e = (byDate[d] ??= { date: d, prices: {} }); logAdjust("IPSA", d, e.ipsa, +c.toFixed(2), "EODHD"); e.ipsa = +c.toFixed(2); } } }
  } catch (e) {}
  console.log(`EODHD: ${ok}/${Object.keys(TICKERS).length} acciones con cierres oficiales.` + (fails.length ? " Fallas: " + fails.join(" · ") : ""));
  if (!ok) errors.push("EODHD sin datos (revisa el plan/símbolos): " + fails.slice(0, 5).join(" · "));
} else {
  console.log("EODHD: sin EODHD_KEY (opcional, fuente pagada con cierres oficiales de la Bolsa) — capa omitida.");
}

/* ── CAPA 3 · CIERRE OFICIAL (sitio de la Bolsa de Santiago, gratis) — máxima prioridad ──
   Estrategia empírica (el sitio tiene protección y API no documentada):
   A) GET getPointHistGAT?nemo=X — puntos HISTÓRICOS oficiales por nemo (suele no exigir CSRF).
   B) GET getPointIntradayGAT?nemo=X&frecuencia=1 — el día en curso.
   C) POST del resumen del día con X-CSRF-Token extraído del HTML del SPA (fallback).
   Cada intento y la FORMA de la respuesta (keys + fila de muestra) quedan en fuenteOficial dentro del JSON:
   si la Bolsa cambia el API, el log del workflow muestra exactamente qué devolvió para ajustar el parseo. */
const officialLog = [];
try {
  const jar = [];
  const keep = res => { try { const sc = res.headers.get("set-cookie"); if (sc) sc.split(/,(?=[^;,]+=)/).forEach(c => { const kv = c.split(";")[0].trim(); if (kv) jar.push(kv); }); } catch (e) {} };
  const H = extra => Object.assign({ "User-Agent": BUA, Accept: "application/json,text/plain,*/*", "Accept-Language": "es-CL,es;q=0.9", Origin: "https://www.bolsadesantiago.com", Referer: "https://www.bolsadesantiago.com/" }, jar.length ? { Cookie: jar.join("; ") } : {}, extra || {});
  const r0 = await fetch("https://www.bolsadesantiago.com/", { headers: { "User-Agent": BUA, Accept: "text/html,*/*", "Accept-Language": "es-CL,es;q=0.9" } }); keep(r0);
  const html = await r0.text();
  officialLog.push("home HTTP " + r0.status + " · " + jar.length + " cookie(s)");
  // token CSRF embebido en el HTML del SPA (meta o variable), si existe
  let csrf = null;
  const m = html.match(/name=["']csrf-token["'][^>]*content=["']([^"']+)/i) || html.match(/["']?csrf[_-]?token["']?\s*[:=]\s*["']([A-Za-z0-9_\-]{16,})["']/i) || html.match(/x-csrf-token["']?\s*[:,]\s*["']([A-Za-z0-9_\-]{16,})["']/i);
  if (m) { csrf = m[1]; officialLog.push("csrf en HTML: sí"); } else officialLog.push("csrf en HTML: no");

  const getJ = async path => {
    const r = await fetch("https://www.bolsadesantiago.com" + path, { headers: H(csrf ? { "X-CSRF-Token": csrf } : {}) });
    keep(r);
    const txt = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status + " · " + txt.slice(0, 60).replace(/\s+/g, " "));
    let j; try { j = JSON.parse(txt); } catch (e) { throw new Error("no-JSON · " + txt.slice(0, 60).replace(/\s+/g, " ")); }
    return Array.isArray(j) ? j : ((j && (j.listaResult || (j.payload && j.payload.datos) || j.datos || j.result)) || j);
  };
  const postJ = async path => {
    const r = await fetch("https://www.bolsadesantiago.com" + path, { method: "POST", headers: H(Object.assign({ "Content-Type": "application/json;charset=UTF-8" }, csrf ? { "X-CSRF-Token": csrf } : {})), body: "{}" });
    keep(r); const txt = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status);
    let j; try { j = JSON.parse(txt); } catch (e) { throw new Error("no-JSON · " + txt.slice(0, 50).replace(/\s+/g, " ")); }
    return Array.isArray(j) ? j : ((j && (j.listaResult || (j.payload && j.payload.datos) || j.datos || j.result)) || j);
  };
  // parseo TOLERANTE de un punto {fecha?, precio?}: claves y formatos varían entre endpoints del sitio
  const DKEYS = ["fec_fij", "FEC_FIJ", "fecha", "FECHA", "fec", "date", "time", "hora", "x", "d"];
  const VKEYS = ["pre_cie", "PRE_CIE", "precio_cierre", "PRECIO_CIERRE", "cierre", "CIERRE", "valor", "VALOR", "precio", "PRECIO", "close", "y", "v"];
  const pDate = v => { if (v == null) return null; if (isFinite(+v)) { const n = +v; const ms = n > 1e12 ? n : (n > 1e9 ? n * 1000 : null); if (!ms) return null; return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); } const s2 = ("" + v).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(s2)) return s2; const dm = ("" + v).match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})/); return dm ? (dm[3] + "-" + dm[2] + "-" + dm[1]) : null; };
  const pPoint = row => { if (!row || typeof row !== "object") return null; let d = null, val = null; for (const k of DKEYS) if (row[k] != null) { d = pDate(row[k]); if (d) break; } for (const k of VKEYS) { const n = +row[k]; if (row[k] != null && isFinite(n) && n > 0) { val = n; break; } } return (d && val != null) ? { d, val } : null; };

  // A) sonda de HISTORIA oficial con un nemo líquido
  let mode = null, probe = null;
  try {
    probe = await getJ("/api/RV_Instrumentos/getPointHistGAT?nemo=BCI");
    if (Array.isArray(probe) && probe.length) {
      officialLog.push("getPointHistGAT BCI: " + probe.length + " punto(s) · keys=" + Object.keys(probe[probe.length - 1] || {}).slice(0, 10).join(",") + " · sample=" + JSON.stringify(probe[probe.length - 1]).slice(0, 140));
      if (pPoint(probe[probe.length - 1])) mode = "hist";
      else officialLog.push("hist: fila no parseable con las claves conocidas");
    } else officialLog.push("getPointHistGAT BCI: vacío/no-lista · " + JSON.stringify(probe).slice(0, 120));
  } catch (e) { officialLog.push("getPointHistGAT: " + String(e.message || e).slice(0, 90)); }
  // B) sonda intradía (para el cierre del día si no hay historia)
  if (!mode) {
    try {
      const pi = await getJ("/api/RV_Instrumentos/getPointIntradayGAT?nemo=BCI&frecuencia=1");
      if (Array.isArray(pi) && pi.length) {
        officialLog.push("getPointIntradayGAT BCI: " + pi.length + " punto(s) · sample=" + JSON.stringify(pi[pi.length - 1]).slice(0, 140));
        if (pPoint(pi[pi.length - 1])) mode = "intra";
      } else officialLog.push("getPointIntradayGAT BCI: vacío/no-lista · " + JSON.stringify(pi).slice(0, 120));
    } catch (e) { officialLog.push("getPointIntradayGAT: " + String(e.message || e).slice(0, 90)); }
  }

  const cut = new Date(Date.now() - rangeSeconds() * 1000).toISOString().slice(0, 10);
  if (mode) {
    // por-nemo: historia (o día) OFICIAL de cada acción del universo, pisando a Yahoo dentro del rango
    let okN = 0; const failN = [];
    for (const [tick, nemo] of Object.entries(NEMO_OF)) {
      try {
        const rows = tick === "BCI" && mode === "hist" ? probe : await getJ(mode === "hist" ? ("/api/RV_Instrumentos/getPointHistGAT?nemo=" + encodeURIComponent(nemo)) : ("/api/RV_Instrumentos/getPointIntradayGAT?nemo=" + encodeURIComponent(nemo) + "&frecuencia=1"));
        if (!Array.isArray(rows) || !rows.length) throw new Error("vacío");
        let n = 0;
        if (mode === "hist") {
          for (const row of rows) { const pt = pPoint(row); if (!pt || pt.d < cut) continue; const e = (byDate[pt.d] ??= { date: pt.d, prices: {} }); logAdjust(tick, pt.d, e.prices[tick], +pt.val.toFixed(2), "Bolsa de Santiago (oficial)"); e.prices[tick] = +pt.val.toFixed(2); n++; }
        } else {
          const pt = pPoint(rows[rows.length - 1]); // último punto del día = cierre/último oficial
          if (pt) { const e = (byDate[pt.d] ??= { date: pt.d, prices: {} }); logAdjust(tick, pt.d, e.prices[tick], +pt.val.toFixed(2), "Bolsa de Santiago (oficial)"); e.prices[tick] = +pt.val.toFixed(2); n = 1; }
        }
        if (n) okN++;
      } catch (e) { failN.push(tick + "=" + String(e.message || e).slice(0, 30)); }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`Cierre OFICIAL Bolsa de Santiago (${mode}): ${okN}/${Object.keys(NEMO_OF).length} acciones aplicadas.` + (failN.length ? " Fallas: " + failN.slice(0, 6).join(" · ") : ""));
    officialLog.push("aplicadas " + okN + " acciones vía " + mode);
    // IPSA por la misma vía (algunos GAT aceptan índices como nemo)
    try { const ri = await getJ("/api/RV_Instrumentos/getPointHistGAT?nemo=IPSA"); if (Array.isArray(ri) && ri.length) { let ni = 0; for (const row of ri) { const pt = pPoint(row); if (!pt || pt.d < cut) continue; const e = (byDate[pt.d] ??= { date: pt.d, prices: {} }); logAdjust("IPSA", pt.d, e.ipsa, +pt.val.toFixed(2), "Bolsa de Santiago (oficial)"); e.ipsa = +pt.val.toFixed(2); ni++; } officialLog.push("IPSA oficial: " + ni + " día(s)"); } } catch (e) { officialLog.push("IPSA GAT: " + String(e.message || e).slice(0, 60)); }
  } else {
    // C) fallback: resumen del día por POST (requiere el csrf del HTML)
    let stocks = null;
    for (const path of ["/api/RV_ResumenMercado/getAccionesPrecios", "/api/RV_ResumenMercado/getResumenAccionesPrecios"]) {
      try {
        const rows = await postJ(path);
        if (!Array.isArray(rows) || !rows.length) { officialLog.push(path + ": sin filas"); continue; }
        officialLog.push(path + ": " + rows.length + " filas · sample=" + JSON.stringify(rows[0]).slice(0, 140));
        const map = {};
        rows.forEach(row => { const nemo = strOf(row, ["NEMO", "nemo", "NEMONICO", "SYMBOL"]); const px = numOf(row, VKEYS); if (nemo && px != null) map[nemo] = px; });
        if (Object.values(NEMO_OF).filter(n => map[n] != null).length >= 10) { stocks = map; break; }
      } catch (e) { officialLog.push(path + ": " + String(e.message || e).slice(0, 50)); }
    }
    if (stocks) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
      const e = (byDate[today] ??= { date: today, prices: {} });
      let applied = 0;
      for (const [tick, nemo] of Object.entries(NEMO_OF)) { const px = stocks[nemo]; if (px == null) continue; logAdjust(tick, today, e.prices[tick], px, "Bolsa de Santiago (oficial)"); e.prices[tick] = px; applied++; }
      console.log(`Cierre OFICIAL Bolsa de Santiago (resumen): ${applied} acciones aplicadas al ${today}.`);
      officialLog.push("resumen aplicado: " + applied);
    } else {
      console.log("Cierre oficial Bolsa de Santiago: no disponible esta corrida — " + officialLog.join(" | "));
    }
  }
} catch (e) { officialLog.push("capa oficial: " + String(e.message || e).slice(0, 80)); console.log("Cierre oficial Bolsa de Santiago: falló (" + String(e.message || e).slice(0, 80) + ")"); }

// Si el run ocurre con la Bolsa de Santiago ABIERTA (antes de ~17:00 hora de Chile), el dato de HOY es un
// valor intradía, no un cierre: se descarta. El run programado (18:05 Chile) trae el cierre real del día.
const scHour = +new Date().toLocaleString("en-US", { timeZone: "America/Santiago", hour: "2-digit", hour12: false });
const todaySc = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
if (scHour < 17 && byDate[todaySc]) {
  delete byDate[todaySc];
  console.log(`Descartado ${todaySc}: mercado aún abierto (valor intradía, no cierre).`);
}

let days = Object.values(byDate)
  .filter(d => Object.keys(d.prices).length || d.ipsa != null)
  .sort((a, b) => (a.date < b.date ? -1 : 1));

// DÍA CALCO: si un día repite EXACTO el vector de precios del día anterior en TODAS las acciones (≥5),
// es un arrastre del upstream — un mercado abierto jamás cierra idéntico en 28/28 papeles — no un cierre real.
// Se vacían sus precios (el día sobrevive solo si trae un IPSA propio distinto). Caso real: los días
// 14/15/16-10-2024 repetían el vector del 11-10-2024. Nunca se copia un cierre anterior como dato del día.
let nCalco = 0;
for (let i = days.length - 1; i >= 1; i--) {
  const cur = days[i].prices || {}, ks = Object.keys(cur);
  if (ks.length < 5) continue;
  let j = i - 1; while (j >= 0 && !Object.keys(days[j].prices || {}).length) j--;
  if (j < 0) continue;
  const prev = days[j].prices || {};
  if (ks.every(t => prev[t] != null && prev[t] === cur[t])) {
    days[i].prices = {}; nCalco++;
    if (days[i].ipsa != null && days[i].ipsa === days[j].ipsa) delete days[i].ipsa;
  }
}
if (nCalco) {
  days = days.filter(d => Object.keys(d.prices).length || d.ipsa != null);
  console.log(`Día(s) CALCO descartados (todas las acciones repetían el cierre anterior): ${nCalco}`);
}

if (!days.length) { console.error("Sin datos. Errores:", errors); process.exit(1); }

const ipsaDays = days.filter(d => d.ipsa != null).length;
const tickerSet = new Set();
days.forEach(d => Object.keys(d.prices || {}).forEach(t => tickerSet.add(t)));
mkdirSync("data", { recursive: true });
const source = "Yahoo Finance (.SN)" + (process.env.EODHD_KEY ? " + EODHD (cierres oficiales)" : "") + " + cierre oficial Bolsa de Santiago (día) + fuentes IPSA";
writeFileSync("data/closes.json", JSON.stringify({ updatedAt: new Date().toISOString(), source, ipsaSources, fuenteOficial: officialLog, ajustesDeFuente: ADJUST_LOG, errors, days }, null, 1));
if (ADJUST_LOG.length) console.log(`Ajustes de fuente (cierre oficial/EODHD pisó a Yahoo): ${ADJUST_LOG.length} — ej: ${JSON.stringify(ADJUST_LOG[0])}`);
console.log(`OK: ${days.length} día(s) (${days[0].date} → ${days[days.length - 1].date}) · ${tickerSet.size} acciones · IPSA en ${ipsaDays} día(s). Errores: ${errors.length ? errors.join("; ") : "ninguno"}`);
