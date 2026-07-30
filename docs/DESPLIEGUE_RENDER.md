# Investor en Render · guía de despliegue

Publica Investor como página web con **disco de datos persistente**: tus respaldos
quedan guardados en el servidor aunque se borre el navegador, y puedes entrar
desde el teléfono con los mismos datos.

## Cómo funciona

- La app sigue siendo la misma (`index.html`): tus datos viven en el navegador
  (localStorage), rápido y privado como siempre.
- El servidor (`server.js`) agrega una **caja fuerte**: la app sube una copia
  completa de tus datos al **disco persistente** de Render (~45 s después de cada
  cambio, si activas el respaldo automático). Se conservan las últimas 40 versiones.
- Si abres Investor en un navegador vacío (teléfono nuevo, navegador borrado), la
  app detecta el respaldo en la nube y **ofrece restaurarlo** con un clic.

### Dos capas de protección (independientes)

| Capa | Qué protege | Cómo se pasa |
|---|---|---|
| **Puerta del sitio** (`AUTH_USER` + `AUTH_PASS`) | Todo: la página, los datos y la API. Un desconocido que dé con tu URL ni siquiera ve que Investor existe ahí. | Diálogo nativo del navegador; tu gestor de contraseñas lo recuerda. |
| **Caja fuerte** (`SYNC_TOKEN`) | La API de respaldos, aunque alguien pasara la puerta. | Se pega una vez en la app (⚙ Configuración → Respaldo → Nube). |

Son independientes a propósito: pasar la puerta **no** da acceso a los respaldos, y el
token **no** abre la puerta. Ambas vienen configuradas en el Blueprint.

> `/api/health` queda siempre accesible sin credenciales, porque Render la consulta para
> saber si el servicio está vivo (si la bloqueáramos, lo reiniciaría en bucle). Sin
> autenticar responde solo que está en pie: ningún dato de tu respaldo.

Si prefieres el sitio abierto, borra `AUTH_USER` y `AUTH_PASS` en el panel de Render:
el servidor detecta que faltan y no exige nada (el `SYNC_TOKEN` sigue protegiendo los
datos, y quien abra la URL verá un Investor vacío).

## Pasos (una sola vez, ~10 minutos)

Todo lo del repositorio ya está listo y verificado: solo tienes que desplegar el
Blueprint. No hay que inventar contraseñas ni tocar archivos.

1. **Crea el servicio desde el Blueprint**
   - Entra a <https://dashboard.render.com>.
   - `New → Blueprint` → conecta GitHub → elige el repo **agobantesc/Investor**.
   - Render lee `render.yaml` y propone todo hecho: el servicio `investor`, su disco
     `investor-datos` (1 GB en `/var/data`), la rama correcta y las claves
     **generadas automáticamente** (`SYNC_TOKEN` y `AUTH_PASS`). Solo confirma.
   - **Instance type**: déjalo en **Starter** (~US$7/mes). El disco persistente exige
     una instancia de pago; sin disco, los respaldos se borrarían en cada deploy.
     ⚠️ *No confundas* el **instance type** (tamaño de la máquina) con el **plan de tu
     cuenta** (Hobby/Professional): son cosas distintas y tener cuenta Pro no cambia
     nada aquí. Subir la instancia a Standard/Pro para esta app es gasto puro.
   - En 2–3 min el servicio queda **Live** con tu URL: `https://investor-XXXX.onrender.com`.

2. **Copia tus tres claves** (Render → tu servicio → `Environment` → *Reveal*)

   | Variable | Para qué | Dónde la usarás |
   |---|---|---|
   | `AUTH_USER` | Usuario de la puerta (viene como `investor`; cámbialo si quieres) | Al abrir la URL |
   | `AUTH_PASS` | Contraseña de la puerta (generada) | Al abrir la URL |
   | `SYNC_TOKEN` | Llave de la caja fuerte (generado) | Dentro de la app, una vez |

   Guárdalas en tu gestor de contraseñas. **Son las llaves de tus datos.**

3. **Comprueba que quedó bien** (30 segundos, recomendado)

   ```bash
   node automation/verify-deploy.mjs https://USUARIO:CLAVE@investor-XXXX.onrender.com TU_SYNC_TOKEN
   ```

   Verifica que la app se sirve, que los cierres del día están ahí, que el disco
   responde, que **la API está cerrada** sin token y que la caja fuerte escribe y lee
   bien (usa un respaldo de prueba y **restaura el tuyo** al terminar, sin tocar nada).
   Si dejaste el sitio abierto, basta con la URL a secas y sin credenciales.

4. **Conecta la app a la nube**
   - Abre tu URL de Render → el navegador pedirá `AUTH_USER` / `AUTH_PASS` (marca
     "recordar" para no repetirlo) → inicia (o crea) tu acceso local.
   - Si vienes del navegador de siempre: exporta allí un respaldo
     (`⚙ Configuración → Respaldo → 💾 Respaldar`) e impórtalo aquí (`📥 Restaurar`).
   - `⚙ Configuración → Respaldo → Nube`: pega el **token**, deja activado el
     **respaldo automático** y pulsa **☁ Guardar ahora**. Listo: tu primera copia
     ya está en el disco del servidor (`Probar conexión` te lo confirma).

5. **En el teléfono**
   - Abre la misma URL en el navegador del teléfono. Como está vacío, Investor
     te ofrecerá **restaurar el respaldo de la nube** (pide el token la primera vez).
   - Para que parezca una app: menú del navegador → **“Añadir a pantalla de inicio”**.

## Datos diarios (cierres)

El workflow de GitHub Actions sigue actualizando `data/closes.json` a diario.
Como `autoDeploy: true`, cada push del bot **redeploya Render solo**, así que la
página siempre sirve datos frescos. La app además sigue leyendo la fuente
automática (raw.githubusercontent) configurada en Datos — ambas rutas funcionan.

## Preguntas rápidas

- **¿Se puede sin pagar?** Sí, con el plan Free, pero **sin disco**: la página
  funciona, el teléfono funciona, pero los respaldos del servidor se pierden en
  cada deploy y el servicio "duerme" tras 15 min (tarda ~1 min en despertar).
  Para la caja fuerte real, usa Starter con disco.
- **¿Qué guarda el disco?** `latest.json` (tu último respaldo completo) más las
  últimas 40 versiones históricas en `/var/data/backups/`.
- **¿Y si pierdo una clave?** Ninguna es irrecuperable: la editas en Render
  (Environment), esperas el redeploy y listo. Cambiar `AUTH_PASS` solo te hará volver
  a iniciar sesión; cambiar `SYNC_TOKEN` te hará pegarlo de nuevo en la app. **Los
  respaldos del disco no se pierden en ningún caso.**
- **¿Y si quiero el sitio sin contraseña?** Borra `AUTH_USER` y `AUTH_PASS` en el panel.
  El servidor detecta que faltan y deja la puerta abierta (el `SYNC_TOKEN` sigue
  cuidando los datos).
- **¿Tener cuenta Pro cambia algo?** No. En Render, el `plan` del `render.yaml` es el
  **instance type** (tamaño de la máquina) y es independiente del plan de tu cuenta.
  El disco persistente se habilita con cualquier instancia de pago (Starter basta), y
  una cuenta Professional no lo hace gratis ni más rápido. Lo que sí aprovechas de Pro
  es la retención de logs más larga (útil para revisar los deploys diarios del bot).
- **¿Habrá downtime?** Un servicio **con disco** no puede hacer deploys sin downtime
  (el disco se monta en una sola máquina), así que cada push del bot de cierres
  (≈1 al día) causa un reinicio breve. Ningún plan levanta ese límite. Los respaldos
  lo sobreviven intactos — está verificado, es justamente para lo que sirve el disco.
- **¿Probar en local?** `node server.js` y abre `http://localhost:10000`
  (usa `SYNC_TOKEN=mitoken node server.js` para probar la nube; los respaldos
  van a `./cloud-data/`, que está en `.gitignore`).

## Verificación previa (ya hecha)

Antes de publicar nada se probó el despliegue completo contra el `server.js` real con
un disco simulado — 10 bloques, todos en verde:

| | |
|---|---|
| Arranque | sin dependencias (solo `http`/`fs`/`path`/`crypto`), crea la estructura del disco |
| Autenticación | sin token, vacío, errado o de largo distinto → 401; correcto → 200 |
| Respaldo | lo que sube baja **idéntico byte a byte** |
| Validación | JSON roto o payload ajeno → 400, sin contaminar el disco |
| Versionado | cada subida agrega versión; `latest` siempre el más nuevo (se guardan 40) |
| **Persistencia** | se mata el proceso y al volver el respaldo sigue **íntegro** |
| Rutas | sirve app y `closes.json`; bloquea traversal, `server.js`, `.env`, POST (405) |
| **Ciclo real** | la app sube su respaldo → se borra el navegador entero → **restaura todo** con valor, aportado y operaciones idénticos |
| Mala config | sin `SYNC_TOKEN` → 503 explícito y la app sigue sirviéndose |
| Tamaño | 41 versiones de un respaldo real (~350 KB) = 14 MB de 1 GB (73× de holgura) |

Y la **puerta del sitio**, en 8 bloques más:

| | |
|---|---|
| Opcional | sin `AUTH_USER`/`AUTH_PASS` todo sigue exactamente como antes |
| Cobertura | con la puerta activa, app, datos y API responden 401 y piden credenciales |
| **Health** | `/api/health` **sigue abierta** (Render la necesita) y sin autenticar no revela nada del respaldo |
| Credenciales | usuario o clave errados, clave vacía, base64 roto o esquema ajeno → 401, con **mensaje idéntico** (no revela cuál falló) |
| Capas | pasar la puerta NO abre la caja fuerte, y el token NO abre la puerta |
| Config a medias | con una sola variable la puerta no se activa y el arranque lo avisa |
| App completa | tras autenticar, la app carga, lee los cierres y respalda en la nube sin errores |
| Verificador | atraviesa la puerta con credenciales en la URL y falla claramente sin ellas |
