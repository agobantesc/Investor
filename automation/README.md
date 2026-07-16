# Carga automática de cierres diarios

Investor es una app 100% en tu navegador (sin servidor), y las APIs financieras bloquean
las llamadas directas desde el navegador (CORS). El método recomendado — gratis y sin
mantener servidores — es que **GitHub Actions busque los cierres cada día y los publique
como un JSON público**, y que Investor lo sincronice al abrir.

```
GitHub Actions (L–V, 18:05 Chile)                 Tu navegador
┌────────────────────────────┐    raw JSON    ┌────────────────────┐
│ fetch-closes.mjs           │ ─────────────▶ │ Investor           │
│ Yahoo Finance (BCI.SN, …)  │  (CORS ok)     │ sincroniza al abrir│
│ → data/closes.json (commit)│                │ 1 vez al día       │
└────────────────────────────┘                └────────────────────┘
```

## Configuración (una vez, ~5 minutos)

1. **Sube esta carpeta a un repo GitHub** (puede ser el mismo repo de Investor).
2. **Activa el workflow**: copia `automation/update-closes.yml` a `.github/workflows/update-closes.yml`
   y haz push. En la pestaña **Actions** ejecútalo una vez a mano (*Run workflow*) para probar:
   debe crear `data/closes.json`.
3. **Conecta Investor**: en la app, abre **⚙ Configuración → Datos → Fuente automática de
   cierres** y pega la URL raw del JSON:
   `https://raw.githubusercontent.com/<usuario>/<repo>/main/data/closes.json`
4. Listo. Investor sincroniza **al abrir la app, una vez al día** (y siempre puedes forzar con
   **Datos → ⟳ Sincronizar cierres**).

## Poblar la base masivamente (backfill, una sola vez)

El mismo workflow sirve para cargar **años de historia diaria de las ~30 acciones + IPSA de una
sola fuente** (misma escala para todo → sin β colapsadas por fuentes mezcladas):

1. GitHub → pestaña **Actions** → *Actualizar cierres IPSA* → **Run workflow** → en `range`
   escribe `2y` (o `1y`, `5y`, `max`) y ejecútalo. El `closes.json` queda con todo el historial.
2. Abre Investor (o fuerza **Datos → ⟳ Sincronizar cierres**): los ~500 días hábiles se fusionan
   por celda en la base.
3. El cron diario sigue con su rango corto (`10d`) y mantiene la base al día desde entonces.

También puedes correrlo local y subir el JSON: `RANGE=2y node automation/fetch-closes.mjs`.

## Cómo entra el dato a la base

La sincronización usa **las mismas reglas que una planilla**: fusión por celda
(acción × fecha, el último dato manda), solo días hábiles y no futuros, y saneo automático
(sin arrastres ni IPSA por delante del mercado). El JSON trae ~2 semanas de historia, así
que si no abres la app unos días, al volver se rellenan los días perdidos.

## Fundamentos (fundamentals.json)

En la misma corrida, `fetch-fundamentals.mjs` genera `data/fundamentals.json` (P/U, P/B,
dividendos, ROE, márgenes, deuda, PEG, EV/EBITDA y consenso de analistas) con estas garantías:

- **Batch con reintentos** (3 intentos con pausa) + segunda pasada por símbolo
  (`financialData`, `defaultKeyStatistics` y `summaryDetail` — esta última sube la cobertura
  de yield y dividendo por acción que el batch no siempre trae).
- **Saneo por rango plausible**: un dato fuera de rango se descarta (`null`), nunca se inventa.
- **Arrastre marcado**: si un ticker desaparece de una corrida (traspié puntual de la fuente)
  pero el archivo anterior tiene ≤14 días, se conserva su dato con `carriedFrom` (la app
  muestra su procedencia). Nunca se arrastran campos sueltos: un dividendo suspendido
  debe poder desaparecer.
- **`coverage` en el JSON**: cuántas acciones traen cada campo (diagnóstico de la fuente).
- **Salida suave**: si Yahoo falla por completo, el script sale con código 0 sin escribir —
  el archivo anterior se conserva y el workflow de cierres no se rompe.

La app lo sincroniza junto a los cierres, lo vuelve a validar (`fundSanitize`), **nunca
retrocede** a una versión más vieja (CDN con caché rezagada) y lo re-trae sola si tiene
más de un día (módulo **Análisis → Fundamentos**, card "Estado de los datos").

## Ajustes

- **Acciones**: edita el mapa `TICKERS` en `fetch-closes.mjs`
  (clave = ticker en Investor, valor = símbolo Yahoo, ej. `"SQM-B": "SQM-B.SN"`).
- **Horario**: el cron corre a las 22:05 UTC (≈18:05/19:05 en Chile según horario de
  verano). La Bolsa de Santiago cierra ~16:00, así que siempre toma el cierre del día.
- **Fuente**: Yahoo Finance con sufijo `.SN` (Santiago). Es una API no oficial pero
  estable; si un símbolo falla, queda registrado en `errors` dentro del JSON sin romper
  el resto.

## Alternativas evaluadas

| Método | Costo | Contras |
|---|---|---|
| **GitHub Actions → raw JSON (recomendado)** | $0 | requiere cuenta GitHub |
| Cloudflare Worker con cron | $0 | más pasos de setup, otra plataforma |
| API pagada con CORS (p.ej. Financial Modeling Prep) | US$15–30/mes | clave expuesta en el navegador |
| Ingreso manual (Datos → Cierre diario) | $0 | lo que haces hoy: manual |
