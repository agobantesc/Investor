# INVERSOR 2.0 — Portfolio Intelligence

Plataforma de análisis de inversiones para el mercado chileno (IPSA), en un **único archivo HTML** (`index.html`), sin dependencias externas, sin backend y con persistencia local (`localStorage`). Evolución de "Gestor de Portafolio" hacia una herramienta con apariencia y rigor de software financiero profesional.

> ⚠️ **Simulación educativa · análisis cuantitativo · no es asesoría financiera.** Los datos fundamentales del módulo multifactor son **representativos/ilustrativos** de empresas reales del IPSA, no cifras auditadas.

---

## Cómo usar

Abre `index.html` en cualquier navegador moderno (doble clic o arrástralo). No requiere instalación, servidor ni conexión.

**Dónde se guardan tus datos:** todo (proyectos de inversión y su seguimiento, escenarios, perfil, acciones importadas, clave del copiloto, operador, tema) se guarda en el **`localStorage` de ese navegador** — local, privado, sin nube. Implicaciones: persiste entre sesiones en el mismo equipo/navegador; **no se sincroniza** entre dispositivos; y se pierde si borras los datos del sitio o usas modo incógnito. Para no depender de un solo navegador, usa **Configuración → Datos → Respaldar** (exporta un JSON con **todos tus clientes** y sus datos) y **Restaurar**. Si el navegador no puede guardar (almacenamiento lleno o modo privado), INVERSOR **te avisa** para que no pierdas cambios sin saberlo.

- **Inicio (Home):** al abrir INVERSOR aterrizas en un **resumen general** — el **patrimonio total gestionado**, la **rentabilidad neta consolidada**, el ranking de **proyectos más rentables** (tarjetas con medalla, sparkline, % neto y β; para comparar carteras: invierte montos chicos en distintas combinaciones y mide cuál rinde mejor), las **acciones destacadas** en tres rankings —por **rentabilidad**, **Sharpe** y **α de Jensen**— calculados sobre **todas las acciones con historial disponible** (universo IPSA + los precios reales que ingresas en tus seguimientos) y filtrables por **diario / semanal / mensual** (por defecto mensual), los **indicadores de mercado que más se movieron** y accesos rápidos.
- **Datos (base de precios central):** un módulo donde centralizas todos tus precios. Subes tus **planillas de Investing** (CSV/XLSX, diario/semanal/mensual) y/o cargas el **cierre de cada día** (IPSA + acciones); todo se fusiona en una **base del sistema** (por fecha, sin borrar lo anterior). Esa base **alimenta el análisis y las simulaciones** (la activas como "universo de análisis"), el **Home**, y **actualiza los seguimientos e historia de todas tus carteras** — incluido el caso de "no cerré precios por varios días, cargo la planilla y se ponen al día" (botón *Actualizar carteras con la base*). El **cierre de un día** también se puede cargar desde el Home (**↻ Actualizar precios**) y se aplica a todos los proyectos que tengan esas acciones.
- **Acceso:** el login ofrece **"mantener sesión iniciada"** para no reingresar la contraseña en cada visita.
- **Modo:** por ahora se gestionan **solo carteras propias de la administración**; el modo asesor multi-cliente queda en el código (oculto en la interfaz) para reactivarlo cuando se necesite.
- **Navegación:** sidebar con **Inicio** arriba y los módulos de trabajo (**Datos · Análisis · Simulación · Inversión**); **Proyectos · Perfil · Mercados** en la barra superior; **Pro · Roadmap** desde **Configuración (⚙)**.
- **Modo asesor · multi-cliente:** administra inversiones de **distintas personas** (tú, tu polola, etc.) como **clientes** independientes. El **selector de cliente** en la barra superior cambia de cartera al instante; cada cliente tiene sus **propios** proyectos, análisis, simulaciones y perfil (aislados en `localStorage`, sin mezclarse). Tu cartera propia es el cliente por defecto **«Administración»**; puedes **renombrar** clientes, proyectos, análisis y simulaciones.
- **Administrador de clientes** (botón ⚙ del selector → *Gestionar clientes*, o desde el hub de Proyectos): un panel que resume la gestión de **cada cliente, incluida tu propia cartera** — **capital aportado**, **capital retirado**, **valor actual**, **comisiones pagadas**, **ganancia neta de comisiones (en $ y %)**, **número de acciones distintas** en cartera, el **perfil de riesgo** del cliente y la **β de su cartera** (promedio ponderado por valor de las posiciones), más una fila **consolidada** con el total de tu práctica (incluida la β consolidada). Desde ahí entras a cada cliente, lo renombras, lo creas o lo eliminas. (La ganancia bruta es *valor actual + retirado − aportado*; la neta le resta las comisiones del operador configurado.)
- **Proyectos (hub):** centraliza todo como proyectos vinculados. Cada **proyecto de inversión** muestra su capital invertido, valor actual y **rentabilidad ($ y %)**, y se **vincula** a los **análisis** (demo IPSA + importados) y **simulaciones** (escenarios) que lo originaron — puedes agregar/quitar más. Un proyecto puede acumular **varios análisis** (su historial de research, p. ej. el original + uno nuevo para evaluar incorporaciones): los chips de análisis son **clickeables** (activan ese universo) y uno se marca como **vigente (★)** — al **activar el proyecto** se carga su análisis vigente. La contabilidad/seguimiento es independiente del análisis. Gestiona (activar, renombrar, eliminar) análisis, simulaciones e inversiones desde un solo lugar.
- **Contabilidad consolidada:** si llevas más de un proyecto, la pestaña Contabilidad agrega **todos** — totales (invertido, recuperado, valor, ganancia realizada/no realizada, rentabilidad total), tabla por proyecto y un **libro de operaciones consolidado** (con columna de proyecto) e **informe consolidado para el contador**.
- **Detalle contable para tu contador:** la Contabilidad muestra, sin interpretar tributariamente, todo el detalle que tu contador necesita — indicadores de **invertido (compras)**, **dinero rescatado (ventas)**, **capital aún invertido** (costo de posiciones abiertas), **valor actual**, **comisiones pagadas (con IVA desglosado)** y ganancia realizada/no realizada; un **Detalle de ventas realizadas** (cada venta con fecha, precio, monto, costo promedio y comisión con IVA, y su resultado neto de referencia); y un **libro de operaciones** con cada compra/venta y sus columnas de **comisión, IVA y efectivo** (dinero realmente movido: compra = monto + comisión; venta = monto − comisión). El **informe para el contador** agrupa las ventas **por año** con subtotales. El tratamiento tributario lo define el contador.
- **Operador y costos · ganancia real neta:** en **Configuración → Operador y costos** eliges la corredora (BTG Pactual, Trii u otra) e indicas la **comisión por operación (%)**, si **agrega IVA (19%)**, y la **comisión mínima y máxima**. La **Contabilidad** descuenta esas comisiones en **cada compra y venta** y muestra el **Resultado real (neto de comisiones)**: *Ganancia bruta − comisiones = ganancia real* ($ y %), con la **comisión por operación** en el libro y en el informe del contador; el **Administrador de clientes** también muestra la ganancia **neta de comisiones** por cliente. La configuración del operador es **global** (igual para todos los clientes).
- **Agente de inversiones:** el asistente IA (antes "Copiloto") es un **analista cuantitativo senior** (Markowitz, CAPM, multifactor, Sharpe/Sortino/IR, VaR), con bienvenida personalizada por tu usuario y sin preguntas precargadas.
- **Nuevo análisis:** en cualquier pestaña de Análisis, la barra de contexto muestra la ventana de datos y el set activo (demo/importado) con un botón **+ Nuevo análisis** que lleva directo a Importar.
- **Escala de interfaz:** en **Configuración** puedes fijar la escala (80 % por defecto, 80/90/100/110 %) — equivale al zoom del navegador y se recuerda, sin tener que ajustarlo a mano.
- **Tema claro / oscuro:** botón ◐ en la barra superior (se recuerda entre sesiones).
- **Configuración (⚙):** botón junto al de tema (perfil, apariencia + escala, copiloto, datos, roadmap y reinicio). Abre un panel central con tu **perfil**, **apariencia** (tema), **copiloto IA** (estado de la clave y modelo), **datos** (set de análisis activo demo/importado y respaldo/restauración) y **plataforma** (reinicio total). Centraliza los ajustes sin salir del módulo en que estés.
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

### 3. **Copiloto IA** — agente real integrado (BYOK)
Un agente de IA (API de Claude) **funcional**, disponible desde el botón flotante ✨ en cualquier módulo, que conversa con **tus datos reales**:

- **Bring-Your-Own-Key (BYOK):** pegas tu propia clave de Anthropic; se guarda **solo en tu navegador** (`localStorage`) y las llamadas van **directo** desde tu equipo a la API (`anthropic-dangerous-direct-browser-access`), sin servidores intermedios.
- **Respuestas en streaming:** el copiloto **escribe progresivamente** (no aparece todo de golpe), en mensajes breves y por pasos para que sea fácil de seguir. El largo se adapta: conciso para preguntas simples, detallado solo cuando pides análisis.
- **Prompt caching:** el *system prompt* y las herramientas se envían con `cache_control` (efímero). Dentro de un mismo turno agéntico (pregunta → tool_use → respuesta) hay varias llamadas que reutilizan ese prefijo, con **lecturas de caché ~90% más baratas** y menor latencia.
- **Tool use (function calling):** el agente lee tu portafolio activo y su seguimiento, las métricas CAPM + multifactor de las 14 acciones (herramienta `get_multifactor` dedicada), la matriz de correlación, tus escenarios, la cartera del Constructor y los **indicadores de mercado** (`get_market_indicators`); y puede **evaluar carteras hipotéticas** (`evaluate_portfolio`) con cifras reales. Está instruido para **integrar siempre el modelo multifactor** además del CAPM.
- **Selector de modelo:** Claude **Opus 4.8** (por defecto), Sonnet 4.6 o Haiku 4.5.
- **Seguro y educativo:** el agente analiza y propone; tú ejecutas los cambios en Constructor / Operar. No es asesoría financiera regulada y los disclaimers están a la vista. Costo aprox. 1–3 ¢ por consulta a tu cuenta de Anthropic.

> **Seguridad:** una clave en el navegador es accesible a los scripts de la página. Úsala en tu equipo personal, ponle límite de gasto en la consola de Anthropic y no publiques el archivo con la clave incrustada.

### 4. **Importar acciones** (Análisis → tab 5) — analiza tu propio universo
Para **analizar muchas acciones candidatas y decidir antes de armar el portafolio**. Dos formas de cargar:

- **Archivos de Investing.com (recomendado), uno por acción** — tal como los descargas (`"Date","Price","Open","High","Low","Vol.","Change %"`, fechas MM/DD/YYYY, números US). **Sube varios a la vez**; el ticker se deriva del nombre del archivo (con mapa de empresas conocidas del IPSA: BCI, CCU, COPEC, SQM-B…) y es **editable** en pantalla. El módulo detecta el formato automáticamente.
- **Un archivo combinado** (CSV/Excel `.xlsx`): una fila por fecha, una columna por acción + una de índice. Hay **plantilla descargable**.

Detalles:
- **Análisis guardados (proyectos):** cada carga que calculas se guarda como un **análisis con nombre** (editable). Mantienes varios en paralelo, los **activas** con un clic (pasan a alimentar toda la plataforma) y los **eliminas** cuando ya no los necesitas. El análisis que tenías hecho se migra automáticamente como el primer proyecto.
- **Tasa libre de riesgo automática:** se toma la **TPM vigente del Banco Central** (vía mindicador.cl), sin escribirla a mano. Puedes sobrescribirla manualmente y volver a "Auto · TPM" cuando quieras. *(La TPM es la tasa de política monetaria — un proxy de corto plazo del retorno sin riesgo; para CAPM también se usa el bono soberano a 10 años, que en el set demo se asume en ~5,5 %.)*
- Elige la **periodicidad** que descargaste (diario / semanal / mensual); las métricas se anualizan en consecuencia (√252 / √52 / √12).
- **Benchmark:** sube también el **índice** (ej. IPSA) como un archivo más; si no, se usa un **índice promedio equiponderado** de tus acciones como proxy.
- Alinea las series por **fechas en común**, omite las que tengan huecos y calcula **β, retorno, volatilidad, Sharpe, α de Jensen, R²** (contra el benchmark) y la **matriz de correlación**.
- Las acciones importadas pasan a usarse en **toda la plataforma**: Comparativa, Detalle, CAPM/SML, Multifactor y el Constructor. Un clic (o el panel de Configuración) vuelve al set demo IPSA.
- Parser de CSV (Investing y combinado) y de **Excel propio** (sin librerías externas, vía `DecompressionStream`); si un `.xlsx` no carga, guárdalo como CSV.

### 5. **Perfil de inversionista** (módulo Perfil) — motor de perfilamiento profesional
- **Motor de 4 dimensiones independientes** (estilo *suitability* MiFID/CMF), no un único score: **Tolerancia al riesgo** (RTS, psicométrica), **Capacidad de riesgo** (RCS, financiera/objetiva), **Conocimiento y experiencia** (KE, idoneidad) y **Necesidad de riesgo** (RR, derivada de tu meta). Cada dimensión se normaliza a 0–100 con ítems ponderados y un ítem **invertido** de control de consistencia.
- **Regla rectora:** el nivel final (1–5: Conservador → Agresivo) es el **mínimo entre tolerancia y capacidad**. La **necesidad de la meta nunca sube el riesgo**: solo detecta brechas (si tu objetivo exige más del que puedes/quieres, sugiere subir aporte, extender horizonte o ajustar la meta). El **conocimiento limita el acceso** a instrumentos complejos (gate de idoneidad). Reglas de borde: horizonte < 1 año acota el nivel ≤ 2; sin fondo de emergencia lo acota ≤ 3.
- **Necesidad de riesgo (RR)** se calcula resolviendo el **retorno requerido (CAGR)** de tu meta (capital actual, objetivo, aporte y horizonte) por bisección, y se mapea a banda. La meta es **opcional**.
- La pantalla de resultado es **transparente**: muestra el nivel recomendado, las **4 sub-dimensiones con su puntaje y nivel**, la **nota** que explica *por qué* se asignó, las **alertas** (brecha de meta, liquidez, inconsistencia, instrumentos bloqueados) y la **asignación estratégica sugerida (SAA)** por clase de activo.
- El perfil **personaliza al Agente de inversiones** (alinea recomendaciones, advierte brechas y respeta el gate de idoneidad) y queda como perfil por defecto del Asistente de simulación.
- El **Asistente de simulación** permite elegir el **enfoque de análisis**: **Combinado** (CAPM + multifactor, recomendado), **CAPM** (clásico, universo sobre la SML) o **Multifactor** (universo y puntaje por los 6 factores de estilo). El universo de acciones y el puntaje se ajustan al enfoque y al perfil.
- El **Constructor de portafolio** tiene una **tabla rica y visual**: por cada acción muestra β, retorno 24m, σ, Sharpe (con barra), α de Jensen y el **composite multifactor** con su estilo, todo con color para decidir de un vistazo.
- **Acceso controlado:** pantalla de inicio de sesión local (usuario + contraseña, hash en el navegador) con la identidad de INVERSOR; opcional, gestionable desde Configuración (bloquear / cambiar / quitar). Es un control de acceso local del navegador, no seguridad de servidor.

### 6. **Mercados · indicadores en vivo** (botón superior) — datos financieros reales, sin backend
Panel tipo "noticias financieras" que trae **datos de mercado en tiempo casi-real directo desde tu navegador**, sin servidor ni API key:

- **Fuentes:** [`mindicador.cl`](https://mindicador.cl) (Banco Central de Chile + INE) para tipo de cambio, cobre y macro; **[Stooq](https://stooq.com)** para el **petróleo** (WTI y Brent), con **Yahoo Finance** como respaldo. Todas keyless; mindicador con CORS, y para el petróleo se intenta acceso directo y varios **proxies CORS públicos** (corsproxy.io, allorigins, thingproxy) si el navegador bloquea la petición.
- **Indicadores:** **Dólar** y **Euro** (CLP), **Cobre** (US$/lb), **Petróleo WTI** y **Brent** (US$, con variación %), **UF**, **UTM**, **IPC** (var. mensual), **tasa de desempleo**, **Imacec**, **TPM** y **Bitcoin**. Para divisas, cobre, UF y petróleo se dibuja una **mini-tendencia (sparkline)** y la **variación %** del último dato.
- **Robusto:** se consultan al abrir el módulo y con **Actualizar**; los últimos valores quedan en `localStorage` para verlos **sin conexión**, con manejo claro de errores (offline / `file://` / timeout) y reintento. Cada fuente degrada de forma independiente (si falla el petróleo, el resto igual se muestra).
- **Conecta con la IA:** el Copiloto puede leer todo esto con la herramienta `get_market_indicators` para **contextualizar sus recomendaciones** con el dólar, el cobre, el petróleo o la TPM del momento.

> ⚠️ A diferencia de los **precios de acciones** en vivo (que sí requieren API key + proxy y mejor cobertura del mercado chileno), los **indicadores macro y el petróleo** tienen fuentes públicas accesibles desde el navegador, así que esta parte ya quedó **funcionando sin backend**. Los valores son referenciales (cierres oficiales, pueden tener rezago) y no constituyen asesoría financiera.

### 7. Módulo **Pro · Roadmap** — precios en tiempo real
Responde, dentro de la app, qué tan difícil es conectar precios de mercado en vivo (ver más abajo), con comparación de proveedores, arquitectura por fases, costos y consideraciones legales. (La integración del **agente IA** ya está hecha — ver punto 3.)

---

## Módulos existentes (preservados)

Toda la funcionalidad anterior se mantiene intacta:

- **Análisis** — Comparativa (mapa riesgo-retorno, correlaciones), Detalle por acción (recta característica/SCL), CAPM/SML, **Multifactor (nuevo)**.
- **Simulación** — Constructor de portafolio (pesos, métricas, VaR, proyección, PDF), Asistente multi-perfil, Comparación de escenarios.
- **Inversión** — Seguimiento real con TWR, CAGR, Sharpe realizado, drawdown, tracking error, information ratio y drift; **Operar** (registrar compra/venta por acción con precio y cantidad → recálculo de capital, valor y drift; e **inyección de capital** como lista de compras *acción · cantidad · precio*, donde INVERSOR calcula el monto por acción — sin porcentajes objetivo); **Contabilidad** (libro de compras/ventas, ganancia realizada/no realizada por costo promedio, e informe imprimible para el contador) e informes.

---

## ¿Qué tan difícil es lo que viene? (resumen del módulo Pro · Roadmap)

> Detalle completo, proveedores, arquitectura y fuentes dentro de la app: **Pro · Roadmap**.

**Conclusión honesta:** ninguno de los dos es difícil *en sí*. La barrera **compartida** es la misma: pasar de un HTML 100% estático a **una capa serverless mínima** (1-2 funciones) que resuelva CORS y guarde las claves API. Construyes ese proxy una vez y desbloqueas ambos objetivos.

### A) Precios de mercado en tiempo real — dificultad **Media**
- El obstáculo no es la app: es **CORS**, **la clave API expuesta** y los **rate limits** — todos resueltos con una función serverless (p. ej. Cloudflare Workers, 100k req/día gratis).
- **El mercado chileno está mucho peor cubierto** que EE.UU. La mejor opción self-service para el IPSA es **EODHD (datos EOD / cierre)**; real-time chileno barato prácticamente no existe. Reserva el **real-time para EE.UU.** (Twelve Data, Polygon).
- **MVP (EOD, botón "Actualizar"): ~1,5–2 días.**

### B) Agente de IA copiloto — ✅ **ya implementado (BYOK)**
- Se resolvió **sin backend** con el patrón **Bring-Your-Own-Key**: el navegador llama directo a la API de Claude con el header `anthropic-dangerous-direct-browser-access` y tu propia clave (en `localStorage`). Loop agéntico con **tool use** sobre los datos reales de la app.
- Modelo por defecto **Claude Opus 4.8** (seleccionable: Sonnet 4.6 / Haiku 4.5); costo ~1–3 ¢ por turno a tu cuenta.
- Para multiusuario o producción pública conviene mover la clave a una **función serverless** (mismo patrón que los precios) y añadir rate-limiting; el BYOK actual es ideal para uso personal.

**Sinergia futura:** cuando se conecten precios en vivo, el copiloto podrá leerlos vía una herramienta `get_quote`. Disclaimers obligatorios: la herramienta es informativa, **no asesoría financiera regulada** (en Chile, regulada por la CMF).

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
