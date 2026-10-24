/* test_datos.js — BATERÍA DE DATOS (sin navegador: lee los archivos del repo).
   Investor se usa para decidir con plata real, así que la base tiene que poder auditarse sola: integridad,
   saltos imposibles, congelamientos del índice, frescura y coherencia entre los cierres y los fundamentos. */
const { readFileSync } = require("fs");
const path = require("path");
const RAIZ = path.resolve(__dirname, "../..");
const CL = JSON.parse(readFileSync(path.join(RAIZ, "data/closes.json"), "utf8"));
const FU = JSON.parse(readFileSync(path.join(RAIZ, "data/fundamentals.json"), "utf8"));

const fallos = [];
let n = 0;
const ok = (nombre, cond, detalle) => { n++; if (!cond) fallos.push(nombre); console.log(`${nombre} ${cond ? "OK" : "FALLA"} ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}`); };
const mediana = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const diasDe = f => Math.floor((Date.now() - new Date(f + "T00:00:00").getTime()) / 864e5);

const days = CL.days || [];

// ── 1. INTEGRIDAD: fechas válidas, ordenadas, sin repetidas y todas con precios ──
const fechas = days.map(d => d.date);
ok("1-INTEGRIDAD-DE-LA-BASE",
  days.length > 100
  && fechas.every(f => /^\d{4}-\d{2}-\d{2}$/.test(f))
  && fechas.every((f, i) => i === 0 || fechas[i - 1] < f)
  && days.every(d => d.prices && typeof d.prices === "object"),
  { dias: days.length, desde: fechas[0], hasta: fechas[fechas.length - 1] });

// ── 2. SALTOS IMPOSIBLES en acciones (>30% de un día al siguiente = dato sospechoso) ──
const saltos = [];
for (let i = 1; i < days.length; i++) {
  const a = days[i - 1].prices || {}, b = days[i].prices || {};
  for (const t of Object.keys(b)) if (a[t] > 0 && b[t] > 0 && Math.abs(b[t] / a[t] - 1) > 0.30) saltos.push(`${t} ${days[i].date} ${(b[t] / a[t] - 1 > 0 ? "+" : "")}${((b[t] / a[t] - 1) * 100).toFixed(0)}%`);
}
ok("2-SIN-SALTOS-IMPOSIBLES-EN-ACCIONES", saltos.length === 0, saltos.slice(0, 5));

// ── 3. EL ÍNDICE: sin saltos absurdos y sin quedarse congelado (el síntoma del feed muerto) ──
const ip = days.filter(d => d.ipsa > 0).map(d => ({ d: d.date, v: d.ipsa }));
let racha = 0, rachaMax = 0, saltosIp = 0;
for (let i = 1; i < ip.length; i++) {
  if (ip[i].v === ip[i - 1].v) { racha++; rachaMax = Math.max(rachaMax, racha); } else racha = 0;
  if (Math.abs(ip[i].v / ip[i - 1].v - 1) > 0.10) saltosIp++;
}
ok("3-INDICE-SANO", saltosIp === 0 && rachaMax <= 2 && ip.length > 100,
  { dias: ip.length, saltos: saltosIp, rachaCongelada: rachaMax, ultimo: ip[ip.length - 1] });

// ── 4. FRESCURA: la base no puede ir más de una semana atrás del último día hábil ──
const ult = fechas[fechas.length - 1];
const atraso = diasDe(ult);
ok("4-BASE-FRESCA", atraso <= 7, { ultimo: ult, diasDeAtraso: atraso, acciones: Object.keys(days[days.length - 1].prices || {}).length });

// ── 5. FUNDAMENTOS coherentes con los cierres (el precio de la foto no puede irse >10% del cierre) ──
const bt = FU.byTicker || {}, last = days[days.length - 1].prices || {};
const desviados = Object.keys(bt).filter(t => bt[t] && bt[t].px > 0 && last[t] > 0 && Math.abs(last[t] / bt[t].px - 1) > 0.10)
  .map(t => `${t} ${((last[t] / bt[t].px - 1) * 100).toFixed(0)}%`);
ok("5-FUNDAMENTOS-COHERENTES", desviados.length === 0, { desviados: desviados.slice(0, 5), fundamentosAl: ("" + FU.updatedAt).slice(0, 10) });

// ── 6. RANGOS de 52 semanas que contienen al precio (con holgura por el desfase de la foto) ──
const fuera = Object.keys(bt).filter(t => { const f = bt[t]; return f && f.px > 0 && f.hi52 > 0 && f.lo52 > 0 && !(f.px >= f.lo52 * 0.85 && f.px <= f.hi52 * 1.15); });
ok("6-RANGOS-52S-CONSISTENTES", fuera.length === 0, fuera.slice(0, 5));

// ── 7. MOVIMIENTO REAL del último día: si casi nada cambió, el feed está sirviendo un calco ──
const a = days[days.length - 2].prices || {}, b = last;
const comunes = Object.keys(b).filter(t => a[t] > 0);
const iguales = comunes.filter(t => a[t] === b[t]).length;
const movs = comunes.map(t => Math.abs(b[t] / a[t] - 1) * 100);
ok("7-EL-ULTIMO-DIA-SE-MOVIO", comunes.length === 0 || iguales < comunes.length * 0.5,
  { identicos: iguales, de: comunes.length, medianaPct: +mediana(movs).toFixed(2) });

// ── 8. COMPLETITUD del último año: cada día hábil con precios trae TODAS las acciones (salvo SONDA, que
//      transa poco y ninguna segunda fuente confirma). Antes, la barra diaria de Yahoo dejaba días con 0–3
//      acciones (20, 22 y 24-07, 03-08, 27-08, 01-09-2026) y las curvas del Seguimiento quedaban cortadas.
//      Se tolera UNA celda suelta por día (una acción sin cierre confirmado por las dos fuentes). ──
const universo = new Set(); days.forEach(d => Object.keys(d.prices || {}).forEach(t => universo.add(t)));
const haceUnAno = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const incompletos = days.filter(d => d.date >= haceUnAno && Object.keys(d.prices || {}).length)
  .map(d => ({ f: d.date, faltan: [...universo].filter(t => t !== "SONDA" && !(d.prices[t] > 0)) }))
  .filter(x => x.faltan.length > 1);
ok("8-DIAS-HABILES-COMPLETOS", incompletos.length === 0, { universo: universo.size, incompletos: incompletos.slice(0, 5), consenso: CL.consenso || null });

// ── 9. SIN PRECIOS CONGELADOS en el último año: una acción líquida no cierra idéntica 4 días hábiles seguidos.
//      Así se colaban los valores congelados de la barra diaria de Yahoo (SQM-B 65.450 del 14 al 17-09-2026). ──
const ultAnio = days.filter(d => d.date >= haceUnAno);
const congelados = [];
for (const t of universo) { if (t === "SONDA") continue; let run = 1;
  for (let i = 1; i < ultAnio.length; i++) { const x = ultAnio[i - 1].prices[t], y = ultAnio[i].prices[t];
    if (x > 0 && x === y) { run++; if (run === 4) congelados.push(t + " hasta " + ultAnio[i].date + " = " + y); } else run = 1; } }
ok("9-SIN-PRECIOS-CONGELADOS", congelados.length === 0, congelados.slice(0, 5));

console.log(`RESUMEN ${fallos.length ? "CON FALLOS" : "TODO OK"} ${JSON.stringify({ total: n, ok: n - fallos.length, fallan: fallos })}`);
process.exit(fallos.length ? 1 : 0);
