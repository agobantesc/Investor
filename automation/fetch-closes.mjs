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
  CENCOSHOPP: "CENCOSHOPP.SN",
  VAPORES: "VAPORES.SN",
  RIPLEY: "RIPLEY.SN",
  SMU: "SMU.SN",
  SONDA: "SONDA.SN",
  ITAUCL: "ITAUCL.SN",
  SECURITY: "SECURITY.SN",
  CAP: "CAP.SN",
};
const IPSA_SYMBOL = "^IPSA";
const DAYS_BACK = "10d"; // trae ~2 semanas para rellenar días perdidos (la fusión de Investor es por celda, no duplica)

async function chart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${DAYS_BACK}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (investor-closes)" } });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`${symbol}: sin datos`);
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const out = {};
  ts.forEach((t, i) => {
    const c = closes[i];
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
  const ipsa = await chart(IPSA_SYMBOL);
  for (const [d, v] of Object.entries(ipsa)) (byDate[d] ??= { date: d, prices: {} }).ipsa = v;
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

mkdirSync("data", { recursive: true });
writeFileSync("data/closes.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "Yahoo Finance (.SN)", errors, days }, null, 1));
console.log(`OK: ${days.length} día(s), último ${days[days.length - 1].date}. Errores: ${errors.length ? errors.join("; ") : "ninguno"}`);
