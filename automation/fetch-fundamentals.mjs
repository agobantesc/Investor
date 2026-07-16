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
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
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

let AUTHC = { cookie: null, crumb: null };   // se comparte entre el batch y los quoteSummary
async function quoteBatch(symbols) {
  const base = "https://query2.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(","));
  // 1º sin crumb (a veces basta) · 2º y 3º con cookie+crumb (camino estándar), con pausa entre intentos:
  // un traspié transitorio de Yahoo no debe dejar la corrida del día sin fundamentos.
  let hdrs = UA, url = base, lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt >= 1) {
      try { AUTHC = await getCrumb(); hdrs = { ...UA, cookie: AUTHC.cookie }; url = base + "&crumb=" + encodeURIComponent(AUTHC.crumb); }
      catch (e) { lastErr = e; }
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
    try {
      const r = await fetch(url, { headers: hdrs });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const out = j && j.quoteResponse && j.quoteResponse.result;
      if (!Array.isArray(out) || !out.length) throw new Error("respuesta sin resultados");
      return out;
    } catch (e) { lastErr = e; console.log("Batch intento " + (attempt + 1) + " falló (" + String(e.message || e) + ")" + (attempt < 2 ? "; reintentando…" : "")); }
  }
  throw lastErr || new Error("batch sin respuesta");
}
/* detalle por símbolo: ROE, márgenes, crecimiento, deuda, consenso de analistas y DIVIDENDOS
   (summaryDetail sube la cobertura de yield/dividendo por acción que el batch no siempre trae) */
async function quoteSummary(sym) {
  const url = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(sym)
    + "?modules=financialData%2CdefaultKeyStatistics%2CsummaryDetail" + (AUTHC.crumb ? ("&crumb=" + encodeURIComponent(AUTHC.crumb)) : "");
  const r = await fetch(url, { headers: AUTHC.cookie ? { ...UA, cookie: AUTHC.cookie } : UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return (j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0]) || null;
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
  // SEGUNDA PASADA (mejor esfuerzo): calidad, crecimiento, deuda y consenso de analistas por símbolo.
  // Si un símbolo falla, quedan solo sus datos del batch — nunca se pierde lo ya obtenido.
  const raw = v => (v && typeof v === "object") ? num(v.raw) : num(v);
  let sumOk = 0;
  for (const [t, sym] of Object.entries(TICKERS)) {
    if (!byTicker[t]) continue;
    try {
      let rSum;
      try { rSum = await quoteSummary(sym); }
      catch (e) { if (!AUTHC.crumb) { AUTHC = await getCrumb(); rSum = await quoteSummary(sym); } else throw e; }
      const fd = (rSum && rSum.financialData) || {}, ks = (rSum && rSum.defaultKeyStatistics) || {}, sd = (rSum && rSum.summaryDetail) || {};
      const f = byTicker[t];
      const pctOf = v => (raw(v) != null ? raw(v) * 100 : null);
      f.roe = rnd(inRange(pctOf(fd.returnOnEquity), -100, 200), 1);          // rentabilidad del patrimonio %
      f.nm = rnd(inRange(pctOf(fd.profitMargins), -100, 100), 1);            // margen neto %
      f.eg = rnd(inRange(pctOf(fd.earningsGrowth), -95, 400), 1);            // crecimiento de utilidades % (interanual)
      f.rg = rnd(inRange(pctOf(fd.revenueGrowth), -95, 400), 1);             // crecimiento de ingresos %
      f.de = rnd(inRange(raw(fd.debtToEquity) != null ? raw(fd.debtToEquity) / 100 : null, 0, 25), 2);   // deuda/patrimonio (Yahoo lo trae en %)
      f.target = inRange(raw(fd.targetMeanPrice), 0, Infinity);              // precio objetivo (consenso)
      f.rec = (fd.recommendationKey && typeof fd.recommendationKey === "string") ? fd.recommendationKey : null;
      f.nAn = inRange(raw(fd.numberOfAnalystOpinions), 0, 500);
      f.peg = rnd(inRange(raw(ks.pegRatio), -50, 50), 2);
      f.evEbitda = rnd(inRange(raw(ks.enterpriseToEbitda), 0, 200), 1);
      // RELLENO con datos REALES del 2º endpoint cuando el batch no los trajo (sube cobertura sin inventar nada):
      // P/B directo de defaultKeyStatistics, o derivado de price/bookValue; P/U fwd; margen desde financialData.
      if (f.pb == null) { let pb = inRange(raw(ks.priceToBook), 0, 100); if (pb == null) { const bv = raw(ks.bookValue); if (bv > 0 && f.px > 0) pb = inRange(f.px / bv, 0, 100); } f.pb = rnd(pb, 2); }
      if (f.fpe == null) f.fpe = rnd(inRange(raw(ks.forwardPE), 0, 500), 2);
      if (f.nm == null) f.nm = rnd(inRange(pctOf(ks.profitMargins), -100, 100), 1);
      // DIVIDENDOS desde summaryDetail cuando el batch no los trajo (cobertura real: Yahoo reparte estos campos
      // entre endpoints según el papel): monto por acción (dividendRate / trailingAnnualDividendRate) y yield.
      if (f.dps == null) f.dps = inRange(rnd(raw(sd.dividendRate) != null ? raw(sd.dividendRate) : raw(sd.trailingAnnualDividendRate), 2), 0, Infinity);
      if (f.dy == null) { let dy2 = raw(sd.dividendYield) != null ? raw(sd.dividendYield) * 100 : (raw(sd.trailingAnnualDividendYield) != null ? raw(sd.trailingAnnualDividendYield) * 100 : null); f.dy = rnd(inRange(dy2, 0, 30), 2); }
      // yield desde la tasa de dividendo si el batch no dio el ratio pero sí el monto
      if (f.dy == null && f.dps != null && f.px > 0) f.dy = rnd(inRange(f.dps / f.px * 100, 0, 30), 2);
      sumOk++;
    } catch (e) { /* sin detalle para este símbolo */ }
    await new Promise(res => setTimeout(res, 300));   // cortesía con la API
  }
  console.log(`Detalle (ROE/márgenes/analistas/dividendos): ${sumOk}/${n} símbolos.`);
  // ARRASTRE del archivo previo (fidelidad sin agujeros): si un ticker desapareció de ESTA corrida (traspié
  // puntual de Yahoo con ese símbolo) pero el archivo anterior lo traía y tiene ≤14 días, se conserva su dato
  // anterior MARCADO con la fecha de origen (carriedFrom) — la app puede mostrar su procedencia. Nunca se
  // arrastran campos sueltos (un dividendo suspendido debe poder desaparecer); solo tickers completos caídos.
  try {
    const prev = JSON.parse(readFileSync("data/fundamentals.json", "utf8"));
    const prevAge = (Date.now() - new Date(prev.updatedAt || 0).getTime()) / 864e5;
    if (prev && prev.byTicker && isFinite(prevAge) && prevAge <= 14) {
      let carried = 0;
      for (const [t, f] of Object.entries(prev.byTicker)) {
        if (byTicker[t] || !TICKERS[t]) continue;
        byTicker[t] = { ...f, carriedFrom: f.carriedFrom || (prev.updatedAt || "").slice(0, 10) };
        carried++;
      }
      if (carried) console.log(`Arrastrados del archivo previo (${(prev.updatedAt || "").slice(0, 10)}): ${carried} ticker(s) que esta corrida no trajo.`);
    }
  } catch (e) { /* sin archivo previo utilizable */ }
  const nOut = Object.keys(byTicker).length;
  // resumen de COBERTURA por campo (queda en el JSON: transparencia y diagnóstico de la fuente)
  const FIELDS = ["px", "pe", "fpe", "eps", "pb", "dy", "dps", "mcap", "hi52", "lo52", "vol3m", "roe", "nm", "eg", "rg", "de", "target", "rec", "nAn", "peg", "evEbitda"];
  const coverage = {}; FIELDS.forEach(k => coverage[k] = Object.values(byTicker).filter(f => f[k] != null).length);
  mkdirSync("data", { recursive: true });
  writeFileSync("data/fundamentals.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "Yahoo Finance (v7 quote)", n: nOut, coverage, byTicker }, null, 1));
  const conPe = Object.values(byTicker).filter(f => f.pe != null).length;
  console.log(`OK: fundamentos de ${nOut} acciones (${conPe} con P/U). Cobertura: ${FIELDS.map(k => k + " " + coverage[k]).join(", ")}`);
} catch (e) {
  // salida SUAVE: los fundamentos son un extra — nunca deben romper el workflow ni borrar el archivo anterior
  console.error("Fundamentos no disponibles en esta corrida: " + String((e && e.message) || e));
  process.exit(0);
}
