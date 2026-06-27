# INVERSOR 2.0 — Portfolio Intelligence

Plataforma de análisis de inversiones para el mercado chileno (IPSA), en un **único archivo HTML** (`index.html`), sin dependencias externas, sin backend y con persistencia local (`localStorage`). Evolución de "Gestor de Portafolio" hacia una herramienta con apariencia y rigor de software financiero profesional.

> ⚠️ **Simulación educativa · análisis cuantitativo · no es asesoría financiera.** Los datos fundamentales del módulo multifactor son **representativos/ilustrativos** de empresas reales del IPSA, no cifras auditadas.

---

## Cómo usar

Abre `index.html` en cualquier navegador moderno (doble clic o arrástralo). No requiere instalación, servidor ni conexión. Tus proyectos de inversión y escenarios se guardan en el navegador.

- **Tema claro / oscuro:** botón ◐ en la barra superior (se recuerda entre sesiones).
- `inversor-v1-original.html` se conserva como referencia de la versión anterior.

---

## Qué hay de nuevo en 2.0

### 1. Rediseño profesional (sistema de diseño consolidado)
- **Identidad INVERSOR 2.0**: nuevo logo (lente de enfoque), wordmark y eyebrow "Portfolio Intelligence".
- **Superficies estratificadas en 3 niveles**, sistema de sombras en capas, rampa de acento completa + segundo color de datos (cian de marca).
- **Modo oscuro completo** tipo terminal, con toggle persistente; los gráficos se re-tematizan automáticamente.
- **Tablas de grado terminal** (header sticky, zebra ultrafino, cursor de fila), tiles KPI con hover, botones con gradiente/glow, focus ring accesible, microinteracciones (entrada escalonada, live-dot de mercado).
- Topbar con efecto *glass* e indicador de mercado.

### 2. Módulo **Multifactor** (Análisis → pestaña 4) — supera la limitación de "solo CAPM"
La versión anterior valoraba con **un solo factor** (β de mercado, CAPM). 2.0 incorpora un modelo **multifactor de estilo** con 6 factores:

| Factor | Origen | Dirección | Cálculo |
|---|---|---|---|
| **Momentum (12-1m)** | Precios | mayor = mejor | retorno acumulado de t-12 a t-1 (salta el último mes) |
| **Low-Volatility** | Retornos | menor σ = mejor | σ anual (anomalía BAB) |
| **Value (HML)** | Fundamental | más barato = mejor | mezcla z(P/B) y z(P/E) |
| **Quality (QMJ)** | Fundamental | mayor = mejor | ROE, margen neto, apalancamiento ajustado, crecimiento EPS |
| **Size (SMB)** | Fundamental | menor cap = mejor | ln(capitalización) |
| **Dividend Yield** | Fundamental | mayor = mejor | rendimiento por dividendo |

**Metodología.** Cada factor se estandariza con **z-score transversal** sobre las 14 acciones (convención **+z = mejor**), winsorizado a ±2,5. El **Composite** combina los factores (igual peso o por **perfil**: conservador / moderado / riesgoso, con distintos pesos de factor).

**Retorno esperado multifactor — modelo tipo APT.** Sobre el ancla CAPM se añade un *tilt* de primas de factor:

```
E(R)_MF = Rf + β·λ_mkt + Σ z_factor · λ_factor
λ: mercado 6,0% · momentum 3,0% · value 2,5% · size 2,0% · quality 1,5% · low-vol 1,5% · yield 1,0%
```

Esto permite **contrastar E(R) CAPM vs E(R) multifactor** acción por acción, con su **atribución por factor** (cuánto suma/resta cada uno en puntos porcentuales).

**Qué muestra la interfaz:**
- **Radar de estilo** por acción (6 ejes) vs neutral de mercado, con **etiquetas automáticas** (Value/Growth, Defensiva/Agresiva, Alta/Baja calidad, Alto dividendo, Momentum).
- **Atribución del retorno esperado** (barras divergentes por factor) y comparación CAPM → multifactor.
- **Tabla de factores** completa (z por factor + Composite + E(R) CAPM + E(R) MF + Δ), reordenable por perfil.
- **Slopegraph de ranking**: cómo cambia el atractivo de cada acción al pasar de 1 factor (α de Jensen) a 6 factores.
- **Exposición factorial de tu portafolio** (radar + E(R) multifactor) leyendo la cartera del Constructor.

### 3. Módulo **Pro · Roadmap** — precios en tiempo real y copiloto de IA
Responde, dentro de la app, las dos preguntas estratégicas con un plan honesto y accionable (ver más abajo). Incluye vistas previas funcionales (mock de panel de cotizaciones y de copiloto de portafolio), comparación de proveedores, arquitectura por fases, costos y consideraciones legales.

---

## Módulos existentes (preservados)

Toda la funcionalidad anterior se mantiene intacta:

- **Análisis** — Comparativa (mapa riesgo-retorno, correlaciones), Detalle por acción (recta característica/SCL), CAPM/SML, **Multifactor (nuevo)**.
- **Simulación** — Constructor de portafolio (pesos, métricas, VaR, proyección, PDF), Asistente multi-perfil, Comparación de escenarios.
- **Inversión** — Seguimiento real con TWR, CAGR, Sharpe realizado, drawdown, tracking error, information ratio, drift, rebalanceo, inyección de capital e informes.

---

## ¿Qué tan difícil es lo que viene? (resumen del módulo Pro · Roadmap)

> Detalle completo, proveedores, arquitectura y fuentes dentro de la app: **Pro · Roadmap**.

**Conclusión honesta:** ninguno de los dos es difícil *en sí*. La barrera **compartida** es la misma: pasar de un HTML 100% estático a **una capa serverless mínima** (1-2 funciones) que resuelva CORS y guarde las claves API. Construyes ese proxy una vez y desbloqueas ambos objetivos.

### A) Precios de mercado en tiempo real — dificultad **Media**
- El obstáculo no es la app: es **CORS**, **la clave API expuesta** y los **rate limits** — todos resueltos con una función serverless (p. ej. Cloudflare Workers, 100k req/día gratis).
- **El mercado chileno está mucho peor cubierto** que EE.UU. La mejor opción self-service para el IPSA es **EODHD (datos EOD / cierre)**; real-time chileno barato prácticamente no existe. Reserva el **real-time para EE.UU.** (Twelve Data, Polygon).
- **MVP (EOD, botón "Actualizar"): ~1,5–2 días.**

### B) Agente de IA copiloto — dificultad **Media-baja**
- Técnicamente más fácil que los precios: la **API de Claude** es limpia y el patrón de **tool use** para leer el JSON del portafolio es directo. La clave de Anthropic vive en el **mismo** backend serverless.
- Modelo base recomendado **Claude Sonnet 4.6** (escalar a **Opus 4.8** para análisis profundo); costo ~1–3 ¢ por turno con *prompt caching*.
- **MVP útil (copiloto que lee tu portafolio): ~2–3 días.**

**Sinergia:** el copiloto se beneficia de los precios (puede leerlos vía una herramienta `get_quote`). Disclaimers obligatorios: datos con retraso etiquetados, y la herramienta es informativa, **no asesoría financiera regulada** (en Chile, regulada por la CMF).

---

## Estructura del repositorio

```
index.html                  · INVERSOR 2.0 (aplicación completa, single-file)
inversor-v1-original.html   · versión anterior (referencia)
README.md                   · este documento
```

## Notas técnicas
- Vanilla JS, motor de gráficos SVG propio (scatter, líneas, barras, donut, radar, slopegraph), sin librerías.
- Datos: 14 acciones del IPSA, ventana jun-2024 a may-2026 (23 retornos mensuales). β por regresión OLS vs IPSA. Rf 5,5% · prima 6,0%.
- El dataset fundamental del módulo multifactor es ilustrativo y está claramente marcado como tal en la interfaz.
