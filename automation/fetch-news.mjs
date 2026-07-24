// Titulares financieros/económicos de Chile para el Home de Investor, desde el runner de GitHub Actions
// (que llega a Google News sin CORS ni proxies — el mismo patrón probado de cierres y fundamentos).
// El workflow news.yml lo corre varias veces al día hábil y publica data/news.json en la rama `news-data`
// (force-push: una sola punta, sin ensuciar el historial). La app lo lee como capa 1; los proxies CORS del
// navegador quedan solo de respaldo. Formato: {updatedAt, source, items:[{title,link,src,ts}]}.
import { writeFileSync, mkdirSync } from "node:fs";

const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const QUERIES = [
  "economía OR mercados OR IPSA OR bolsa Chile",
  "acciones OR empresas OR dividendos bolsa de Santiago",
];
const feedUrl = q => "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=es-419&gl=CL&ceid=CL:es";

const unesc = s => (s || "")
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/<[^>]+>/g, "").trim();

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const pick = tag => { const x = b.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">")); return x ? x[1] : ""; };
    let title = unesc(pick("title")), link = unesc(pick("link")), src = unesc(pick("source")), pub = unesc(pick("pubDate"));
    // Google News suele traer "Titular - Medio": separa el medio si no vino la etiqueta <source>
    const t2 = title.match(/^(.*) - ([^-]{2,40})$/);
    if (t2) { title = t2[1].trim(); if (!src) src = t2[2].trim(); }
    let ts = 0; try { if (pub) ts = new Date(pub).getTime() || 0; } catch (e) {}
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, src, ts });
  }
  return items;
}

const all = []; const log = [];
for (const q of QUERIES) {
  try {
    const r = await fetch(feedUrl(q), { headers: { "User-Agent": BUA, "Accept": "application/rss+xml,text/xml,*/*" } });
    if (!r.ok) { log.push(`"${q.slice(0, 24)}…": HTTP ${r.status}`); continue; }
    const items = parseRss(await r.text());
    log.push(`"${q.slice(0, 24)}…": ${items.length} titulares`);
    all.push(...items);
  } catch (e) { log.push(`"${q.slice(0, 24)}…": ${String((e && e.message) || e).slice(0, 60)}`); }
}

// dedupe por titular (normalizado), lo más reciente primero, tope 20
const seen = new Set();
const items = all
  .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  .filter(n => { const k = n.title.toLowerCase().replace(/\s+/g, " ").slice(0, 90); if (seen.has(k)) return false; seen.add(k); return true; })
  .slice(0, 20);

if (!items.length) { console.error("Sin titulares. Log:", log.join(" · ")); process.exit(1); }

mkdirSync("data", { recursive: true });
writeFileSync("data/news.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "Google News (Chile)", log, items }));
console.log(`news.json publicado: ${items.length} titulares · ${log.join(" · ")}`);
