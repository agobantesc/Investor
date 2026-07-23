// Cotizaciones EN VIVO (intradía, diferidas ~15 min) del universo Investor + IPSA, desde el runner de
// GitHub Actions — que SÍ llega a Yahoo sin CORS ni proxies (el mismo camino probado de los cierres diarios
// y de fundamentos). El workflow live-quotes.yml lo corre cada 15 min en horario bursátil y publica
// data/live.json en la rama `live-data` (force-push: una sola punta, sin ensuciar el historial).
// La app lo consume como capa 1 de su vista EN VIVO; los proxies CORS del navegador quedan de respaldo.
// SOLO VISUALIZACIÓN: este archivo jamás toca data/closes.json ni la historia de cierres.
import { writeFileSync, mkdirSync } from "node:fs";
import { TICKERS } from "./tickers.mjs";

const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ¿Bolsa de Santiago en horario? L–V 09:25–17:20 (margen sobre 09:30–17:15 para no perder puntas).
// El cron corre en UTC con margen para el cambio de hora chileno; el corte fino se decide aquí.
function marketOpenSantiago() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = k => { const x = p.find(o => o.type === k); return x ? x.value : ""; };
  if (["Sat", "Sun"].includes(g("weekday"))) return false;
  let hh = +g("hour"); if (hh === 24) hh = 0;
  const mins = hh * 60 + +g("minute");
  return mins >= 565 && mins <= 1040;
}

if (!marketOpenSantiago() && !process.env.FORCE) {
  console.log("Bolsa de Santiago cerrada: no se publica live.json (usa FORCE=1 para forzar).");
  process.exit(0);
}

// cookie + crumb de Yahoo (v7 quote lo exige; mismo helper probado en fetch-closes/fetch-fundamentals)
let _yCookie = null, _yCrumb = null;
async function yahooAuth() {
  if (_yCookie && _yCrumb) return;
  for (const u of ["https://fc.yahoo.com/", "https://finance.yahoo.com/"]) {
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

const symToTick = {}; for (const [t, s] of Object.entries(TICKERS)) symToTick[s] = t;
const quotes = {}; let ipsa = null; const log = [];

// CAPA 1: v7 quote en LOTE (todo el universo + ^IPSA en 1-2 requests) con cookie+crumb
try {
  await yahooAuth();
  const syms = [...Object.values(TICKERS), "^IPSA"];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(`https://${host}/v7/finance/quote?symbols=${encodeURIComponent(syms.join(","))}&crumb=${encodeURIComponent(_yCrumb)}`, { headers: { "User-Agent": BUA, Cookie: _yCookie, Accept: "application/json" } });
      if (!r.ok) { log.push(`quote ${host}: HTTP ${r.status}`); continue; }
      const j = await r.json();
      const arr = j && j.quoteResponse && j.quoteResponse.result;
      if (!Array.isArray(arr) || !arr.length) { log.push(`quote ${host}: sin resultados`); continue; }
      for (const q of arr) {
        const px = +q.regularMarketPrice, ts = q.regularMarketTime ? +q.regularMarketTime * 1000 : Date.now();
        const chg = (q.regularMarketChangePercent != null && isFinite(+q.regularMarketChangePercent)) ? +(+q.regularMarketChangePercent).toFixed(2) : null;
        if (!isFinite(px) || px <= 0) continue;
        if (q.symbol === "^IPSA") ipsa = { px: +px.toFixed(2), ts, chg };
        else { const t = symToTick[q.symbol]; if (t) quotes[t] = { px: +px, ts, chg }; }
      }
      if (Object.keys(quotes).length) { log.push(`quote ${host}: ${Object.keys(quotes).length} acciones${ipsa ? " + IPSA" : ""}`); break; }
    } catch (e) { log.push(`quote ${host}: ${String((e && e.message) || e).slice(0, 60)}`); }
  }
} catch (e) { log.push("auth: " + String((e && e.message) || e).slice(0, 60)); }

// CAPA 2 (respaldo): v8 chart por símbolo — sin crumb — para lo que falte
const missing = Object.keys(TICKERS).filter(t => !quotes[t]);
if (missing.length || !ipsa) {
  const wants = [...missing.map(t => [t, TICKERS[t]]), ...(!ipsa ? [["^IPSA", "^IPSA"]] : [])];
  await Promise.allSettled(wants.map(async ([t, sym]) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`, { headers: { "User-Agent": BUA, Accept: "application/json" } });
      if (!r.ok) return;
      const j = await r.json(), m = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      const px = m && +m.regularMarketPrice, ts = m && m.regularMarketTime ? +m.regularMarketTime * 1000 : Date.now();
      const prev = m && +(m.chartPreviousClose || m.previousClose);
      const chg = (isFinite(prev) && prev > 0 && isFinite(px)) ? +((px / prev - 1) * 100).toFixed(2) : null;
      if (!isFinite(px) || px <= 0) return;
      if (t === "^IPSA") ipsa = { px: +px.toFixed(2), ts, chg };
      else quotes[t] = { px: +px, ts, chg };
    } catch (e) {}
  }));
  log.push(`chart respaldo: pedidos ${wants.length}`);
}

const n = Object.keys(quotes).length;
if (!n && !ipsa) { console.error("Sin cotizaciones. Log:", log.join(" · ")); process.exit(1); }

mkdirSync("data", { recursive: true });
writeFileSync("data/live.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "yahoo (diferido ~15 min)", log, ipsa, quotes }));
console.log(`live.json publicado: ${n} acciones${ipsa ? ` · IPSA ${ipsa.px} (${ipsa.chg != null ? ipsa.chg + "%" : "s/var"})` : ""}`);
