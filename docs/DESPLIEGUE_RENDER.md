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
- La API de respaldos está protegida por un **token secreto** (`SYNC_TOKEN`):
  sin él, nadie puede leer ni escribir tus datos. La página en sí es pública,
  pero quien la abra ve un Investor vacío (los datos nunca viajan sin token).

## Pasos (una sola vez, ~10 minutos)

1. **Crea el servicio desde el Blueprint**
   - Entra a <https://dashboard.render.com> (crea la cuenta si no tienes).
   - `New → Blueprint` → conecta GitHub → elige el repo **agobantesc/Investor**.
   - Render lee `render.yaml` y propone el servicio `investor` con su disco
     `investor-datos` (1 GB en `/var/data`). Acepta.
   - **Plan**: el disco persistente requiere el plan **Starter** (~US$7/mes).
     Sin disco los respaldos se borrarían en cada deploy — no sirve de caja fuerte.

2. **Define el token secreto**
   - En el servicio → `Environment` → variable `SYNC_TOKEN` → escribe una frase
     larga y única (ej: `mi-caja-fuerte-ipsa-2026-lechuga-89`). Guarda.
   - Render redeploya solo. En 1–2 min tu URL queda viva:
     `https://investor-XXXX.onrender.com`.

3. **Conecta la app a la nube**
   - Abre tu URL de Render → inicia (o crea) tu acceso local.
   - Si vienes del navegador de siempre: exporta allí un respaldo
     (`⚙ Configuración → Respaldo → 💾 Respaldar`) e impórtalo aquí (`📥 Restaurar`).
   - `⚙ Configuración → Respaldo → Nube`: pega el **token**, deja activado el
     **respaldo automático** y pulsa **☁ Guardar ahora**. Listo: tu primera copia
     ya está en el disco del servidor (`Probar conexión` te lo confirma).

4. **En el teléfono**
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
- **¿Y si pierdo el token?** Defines uno nuevo en Render (Environment) y lo
  vuelves a pegar en la app. Los respaldos del disco no se pierden.
- **¿Probar en local?** `node server.js` y abre `http://localhost:10000`
  (usa `SYNC_TOKEN=mitoken node server.js` para probar la nube; los respaldos
  van a `./cloud-data/`, que está en `.gitignore`).
