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
import { writeFileSync, mkdirSync } from "node:fs";

// Universo IPSA (~30). Clave = ticker en Investor, valor = símbolo Yahoo Finance (.SN = Bolsa de Santiago).
const TICKERS = {
  // núcleo (con historial demo en la app)
  CHILE: "CHILE.SN",
  SANTANDER: "BSANTANDER.SN",
  BCI: "BCI.SN",
  ENELCHILE: "ENELCHILE.SN",
  COLBUN: "COLBUN.SN",
  FALABELLA: "FALABELLA.SN",
  CENCOSUD: "CENCOSUD.SN",
  COPEC: "COPEC.SN",
  CMPC: "CMPC.SN",
  "SQM-B": "SQM-B.SN",
  CCU: "CCU.SN",
  ENTEL: "ENTEL.SN",
  LATAM: "LTM.SN",
  PARAUCO: "PARAUCO.SN",
  // resto del IPSA
  "AGUAS-A": "AGUAS-A.SN",
  IAM: "IAM.SN",
  ENELAM: "ENELAM.SN",
  ECL: "ECL.SN",
  "ANDINA-B": "ANDINA-B.SN",
  CONCHATORO: "CONCHATORO.SN",
  QUINENCO: "QUINENCO.SN",
  MALLPLAZA: "MALLPLAZA.SN",
  VAPORES: "VAPORES.SN",
  RIPLEY: "RIPLEY.SN",
  SMU: "SMU.SN",
  SONDA: "SONDA.SN",
  ITAUCL: "ITAUCL.SN",
  BICECORP: "BICECORP.SN",   // Grupo Security se fusionó con BICE en 2025 → BICECORP es el nombre IPSA vigente (SECURITY.SN dejó de existir)
  CAP: "CAP.SN",
  // CENCOSHOPP (Cencosud Shopping) no está en Yahoo con .SN; cárgalo por planilla si consigues sus cierres.
};
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

try {
  let ipsa = await chart(IPSA_SYMBOL);
  // el índice debería traer tantos días como las acciones; si viene escaso, reintenta con period1/period2
  if (Object.keys(ipsa).length < 10 && DAYS_BACK !== "10d") {
    try { const alt = await chart(IPSA_SYMBOL, true); if (Object.keys(alt).length > Object.keys(ipsa).length) ipsa = alt; } catch (e) {}
  }
  const nIpsa = Object.keys(ipsa).length;
  for (const [d, v] of Object.entries(ipsa)) (byDate[d] ??= { date: d, prices: {} }).ipsa = v;
  console.log(`IPSA: ${nIpsa} día(s).`);
  if (!nIpsa) errors.push("IPSA (^IPSA): 0 puntos — el análisis no podrá calcular β sin el índice.");
} catch (e) { errors.push(String(e.message || e)); }

for (const [tick, sym] of Object.entries(TICKERS)) {
  try {
    const px = await chart(sym);
    for (const [d, v] of Object.entries(px)) ((byDate[d] ??= { date: d, prices: {} }).prices[tick] = v);
  } catch (e) { errors.push(String(e.message || e)); }
  await new Promise(r => setTimeout(r, 350)); // cortesía con la API
}

const days = Object.values(byDate)
  .filter(d => Object.keys(d.prices).length || d.ipsa != null)
  .sort((a, b) => (a.date < b.date ? -1 : 1));

if (!days.length) { console.error("Sin datos. Errores:", errors); process.exit(1); }

const ipsaDays = days.filter(d => d.ipsa != null).length;
const tickerSet = new Set();
days.forEach(d => Object.keys(d.prices || {}).forEach(t => tickerSet.add(t)));
mkdirSync("data", { recursive: true });
writeFileSync("data/closes.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "Yahoo Finance (.SN)", errors, days }, null, 1));
console.log(`OK: ${days.length} día(s) (${days[0].date} → ${days[days.length - 1].date}) · ${tickerSet.size} acciones · IPSA en ${ipsaDays} día(s). Errores: ${errors.length ? errors.join("; ") : "ninguno"}`);
