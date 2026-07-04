#!/usr/bin/env node
/**
 * fetch-fundamentals.mjs — obtiene los FUNDAMENTOS básicos del universo IPSA desde Yahoo Finance
 * (P/U, P/U forward, EPS, P/B, dividend yield, capitalización, rango 52 semanas, volumen) y escribe
 * data/fundamentals.json, que Investor sincroniza por el mismo canal que los cierres:
 *
 *   { "updatedAt": "...", "byTicker": { "BCI": { "px":…, "pe":…, "pb":…, "dy":…, "mcap":… }, … } }
 *
 * UNA sola llamada batch (v7/finance/quote con todos los símbolos). Yahoo exige cookie+crumb para
 * este endpoint: se hace el mismo "baile" que las librerías estándar (cookie de fc.yahoo.com →
 * crumb de /v1/test/getcrumb). Si algo falla, sale con código 0 SIN escribir: el archivo anterior
 * se conserva y el workflow de cierres nunca se rompe por culpa de los fundamentos.
 * Sin dependencias (Node 18+). Uso: node automation/fetch-fundamentals.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { TICKERS } from "./tickers.mjs";

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

async function getCrumb() {
  const r1 = await fetch("https://fc.yahoo.com/", { headers: UA, redirect: "manual" });
  const cookie = (r1.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Yahoo no entregó cookie");
  const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { ...UA, cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes("<")) throw new Error("Yahoo no entregó crumb (HTTP " + r2.status + ")");
  return { cookie, crumb };
}

async function quoteBatch(symbols) {
  const base = "https://query2.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(","));
  // 1º sin crumb (a veces basta) · 2º con cookie+crumb (camino estándar)
  let hdrs = UA, url = base;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) { const { cookie, crumb } = await getCrumb(); hdrs = { ...UA, cookie }; url = base + "&crumb=" + encodeURIComponent(crumb); }
    try {
      const r = await fetch(url, { headers: hdrs });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const out = j && j.quoteResponse && j.quoteResponse.result;
      if (!Array.isArray(out) || !out.length) throw new Error("respuesta sin resultados");
      return out;
    } catch (e) { if (attempt === 1) throw e; console.log("Sin crumb falló (" + String(e.message || e) + "); reintentando con cookie+crumb…"); }
  }
}

const num = v => (v != null && isFinite(+v)) ? +v : null;
const rnd = (v, d) => v == null ? null : +v.toFixed(d);
// SANEO: Yahoo a veces trae basura en los .SN (p.ej. P/B de SQM-B = 3.269 por moneda del valor libro,
// o yield 0 cuando simplemente no tiene el dato). Fuera de rango plausible → null (la app muestra "—").
const inRange = (v, lo, hi) => (v != null && v > lo && v < hi) ? v : null;

try {
  const bySym = {}; Object.entries(TICKERS).forEach(([t, s]) => bySym[s] = t);
  const rows = await quoteBatch(Object.values(TICKERS));
  const byTicker = {};
  rows.forEach(q => {
    const t = bySym[q.symbol]; if (!t) return;
    const px = num(q.regularMarketPrice);
    // dividend yield: Yahoo lo trae como fracción (trailingAnnualDividendYield) o se deriva de la tasa anual/px
    let dy = num(q.trailingAnnualDividendYield); if (dy != null) dy *= 100;
    if (dy == null && num(q.trailingAnnualDividendRate) != null && px > 0) dy = q.trailingAnnualDividendRate / px * 100;
    byTicker[t] = {
      name: q.longName || q.shortName || t,
      px, pe: rnd(inRange(num(q.trailingPE), 0, 500), 2), fpe: rnd(inRange(num(q.forwardPE), 0, 500), 2),
      eps: rnd(num(q.epsTrailingTwelveMonths), 2), pb: rnd(inRange(num(q.priceToBook), 0, 100), 2),
      dy: rnd(inRange(dy, 0, 30), 2), dps: inRange(rnd(num(q.trailingAnnualDividendRate), 2), 0, Infinity),
      mcap: num(q.marketCap), hi52: num(q.fiftyTwoWeekHigh), lo52: num(q.fiftyTwoWeekLow),
      vol3m: num(q.averageDailyVolume3Month),
    };
  });
  const n = Object.keys(byTicker).length;
  if (n < 5) throw new Error("solo " + n + " acciones con datos: respuesta sospechosa, no se escribe");
  mkdirSync("data", { recursive: true });
  writeFileSync("data/fundamentals.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "Yahoo Finance (v7 quote)", n, byTicker }, null, 1));
  const conPe = Object.values(byTicker).filter(f => f.pe != null).length;
  console.log(`OK: fundamentos de ${n} acciones (${conPe} con P/U). Ej BCI: ${JSON.stringify(byTicker.BCI || {})}`);
} catch (e) {
  // salida SUAVE: los fundamentos son un extra — nunca deben romper el workflow ni borrar el archivo anterior
  console.error("Fundamentos no disponibles en esta corrida: " + String((e && e.message) || e));
  process.exit(0);
}
