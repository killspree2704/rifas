# Dónde está todo

> Para **por qué** el sistema es como es —y qué se intentó antes que no
> funcionó— ver [`BITACORA.md`](BITACORA.md).

Para retomar el proyecto desde cualquier computadora o teléfono, sin depender
de esta máquina ni de esta conversación. Última revisión: 23 de septiembre de
2026.

## Lo primero: qué es durable y qué no

| Cosa | Dónde vive de verdad | ¿Se pierde si cambias de equipo? |
| --- | --- | --- |
| Todo el código | GitHub: `killspree2704/rifas`, rama `main` | No |
| El sitio publicado | Cloudflare Workers, se publica solo con cada `git push` | No |
| Rifas, folios, códigos, ganadores | Supabase, proyecto `fgwavuaolmrwagaymgos` | No |
| La función `sorteo` | Desplegada en Supabase (Edge Functions) | No |
| La llave que firma los códigos | Tabla `llave_firma` en Supabase | No |
| **La clave del panel** | Aquí abajo, y su **hash** en `panel_clave` | No. Y si se pierde, se reemplaza desde Supabase sin necesitar la anterior |

Todo está en el repositorio, **incluida la clave del panel** — por eso el repo
es privado y tiene que seguir siéndolo. De ella la base solo conserva un hash,
así que no se «recupera»: se reemplaza, y eso se hace desde Supabase sin
necesitar la anterior (ver abajo).

## Acceso al panel

| | |
| --- | --- |
| Dirección | https://rifas.el-original.workers.dev/panel.html |
| Usuario | No hay. Solo la clave |
| Clave | `JrIEng7X3lSz` |

> ### ⚠️ Este repositorio tiene que seguir siendo PRIVADO
>
> Esa clave es el control del sorteo: quien la tenga puede crear rifas y
> revelar un ganador. Está escrita aquí porque el repositorio es privado
> —comprobado: un visitante anónimo recibe 404—, y además **ya vivía en el
> historial de git desde antes**, así que esconderla de este archivo no la
> quitaría de ningún lado.
>
> El 23 de septiembre de 2026 se cambió desde el panel y se volvió a dejar
> esta misma el mismo día, a petición del dueño.
>
> **Si algún día lo vuelves público, o agregas colaboradores, cambia la clave
> ANTES.** Git conserva para siempre lo que se le entrega: esta línea y todo
> el historial saldrían juntos, aunque para entonces ya la hubieras borrado
> del archivo. Y esta clave en concreto ya está ahí dentro, así que borrarla
> del archivo no serviría: hay que **cambiarla**.

En la base solo vive su **hash** SHA-256, en `panel_clave`, que nadie puede
revertir. Guárdala también en un gestor de contraseñas: un repositorio no es
buen único lugar para un secreto.

### Cómo cambiarla

**Desde el panel: pestaña «Perfil».** Pide la actual —tecleada, no la que la
pantalla trae guardada, para que un panel abierto y sin dueño no sirva para
dejar al dueño fuera—, la nueva dos veces, y ocho caracteres o más. La pantalla
que la cambió sigue trabajando; las demás tienen que volver a entrar.

> ⚠️ **Al cambiarla desde el panel, actualiza también la línea de arriba**, o
> este documento le va a mentir a quien lo lea buscando entrar. Ya pasó una
> vez: se cambió la clave y el archivo siguió anunciando la anterior.

### Si se pierde

**Sí se puede restablecer**, y no hace falta el panel ni la clave vieja: basta
con entrar a Supabase con la cuenta dueña del proyecto. No es «recuperarla»
—el servidor solo guarda su huella y de una huella no se saca el original—,
es **reemplazarla** por una nueva. En el editor SQL de Supabase:

```sql
-- Cambia SOLO el texto entre comillas por tu clave nueva.
update public.panel_clave
   set hash = encode(sha256('tu-clave-nueva'::bytea), 'hex'),
       actualizado_en = now()
 where id = 1;
```

(Comprobado: así es exactamente como la función compara la clave que tecleas.)

Surte efecto en la llamada siguiente; no hay que publicar nada ni reiniciar
nada. Quien tuviera el panel abierto con la clave vieja tendrá que volver a
entrar.

**Los boletos ya impresos siguen siendo válidos**: la clave del panel y la
llave que firma los códigos son dos cosas distintas. Cambiar una no toca a la
otra, así que restablecer la clave nunca invalida un lote.

## Las llaves

| Llave | Para qué | Dónde conseguirla |
| --- | --- | --- |
| Clave del panel | Entrar a `panel.html` | Arriba, en «Acceso al panel» |
| Llave de firma (64 caracteres) | Calcular el código de un folio fuera del panel | `select llave from llave_firma where id = 1;` en el editor SQL de Supabase |
| Clave pública de Supabase | Ya está en `assets/config.js` | No es secreta: solo deja leer el estado de la rifa |

La llave de firma **no hace falta para nada del día a día**: el panel firma los
códigos solo. Sirve únicamente si alguna vez quieres volver a generar boletos
desde la terminal con `herramientas/generar-folios.mjs`.

## Direcciones

| | |
| --- | --- |
| Repositorio | https://github.com/killspree2704/rifas |
| Boleto (lo que ve la gente) | https://rifas.el-original.workers.dev/ |
| Panel | https://rifas.el-original.workers.dev/panel.html |
| Diagnóstico de red | https://rifas.el-original.workers.dev/diagnostico.html |
| Supabase | https://supabase.com/dashboard/project/fgwavuaolmrwagaymgos |
| Cloudflare | https://dash.cloudflare.com → Workers & Pages → `rifas` |

Todas con la cuenta `perez.eduardo2704@gmail.com`.

### Ver un cambio antes de fusionarlo

Cloudflare publica **una dirección por rama**, no solo la de `main`. La forma
es la rama con los `/` y los `.` cambiados por guiones:

```
https://<rama-con-guiones>-rifas.el-original.workers.dev/panel.html
```

Por ejemplo, la rama `claude/bold-archimedes-9b51qm` se ve en
`https://claude-bold-archimedes-9b51qm-rifas.el-original.workers.dev/panel.html`.

> **Esa dirección usa la MISMA base de datos que la de verdad.** Es una copia
> del sitio, no del sistema: la rifa que crees ahí es una rifa real, con sus
> folios reales ocupados. Para probar sin tocar nada real está el servidor de
> prueba (`node pruebas/servidor-de-prueba.mjs`).

## Retomar desde otro equipo

Para **usar** el sistema no hace falta instalar nada: el panel se abre en el
navegador de cualquier teléfono o computadora con la clave. Lo de abajo es
solo si quieres tocar el código.

```bash
git clone https://github.com/killspree2704/rifas
cd rifas

# Verlo en local (sin tocar nada real)
npx serve .        # o: python3 -m http.server

# Correr las pruebas
npm install playwright jsqr pngjs && npx playwright install chromium
node pruebas/panel.mjs
```

Publicar es `git push`: Cloudflare recompila solo. **Si tocas archivos del
sitio, sube el número de versión en `sw.js`** (`CACHE = 'rifa-v11'` → `v12`) o
los teléfonos que ya abrieron la página seguirán viendo la vieja. **Y si lo que
tocaste fue el panel, sube también el `?v=` de las etiquetas en `panel.html`**,
al mismo número: eso es lo único que alcanza al operador que ya tiene instalado
el trabajador de servicio anterior, porque una dirección que su copia nunca vio
lo obliga a ir a la red.

Y el orden al publicar, que depende de qué cambió en la función `sorteo`:

- **Si la función quita o renombra algo** (un campo, una respuesta), **el sitio
  va primero o al mismo tiempo, nunca después.** Al revés el panel le pide al
  servidor algo que ya no existe: así salió el «undefined» en las hojas.
- **Si la función solo agrega algo** (una acción nueva que el sitio va a usar),
  **la función va primero.** Nadie la llama todavía, así que no rompe nada, y
  cuando el sitio llegue ya la encuentra.

## Cómo está armado

```
El boleto de papel                El teléfono                    El panel
┌──────────────┐                 ┌──────────────┐              ┌──────────────┐
│ 1018   4307  │   escanea QR    │ index.html   │              │ panel.html   │
│ 2850   3267  │ ──────────────► │ + app.js     │              │ + panel.js   │
│ [QR]  R5VR   │  ?b=…&c=…       └──────┬───────┘              └──────┬───────┘
└──────────────┘                        │                             │
                                rifa_de_boleto()            función de borde
                                 (solo lee)                 `sorteo` (escribe)
                                        │                             │
                                        └────────► Supabase ◄─────────┘
```

- El teléfono **solo lee**. Nunca puede escribir nada.
- El panel **tampoco escribe directo**: todo pasa por la función `sorteo`, que
  pide la clave en cada llamada.
- La rifa que ve cada boleto la decide **el boleto impreso**, no una
  configuración. Por eso una rifa nueva no necesita publicar el sitio otra vez.
- **Un boleto lleva varios folios** —cuatro por omisión—, y cada uno es una
  oportunidad de ganar. El ganador es **uno solo**: el boleto entra cuatro
  veces a la tómbola, no se lleva cuatro premios. Cuántos números lleva cada
  boleto se elige al crear la rifa.

### En la base de datos

| Tabla | Qué guarda |
| --- | --- |
| `rifas` | Una fila por rifa: estado, fecha, ganador, si es la activa, el enlace de la transmisión, desde qué aparato salió, el **diseño del boleto impreso** y si está **archivada** (`archivada`; sacada del historial del panel, sin borrar nada). Trae también `emision`, de cuando el boleto imprimía una fecha de emisión —ya no se usa desde el panel, pero la columna se quedó— |
| `boletos` | El boleto de papel: su identificador (el del QR) y su código. **Sin políticas: nadie lo lee desde fuera** |
| `folios` | Un renglón por número impreso. El folio es único de por vida, entre todas las rifas, **archivadas o no**. **Sin políticas** |
| `sorteo_log` | Cada acción del panel con su hora, **y también cada número tecleado en «Revelar» que no pertenecía a la rifa** (`intento_rechazado`) — la prueba de que un papelito ajeno a lo impreso queda rechazado y registrado, no solo rechazado |
| `panel_clave` | El hash de la clave. Sin políticas |
| `panel_ajustes` | Lo que no cuelga de una rifa: hoy, el diseño que heredará la próxima. Sin políticas |
| `llave_firma` | La llave HMAC. Sin políticas |

| Función | Qué hace |
| --- | --- |
| `rifa_de_boleto(boleto, codigo)` | Devuelve la rifa de un boleto **y sus folios**, y solo si los dos coinciden |
| `proteger_ganador` (disparador) | Impide escribir el ganador antes de revelar y cambiarlo después. **Ni con la llave de servicio** |

Migraciones aplicadas, en orden: `esquema_rifas`, `realtime_rifas`,
`endurecer_trigger`, `rifa_activa_y_llave`, `rifa_de_folio`, `transmision`,
`rifa_de_folio_con_transmision`, `boleto_con_varios_folios`,
`diseno_del_boleto`, `ajustes_del_panel`, `fecha_de_emision_del_lote`.

> El 25 de octubre de 2026 se aplicaron dos cambios más directo por SQL
> —composite PK de `folios` para el sorteo de canastas, y `rifas.archivada`—
> sin pasar por el flujo de migraciones con nombre de siempre, porque el
> MCP de Supabase estaba sin autenticar en ese momento. El esquema real ya
> los tiene; lo que falta es el registro con nombre en el historial de
> migraciones, que no afecta a nada en producción.

**Aquí no hay ningún dato personal del comprador.** Ni nombres, ni teléfonos,
ni correos. Solo números. Quién compró cada boleto lo lleva el vendedor en su
libreta, y ese es el diseño, no una omisión.

## Archivar una rifa, y por qué no hay «borrar» en el panel

Desde el historial de la pestaña Rifas, **«Archivar»** saca una rifa de la
lista de siempre — sin teclear nada, con el doble toque de siempre para
confirmar. **No borra nada**: sus boletos y folios se quedan en la base tal
cual. En el modo de siempre (sin tope), eso es lo que hace que sus números
nunca se repitan en otra rifa; en el sorteo de canastas (con tope) los
números SÍ se repiten entre rifas a propósito, archivadas o no — ver
«Sorteo de canastas» más abajo. Una rifa archivada se puede ver y traer de
vuelta en el desplegable
**«Archivadas»**, con su botón **«Reactivar»**.

Sirve lo mismo con una rifa recién creada por error que con una ya cerrada y
con ganador: archivar no tiene el candado del ganador, porque no toca ni el
ganador ni ningún folio — solo deja de aparecer en la lista.

**El borrado de verdad —el que sí libera folios para reusarlos, y que de
verdad no tiene vuelta atrás— no vive en el panel.** Se decidió así a
propósito: es la única manera de que un clic de más en el panel nunca
destruya nada. Si hace falta de verdad (rifas de prueba, un ensayo que se
coló en producción), se pide directo en el chat con quien mantiene el
proyecto, y se hace a mano contra la base. Así pasó el 25 de octubre de
2026: se crearon sin querer dos rifas de prueba («PRUEBA 1», «PRUEBA2») y,
confirmado explícitamente, también se borró la primera rifa real de
octubre para dejar la base en cero otra vez.

## Dos rifas el mismo día

**Sí se puede**, sin tocar nada del sistema: cada boleto impreso resuelve su
propia rifa por sí solo, no existe «la rifa del día». Para un segundo sorteo
una o dos horas después del primero:

1. Antes del evento, **crea las dos rifas** desde la pestaña Rifas —cada una
   con su propio lote de boletos y su propia hoja para imprimir—.
2. Reparte los boletos de cada una por separado: a simple vista son
   distintos (nombre, serie, diseño si se eligió uno distinto), pero lo que
   de verdad los distingue es el folio impreso.
3. Para el primer sorteo, **«Manejar esta»** sobre la primera rifa, transmite,
   revela, cierra.
4. Para el segundo, **«Manejar esta»** sobre la segunda —ahí el panel cambia
   de cuál maneja, nada más—, y se repite el mismo guion.

Lo único a cuidar: cada boleto trae impreso a qué rifa pertenece por su
folio, así que repartir los boletos de la rifa equivocada en la mesa
equivocada confundiría a quien participa, aunque el sistema en sí no se
rompe. Conviene que el diseño o el nombre dejen clara la diferencia a
simple vista.

## ⚠️ El plan gratis PAUSA el proyecto a los 7 días sin actividad

Pasó el 12 de octubre de 2026: el panel daba «Failed to fetch» y la causa era
que Supabase había pausado el proyecto por inactividad desde el 28 de
septiembre. No era la clave ni el sitio: la base estaba apagada.

**Qué se siente:** «Failed to fetch» en el panel, y la pantalla del boleto sin
poder resolver nada. Ojo con el diagnóstico equivocado: una clave mala NO da
ese mensaje, da «clave incorrecta».

**Cómo se arregla:** entrar al [panel de Supabase](https://supabase.com/dashboard/project/fgwavuaolmrwagaymgos),
pulsar **Resume project** y esperar. Tarda unos minutos y pasa por `COMING_UP`
→ `RESTORING` → `ACTIVE_HEALTHY`. **Durante `COMING_UP` el esquema se ve vacío
y parece que se perdió todo: no es cierto**, los datos se cargan en
`RESTORING`. No hagas nada hasta ver `ACTIVE_HEALTHY`.

**Cómo se evita**, que es lo que importa:

- **Lo barato:** abrir el panel o `diagnostico.html` un par de veces por semana.
  Según la documentación de Supabase, «unas pocas peticiones al día a lo largo
  de la semana» bastan para que no se pause.
- **Lo seguro, y lo que yo haría para el mes del evento:** pasar a Pro. **Los
  proyectos de pago no se pausan nunca.** Ya había una razón para pagar ese mes
  —las 500 conexiones en vivo—; esta es más grave, porque un proyecto pausado
  el día del sorteo deja todo muerto hasta que alguien lo despierte, y tarda
  minutos.

Supabase manda **dos correos** al dueño: un aviso una semana antes y otro al
pausarse. No los ignores. Y hay **90 días** para restaurar un proyecto pausado;
pasados esos, solo queda descargar un respaldo.

## El día de la rifa

1. Llegar a la sede y abrir `diagnostico.html` con la red del lugar y con
   datos móviles. Cuatro pruebas en segundos: sitio, base, **motor del panel**
   y reloj. Si la tercera sale en rojo, el panel no va a poder revelar aunque
   todo lo demás se vea bien.
2. Entrar al panel y comprobar que la rifa correcta está en **En espera**.
3. Empezar a transmitir en YouTube desde la app, con **«Permitir insertar»
   encendido** en la configuración avanzada del directo. Ya al aire, copiar el
   enlace del directo —o dejar puesto `youtube.com/channel/UC…/live`, que
   sirve para siempre y sí se incrusta— y presionar **Transmitir** en el
   panel. Los teléfonos cambian solos a «La rifa se está llevando a cabo» y
   traen el botón **Ver la transmisión aquí**, que mete el reproductor en la
   propia pantalla del boleto. Debajo queda «o ábrela en YouTube» por si algo
   falla. **Quien la ve no necesita cuenta de nada.**
4. Sacar una bolita de cada canasta —de izquierda a derecha, un dígito por
   canasta— y teclear el número que forman. **El ganador lo deciden las
   canastas, no la app**: «Revelar» solo registra lo que ya salió, y el
   servidor rechaza cualquier número que no pertenezca a la rifa.
   («Sortear al azar» es el otro botón, para cuando no hay sorteo físico.) El panel enseña **de qué boleto
   salió ese número, con su código y sus otros tres números**:
   **compáralo con el talón que traes en la mano** antes de tocar Revelar, que
   no se enciende hasta entonces. Luego pide confirmar dos veces.
   **Es irreversible**: ni tú ni nadie puede cambiar el ganador después.
5. **Cerrar**. El resultado sigue viéndose para quien escanee, para siempre.

Si algo sale mal con la red: la pantalla del participante funciona con el
reloj del teléfono y se guarda sola para abrirse sin conexión. Lo único que
necesita señal es enterarse del ganador.

## Sorteo de canastas: números chicos que se repiten entre rifas

Pedido el 25 de octubre de 2026, para que el sorteo físico se parezca al de
una rifa tradicional: una canasta por dígito, con sus bolitas, en vez de un
solo bombo con un papelito por boleto vendido. Por ejemplo, con 4 canastas:
la primera con bolitas 0 y 1 (tope 1999), las otras tres con las diez
bolitas 0-9 cada una. Sacar una bolita de cada canasta arma el número
ganador, dígito por dígito.

**Cómo se usa:** al crear la rifa, campo **«Tope del sorteo»**. Puesto un
número (por ejemplo 999, o 1999 si la primera canasta ya trae una bolita
más), los folios salen de 1 a ese tope, con tantos ceros a la izquierda
como hagan falta. **Vacío, sigue el modo de siempre**: números grandes y al
azar, únicos para toda la vida del proyecto —el de antes de este cambio.

**Lo que cambia de fondo:** con tope puesto, el folio **ya no es único
entre rifas, a propósito** —el mismo 0347 puede salir en esta rifa y en la
siguiente—. Lo que antes impedía la falsificación era que el número fuera
raro de adivinar entre 90,000 posibles; ahora lo sigue impidiendo el
**código firmado** que lleva cada boleto (el de 4 letras, HMAC, imposible de
calcular sin la llave del servidor), que no depende para nada de qué tan
grande sea el folio. Por eso la pantalla «Verificar» del panel, cuando
alguien solo trae el número suelto —sin el identificador largo del QR—,
ahora busca la pareja **folio + código** entre TODAS las rifas, no solo
dentro de una: que dos boletos de rifas distintas compartan folio Y código
firmado es, en la práctica, imposible.

**Cuántos boletos caben:** el tope ES el límite real —no hay margen extra
como en el modo grande—. Con tope 999 y 4 números por boleto, caben 999÷4 ≈
249 boletos. Si se agrega una bolita más a la primera canasta (tope 1999),
caben hasta 499. El panel avisa si lo que se pide no cabe en el tope, antes
de generar nada.

**El campo «Tope» no se limpia solo entre una rifa y la siguiente**: representa
las canastas físicas que ya se tienen armadas, que no cambian de una rifa a
otra —solo cuando de verdad se le agrega una bolita más a alguna—.

## Para la siguiente rifa

Todo desde el panel, sin tocar código ni publicar nada:

1. **Rifas → Nueva rifa**: nombre, serie, día y hora, cuántos boletos,
   **cuántos números lleva cada boleto** (4 de omisión), dígitos del folio,
   **tope del sorteo** (ver «Sorteo de canastas» más abajo) y precio si
   quieres llevar la cuenta. Sin tope, lo que tiene que caber en los dígitos
   son los *números*, no los boletos: con 4 por boleto y 4 dígitos caben 675
   boletos; el panel te lo dice antes de generar nada.
2. Se abre la hoja: **Imprimir → Guardar como PDF**, y de ahí a la imprenta.
   Si al imprimir sale en blanco y negro, sin la foto ni los colores de
   fondo: en el diálogo de impresión, busca «Más opciones» → **«Gráficos de
   fondo»** y márcala. El panel ya fuerza esto por código —no debería hacer
   falta tocar nada—, pero algunos navegadores viejos no lo respetan.
3. **Manejar esta** para que el panel opere esa rifa.
4. Si quieres darle aspecto, **pestaña «Diseño»**. Lo primero que se elige
   ahí es la **disposición**, que es la plantilla entera:
   - **Clásica**: horizontal y sobria, la de siempre.
   - **Suertudito** y **Bono Gana Hoy**: dos FOTOS REALES de boletos que trajo
     el dueño —todo lo fijo de cada una (marco, título, adornos, aviso) va de
     fondo tal cual, sin dibujarse de nuevo; son `assets/boleto-suertudito-colon.png`
     y `assets/boleto-bono-gana-hoy.png`—. Encima se ponen solo los datos que
     cambian de boleto a boleto: los números en sus recuadros, el QR, la
     caducidad, el precio y, al pie, el identificador y el código. Donde la
     foto trae una MUESTRA (el QR de ejemplo, «$20», en «Suertudito» también
     fechas de muestra), lo que va encima lleva su propio fondo opaco para
     taparla del todo: nunca debe asomar un dato de muestra en un boleto
     real. Los logos propios de cada foto —«Grupo Rural» en una, los
     tréboles y el teléfono en la otra— vienen impresos ahí, no se tocan ni
     se reemplazan por el logo que se sube desde el panel, que es un adorno
     aparte de la disposición clásica.
     Cada pieza está donde la foto dice que va, medida en píxeles sobre la
     imagen, no a ojo —y las dos fotos tienen SUS PROPIAS medidas, guardadas
     cada una por separado—. Al elegir cualquiera de las dos, los boletos
     por renglón saltan a 3 —el tamaño del original— y los colores se ponen
     solos en los de esa foto —verde para «Suertudito», rojo para «Bono
     Gana Hoy»—, para que el QR, las cajas y la caducidad combinen con ella.
     Las dos cosas son sugerencia: se cambian enseguida desde los controles.

     Los números van en dos columnas: con cuatro caen exactamente en las
     cuatro esquinas del original, y **con más de cuatro el boleto se
     aprieta** —tantos renglones como hagan falta hasta diez— y entonces la
     caducidad baja al pie. Ninguna rifa imprime menos números de los que
     vendió. Los números mismos van grandes, casi llenando el recuadro —no
     es solo un folio ahí, es lo primero que alguien tiene que poder leer
     de lejos—.

     Abajo, en las tres disposiciones, van **el identificador del boleto y su
     código impresos en letra**. No es decoración: el día del sorteo el panel
     enseña el código del boleto que salió y hay que compararlo con el talón
     en la mano. Dentro del QR no alcanza —un QR arrugado o mojado no se lee
     y el cotejo se queda sin hacer.

   Encima van ocho temas listos, tus colores, **doce fondos** —seis de línea,
   al estilo del papel de seguridad, y seis de figura: estrellas, confeti,
   burbujas, corazones, tréboles y fiesta, con sus propios colores—, logo y
   el aviso de letra chica.

   **Tono de la foto** (en «Suertudito» y «Bono Gana Hoy», cada una con el
   suyo): la foto de cada plantilla tiene su color de origen —verde una, rojo
   la otra, así las trajo el cliente—, y este control la gira hacia otro
   color sin tocar el archivo. No es un filtro de Instagram sobre todo el
   boleto: solo gira la FOTO (`filter: hue-rotate()` en el pseudo-elemento
   que la trae de fondo), el blanco del papel y el negro del QR no se
   mueven. Trae cinco atajos —Original (el de la foto), Azul, Morado, Rosa,
   Dorado— que además cambian «Tus colores» a juego, calculados para llegar
   al MISMO color final sin importar de cuál arranque la foto puesta, para
   que los recuadros y el texto no se queden en el color de origen con la
   foto ya girada; se puede afinar después con los controles de siempre.
   También hay un control de grados (0–360) para cualquier tono intermedio.

   > **Ojo con la letra del título.** Se pide `Times New Roman` o
   > `Liberation Serif`, que es la romana cursiva del original —no una letra
   > manuscrita: la primera versión pedía `Segoe Script` y en una máquina con
   > Windows el título salía escrito a mano, que es otro boleto—. Si la
   > computadora no tiene ninguna de las dos, sale en la romana de
   > sistema: legible, pero con otra letra. Imprime una hoja de prueba desde
   > la máquina que vaya a hacer el tiraje antes de mandar el lote. **Se puede diseñar antes de crear la
   rifa**: sin ninguna, lo que guardes se le copia a la próxima al nacer. Se guarda **en esa rifa**,
   así que cada una puede verse distinta y reimprimir una hoja vieja da la hoja
   de entonces. Solo toca el papel; la pantalla del participante no cambia.
   El QR va siempre sobre blanco, pase lo que pase con el tema: uno sin
   contraste no lo lee ningún teléfono, y de eso uno se entera cuando los
   boletos ya se repartieron.

Los folios nunca se repiten entre rifas. Los boletos viejos siguen abriendo su
propio resultado.

## Fecha de emisión del lote — quitada (26 de octubre de 2026)

El boleto imprimía «Emisión: …» de canto, junto a la caducidad, con un campo
para fijarla al crear la rifa y otro para corregirla después en **Diseño**.
El dueño pidió quitarla del todo: el boleto ya no imprime ninguna fecha de
emisión, y los dos campos que la controlaban —«Fecha de emisión (opcional)»
en Nueva rifa y «Fecha de emisión impresa» en Diseño— se quitaron del panel.
**La caducidad se queda igual que siempre**, ahora sola y centrada en el
hueco de canto donde antes iban las dos.

La columna `rifas.emision` sigue en la base y la función de borde `sorteo`
sigue aceptando `fecha_emision` en `crear_rifa` y la acción `fijar_emision`
—nada los llama ya desde el panel, pero no hacía falta tocar producción para
quitar un campo del frontend—. Si algún día hace falta borrarlos de verdad,
es un cambio aparte, en el servidor.

## El QR de «Bono Gana Hoy» tapaba la herradura — corregido (26 de octubre de 2026)

El primer acomodo de esta plantilla trataba el logo del centro —la
herradura y la bolsa de dinero— como si fuera una MUESTRA que había que
tapar, igual que el QR de ejemplo de «Suertudito». No lo es: es parte fija
del diseño y el dueño lo notó ya con el boleto impreso, en producción —el QR
de verdad se ponía encima y se lo comía entero.

El QR se movió al hueco vacío de abajo del logo (`qr.top` pasó de 25.6 % a
51.3 % en `PLANTILLAS.bono`, dentro de `assets/panel.js`), y la herradura se
queda visible, sin nada encima. Como ese hueco ya no le sobra espacio a la
caducidad, esta plantilla dejó de tener un recuadro `.fechas` propio —a
diferencia de «Suertudito»—: la caducidad de «Bono Gana Hoy» siempre sale en
el pie, igual que en un boleto apretado, aunque lleve solo cuatro números.
Si algún día se agrega una tercera plantilla sin hueco propio para la
caducidad, basta con no definirle `fechas` en `PLANTILLAS` para que se
comporte igual.

## El precio del boleto, ahora corregible después de crear la rifa (26 de octubre de 2026)

Antes solo se fijaba una vez, al crear la rifa («Precio» en **Nueva rifa**).
El dueño pidió poder corregirlo después —un precio mal tecleado se nota ya
con el lote andando—, así que en **Diseño** hay ahora un campo «Precio del
boleto» con su propio botón «Guardar precio», igual que antes lo tenía la
fecha de emisión. Va aparte de «Guardar el diseño» a propósito: el precio es
**de la rifa**, no del diseño —entra en el total vendido que se enseña en la
lista de rifas—, así que vive en su propia acción del servidor
(`fijar_precio`, en `supabase/funciones/sorteo/index.ts`) en vez de colarse
dentro de `diseno`. No toca folios ni boletos, así que corregirlo sigue
siendo válido aunque la rifa ya esté cerrada.

## Estado al 25 de octubre de 2026

Comprobado consultando Supabase, no de memoria.

**La base está vacía de rifas, por segunda vez y a propósito.** La tarde del
25 de octubre se crearon sin querer dos rifas de prueba («PRUEBA 1»,
«PRUEBA2», 250 boletos cada una) mientras se probaba el panel, y de paso se
decidió —confirmado explícitamente con el dueño, que entendía que esto
incluía borrar un ganador ya revelado— borrar también «Rifa El muerde
manos», la del 12 de octubre, para dejar todo en cero otra vez antes de
usar el sistema de verdad.

| Tabla | Filas |
| --- | --- |
| `rifas` | 0 |
| `boletos` | 0 |
| `folios` | 0 |
| `sorteo_log` | 0 |
| `panel_ajustes` | 1, sin diseño guardado: la próxima rifa nace con el clásico |
| `llave_firma` | 1 — intacta |
| `panel_clave` | 1 — con la clave de arriba |

Ese borrado se hizo **a mano, directo en la base**, no desde el panel: el
panel ya no tiene ni una acción para borrar de verdad (ver «Archivar una
rifa» más arriba). Es el único camino que queda para un borrado real, y
existe a propósito para que un clic de más en el panel nunca destruya nada.

### Dónde está cada pieza hoy

| | |
| --- | --- |
| Service worker | `rifa-v28` |
| Etiquetas del panel | `?v=28` |

### El «undefined» de las hojas: qué fue

Queda anotado porque la causa sigue importando, aunque esas rifas ya se
borraron. Las hojas de `PRUEBA 2` y `RIFA PRUEBA 3` salieron con `C-undefined`
donde iba el código. **No fue la base**: los datos de las dos estaban completos
y bien firmados. Fueron dos errores encadenados, los dos ya corregidos:

1. La función `sorteo` se publicó antes que el sitio. El panel viejo pedía
   `boleto.folio`, campo que la función nueva ya no manda.
2. Aun después de publicar el sitio, el trabajador de servicio seguía sirviendo
   `panel.js` desde la copia guardada: HTML nuevo corriendo JavaScript viejo.
   Ahora los archivos del panel van a la red primero y sus etiquetas llevan
   `?v=`, que sube a la par de `CACHE`.

De ahí salen las dos reglas de publicación que están arriba, en «Retomar desde
otro equipo». Si vuelve a aparecer un «undefined» en la hoja, el sospechoso
número uno es el caché del navegador, no la base.

- `assets/config.js` **no apunta a ninguna rifa**: sus valores son solo el
  respaldo del primer pintado, y la rifa de verdad la resuelve el boleto.
- El panel y el boleto pasan **235 comprobaciones** automáticas
  (`node pruebas/panel.mjs`), todas en verde.

### La transmisión, en corto

- Se transmite **desde la app de YouTube**, no desde la página. Un navegador
  no puede mandar video a YouTube: no habla RTMP, y hacerlo pediría un
  servidor propio de por medio.
- La transmisión **se ve dentro del boleto**, pero el reproductor solo se
  carga cuando alguien toca el botón. Así la página sigue abriendo sin
  depender de ningún dominio ajeno, y quien no lo toca no paga nada.
- **Enciende «Permitir insertar»** en la configuración avanzada del directo,
  en YouTube Studio. Viene apagado por omisión y sin eso el reproductor sale
  en blanco.
- El enlace `@tucanal/live` es permanente pero **no se puede incrustar**. El
  de `channel/UC…/live` es permanente y sí. El panel lo avisa al escribirlo.
- **Ver no pide cuenta**; solo comentar la pide. Y si el directo queda marcado
  como restringido por edad, sí va a pedir sesión: no lo marques.
- **Un solo aparato transmite a la vez.** El segundo ve de dónde está saliendo
  y puede tomar el control si el primero se cayó.

### Pendientes

- **Supabase Pro para el mes del evento, por DOS razones.** La primera y más
  grave: **el plan gratis pausa el proyecto a los 7 días sin actividad** —ya
  pasó una vez— y los de pago no se pausan nunca; un proyecto pausado el día
  del sorteo deja todo muerto hasta que alguien lo despierte. La segunda: el
  plan gratis da 200 conexiones simultáneas de Realtime y ustedes esperan 500
  teléfonos. Con Pro (~25 USD el mes, cancelable después) se resuelven las dos.
  Lo de las conexiones solo no se rompe —el sondeo de respaldo cubre a los que
  no alcancen canal, y está medido: 500 pantallas proyectan 167 consultas por
  segundo y todas ven el resultado, solo que tardan unos segundos más—. Lo de
  la pausa sí rompe.
- **Borrar la rama vieja** `claude/qr-code-raffle-ticket-ks2mxd` en el
  repositorio de Koppert. Su PR está cerrado y `main` quedó intacto, pero la
  rama sigue ahí.
- **Dejar el diseño elegido ANTES de crear la próxima rifa.** El diseño se
  copia a la rifa al crearla, no después: si se quiere el boleto
  «Suertudito», hay que elegirlo en la pestaña «Diseño» y guardarlo primero,
  o la rifa nace con el clásico.
- ~~Reemplazar el boleto «Suertudito» dibujado por la foto real del cliente~~
  **Hecho (26 de octubre de 2026).** `assets/boleto-suertudito-colon.png` es
  ahora el fondo del boleto, tal cual, incluyendo el logo «Grupo Rural» (el
  dueño pidió explícitamente conservarlo, no omitirlo). Encima solo van los
  datos que cambian: números, QR, fechas, precio, y al pie el identificador +
  código en letra chica. Ver la disposición «Suertudito», dentro de «Para la
  siguiente rifa» más arriba, para el detalle completo.
