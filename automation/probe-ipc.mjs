#!/usr/bin/env node
/**
 * probe-ipc.mjs — SONDA de fuentes del IPC (y del resto de indicadores macro), para correr EN el runner.
 * No escribe nada: imprime, por candidato, si responde, cuántos puntos trae la serie, cuál es el dato MÁS
 * NUEVO y su antigüedad en días. Con eso se decide con evidencia por qué el IPC quedó congelado y qué
 * fuente promover a la app (el mismo método que resolvió el IPSA).
 */
const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HOY = new Date();
const diasDe = f => { if (!f) return null; const d = new Date(("" + f).slice(0, 10) + "T00:00:00"); return isNaN(d) ? null : Math.floor((HOY - d) / 864e5); };

async function getJson(url, ms) {
  const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), ms || 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": BUA, Accept: "application/json,text/plain,*/*" } });
    const txt = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status + " · " + txt.slice(0, 80));
    try { return JSON.parse(txt); } catch (e) { throw new Error("no-JSON · " + txt.slice(0, 100)); }
  } finally { clearTimeout(to); }
}

/* resume una serie [{fecha,valor}] → cuántos puntos, el más nuevo y su antigüedad */
function resumeSerie(tag, serie) {
  const s = (serie || []).filter(x => x && isFinite(+x.valor));
  if (!s.length) { console.log(`  ✗ ${tag}: serie VACÍA (0 puntos con valor)`); return; }
  const top = s.reduce((a, b) => ((("" + a.fecha) > ("" + b.fecha)) ? a : b));
  const d = diasDe(top.fecha);
  const cola = s.slice(0, 4).map(x => ("" + x.fecha).slice(0, 10) + "=" + x.valor).join(" · ");
  console.log(`  ${d != null && d <= 45 ? "✓" : "⚠"} ${tag}: ${s.length} punto(s) · más nuevo ${("" + top.fecha).slice(0, 10)} = ${top.valor} (hace ${d} d)`);
  console.log(`      primeros de la respuesta: ${cola}`);
}

console.log(`SONDA IPC · ${HOY.toISOString()}`);

// ── 1) mindicador: endpoint AGREGADO (el que usa la app como fuente principal) ──
console.log("\n[1] mindicador.cl/api (agregado) — lo que la app lee primero");
try {
  const j = await getJson("https://mindicador.cl/api");
  for (const k of ["ipc", "utm", "tpm", "imacec", "tasa_desempleo", "uf", "dolar"]) {
    const o = j[k];
    console.log(`  ${k.padEnd(15)} ${o ? (("" + o.fecha).slice(0, 10) + " = " + o.valor + "  (hace " + diasDe(o.fecha) + " d)") : "AUSENTE en la respuesta"}`);
  }
} catch (e) { console.log("  ✗ falló: " + String(e.message || e).slice(0, 160)); }

// ── 2) mindicador: SERIE propia del IPC (la reparación que la app ya intenta) ──
console.log("\n[2] mindicador.cl/api/ipc y variantes por año — la reparación actual de la app");
for (const u of ["https://mindicador.cl/api/ipc",
                 `https://mindicador.cl/api/ipc/${HOY.getFullYear()}`,
                 `https://mindicador.cl/api/ipc/${HOY.getFullYear() - 1}`]) {
  try { const j = await getJson(u); resumeSerie(u.replace("https://mindicador.cl/api/", ""), j && j.serie); }
  catch (e) { console.log(`  ✗ ${u}: ${String(e.message || e).slice(0, 140)}`); }
  await new Promise(r => setTimeout(r, 300));
}

// ── 3) OTRAS FUENTES públicas del IPC chileno ──
console.log("\n[3] fuentes alternativas");
// 3a) CMF (ex-SBIF): oficial, requiere apikey gratuita (secret CMF_KEY). Sin key, se informa y se salta.
if (process.env.CMF_KEY) {
  const y = HOY.getFullYear();
  for (const u of [`https://api.cmfchile.cl/api-sbifv3/recursos_api/ipc?apikey=${process.env.CMF_KEY}&formato=json`,
                   `https://api.cmfchile.cl/api-sbifv3/recursos_api/ipc/${y}?apikey=${process.env.CMF_KEY}&formato=json`]) {
    try { const j = await getJson(u); resumeSerie("CMF " + u.split("recursos_api/")[1].split("?")[0], (j && j.IPCs || []).map(x => ({ fecha: x.Fecha, valor: ("" + x.Valor).replace(",", ".") }))); }
    catch (e) { console.log(`  ✗ CMF: ${String(e.message || e).slice(0, 140)}`); }
    await new Promise(r => setTimeout(r, 300));
  }
} else console.log("  · CMF (api.cmfchile.cl): sin secret CMF_KEY — no se prueba (la key es gratuita en cmfchile.cl)");

// 3b) BCCh vía su servicio abierto de series (sin credenciales suele rechazar: se prueba igual)
try {
  const j = await getJson("https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx?user=&pass=&function=GetSeries&timeseries=F074.IPC.VAR.Z.EP23.C.M&firstdate=2025-01-01");
  console.log("  · BCCh respondió: " + JSON.stringify(j).slice(0, 160));
} catch (e) { console.log("  ✗ BCCh (si3.bcentral.cl): " + String(e.message || e).slice(0, 140)); }

// 3c) OTRAS APIs chilenas de indicadores (respuesta COMPLETA: interesa si traen ipc y con qué fecha)
for (const u of ["https://api.gael.cloud/general/public/indicadores",
                 "https://api.boostr.cl/economy/indicators.json",
                 "https://mindicador.cl/api/ipc/01-08-2026"]) {
  try {
    const j = await getJson(u, 12000);
    const txt = JSON.stringify(j);
    const tieneIpc = /ipc/i.test(txt);
    console.log(`  · ${u}: ${tieneIpc ? "MENCIONA ipc" : "sin ipc"} · ${txt.length} bytes`);
    if (tieneIpc) {
      // imprime solo lo relacionado con ipc para no inundar el log
      const m = txt.match(/.{0,160}ipc.{0,220}/i);
      console.log("      " + (m ? m[0] : "(no se pudo recortar)"));
    }
  } catch (e) { console.log(`  ✗ ${u}: ${String(e.message || e).slice(0, 140)}`); }
  await new Promise(r => setTimeout(r, 300));
}

// ── 4) ¿el problema es SOLO del IPC? Antigüedad de cada serie propia de mindicador ──
console.log("\n[4] serie propia de cada indicador mensual (¿está congelado solo el IPC?)");
for (const k of ["ipc", "utm", "tpm", "imacec", "tasa_desempleo"]) {
  try { const j = await getJson("https://mindicador.cl/api/" + k); resumeSerie(k, j && j.serie); }
  catch (e) { console.log(`  ✗ ${k}: ${String(e.message || e).slice(0, 120)}`); }
  await new Promise(r => setTimeout(r, 250));
}
console.log("\nFIN DE LA SONDA");
