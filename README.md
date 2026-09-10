# Rifas con folio y código QR

> **¿Retomando el proyecto, o desde otro equipo?** Empieza por
> [`CONTINUIDAD.md`](CONTINUIDAD.md): direcciones, llaves, cómo está armado,
> qué hacer el día de la rifa y qué queda pendiente.

Sitio del participante y panel de sorteo en vivo. Página estática servida por
Cloudflare; el estado de la rifa vive en Supabase y llega a los teléfonos por
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
| `en_vivo` | «La rifa se está llevando a cabo», con el botón a la transmisión si la hay — entra sola al llegar la hora |
| `revelado` | Su folio contra el ganador: ¡Ganaste! o Suerte para la próxima |
| `cerrado` | Igual que revelado, con la rifa terminada |

Un folio inventado, o con código equivocado, ve **Boleto no válido**.

Cada boleto sabe a qué rifa pertenece: la pantalla no está atada a ninguna
rifa fija, la manda el folio impreso. Un boleto de hace un año sigue abriendo
su propio resultado, y uno recién impreso abre el sorteo que viene.

**El organizador** entra a `…/panel.html` con la clave del panel. Tres
pestañas:

| Pestaña | Para qué |
| --- | --- |
| **Sorteo** | Guardar el enlace de la transmisión, salir al aire, revelar al ganador (capturando el folio de la tómbola o dejando que el sistema sortee) y cerrar |
| **Rifas** | Crear una rifa nueva con sus folios, ver el historial completo y sacar la hoja de boletos para imprimir |
| **Verificar** | Teclear folio y código de un boleto de papel y saber si es original |

### La transmisión en vivo

La página **no reproduce video**: enseña un botón que lleva al directo de
YouTube. Eso es deliberado.

- **Nadie se registra.** Ver un directo de YouTube no pide cuenta, ni público
  ni «no listado». Solo comentar la pide, y comentar no hace falta aquí. (Un
  directo marcado como restringido por edad sí pediría sesión: no marcarlo.)
- **El sitio sigue sin pedirle un byte a nadie más.** Un reproductor
  incrustado metería un dominio ajeno en el camino crítico, que es justo lo
  que se quitó para que la página abra en una red saturada.
- **El video lo transmite la app de YouTube**, que es sólida. Un navegador
  transmitiendo desde un celular se corta en cuanto se bloquea la pantalla o
  entra una llamada; además, **ningún navegador puede mandar video a YouTube
  por su cuenta** —no habla RTMP— y hacerlo pediría un servidor propio de por
  medio.
- El botón abre **otra pestaña**: el boleto se queda atrás y el resultado
  sigue llegando solo.

El enlace se pega en el panel. Si usas la forma `youtube.com/@tucanal/live`,
apunta siempre al directo que esté al aire en ese canal: se pega una vez y
sirve para todas las rifas. El panel acepta también `youtu.be/…`, `/live/…` o
la dirección con parámetros pegados, y las guarda ya limpias.

**Un solo aparato transmite.** Al salir al aire, el panel anota desde cuál
aparato fue. Si alguien abre el panel en otro lado, ve *«Transmitiendo desde
el celular»* y el botón no le deja prenderla otra vez —aunque puede **tomar el
control** si hace falta, por ejemplo si ese celular se quedó sin batería.
Regresar a espera o cerrar suelta el candado.

### La doble confirmación del boleto

Cada boleto lleva dos números: el **folio** (el número grande) y el **código**
de cuatro caracteres. El código no es un número más: sale de firmar el folio
con una llave que solo conoce el servidor —HMAC-SHA256, recortado a cuatro
caracteres en base32 de Crockford, sin I, L, O ni U para que nadie confunda un
1 con una I al teclearlo—. Sin esa llave no se puede calcular, así que un
boleto fotocopiado con otro folio no pasa la comprobación.

Los folios **no se repiten jamás entre rifas**: al crear una nueva, el servidor
descarta cualquier número que ya se haya usado alguna vez. Un boleto viejo no
puede colarse como nuevo.

El registro de a quién se le vendió cada boleto sigue en la libreta del
vendedor. Aquí solo viven números.

## Estructura

| Archivo | Para qué |
| --- | --- |
| `index.html`, `assets/app.js` | Pantalla del participante |
| `panel.html`, `assets/panel.js` | Panel de sorteo |
| `assets/config.js` | Rifa activa, fecha del sorteo y llaves públicas |
| `assets/panel.css` | Estilos del panel |
| `assets/youtube.js` | Reconoce y limpia un enlace de YouTube pegado a mano |
| `supabase/funciones/sorteo/index.ts` | Función de borde: todo lo que el panel puede hacer |
| `supabase/esquema.sql` | Qué hay en la base y qué garantiza |
| `herramientas/*.mjs` | Lo mismo desde la línea de comandos, de cuando no existía el panel |

## Preparar una rifa

Todo desde el panel, sin tocar código ni volver a publicar el sitio:

1. **Rifas → Nueva rifa**: nombre, serie, día y hora del sorteo, cuántos
   boletos, cuántos dígitos y —si se quiere llevar la cuenta— el precio.
   La cantidad **la elige quien crea la rifa**, de 1 a 5000: la casilla
   arranca vacía y los atajos (10, 25, 50, 100, 250, 500) solo la llenan.
   Debajo va diciendo qué se va a generar y avisa **antes** de apretar el
   botón si los folios no alcanzan —con pocos dígitos el lote se apretuja y
   los números se vuelven adivinables, así que hay un tope: 2.700 boletos
   con 4 dígitos, 27.000 con 5—. La hora se guarda siempre como hora del
   lugar del evento, sin importar desde qué huso se llene el formulario.
2. El servidor inventa los folios, los firma y los guarda. Al terminar abre
   la **hoja de boletos** con folio, código y QR de cada uno: de ahí sale a
   la impresora o a un PDF (*Imprimir → Guardar como PDF*).
3. **Manejar esta** pone esa rifa al frente de la pestaña Sorteo.

La hoja se puede volver a sacar cuando sea desde **Hoja de boletos** en
cualquier rifa del historial. Nada se borra: cada rifa conserva sus folios y
su ganador para siempre.

Las herramientas de `herramientas/` hacen lo mismo desde la terminal y siguen
sirviendo, pero ya no hacen falta. Los archivos `lote*.json` y `lote*.csv` que
generan **no se suben al repositorio**: llevan el código de cada folio y
publicarlos permitiría fabricar URLs válidas.

## Seguridad

- El público solo puede leer el estado de la rifa. No hay escritura pública en
  ninguna tabla, y la tabla `boletos` no tiene ni una política: los códigos no
  salen de la base. Para saber de qué rifa es un boleto hay que traer folio y
  código ya escritos: `rifa_de_folio` solo contesta cuando los dos coinciden,
  y nunca devuelve el código.
- La llave que firma los códigos vive en `llave_firma`, una tabla **sin
  ninguna política**: solo la alcanza la función de borde. Si saliera de ahí,
  cualquiera podría fabricar boletos.
- **El ganador es inmutable**: un disparador impide escribirlo antes de revelar
  y cambiarlo después. Ni siquiera con la llave de servicio.
- El panel no escribe en la base: llama a la función de borde `sorteo`, que
  exige la clave del panel en cada acción y compara contra un hash que el
  navegador no puede leer, en tiempo constante y con un retardo si falla.
- Cada acción del sorteo queda en `sorteo_log` con su hora.

Lo que esto **no** resuelve: un QR se fotografía y se reenvía, y la URL se
puede editar a mano. La página es un visor; el comprobante es el boleto
físico.

## Aguante de red

En un evento con mucha gente en el mismo lugar la antena se satura y las
cargas se cortan (`ERR_NETWORK_CHANGED` y compañía). Tres decisiones para que
eso no arruine el sorteo:

- **Un solo host y una sola conexión.** La página no pide nada fuera de su
  propio dominio: ni CDN, ni tipografías de Google. Cada host extra son más
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
(`CACHE = 'rifa-v6'`, etc.) para que los teléfonos tomen la versión nueva.

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

## Dónde vive

| | |
| --- | --- |
| Página del participante | `https://rifas.el-original.workers.dev/` |
| Panel de sorteo | `https://rifas.el-original.workers.dev/panel.html` |
| Diagnóstico de red | `https://rifas.el-original.workers.dev/diagnostico.html` |
| Hosting | Cloudflare Workers (estáticos), desplegado desde este repositorio |
| Base de datos | Supabase, proyecto `rifas` |

Se mudó desde GitHub Pages porque **su red móvil no alcanzaba los servidores
de GitHub**: la página no cargaba en datos, en ninguna de sus formas.
Comprobado con el diagnóstico: en Cloudflare responde en 103 ms sobre una
conexión de 0.25 Mbps.

## Cambiar de hosting

El sitio no depende de dónde esté publicado: todas sus rutas son relativas y
no pide nada a terceros. Para moverlo basta con servir esta carpeta en otro
lado y regenerar los QR con la URL nueva:

```bash
node herramientas/hoja-boletos.mjs lote.json "https://rifas.el-original.workers.dev/" hoja.html
```

En **Cloudflare Pages** son cuatro pasos, sin tocar el código: crear cuenta,
*Workers & Pages → Create → Pages → Connect to Git*, elegir este repositorio,
y dejar los ajustes de compilación vacíos (no hay compilación, es HTML). Cada
`git push` se publica solo, igual que ahora.

## Probar sin tocar nada real

```bash
npm install playwright jsqr pngjs && npx playwright install chromium
node pruebas/panel.mjs
```

Levanta un servidor que finge ser Supabase y conduce un navegador de verdad:
entra con la clave, crea una rifa, saca la hoja de boletos —y **lee el QR
impreso** para comprobar que apunta al boleto correcto—, cambia de rifa,
verifica un boleto de papel, guarda el enlace de la transmisión, y corre el
sorteo entero mirando cómo la pantalla del participante pasa sola a «en vivo»
—con su botón al directo— y luego al resultado. **64 comprobaciones**, ninguna
contra la base real.

## Ensayo sin tocar la rifa real

`?ensayo=1` corre la pantalla del participante contra el reloj, sin servidor:

```
?f=11052&c=R5VR&ensayo=1                 → espera / en vivo según la hora
?f=11052&c=R5VR&ensayo=1&ganador=11052   → fuerza la pantalla de ganador
```
