/* DÍAS CORRUPTOS ("pico y vuelta") y órdenes de borrado — lógica pura, sin red, para poder probarla.
   La usa fetch-closes.mjs; la prueba es automation/tests/test_bot_borrar.js.

   Muchas acciones saltan >4% un día y lo devuelven >4% al siguiente, con el mercado tranquilo. Ninguna rueda
   real hace eso en bloque; es una foto mala del upstream. Caso real: 01-09-2026, nueve acciones a la vez
   (SQM-B −13,9% y vuelta, CAP +13,8% y vuelta, RIPLEY −9,0%…) mientras el índice se movía +0,6%. Con ≥5
   acciones así, lo de ese día no es confiable: se descarta (el IPSA también, salvo que sea oficial) y queda
   registrado en `borrar` para que la app lo quite de las bases locales que ya lo tenían.

   Tres resguardos (auditoría multiagente):
   · MERCADO TRANQUILO de verdad: si la mediana de la canasta o el IPSA oficial se movió más de 2,5% en
     cualquiera de los dos tramos, es una rueda real —pánico y rebote— y no se toca. Antes se descartaban los
     cierres REALES del peor día del mercado y el riesgo de las acciones candidatas lo omitía.
   · Lo que el CONSENSO WSJ + Yahoo-60m confirma (dos fuentes independientes) es real y se conserva. Antes el
     consenso lo rellenaba y este paso lo volvía a borrar, en cada corrida.
   · La orden se HEREDA del archivo previo (fecha de alta en `borrarDesde`) y vive 60 días, o hasta que el día
     vuelva a tener cierres (el consenso solo rellena lo confirmado). Antes duraba hasta la corrida siguiente
     y un navegador que no sincronizó en esa ventana se quedaba con los precios malos. */
export const PICO_MIN_ACC = 5, PICO_UMBRAL = 0.04, PICO_CALMA = 0.025, BORRAR_VIGENCIA_DIAS = 60;

const mediana = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const movIpsa = (x, y) => (x.ipsaOfi && y.ipsaOfi && x.ipsa > 0 && y.ipsa > 0) ? Math.abs(y.ipsa / x.ipsa - 1) : 0;

/* days: [{date, ipsa?, ipsaOfi?, ipsaSynth?, prices:{T:v}}] en orden ascendente (se modifica en el lugar).
   borrarPrev: {fecha: {modo:"precios"|"todo", desde:"AAAA-MM-DD"}} del archivo previo.
   confirmado(t, fecha, valor): ¿ese cierre lo confirma el consenso? · hoy: "AAAA-MM-DD" · log: para el registro.
   Devuelve {days, borrar, borrarDesde}. */
export function depurarDiasCorruptos(days, { borrarPrev = {}, confirmado = () => false, hoy, log = () => {} } = {}) {
  const borrar = {}, borrarDesde = {};
  const conPx = days.map((d, i) => i).filter(i => Object.keys(days[i].prices || {}).length >= 8);
  const malos = [];
  for (let k = 1; k < conPx.length - 1; k++) {
    const da = days[conPx[k - 1]], db = days[conPx[k]], dc = days[conPx[k + 1]];
    const a = da.prices, b = db.prices, c = dc.prices;
    const raros = [], r1s = [], r2s = [];
    for (const t in b) {
      if (!(a[t] > 0 && c[t] > 0)) continue;
      const r1 = b[t] / a[t] - 1, r2 = c[t] / b[t] - 1;
      r1s.push(r1); r2s.push(r2);
      if (Math.abs(r1) > PICO_UMBRAL && Math.abs(r2) > PICO_UMBRAL && Math.sign(r1) !== Math.sign(r2) && Math.abs(c[t] / a[t] - 1) < Math.abs(r1) / 2 && !confirmado(t, db.date, b[t])) raros.push(t);
    }
    if (raros.length < PICO_MIN_ACC) continue;
    const mov = Math.max(Math.abs(mediana(r1s)), Math.abs(mediana(r2s)), movIpsa(da, db), movIpsa(db, dc));
    if (mov > PICO_CALMA) { log(`Pico y vuelta el ${db.date} con el MERCADO en movimiento (${(mov * 100).toFixed(1)}%): rueda real, se conserva.`); continue; }
    malos.push([conPx[k], raros]);
  }
  for (const [i, raros] of malos) {
    const d = days[i];
    borrar[d.date] = d.ipsaOfi ? "precios" : "todo";
    const quedan = {}; for (const [t, v] of Object.entries(d.prices)) if (confirmado(t, d.date, v)) quedan[t] = v;
    const nq = Object.keys(quedan).length;
    log(`Día CORRUPTO descartado: ${d.date} — ${raros.length} acciones con pico y vuelta (${raros.join(", ")})${nq ? ` · se conservan ${nq} cierre(s) confirmados por el consenso` : ""}.`);
    d.prices = quedan;
    if (!d.ipsaOfi) { delete d.ipsa; delete d.ipsaSynth; }
  }
  if (malos.length) days = days.filter(d => Object.keys(d.prices).length || d.ipsa != null);
  // HERENCIA de las órdenes del archivo previo
  const porFecha = Object.fromEntries(days.map(d => [d.date, d]));
  let nHer = 0, nFin = 0;
  for (const [f, o] of Object.entries(borrarPrev)) {
    if (borrar[f]) { borrarDesde[f] = o.desde || hoy; continue; }   // detectado otra vez: conserva su fecha de alta
    const edad = (Date.parse(hoy) - Date.parse(o.desde || hoy)) / 864e5;
    const nPx = porFecha[f] ? Object.keys(porFecha[f].prices || {}).length : 0;
    if (!(edad <= BORRAR_VIGENCIA_DIAS) || nPx >= 8) { nFin++; continue; }   // venció, o el día ya tiene cierres de nuevo
    borrar[f] = o.modo; borrarDesde[f] = o.desde || hoy; nHer++;
  }
  for (const f of Object.keys(borrar)) if (!borrarDesde[f]) borrarDesde[f] = hoy;
  if (nHer || nFin) log(`Órdenes de borrado: ${nHer} heredada(s) vigente(s), ${nFin} cerrada(s) (vencidas o con el día de nuevo confirmado).`);
  return { days, borrar, borrarDesde };
}
