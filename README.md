# Rifas con folio y código QR

Sitio del participante y panel de sorteo en vivo. Página estática en GitHub
Pages; el estado de la rifa vive en Supabase y llega a los teléfonos por
Realtime.

**Sin datos personales.** La base guarda folios, códigos y el estado del
sorteo. Nada más: ni nombres, ni teléfonos, ni correos. El registro de a quién
se le vendió cada boleto lo lleva el organizador a mano, en papel.

## Cómo se usa

**El participante** escanea el QR de su boleto y cae en
`…/rifas/?f=11052&c=R5VR`. La página valida el boleto y le muestra:

| Estado | Pantalla |
| --- | --- |
| `espera` | Su folio, «Pronto conoceremos al ganador o la ganadora» y el cronómetro |
| `en_vivo` | «El sorteo está en curso» — entra sola al llegar la hora |
| `revelado` | Su folio contra el ganador: ¡Ganaste! o Suerte para la próxima |
| `cerrado` | Igual que revelado, con la rifa terminada |

Un folio inventado, o con código equivocado, ve **Boleto no válido**.

**El organizador** entra a `…/rifas/panel.html` con la clave del panel y tiene
tres pasos: poner en vivo, revelar al ganador (capturando el folio de la
tómbola o dejando que el sistema sortee) y cerrar.

## Estructura

| Archivo | Para qué |
| --- | --- |
| `index.html`, `assets/app.js` | Pantalla del participante |
| `panel.html`, `assets/panel.js` | Panel de sorteo |
| `assets/config.js` | Rifa activa, fecha del sorteo y llaves públicas |
| `herramientas/generar-folios.mjs` | Lote de folios con su código de verificación |
| `herramientas/hoja-boletos.mjs` | Hoja imprimible con folio, código y QR |
| `herramientas/generar-qr.mjs` | Un QR suelto en SVG y PNG |
| `supabase/esquema.sql` | Qué hay en la base y qué garantiza |

## Preparar una rifa

```bash
# 1. Folios con código. La llave firma los códigos: sin ella no se pueden
#    fabricar boletos válidos, y si se pierde hay que reimprimir todo.
export LLAVE_RIFA=…
node herramientas/generar-folios.mjs --cantidad 500 --digitos 5 --serie B --salida lote-b

# 2. Hoja para la imprenta
node herramientas/hoja-boletos.mjs lote-b.json "https://killspree2704.github.io/rifas/" hoja-b.html

# 3. Cargar el lote en Supabase (insert en `boletos`) y crear la fila en `rifas`
# 4. Apuntar assets/config.js a la nueva rifa
```

Los archivos `lote*.json` y `lote*.csv` **no se suben al repositorio**: llevan
el código de cada folio y publicarlos permitiría fabricar URLs válidas.

## Seguridad

- El público solo puede leer el estado de la rifa. No hay escritura pública en
  ninguna tabla, y la tabla `boletos` no tiene ni una política: los códigos no
  salen de la base. La validación pasa por una función que responde solo
  verdadero o falso.
- **El ganador es inmutable**: un disparador impide escribirlo antes de revelar
  y cambiarlo después. Ni siquiera con la llave de servicio.
- El panel no escribe en la base: llama a la función de borde `sorteo`, que
  exige la clave del panel en cada acción y compara contra un hash que el
  navegador no puede leer.
- Cada acción del sorteo queda en `sorteo_log` con su hora.

Lo que esto **no** resuelve: un QR se fotografía y se reenvía, y la URL se
puede editar a mano. La página es un visor; el comprobante es el boleto
físico.

## Aguante de red

En un evento con mucha gente en el mismo lugar la antena se satura y las
cargas se cortan (`ERR_NETWORK_CHANGED` y compañía). Tres decisiones para que
eso no arruine el sorteo:

- **Un solo host y una sola conexión.** La página no pide nada fuera de
  GitHub Pages: ni CDN, ni tipografías de Google. Cada host extra son más
  apretones de manos DNS y TLS, y en una red saturada cada uno es otra
  oportunidad de que la carga se corte.
- **Nada bloquea el primer pintado.** La hoja de estilos de Google Fonts era
  bloqueante: hasta que no respondía, la pantalla se quedaba en blanco. Medido
  en 3G saturado (400 kbps, 400 ms de latencia): con ella, **el boleto no
  aparecía ni en 12 segundos**; sin ella, 2.4 s; y moviendo además `supabase-js`
  fuera del camino crítico, **1.4 s**. La librería (55 KB) se descarga después,
  con el boleto ya en pantalla, y si no llega la página funciona con el reloj.
- **`sw.js`**: quien ya abrió la página una vez la vuelve a abrir aunque no
  haya red. Lo único que necesita conexión es consultar el estado, que son
  unos cuantos bytes. Verificado: con la red apagada del todo, recargar sigue
  mostrando el boleto.
- **Reintentos discretos.** Si la consulta falla, la pantalla no se rompe:
  reintenta, y al segundo fallo avisa «Sin conexión estable». Vuelve a
  preguntar en cuanto regresa la red y en cuanto la persona desbloquea el
  teléfono, que es justo lo que pasa a la hora del sorteo.

Al cambiar archivos del sitio hay que subir la versión del caché en `sw.js`
(`CACHE = 'rifa-v2'`, etc.) para que los teléfonos tomen la versión nueva.

## Qué aguanta, medido

Se simularon 30 pantallas reales (Chromium) contra un servidor de pruebas,
con la red cayéndose y volviendo en un tercio de ellas justo alrededor del
reveal. El canal en vivo estaba **deshabilitado a propósito**: estas cifras
son el peor caso, cuando solo queda el sondeo.

| | Antes de blindar | Después |
| --- | --- | --- |
| Pantallas que vieron el resultado | 30/30 | 30/30 |
| Tiempo hasta verlo (mediana) | 7.2 s | 7.1 s |
| Peor caso | 22.7 s | **13.7 s** |
| Consultas al servidor | 1316 | 1233 |
| Proyección a 500 pantallas | 200/s | 167/s |

El peor caso son los teléfonos que estuvieron **sin señal durante el reveal**
y la recuperaron seis segundos después. Con señal estable, todos ven el
resultado en menos de cinco segundos.

Con el servidor caído (60 respuestas 503 seguidas): ninguna pantalla se rompe,
todas siguen mostrando el cronómetro, y al volver el servicio las diez se
enteran del resultado en menos de 13 segundos.

Con la red apagada del todo, recargar sigue mostrando el boleto (lo guarda
`sw.js`).

### Cuánto pesa esto en Supabase

El plan gratuito da **200 conexiones simultáneas y 100 mensajes por segundo**
de Realtime. Con 500 boletos eso no alcanza si todos abren la página a la vez,
y por eso el sondeo es la red de seguridad y no un adorno. Los ritmos se
ajustan en `assets/config.js` sin tocar código.

## Diagnóstico desde el propio teléfono

`…/diagnostico.html` — se abre con la red que se quiera probar (wifi de la
sede, datos de cada compañía) y dice en segundos qué alcanza y qué no: el
sitio, la base de datos de la rifa y si el reloj del teléfono está en hora.
Trae un botón para copiar el resultado y mandarlo.

Conviene correrlo en la sede el día del evento, antes de que llegue la gente.

## Cambiar de hosting

El sitio no depende de dónde esté publicado: todas sus rutas son relativas y
no pide nada a terceros. Para moverlo basta con servir esta carpeta en otro
lado y regenerar los QR con la URL nueva:

```bash
node herramientas/hoja-boletos.mjs lote.json "https://LA-NUEVA-URL/" hoja.html
```

En **Cloudflare Pages** son cuatro pasos, sin tocar el código: crear cuenta,
*Workers & Pages → Create → Pages → Connect to Git*, elegir este repositorio,
y dejar los ajustes de compilación vacíos (no hay compilación, es HTML). Cada
`git push` se publica solo, igual que ahora.

## Ensayo sin tocar la rifa real

`?ensayo=1` corre la pantalla del participante contra el reloj, sin servidor:

```
?f=11052&c=R5VR&ensayo=1                 → espera / en vivo según la hora
?f=11052&c=R5VR&ensayo=1&ganador=11052   → fuerza la pantalla de ganador
```
