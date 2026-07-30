#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Investor · verificador POST-DESPLIEGUE

   Comprueba, contra el servicio YA PUBLICADO en Render, que todo quedó bien:
   la app se sirve, los cierres del día están ahí, la API de respaldos exige
   token, el disco persistente responde y (opcionalmente) que el respaldo
   sube y baja idéntico.

   Uso:
     node automation/verify-deploy.mjs https://investor-XXXX.onrender.com
     node automation/verify-deploy.mjs https://investor-XXXX.onrender.com TU_SYNC_TOKEN

   Si activaste la PUERTA DEL SITIO (AUTH_USER/AUTH_PASS), pon las credenciales en la
   propia URL, como en cualquier navegador:
     node automation/verify-deploy.mjs https://usuario:clave@investor-XXXX.onrender.com TU_SYNC_TOKEN

   Sin token verifica lo público (app, datos, que la API esté cerrada).
   Con token verifica además la caja fuerte completa, incluida una escritura
   de prueba que NO toca tu respaldo real (se escribe y se restaura el previo).
   ═══════════════════════════════════════════════════════════════════════════ */
let ARG = (process.argv[2] || "").replace(/\/+$/, "");
const TOKEN = (process.argv[3] || process.env.SYNC_TOKEN || "").trim();

if (!ARG || !/^https?:\/\//.test(ARG)) {
  console.error("Uso: node automation/verify-deploy.mjs https://tu-servicio.onrender.com [SYNC_TOKEN]");
  console.error("     (con puerta activa: https://usuario:clave@tu-servicio.onrender.com)");
  process.exit(2);
}
/* credenciales de la puerta embebidas en la URL (fetch no las envía solo: se extraen y viajan como header) */
let BASIC = "";
{
  const u = new URL(ARG);
  if (u.username || u.password) {
    BASIC = "Basic " + Buffer.from(decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password), "utf8").toString("base64");
    u.username = ""; u.password = "";
    ARG = u.toString().replace(/\/+$/, "");
  }
}
const URL_BASE = ARG;

const R = [];
const ok = (id, cond, det) => { R.push({ id, cond }); console.log((cond ? "  ✓ " : "  ✗ ") + id + (det ? "  " + det : "")); };
const H = (extra) => Object.assign({}, BASIC ? { Authorization: BASIC } : {}, extra || {});
const get = (p, tok) => fetch(URL_BASE + p, { headers: H(tok ? { "x-investor-token": tok } : {}), cache: "no-store" });

const T0 = Date.now();
console.log("\nVerificando " + URL_BASE + "\n");

try {
  // ── 1. la app responde y es Investor ──
  console.log("Aplicación");
  const t0 = Date.now();
  let idx, html;
  try { idx = await fetch(URL_BASE + "/", { headers: H() }); html = await idx.text(); }
  catch (e) {
    console.error("\n✗ No se pudo conectar con " + URL_BASE);
    console.error("  (" + e.message + ")\n");
    console.error("  Revisa que:");
    console.error("   · la URL sea la que muestra Render arriba del servicio (https://investor-XXXX.onrender.com)");
    console.error("   · el deploy haya TERMINADO (en Render debe decir «Live», no «Building» o «Deploying»)");
    process.exit(1);
  }
  const ms = Date.now() - t0;
  // la PUERTA del sitio está activa y no le pasamos credenciales (o son incorrectas)
  if (idx.status === 401 && /^Basic/i.test(idx.headers.get("www-authenticate") || "")) {
    console.error("\n✗ El sitio pide usuario y contraseña" + (BASIC ? ", y las que diste no son correctas." : " (tienes la puerta activada)."));
    console.error("\n  Vuelve a ejecutarlo con las credenciales en la URL:");
    console.error("    node automation/verify-deploy.mjs https://USUARIO:CLAVE@" + URL_BASE.replace(/^https?:\/\//, "") + (TOKEN ? " " + "TU_SYNC_TOKEN" : ""));
    console.error("\n  Las encuentras en Render → tu servicio → Environment (AUTH_USER y AUTH_PASS).");
    console.error("  Si la clave lleva caracteres raros (@ : / #), codifícalos o cámbiala por una sin ellos.");
    process.exit(1);
  }
  if (!html.trim().startsWith("<")) {
    console.error("\n✗ " + URL_BASE + " respondió HTTP " + idx.status + ", pero no devolvió una página web.");
    console.error("  Respuesta: " + html.slice(0, 120).replace(/\s+/g, " "));
    console.error("\n  Suele ser una URL equivocada (¿es la de tu servicio en Render?) o un deploy aún en curso.");
    process.exit(1);
  }
  ok("la app responde (HTTP " + idx.status + ", " + ms + " ms)", idx.status === 200);
  ok("es Investor y viene completa (" + Math.round(html.length / 1024) + " KB)", html.includes("Investor") && html.length > 400000);
  ok("se sirve como HTML", (idx.headers.get("content-type") || "").includes("text/html"));
  if (ms > 20000) console.log("     ⚠ tardó " + ms + " ms: si estás en plan Free, el servicio estaba dormido.");

  // ── 2. datos del día ──
  console.log("\nDatos de mercado");
  const cl = await get("/data/closes.json");
  ok("closes.json disponible (HTTP " + cl.status + ")", cl.status === 200);
  if (cl.status === 200) {
    const j = await cl.json();
    const días = (j.days || []).length;
    const último = días ? j.days[días - 1].date : "—";
    const conIpsa = (j.days || []).filter(d => d.ipsa > 0).length;
    const edadH = j.updatedAt ? (Date.now() - new Date(j.updatedAt).getTime()) / 36e5 : null;
    ok("historia completa (" + días + " días, hasta " + último + ")", días > 200);
    ok("IPSA presente en " + conIpsa + " de " + días + " días", conIpsa >= días * 0.9);
    ok("datos frescos (" + (edadH == null ? "?" : edadH.toFixed(1) + " h desde la última corrida") + ")", edadH == null || edadH < 72,
      edadH != null && edadH >= 72 ? "→ revisa el workflow de cierres en GitHub Actions" : "");
  }

  // ── 3. salud del servicio y del disco ──
  console.log("\nServicio y disco");
  const h = await (await get("/api/health")).json();
  ok("health responde", h.ok === true);
  ok("SYNC_TOKEN configurado en el servidor", h.tokenConfigured === true,
    h.tokenConfigured ? "" : "→ Render → el servicio → Environment → SYNC_TOKEN");
  ok("estado del respaldo: " + (h.hasBackup ? ("existe, del " + new Date(h.savedAt).toLocaleString("es-CL")) : "aún no hay (normal si recién desplegaste)"), true);

  // ── 4. la API está CERRADA sin token (nadie puede leer tus datos) ──
  console.log("\nSeguridad");
  const sinTok = await get("/api/backup/meta");
  const malTok = await get("/api/backup/meta", "token-incorrecto");
  ok("sin token → " + sinTok.status + " (debe ser 401)", sinTok.status === 401);
  ok("con token errado → " + malTok.status + " (debe ser 401)", malTok.status === 401);
  const srv = await get("/server.js");
  ok("el código del servidor no se sirve (" + srv.status + ")", srv.status === 404);

  // ── 5. caja fuerte completa (solo con token) ──
  if (!TOKEN) {
    console.log("\nCaja fuerte: omitida (pasa tu SYNC_TOKEN como 2º argumento para probarla completa)");
  } else {
    console.log("\nCaja fuerte (con token)");
    const metaRes = await get("/api/backup/meta", TOKEN);
    ok("el token es válido (HTTP " + metaRes.status + ")", metaRes.status === 200);
    if (metaRes.status === 200) {
      const meta = await metaRes.json();
      ok("meta legible: " + meta.versions + " versión(es), " + Math.round((meta.bytes || 0) / 1024) + " KB", true);

      // respaldo real actual (para restaurarlo tras la prueba de escritura)
      let previo = null;
      if (meta.hasBackup) {
        const r = await get("/api/backup", TOKEN);
        if (r.status === 200) { previo = await r.json(); ok("el respaldo actual se descarga completo", !!(previo && previo.clients)); }
      }

      // escritura de prueba → verifica que el DISCO acepta escrituras
      const prueba = { _app: "portfolio-dashboard", _v: 2, _date: new Date().toISOString(),
        _prueba: "verify-deploy", clients_registry: null, active_client: null, broker: null, ui_scale: null, clients: {} };
      const put = await fetch(URL_BASE + "/api/backup", { method: "PUT", headers: H({ "x-investor-token": TOKEN, "Content-Type": "application/json" }), body: JSON.stringify(prueba) });
      ok("el disco acepta escrituras (HTTP " + put.status + ")", put.status === 200);
      const leído = await (await get("/api/backup", TOKEN)).json();
      ok("lo escrito se lee idéntico", leído && leído._prueba === "verify-deploy");

      // se devuelve el respaldo real (la prueba queda solo como versión histórica)
      if (previo) {
        const back = await fetch(URL_BASE + "/api/backup", { method: "PUT", headers: H({ "x-investor-token": TOKEN, "Content-Type": "application/json" }), body: JSON.stringify(previo) });
        const fin = await (await get("/api/backup", TOKEN)).json();
        ok("tu respaldo real quedó restaurado", back.status === 200 && JSON.stringify(fin) === JSON.stringify(previo));
      } else {
        console.log("     · no había respaldo previo: la prueba queda como primer respaldo (la app lo reemplazará al sincronizar)");
      }
    }
  }

  const fallos = R.filter(x => !x.cond);
  console.log("\n" + "─".repeat(58));
  if (!fallos.length) {
    console.log("DESPLIEGUE OK · " + R.length + " comprobaciones, 0 fallos  (" + ((Date.now() - T0) / 1000).toFixed(1) + " s)");
    if (!TOKEN) console.log("Siguiente paso: copia el SYNC_TOKEN desde Render → Environment y pégalo en\nla app: ⚙ Configuración → Respaldo → Nube → Probar conexión → ☁ Guardar ahora.");
    process.exit(0);
  }
  console.log("CON FALLOS · " + fallos.length + " de " + R.length + ":");
  fallos.forEach(f => console.log("  ✗ " + f.id));
  process.exit(1);
} catch (e) {
  console.error("\nNo se pudo verificar: " + e.message);
  console.error("Revisa que la URL sea la del servicio en Render y que el deploy haya terminado.");
  process.exit(1);
}
