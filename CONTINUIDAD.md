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
| Clave | `7AMobF7aQy` |

> ### ⚠️ Este repositorio tiene que seguir siendo PRIVADO
>
> Esa clave es el control del sorteo: quien la tenga puede crear rifas y
> revelar un ganador. Está escrita aquí porque el repositorio es privado
> —comprobado: un visitante anónimo recibe 404—, y además **ya vivía en el
> historial de git desde antes**, así que esconderla de este archivo no la
> quitaría de ningún lado.
>
> El 23 de septiembre de 2026 se cambió desde el panel y se volvió a dejar
> esta misma el mismo día, a petición del dueño. El 7 de noviembre de 2026 el
> dueño la había olvidado: se **reemplazó** directo en Supabase (ver «Si se
> pierde» abajo), sin necesitar la anterior.
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

### Candado contra fuerza bruta (7 de noviembre de 2026)

Diez claves equivocadas seguidas —vengan de una conexión o repartidas entre
muchas a la vez— congelan la clave 15 minutos, aunque después se escriba la
correcta. Es aparte del retraso de 700ms que ya traía cada petición mala: ese
retraso es por petición, así que no frena un ataque en paralelo; el candado
sí, porque la cuenta de fallos vive en la base (`panel_candado`), no en la
memoria de cada petición.

Si alguna vez el dueño se traba ahí por error propio (varias claves mal
tecleadas seguidas), no hay botón en el panel para destrabarlo —a propósito,
es el mismo candado que frena a cualquiera—: se espera, o se limpia a mano
en el editor SQL de Supabase:

```sql
update public.panel_candado set fallos = 0, bloqueado_hasta = null where id = 1;
```

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
| `rifas` | Una fila por rifa: estado, fecha, ganador, si es la activa, el **diseño del boleto impreso** y si está **archivada** (`archivada`; sacada del historial del panel, sin borrar nada). Trae también `emision` y `transmision_url`/`transmite_desde`, de funciones que el panel ya no ofrece —ni la fecha de emisión ni el video de YouTube—, pero esas columnas se quedaron |
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
   Los teléfonos cambian solos a «La rifa se está llevando a cabo» al llegar
   la hora del sorteo —no hace falta ningún paso aquí para eso—.
3. Sacar una bolita de cada canasta —de izquierda a derecha, un dígito por
   canasta— y teclear el número que forman. **El ganador lo deciden las
   canastas, no la app**: «Revelar» solo registra lo que ya salió, y el
   servidor rechaza cualquier número que no pertenezca a la rifa.
   («Sortear al azar» es el otro botón, para cuando no hay sorteo físico.) El panel enseña **de qué boleto
   salió ese número, con su código y sus otros tres números**:
   **compáralo con el talón que traes en la mano** antes de tocar Revelar, que
   no se enciende hasta entonces. Luego pide confirmar dos veces.
   **Es irreversible**: ni tú ni nadie puede cambiar el ganador después.
4. **Cerrar**. El resultado sigue viéndose para quien escanee, para siempre.

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

## El tope mal elegido deja una canasta casi vacía (26 de octubre de 2026)

El dueño imprimió «Boletos A — 250.pdf» (250 boletos, tope 1000, 4 dígitos) y
notó algo raro: de los 1000 folios, **999 empezaban en 0 y SOLO UNO en 1**
(el folio 1000 mismo). Su canasta de hasta la izquierda ya trae armadas las
bolitas 0 y 1 —no es un error de capacidad, el boleto #1000 sí se puede
ganar—, pero con un tope apenas arriba de 1000 esa bolita casi nunca
encuentra pareja al sacarla en vivo: 1 de cada 1000 posibles, en vez de la
mitad que esperaría cualquiera viendo una canasta de dos bolitas.

**La causa:** el tope se puso en exactamente lo que hacía falta (250×4=1000),
no en lo que la canasta física puede producir. Con una canasta de 0 y 1 en el
primer dígito, el tope que de verdad la aprovecha es **1999**, no 1000 —el
sorteo de canastas no obliga a vender todos los folios posibles, solo a que
el RANGO del sorteo coincida con las bolitas armadas—.

**Arreglado:**
- El texto de ayuda de «Tope del sorteo», en **Nueva rifa**, ahora explica
  esto con el ejemplo exacto (999 si la canasta trae solo el 0, 1999 si
  trae el 0 y el 1 — nunca un número a medias como 1050).
- El panel **avisa solo**, antes de generar nada: si el tope que se escribe
  deja la canasta de más a la izquierda con menos del 30% de su rango
  aprovechado, el resumen de «Nueva rifa» lo dice en rojo y sugiere el tope
  que sí la llena entera. Ver `resumenNueva()` en `assets/panel.js`.

## El panel, de vidrio a tarjetas sólidas —«más administrativo» (6 de noviembre de 2026)

Pedido del dueño, con una imagen de referencia (un dashboard genérico de
plantilla): reestructurar el panel para que se sienta más como una
herramienta administrativa seria y menos como una app de consumo. **No se
copió la imagen tal cual** —traía un mapa mundial con pines y contadores
de seguidores de Facebook/Twitter, que no tienen nada que ver con una
rifa—, se adaptó el ESTILO (tarjetas sólidas, barra lateral oscura,
tarjeta de acento en degradado) a datos reales de este sistema.

**Qué cambió, en `assets/panel.css`:**
- El vidrio esmerilado de `section.caja` y de la barra lateral —`blur()`,
  fondos traslúcidos— se cambió por tarjetas sólidas y planas, con una
  sombra discreta en vez de desenfoque. Se hizo redefiniendo las variables
  `--vidrio*` a colores sólidos en vez de tocar cada regla que las usa —el
  mismo truco de «la ranura importa, no el nombre» que ya traía este
  archivo—, así que no hubo que rastrear cada tarjeta por separado.
- La luz de fondo de colores (`body::before`, pensada para el boleto de
  tómbola) se apaga en `body.panel`: un panel de trabajo se ve más serio
  sobre un fondo liso.

**Lo nuevo, en `panel.html` + `assets/panel.js`:** una fila de cuatro
tarjetas de estadística arriba de la pestaña Sorteo —boletos vendidos,
números en juego, recaudado, días para el sorteo—, con la primera en el
acento azul del panel en degradado. **Todo sale de datos reales de la
rifa que se está manejando, nada de muestra**: si el precio no está
puesto, «Recaudado» se queda en guion, no en `$0.00` que haga pensar que
de verdad no se ha vendido nada.

**Un hallazgo real al construirlo:** guardar un precio nuevo desde Diseño
actualizaba la vista previa del boleto, pero NO la tarjeta «Recaudado» de
Sorteo —se quedaba con el número viejo hasta el siguiente refresco
aparte—. Corregido pidiendo el estado fresco justo después de guardar.

240 comprobaciones en verde (antes 235), 5 nuevas para las tarjetas y el
refresco del precio.

## Herramienta para medir la próxima plantilla (6 de noviembre de 2026)

Pedido del dueño: las plantillas futuras («Suertudito», «Bono Gana Hoy»)
van a seguir el mismo patrón —foto de fondo, cuatro números en dos
columnas, QR, precio, caducidad, pie—, y preguntó si el proceso de medir
esas fotos a mano (cuentagotas, contador de píxeles, scripts de Python
armados una sola vez) se podía dejar listo en el código para la próxima
vez, en vez de repetirlo desde cero.

**`herramientas/medir_plantilla.py`** hace justo eso. No adivina solo
—sigue pidiendo un punto aproximado de dónde cae cada recuadro, que un ojo
humano ubica en segundos viendo la foto—, pero AFINA ese punto al borde
exacto en píxeles, la parte lenta que antes se hacía a mano. Validado
re-midiendo «Suertudito» y «Bono Gana Hoy» desde sus fotos ya guardadas: el
resultado cae a menos de 0.2 puntos porcentuales de los valores que ya
están en `PLANTILLAS` —una diferencia que no se nota impresa—.

**Para la próxima plantilla:**
1. Conseguir la foto (o el PDF, con `pdf_a_imagen`).
2. Ver a ojo, en cualquier visor de imágenes, un punto aproximado DENTRO
   de cada uno de los cuatro recuadros de número.
3. `cuadricula_de_cajas(img, [esos cuatro puntos])` da el `caja` completo,
   listo para pegar en `PLANTILLAS`.
4. `color_hex(img, x, y)` para los colores del tema (fondo, acento…), con
   el mismo sistema de coordenadas.
5. El resto —`qr`, `fechas`, `precio`, `pie`— sigue siendo a ojo, como
   hasta ahora: son huecos de forma y tamaño distinto en cada foto, no una
   cuadrícula repetible como los números.

Ver el docstring del archivo para el uso completo, con ejemplos.

## Se quita el catálogo de temas y plantillas: ahora se cargan (7 de noviembre de 2026)

Siguiente paso natural de la herramienta de arriba: en vez de medir la foto
por fuera y luego copiar esas medidas A MANO dentro de `PLANTILLAS` en
`assets/panel.js` —lo que obligaba a desplegar código nuevo por cada boleto
físico distinto que llegara—, el panel ahora SOLO sabe leer un archivo de
medidas. Pedido explícito del dueño: «vaciar el código que no nos sirve».

**Lo que se quitó entero**, del panel (HTML/CSS/JS) y de la función de
borde: los ocho temas de color, los doce fondos (tramas de línea y de
figura), el logo subible, el catálogo fijo de dos plantillas con foto
(«Suertudito», «Bono Gana Hoy») y el control de tono que las giraba. Nada
de esto decidía algo que no se pudiera resolver mejor con la foto real.

**Lo que lo reemplaza:** la pestaña Diseño trae un bloque «Plantilla» con
dos archivos para subir —la foto del boleto y un JSON de medidas— que se
miden por fuera con `herramientas/medir_plantilla.py` (ver arriba). El
panel junta los dos en el navegador (ninguno de los dos solo hace nada) y
los manda juntos a `guardar_diseno`. Sin plantilla, el boleto sigue
saliendo con el diseño clásico de siempre —fondo blanco, números en
recuadros, sin foto—, con colores fijos y ya probados, no editables: no
tiene sentido un selector de color para un diseño que nadie pidió cambiar.

El archivo de medidas trae las mismas cinco piezas que antes vivían
cableadas en `PLANTILLAS` —`caja`, `qr`, `fechas` (opcional), `precio`,
`pie`— más los cuatro colores del boleto (`fondo`, `tinta`, `acento`,
`borde`), medidos de la foto real con `color_hex()` en vez de salir de un
tema de catálogo. `medir_plantilla.py` ahora trae `armar_medidas()` y
`guardar_medidas()` para juntar todo eso en el archivo exacto que el panel
pide, sin tocar ningún código del panel ni desplegar nada nuevo.

La función de borde valida la FORMA de ese archivo —números entre 0 y 100,
colores `#rrggbb`, la foto como imagen base64 de hasta 2 MB— igual que
antes validaba el catálogo fijo, solo que ya no conoce ningún nombre de
tema ni de disposición: lo que decide cómo se ve el boleto es, de verdad,
lo que el dueño sube, no una lista en el código.

Las fotos de «Suertudito» y «Bono Gana Hoy» (`assets/boleto-*.png`) se
quedan en el repo —ya no las usa el panel, pero sirven de plantilla de
prueba real para `pruebas/panel.mjs`, que ahora ejercita el flujo completo
de carga subiendo esa misma foto y un JSON de medidas armado con los
valores que antes estaban en `PLANTILLAS`—.

195 comprobaciones en verde (antes 240: se fueron las de temas/tramas/tono/
logo, que ya no existen, y entraron las nuevas de cargar y quitar una
plantilla).

## Pestaña «Ayuda»: la guía vive dentro del panel (7 de noviembre de 2026)

Pedido del dueño: una sección en el panel que explique, en español llano,
cómo funciona la página de la rifa para el público y los pasos para crear,
revelar, corregir y «cancelar» (archivar) una rifa — algo que el dueño
pueda leer sin tener que preguntar.

**`#paneAyuda`**, sexta pestaña, con seis bloques plegables: lo que ve la
gente (QR, cuenta regresiva, por qué nadie más puede cambiar nada), cómo
crear una rifa, cómo revelar y cerrar, cómo corregir el diseño después,
cómo archivar/reactivar (y por qué no hay «borrar»), y Verificar/Perfil.
Cada paso cita el texto REAL de su botón («Generar rifa y boletos»,
«Manejar esta», «Revelar», «Archivar», «Reactivar»…), no una paráfrasis —
así, si algún día un botón cambia de nombre, la guía queda mintiendo de
forma obvia en vez de quedarse desactualizada en silencio. `pruebas/
panel.mjs` comprueba justamente eso: que el texto de la pestaña siga
citando los nombres reales. 202 comprobaciones en verde (antes 195).

## La pestaña Ayuda, con GIFs reales del panel (7 de noviembre de 2026)

El dueño pidió, además de los iconos animados, GIFs de verdad mostrando los
botones — y después, en el mismo hilo, pidió explicar con más detalle cómo
cargar un diseño de boleto y cómo «mandarlo a llamar» para que salga en la
hoja impresa. Las dos cosas se resolvieron juntas.

**Los GIFs son grabaciones reales del panel**, hechas con la extensión de
Chrome conectada en vivo (`mcp__claude-in-chrome__gif_creator`) contra el
**servidor de prueba** (`node pruebas/servidor-de-prueba.mjs`, clave
`secreta`) — nunca contra producción, por la misma razón de siempre: no
exponer la clave real en una grabación. Viven en `assets/ayuda/` (cinco
archivos, 300 KB a 5.4 MB cada uno) y se insertan con `loading="lazy"`: el
navegador no los pide hasta que de verdad se desplaza hasta verlos, así que
no pesan nada si nadie abre la pestaña Ayuda.

- `ayuda-entrar.gif` — entrar con la clave y llegar a Sorteo.
- `ayuda-crear-rifa.gif` — llenar «Nueva rifa» y generar el lote.
- `ayuda-revelar-ganador.gif` — escribir el folio, el cotejo, y «Revelar».
- `ayuda-cargar-plantilla.gif` — subir la foto y el JSON, y «Guardar el diseño».
- `ayuda-archivar-rifa.gif` — tocar «Archivar» y ver que sale de la lista.

**El bloque de «Cómo corregir o cambiar una rifa después» se reescribió
entero**, con los pasos completos de punta a punta: medir la foto por
fuera (una sola vez por plantilla, con `medir_plantilla.py`), subir los
DOS archivos en «Diseño» → «Plantilla» (mientras falte uno, el panel sigue
diciendo que no hay ninguna plantilla cargada), y —el punto que antes no
quedaba claro— que **tocar «Guardar el diseño» es lo que de verdad la
manda a llamar**: subir los archivos solo los deja en el navegador, no en
la rifa; sin guardar, «Hoja de boletos» sigue imprimiendo el diseño
clásico. También se documentó la diferencia entre «Quitar la plantilla»
(solo lo que estaba a medio cargar, sin guardar) y «Volver al de siempre»
(borra la que ya estaba guardada en la rifa, con su propia confirmación).

203 comprobaciones en verde (antes 202: una prueba se actualizó al texto
nuevo de la plantilla, y se agregó otra para la frase «la manda a llamar»).

## GIFs reales para cada punto de la guía, con zoom (7 de noviembre de 2026)

Primer intento: esa misma sesión corría en segundo plano sin Chrome
conectado, así que los GIFs de arriba se quedaron en iconos animados de
CSS. El dueño abrió Chrome y pidió retomarlo —uno por cada punto de la
guía, no dejar ninguno sin ilustrar— y además que se vieran más grandes:
a 1536×674 de pantalla completa, los botones y el texto salían
diminutos.

**El zoom se resolvió con CSS, no cambiando el tamaño de la ventana.**
`resize_window` no funcionó en este entorno —la ventana de Chrome se
quedaba en su tamaño de siempre pese a pedirle otro—, así que en vez de
eso se aplicó `document.documentElement.style.zoom = '1.7'` a la página
antes de grabar: es el mismo truco que el zoom nativo del navegador
(Ctrl +), reacomoda el layout entero a un tamaño mayor en vez de solo
estirar una imagen. Con eso, cada botón y cada campo se ve mucho más
grande en el GIF sin tocar ni un pixel del diseño real del panel.

**Las ocho grabaciones, una por cada punto importante de la guía:**

- `ayuda-entrar.gif` — entrar con la clave y llegar a Sorteo.
- `ayuda-crear-rifa.gif` — llenar «Nueva rifa» y generar el lote.
- `ayuda-revelar-ganador.gif` — folio, cotejo, «Revelar» y «Cerrar rifa».
- `ayuda-cargar-plantilla.gif` — subir la foto y el JSON, «Guardar el diseño».
- `ayuda-archivar-rifa.gif` — tocar «Archivar» y ver que sale de la lista.
- `ayuda-reactivar-rifa.gif` — abrir «Archivadas» y tocar «Reactivar».
- `ayuda-verificar-boleto.gif` — comprobar un boleto y ver «Boleto original».
- `ayuda-cambiar-clave.gif` — la clave actual, la nueva dos veces, y confirmar.

Siguen grabadas contra el servidor de prueba, nunca contra producción,
por la misma razón de siempre: no exponer la clave real en una
grabación. `pruebas/panel.mjs` ahora comprueba que las ocho existan de
verdad (`fetch` a cada `src` dentro de `#paneAyuda`, esperando 200): un
nombre de archivo mal escrito se queda mudo en pantalla si nadie lo
mira, así que la prueba lo nota en vez de la gente.

212 comprobaciones en verde (antes 203: 9 nuevas, una por cada GIF más
la que cuenta que sean exactamente ocho).

## Los GIFs salían «imagen sobre imagen» — causa y arreglo (7 de noviembre de 2026)

El dueño los probó y se veían mal: como una captura encimada sobre otra,
nada fluido. La causa: `gif_creator` mete a la grabación CUALQUIER acción
de `computer`/`navigate` que ocurra mientras está grabando, y durante las
ocho grabaciones de arriba se intercalaron muchas capturas `zoom` propias
—para ver dónde estaban los botones antes de hacer clic con coordenadas
fijas—, cada una a un tamaño de recorte ligeramente distinto al de los
fotogramas normales de clic/tecleo. El GIF terminaba mezclando fotogramas
de tamaños distintos, y eso es justo lo que se ve como una imagen pegada
encima de otra.

**El arreglo fue dejar de usar coordenadas fijas del todo.** En vez de
tomar una captura para ADIVINAR dónde está un botón y luego hacer clic en
esas coordenadas, se usa `find()` (busca un elemento por descripción, no
mete fotogramas a la grabación) para obtener su referencia, y se hace clic
directo sobre esa referencia (`computer` con `ref`, no con `coordinate`).
Así cada fotograma de la grabación viene SOLO de una acción real sobre el
panel, todas del mismo tamaño, sin capturas de verificación de por medio.
Para confirmar un estado (¿ya se reveló el ganador?, ¿qué dice el mensaje
de error?) se usa `javascript_tool` —lee el DOM directo, tampoco mete
fotogramas— en vez de otra captura.

De paso se encontraron y rodearon dos problemas reales de automatización,
no del panel: el campo `datetime-local` de «Día y hora del sorteo» no
admite teclear por segmentos de forma confiable con clics por referencia
—el cursor no siempre cae en el segmento del mes—, así que esa fecha se
fija por JavaScript (`el.value = '...'; dispatchEvent('input')`); y la
doble confirmación de los botones peligrosos (crear rifa, revelar,
archivar, volver al de siempre) necesita los dos clics MUY seguidos —el
viaje de ida y vuelta de cada clic por referencia, con sus esperas,
puede acercarse a los 8 segundos de la ventana de confirmación—, así que
el segundo clic de cada par se dispara con `elemento.click()` por
JavaScript en vez de esperar al siguiente turno de herramienta.

**También se completó la cobertura: ahora son diez GIFs, uno por cada
punto real de la guía**, no solo los que se consideraron «importantes» la
vez pasada:

- `ayuda-entrar.gif`
- `ayuda-boleto-publico.gif` — nuevo: la pantalla que ve quien escanea el QR (`index.html?b=…&c=…`), para «Lo que ve la gente».
- `ayuda-crear-rifa.gif`
- `ayuda-revelar-ganador.gif` — ahora empieza en «Manejar esta», el primer paso real del bloque.
- `ayuda-cargar-plantilla.gif`
- `ayuda-volver-de-siempre.gif` — nuevo: el punto de «Quitar la plantilla»/«Volver al de siempre».
- `ayuda-archivar-rifa.gif`
- `ayuda-reactivar-rifa.gif`
- `ayuda-verificar-boleto.gif`
- `ayuda-cambiar-clave.gif`

214 comprobaciones en verde (antes 212: una prueba se actualizó a diez
GIFs en vez de ocho, y entraron dos comprobaciones nuevas de que esos
dos archivos existen).

## Medidor de plantilla, dentro del panel (7 de noviembre de 2026)

El dueño pidió que medir una plantilla nueva no obligara a tocar el
repositorio ni a correr `herramientas/medir_plantilla.py` —el cliente no
sabe hacerlo, y antes era un paso que dependía de pedirle ayuda a quien
toca el código—. El script no se quitó (sigue sirviendo como ruta
avanzada, para quien lo prefiera o reutilice un JSON ya medido), pero
dejó de ser el único camino: en «Diseño» → «Plantilla», en cuanto se sube
la foto aparece «Medir esta foto aquí mismo», que abre un asistente
dentro de la misma página.

El asistente reimplementa en JavaScript, sobre un `<canvas>`, el mismo
algoritmo del script: para los cuatro recuadros de número, un clic
APROXIMADO cerca del borde basta —el navegador escanea alrededor del
punto buscando el primer salto de contraste y encuentra el rectángulo
exacto solo, igual que `recuadro_cercano()` en Python—. El QR, el precio,
el pie y la franja opcional de fechas no tienen un borde que detectar
—son zonas donde el panel debe COLOCAR algo, no un dibujo con marco—, así
que esos se marcan arrastrando un rectángulo a ojo. Los cuatro colores
(fondo, letra chica, números, marco) se toman con un cuentagotas: un clic
lee el píxel exacto de la foto, igual que `color_hex()`. Al terminar el
último paso, arma el mismo JSON que antes había que subir a mano y lo
entrega directo a `intentarArmarPlantilla()` — el cliente nunca ve ni
toca un archivo.

Probado de principio a fin contra la foto real de «Suertudito»
(896×1200 px), comparando contra sus medidas ya conocidas de cuando
existía el catálogo fijo: los cuatro recuadros cayeron casi exactos sobre
el marco impreso de verdad en la vista previa, sin tocar las coordenadas
a mano después.

Un bug de layout aparte, encontrado al probarlo: la columna de contenido
del panel es un `1fr` de CSS Grid (ver «El panel se recorre a una barra
lateral»), y un `1fr` no se encoge por debajo del ancho de su contenido
más ancho a menos que se le diga —el lienzo del medidor, con la foto a su
tamaño real, empujaba la página ENTERA a un ancho mayor que la pantalla,
con una barra de scroll horizontal en todo el panel en vez de solo dentro
del lienzo—. Se arregló con `min-width: 0` en `.contenido` (el truco de
siempre para ese caso de Grid/Flexbox) más `max-width: 100%` en el
envoltorio del lienzo, que si tiene su propio `overflow: auto` para
desplazarse y hacer zoom sin arrastrar al resto de la página con él.

`?v=40` / `rifa-v40`. Todo sigue en verde.

## Pulida del medidor: lenguaje llano, validación, pruebas y un GIF al día (7 de noviembre de 2026)

Repaso completo del medidor recién agregado, a pedido explícito del dueño
—«el cliente no entiende de tecnología»—, más una pasada de seguridad y
funcionamiento sobre el panel entero mientras el dueño estaba fuera.

**Lenguaje llano.** El bloque «Avanzado: ya tengo un archivo de medidas
(JSON)» —mencionaba `herramientas/medir_plantilla.py` y «el repositorio»—
se volvió «¿Ya mediste este boleto antes? Reutiliza ese archivo», sin
mencionar Python, JSON como tal ni el repositorio. Sigue siendo el mismo
mecanismo por dentro (un `<input type="file">` que lee el mismo formato de
siempre), solo que ya no asume que quien lo lee sabe qué es un archivo
JSON.

**Agujero real encontrado y cerrado: un archivo reutilizado roto rompía la
vista previa EN SILENCIO.** `leerJsonMedidas()` solo comprobaba que las
claves existieran, nunca que los valores sirvieran —un color inválido, una
medida que no es número—. Subir un archivo así no tronaba nada (ninguna
excepción, ningún aviso): la vista previa simplemente salía mal, sin que
nadie supiera por qué, justo el tipo de «falla de comunicación» que un
cliente sin conocimientos técnicos no sabría diagnosticar. Se agregó la
misma validación que ya hacía el servidor (`limpiarPlantilla` en
`supabase/funciones/sorteo/index.ts`: colores contra `/^#[0-9a-fA-F]{6}$/`,
medidas numéricas entre 0 y 100) pero del lado del navegador, con un
mensaje claro en español («El color de fondo de ese archivo no es válido.
Vuelve a medir esta plantilla.») en vez de un silencio confuso. Probado a
mano con un archivo roto a propósito: antes decía «Plantilla cargada» igual
(mentira, salía rota); ahora rechaza con el motivo exacto.

**Revisado, sin encontrar nada: ¿se puede inyectar HTML/JS por los campos
de la plantilla?** Con el medidor nuevo invitando a «reutilizar un
archivo», alguien podría mandarle al dueño un archivo de medidas
manipulado. Se repasó la cadena completa: la vista previa en vivo pinta el
CSS de la plantilla con `estilo.textContent = ...` sobre un `<style>` de
verdad —`textContent` nunca reinterpreta su contenido como HTML, así que
un valor con `</style>` dentro no puede «escaparse» del bloque de
estilos—. La hoja impresa (`document.write`, que SÍ sería vulnerable a
ese truco) solo se arma con `rifa.diseno` ya guardado en el servidor, y
`limpiarPlantilla` ya rechaza cualquier color o medida fuera de forma
ANTES de guardar nada. Conclusión: no hay inyección posible hoy, ni por la
vista previa ni por la hoja impresa; el único gap real era el de
comunicación de arriba (validación ausente del lado del cliente), ya
cerrado.

**GIF de Ayuda desactualizado, corregido.** `ayuda-cargar-plantilla.gif`
todavía mostraba el flujo viejo (subir foto + JSON a mano) de antes del
medidor. Se regrabó mostrando el flujo real: subir la foto, tocar «Medir
esta foto aquí mismo», marcar un par de recuadros de verdad sobre el
lienzo, y terminar en «Guardar el diseño» con la confirmación en pantalla.

**Pruebas automáticas nuevas para el medidor en sí**, no solo para que el
botón exista: en `pruebas/panel.mjs`, un bloque nuevo sube la foto real de
Suertudito, abre el medidor, prueba «Deshacer» y «Cancelar», y después
completa los nueve pasos de corrido —clics y arrastres simulados sobre el
`<canvas>`, igual que un dedo o un mouse de verdad— incluida la franja de
fechas. Compara los cuatro recuadros que el algoritmo encontró SOLO contra
las medidas reales conocidas de Suertudito (de cuando existía el catálogo
fijo): el mayor desvío salió de 0.12 puntos porcentuales. 226
comprobaciones en verde (antes 214).

**Repasado sin cambios, todo intacto:** el candado de fuerza bruta
(`panel_candado`), la impresión con plantilla (las pruebas ya existentes
comprueban PDF con y sin fondos forzados, posición exacta de los cuatro
recuadros en la hoja, pie dentro del boleto), y el resto de los botones
del panel —archivar/reactivar, verificar boleto, cambiar clave, crear
rifa, revelar—, todos cubiertos por la misma suite, que sigue en verde.

`?v=41` / `rifa-v41`.

## Biblioteca de plantillas guardadas, con nombre propio (7 de noviembre de 2026)

El dueño notó que, al quitar el catálogo fijo (`PLANTILLAS`, PR #32),
«Suertudito» y «Bono Gana Hoy» habían dejado de estar disponibles de un
clic: cada rifa nueva con esa plantilla obligaba a volver a medir la foto
desde cero. Pidió dos cosas: recuperar esas dos, y que cualquier plantilla
medida se pueda guardar con un nombre para reutilizarla, renombrarla o
borrarla después.

**Tabla nueva, `plantillas_guardadas`** (migración aplicada directo contra
producción vía el MCP de Supabase, que esta vez SÍ autenticó): `id`
(uuid), `nombre`, `plantilla` (el mismo JSON de siempre, completo —foto
incluida—), `creada_en`, `actualizada_en`. Sin políticas RLS a propósito,
igual que `panel_ajustes`/`panel_candado`: solo la función de borde la
toca. Vive aparte de `rifas.diseno` —que es LA plantilla puesta en una
rifa—: esto es de dónde se elige.

**Cuatro acciones nuevas en la función de borde**: `plantillas` (lista
todas), `guardar_plantilla` (nueva, o reemplaza si llega `id`),
`renombrar_plantilla` (solo el nombre, sin volver a medir) y
`borrar_plantilla`. Las cuatro reutilizan `limpiarPlantilla()`, la misma
validación de siempre —colores, medidas, tamaño de foto—, así que no hay
manera de guardar algo roto en la biblioteca.

**En el panel**, Diseño → Plantilla ahora abre con la biblioteca primero:
una tarjeta por plantilla guardada, con su foto en miniatura, «Usar esta»,
«Renombrar» y «Borrar» (con el mismo doble clic de ocho segundos que el
resto de acciones irreversibles del panel). Debajo sigue «O mide una foto
nueva» con el medidor de siempre, y en cuanto hay una plantilla puesta
—venga de la biblioteca, del medidor o del archivo avanzado— aparece un
campo para guardarla con nombre.

**Las dos plantillas viejas, recuperadas de verdad**: sus medidas exactas
—las que vivían a mano en `PLANTILLAS` antes del PR #32— se sacaron del
historial de git y se sembraron directo en la tabla nueva por SQL, junto
con las fotos reales ya en `assets/`. Ya aparecen en la biblioteca de
cualquiera que entre al panel, sin que nadie tenga que medirlas de nuevo.

**Susto de despliegue, ya resuelto:** al desplegar la función de borde con
las acciones nuevas, el primer intento mandó por error un archivo de
relleno (`PLACEHOLDER`) en vez del código real —production quedó, por
unos segundos, sirviendo una función que no hacía nada—. Se notó al
instante comprobando la respuesta real del endpoint y se corrigió con un
segundo despliegue, ya con el archivo de verdad. Lección: después de
`deploy_edge_function`, SIEMPRE comprobar con una llamada real (aunque sea
con una clave mala, para ver que conteste «clave incorrecta» y no un error
genérico) antes de seguir con cualquier otra cosa.

**Pruebas automáticas nuevas**: guardar una plantilla recién medida,
verla aparecer con su foto real de miniatura, quitarla de la rifa y
traerla de vuelta con «Usar esta», renombrarla, y borrarla con su doble
confirmación. 234 comprobaciones en verde (antes 226). El servidor de
prueba (`pruebas/servidor-de-prueba.mjs`) finge las cuatro acciones
nuevas con la misma validación que el servidor real.

`?v=42` / `rifa-v42`.

## Auditoría de la pantalla del participante: un hallazgo real, cerrado (7 de noviembre de 2026)

A pedido del dueño, pasada de seguridad, rendimiento y bugs sobre
`index.html`/`assets/app.js` (lo que ve quien escanea el QR) y
`diagnostico.html`. Repasado y SIN hallazgos: ningún `innerHTML` /
`document.write` / `eval` en todo ese lado —todo lo dinámico se pinta con
`textContent`, así que no hay por dónde inyectar HTML aunque el nombre de
una rifa viniera manipulado—; `rifa_de_boleto()` usa parámetros tipados,
no texto armado a mano, así que no hay inyección de SQL posible; las
consultas que sí corren (`boletos.id` por llave primaria,
`folios.boleto_id` con su propio índice) están bien indexadas; y el
sondeo/canal en vivo ya traían un diseño cuidado para cientos de teléfonos
a la vez (ritmo variable, reintento con desfase aleatorio, tope duro en
los minutos del sorteo) — no hay nada que mejorar ahí.

**Sí se encontró un hueco real, de los que importan**: `rifas` tenía RLS
con una política de solo lectura sin restringir FILAS (cualquiera puede
leer cualquier rifa, pasada o presente —diseño ya aceptado de antes—),
pero el permiso de Postgres por COLUMNA que Supabase otorga por omisión
cubría la tabla entera. La pantalla del participante solo necesita
`id, estado, folio_ganador, fecha_sorteo`, pero nada se lo impedía a
alguien pidiendo `select=diseno` o `select=*` con la llave pública
—sin ningún boleto de por medio—. Antes de la biblioteca de plantillas
esto ya era de más (nombre, precio, quién transmite), pero desde que
`diseno.plantilla.foto` puede pesar varios cientos de KB hasta poco más
de 1 MB, y las rifas nunca se borran, esto se volvía una vía abierta para
bajar, sin autorización, cada vez más datos con el tiempo.

**Corregido** (migración `angostar_columnas_publicas_rifas`, aplicada
directo en producción): `revoke all on table public.rifas from anon,
authenticated;` seguido de `grant select (id, estado, folio_ganador,
fecha_sorteo) on public.rifas to anon, authenticated;`. Comprobado con la
llave pública real: pedir las columnas de siempre sigue dando `200`;
pedir `diseno` o `select=*` ahora da `401 permission denied`.
`rifa_de_boleto()` —la que de verdad entrega nombre, serie, folios y
transmisión, pero solo a quien ya probó boleto + código— es
`SECURITY DEFINER` y no depende de este permiso: se comprobó que sigue
contestando exactamente igual. El panel tampoco se entera: nunca habla
con Supabase directo, todo pasa por la función de borde con llave de
servicio, que ignora por completo estos permisos de `anon`/`authenticated`.
De paso se quitaron también los permisos de escritura directa (INSERT/
UPDATE/DELETE) que Supabase deja por omisión en una tabla nueva: ya
estaban bloqueados por RLS —no hay ninguna política que los permita—,
pero no hacía falta dejarlos ahí sueltos tampoco.

## Los diez GIFs de Ayuda, con el puntero de verdad moviéndose (7 de noviembre de 2026)

El dueño los volvió a ver y notó que el cursor seguía saltando de golpe de
un clic al siguiente, sin recorrido visible —quería verlo avanzar hacia
cada casilla y notarse el clic, con algo parecido a una onda de presión—.

La herramienta de grabación (`gif_creator`) solo guarda un fotograma por
cada acción de verdad (clic, tecleo, scroll…) y lo mantiene fijo cerca de
un segundo: no hay manera de pedirle una animación continua entre dos
puntos. El acercamiento real fue agregar `hover` de verdad —que SÍ cuenta
como acción y SÍ se graba— en varios puntos intermedios entre donde
estaba el puntero y donde iba el siguiente clic, así que el GIF reproduce
al puntero «caminando» en varios pasos cortos hacia el botón en vez de
teletransportarse. El círculo naranja con «Clicked» que ya traía la
herramienta por omisión hace de aviso de presión.

Los diez GIFs se volvieron a grabar así, de cabo a rabo, contra el
servidor de prueba: entrar, el boleto público, crear una rifa, revelar al
ganador (esta vez sí empezando por «Manejar esta»), archivar, reactivar,
verificar un boleto, cambiar la clave, cargar una plantilla con el
medidor, y volver al de siempre. El doble clic de confirmación de varios
botones (crear rifa, revelar, volver al de siempre) volvió a fallar por
la misma razón de siempre —el tiempo real entre dos llamadas de la
herramienta supera la ventana de ocho segundos—: el primer clic se grabó
de verdad, con su recorrido; el segundo, de confirmación, se disparó por
JavaScript, invisible en el GIF pero instantáneo y confiable.

Sin cambios de código: solo los diez archivos de `assets/ayuda/`. No hace
falta subir versión —los GIFs no llevan `?v=`—, aunque alguien con una
copia ya guardada en caché los vea actualizados hasta su próxima
descarga, sin que eso rompa nada mientras tanto.

## Los diez GIFs de Ayuda, un poco más rápidos (9 de noviembre de 2026)

Después de verlos con el puntero ya recorriendo el camino al clic, el
pedido fue que se vieran «ligeramente más acelerados». La herramienta de
grabación no tiene ningún control de velocidad o de cuánto dura cada
fotograma —ya se investigó al arreglar la fluidez del puntero—, así que
en vez de volver a grabar los diez contra Chrome, se tomaron los GIFs ya
hechos y se les aceleró el tiempo DE VERDAD con `ffmpeg`
(`setpts=PTS/1.25` más `palettegen`/`paletteuse` para no perder calidad
ni inflar el peso): 1.25× más rápido, sin perder ni un solo fotograma de
los que ya traían —se comprobó con `ffmpeg` que ninguno se recortó—.

`assets/ayuda/ayuda-boleto-publico.gif` casi duplicó su peso (1.4 MB →
2.7 MB): tiene un fondo con degradado, y el nuevo paleteado de `ffmpeg`
—más fiel para evitar bandas de color— pesa más que el que traía la
herramienta original. Sigue siendo un peso razonable para un GIF de
ayuda que se carga una sola vez; no se le encontró arreglo sin perder
nitidez en el degradado.

Sin cambios de código, solo los diez archivos de `assets/ayuda/`.

## El medidor del tope, en lenguaje llano, y los folios que empiezan en 0: no era un bug (7 de noviembre de 2026)

Dos pedidos en el mismo mensaje. **Uno, de forma**: el texto de ayuda bajo
«Tope del sorteo (opcional)», en «Nueva rifa», era un párrafo larguísimo
—necesario, pero que todos tenían que saltarse para llegar al siguiente
campo—. Se partió en dos: una línea corta, siempre visible, con lo
esencial; y el resto —cómo elegirlo según las bolitas de verdad— detrás
de un `<details>` nativo, «Cómo elegirlo según tus bolitas», plegado por
omisión. Clase nueva `.ayuda-detalle` en `assets/panel.css`, misma letra
chica que `.campo .ayuda` de siempre.

**Dos, de fondo**: el dueño recordaba que «la última vez» los folios solo
le salieron empezando en 0, y pidió revisar que el generador también
pueda sacar folios que empiecen en 1. Se corrió el algoritmo de verdad
—`foliosDeRangoChico()`, copiado tal cual de la función de borde— miles
de veces fuera del panel para comprobarlo de raíz, no a ojo:

- **Con tope 1999** (el caso exacto que ya vive documentado en
  `pruebas/panel.mjs`): en 20,000 folios simulados, 9,947 empezaron en 0 y
  10,053 en 1 —prácticamente mitad y mitad, sin sesgo—.
- **Con tope 999**: el primer dígito SIEMPRE salió 0, en todas las
  corridas. Esto no es un error: con 999 la canasta de la izquierda solo
  trae la bolita del 0 —es justo lo que ese tope representa—, así que
  TODOS los folios tienen que empezar ahí. Si «la última vez» fue este el
  tope usado, el panel se comportó exactamente como se le pidió.
- **Sin tope** (el modo de siempre, números grandes y únicos): el primer
  dígito salió parejo entre 1 y 9 en miles de folios, nunca 0 —tal como
  debe ser, porque ese modo no rellena con ceros a la izquierda—.

No había ningún bug que corregir. Lo que sí existe —y ya pasó la prueba
de siempre en `pruebas/panel.mjs`— es el aviso en vivo que el panel
muestra ANTES de generar nada: si el tope puesto deja casi vacía la
última bolita (como poner 1000 en vez de 1999, que desperdicia 999 de
cada 1000 posibles usos de la bolita del 1), `cuentaNueva` en
`assets/panel.js` lo dice con todas sus letras y sugiere el tope correcto
—ver el comentario «El caso real que lo motivó» ahí mismo—. Ese aviso es
la protección real contra el síntoma que el dueño recordaba; quedó
intacto, sin tocar.

`?v=43` / `rifa-v43`. 234 comprobaciones en verde, sin cambios en esa
cuenta: no se tocó ninguna lógica, solo el texto.

## Se quita la transmisión por YouTube (27 de octubre de 2026, tercera pasada)

Pedido explícito del dueño: quitar el enlace y el video de YouTube por
completo —ni el panel lo ofrece, ni la pantalla del boleto lo muestra—,
dejando solo la parte de consultar si alguien ganó. Razón: menos gente con
la pantalla del boleto abierta esperando un video es menos gente con el
canal de Realtime abierto al mismo tiempo, y de paso desaparece la latencia
de YouTube que había dado problemas justo el día anterior.

**Lo que cambió:**
- `index.html`: la pantalla «En vivo» ya no trae botón ni enlace a ningún
  lado, solo el tambor girando y «La rifa se está llevando a cabo» —sigue
  entrando sola al llegar la hora del sorteo, eso no cambió—. La pantalla de
  resultado tampoco trae ya «Seguir viendo la transmisión».
- `panel.html`: el paso «Abrir la transmisión» —enlace, botón «Transmitir»,
  «Tomar el control», candado de qué aparato transmite— se quitó entero de
  la pestaña Sorteo. Lo que era el paso 2 («Revelar al ganador») ahora es el
  1, y «Cerrar» ahora es el 2. También se quitó «Regresar a espera»: sin
  «Transmitir» no queda nada de qué regresar.
- `assets/youtube.js` —reconocía y limpiaba enlaces de YouTube— se borró
  entero: ya no lo usa ni el panel ni el boleto.
- CSS muerto limpiado de paso: `.marco-video`, `.boton-transmision`,
  `.alterna` (estilos.css), `.bloque-transmision`, `.candado`,
  `.aviso-incrustar` (panel.css).

**Lo que NO se tocó, a propósito** —mismo criterio que con la fecha de
emisión: no vale la pena arriesgar producción por borrar algo que ya nadie
llama—:
- Las columnas `rifas.transmision_url` y `rifas.transmite_desde` se quedan
  en la base, vacías para siempre en cualquier rifa nueva.
- La función de borde `sorteo` sigue aceptando las acciones `en_vivo` y
  `transmision` —nadie las llama ya desde el panel ni desde el boleto—.
- El estado `en_vivo` sigue existiendo como valor posible de `rifas.estado`:
  la pantalla del boleto lo sigue reconociendo (por si alguna rifa vieja lo
  trajera puesto), pero ya nada en el panel lo escribe —el reloj local de
  cada teléfono es ahora el único que decide cuándo mostrar «en vivo»—.

235 comprobaciones automáticas en verde (antes 254: se quitaron las que
probaban el video/enlace que ya no existe, y se reescribió «El sorteo, de
punta a punta» para comprobar el cruce real a «en vivo» por el reloj, sin
ningún botón «Transmitir» de por medio).

## Tres escenarios provocados a propósito (27 de octubre de 2026, segunda pasada)

Pedido explícito del dueño: no solo revisar que todo esté bien, sino
PROVOCAR fallos de verdad —catastrófico, medio, ligero— para confirmar que
el blindaje aguanta antes de que sea el evento real.

**Catastrófico — ¿se puede registrar DOS folios ganadores distintos si dos
peticiones de «Revelar» llegan casi juntas?** Se probó de verdad: se creó
una rifa desechable, se simuló la primera revelación (UPDATE sin ninguna
guarda, igual a como lo escribe la función de borde), y luego se intentó
una segunda con un folio distinto. **La base la rechazó sola**, con un
disparador (`rifas_proteger_ganador`, función `proteger_ganador()`) que
existía desde antes y no estaba documentado aquí: impide cambiar
`folio_ganador` una vez puesto, e impide ponerlo si el estado no es
`revelado`/`cerrado`. Es broma mala que en una carrera de verdad —dos
peticiones que ya pasaron el chequeo de JavaScript (que SÍ es vulnerable,
lee `actual` antes de escribir) antes de que ninguna terminara de
escribir— la segunda tronaría al intentar guardar, y la función de borde ya
devuelve ese error tal cual (`errorEscritura.message`), limpio. **No hizo
falta ningún cambio de código: el candado de verdad ya estaba puesto, en
el lugar correcto —la base, no la aplicación—.**

**Catastrófico — Supabase entero cae justo con la rifa en vivo.**
Simulado con el servidor de prueba: toda petición al backend truena un
buen rato, con una rifa ya resuelta en pantalla. Resultado: la pantalla del
participante NUNCA inventa un «ganaste»/«no ganaste», el cronómetro sigue
corriendo solo, y al volver la red se recupera SIN que nadie recargue la
página —gracias a los arreglos de la pasada anterior—. Del lado del panel,
se encontró un hueco real: al fallar la red, el mensaje de error era
literalmente «Failed to fetch» —inglés crudo del navegador, sin
explicación—, mostrado justo en el momento más tenso del evento. Corregido
en `llamar()` (`assets/panel.js`): un fallo de red real ahora dice «No se
pudo conectar con el servidor. Revisa la red e inténtalo de nuevo —nada se
guardó todavía—», distinguiéndolo del error que SÍ manda el servidor (ese
ya traía su propio mensaje en español y se deja pasar tal cual).

**Medio — la red parpadea a medio «Revelar».** El primer intento de
revelar falla por la red; el operador reintenta cuando vuelve. Probado de
punta a punta: el botón no se queda bloqueado tras el fallo, el reintento
completo (confirmar dos veces, como siempre) revela un ganador limpio, sin
rastro del intento fallido. Nada que corregir —el diseño de confirmación
en dos pasos (`confirmar()`) ya se reinicia solo en cada intento—.

**Ligero — ya cubierto en la pasada anterior**: el QR que a veces mostraba
«página no encontrada», y la pantalla que se quedaba muda si el primer
intento de resolver la rifa fallaba por la red. Ver la sección de arriba.

254 comprobaciones automáticas en verde (antes 247), 7 nuevas que
reproducen la caída total del backend con la rifa en vivo.

## Pasada de blindaje antes del evento real (27 de octubre de 2026)

El dueño pidió una revisión a fondo, y reportó algo concreto: a veces, al
escanear el QR, la pantalla dice «página no encontrada» a menos que recargue
una o dos veces. Se encontraron y corrigieron DOS bugs reales, distintos
entre sí, que juntos explican bien ese síntoma —no se pudo confirmar
cuál de los dos fue el que vio el dueño esa noche, los logs de Supabase no
muestran ningún error del lado del servidor en esa ventana, lo que apunta a
que el fallo ocurrió antes de llegar ahí—.

**1. El trabajador de servicio (`sw.js`) enseñaba un error de red tal cual,
en vez de la pantalla de «Sin conexión» que existe justo para eso.**
`fetch()` no rechaza su promesa cuando el servidor contesta con un error
—un 404, un 502—, solo cuando la red de plano no contesta. El código
revisaba `r || SIN_RED` (¿hubo ALGUNA respuesta?), no `r.ok` (¿la respuesta
fue buena?), así que un 404 pasajero del borde de Cloudflare —un
despliegue a medio propagar, algo que pasó varias veces hoy mismo, con
nueve despliegues seguidos— se le enseñaba a quien acababa de escanear el
QR como si fuera la página de verdad. Una recarga, momentos después,
volvía a pedir la red y ya salía bien: el síntoma exacto. Arreglado en
las tres rutas de navegación de `sw.js` (`r && r.ok`, no solo `r`), y se
agregó un reintento rápido y silencioso (~400ms) para los casos donde la
red SÍ contestó pero mal —sin ese reintento para una red que de plano no
contesta, que sería traicionar la regla de este archivo: abrir al instante
vale más que abrir lo último—.

**2. Si el primer intento de saber a qué rifa pertenece un boleto fallaba
por la red, la pantalla se quedaba muda PARA SIEMPRE, aunque la red
volviera.** En `assets/app.js`, `resolverRifa()` —llamada solo una vez, al
cargar la página— decide tratar el boleto como válido cuando no se pudo
preguntar (correcto: el comprobante real es el papel), pero nunca dejaba
`rifaId` puesto, y TANTO el sondeo como el canal en vivo necesitan
`rifaId` para hacer cualquier cosa. El reloj seguía corriendo —la pantalla
parecía funcionar— pero nunca se enteraba de que empezó la transmisión ni
de quién ganó, ni con la red ya de vuelta. Arreglado centralizando la
cadena «resolver → seguir» en `intentarResolverYSeguir()`, que ahora
también se reintenta desde dentro de `refrescar()` cada vez que hay red
pero sigue sin `rifaId` —en el próximo sondeo, o al volver la conexión—.

**Revisión de la base, de paso:**
- Confirmado por los advisors de Supabase: `boletos`, `folios`,
  `llave_firma`, `panel_ajustes`, `panel_clave` y `sorteo_log` tienen RLS
  encendido SIN ninguna política —a propósito, es el candado total contra
  `anon`, documentado arriba—. La función `rifa_de_boleto` (`SECURITY
  DEFINER`, llamable por `anon`) se revisó a mano: exige boleto Y código
  juntos, fija su propio `search_path`, y solo devuelve lo mínimo. Ningún
  hallazgo real, los dos avisos del linter son el diseño, no un descuido.
- Un índice que faltaba de verdad: `sorteo_log.rifa_id` no tenía uno
  cubriendo su llave foránea. Agregado (`indice_sorteo_log_rifa_id`).
- Los logs de Supabase de las últimas 24 horas no muestran ni un error de
  Postgres ni una respuesta 4xx/5xx real del servidor —la base está sana—.

247 comprobaciones automáticas en verde (antes 244), tres nuevas para el
segundo bug, comprobado con una red que se cuelga a propósito en la prueba.

## El panel se recorre a una barra lateral desde 880px (26 de octubre de 2026)

El panel nació pensado para un celular, de una sola columna de 520px, y se
quedó así incluso en una pantalla de escritorio: a los 1280px de un monitor
cualquiera, 760px se quedaban en blanco a los lados, sin usarse para nada. El
dueño pidió aprovechar ese espacio y mover la navegación a una barra lateral,
con una inclinación clara hacia el tema oscuro.

- **Desde 880px de ancho**, `.cuerpo` (nuevo contenedor, en `panel.html`) pasa
  de columna única a una rejilla de dos columnas: la navegación —los mismos
  botones `.pestana` de siempre, con un ícono SVG agregado a cada uno— se
  acomoda en una columna angosta (232px) fija al desplazar
  (`position: sticky`), y el contenido usa el resto. `.tablero` subió su ancho
  máximo de 520px a 1180px para que hubiera algo que repartir.
- **Debajo de 880px no cambia nada de lo que ya funcionaba**: mismo orden del
  DOM, misma fila de pestañas de siempre —solo que ahora se desliza en vez de
  partirse en dos renglones cuando las cinco no caben, un patrón más
  parecido al de cualquier app de celular—. Es a propósito: este panel se
  sigue manejando desde un teléfono el día del evento, y esa pantalla no
  debía arriesgarse por un cambio pensado para el escritorio.
- El acomodo usa `grid-template-columns`, no reordena el DOM ni toca
  `panel.js`: el único cambio de lógica fue agregar `#cuerpo` (antes
  `.cuerpo` no tenía manera de ocultarse antes de iniciar sesión, y el
  encabezado con el título de la rifa —reubicado de la cabecera global al
  tope del contenido— se quedaba flotando solo, visible de más, sobre la
  pantalla de entrada).
- El resplandor del ítem activo en la barra lateral usa `--luz-oro`, la
  misma variable que ya pinta la luz de fondo detrás de todo —ni un color
  nuevo, ni un archivo nuevo—, y por eso se ve bien en los dos temas sin
  condicional aparte.
- 7 comprobaciones nuevas, agregadas a propósito a un ancho FUERA de 1280px
  —el que usa el resto de las pruebas sin darse cuenta— porque si no, un
  quiebre a 880px nunca se habría ejercitado.

## Estado al 26 de octubre de 2026

Comprobado consultando Supabase, no de memoria.

**La base está vacía de rifas, por tercera vez y a propósito.** Mientras se
probaba en producción el flujo de admin y la transmisión en vivo (ver
secciones de arriba), quedó creada «PRUEBA1» (250 boletos, estado `en_vivo`).
El dueño pidió borrarla para dejar la base lista para la rifa real. El MCP de
Supabase conectado a esta sesión **seguía sin poder autenticarse en segundo
plano** —mismo problema de sesiones anteriores—, así que el borrado se hizo
con el CLI de Supabase (`npx supabase db query --project-ref ... --linked
--file ...`), que sí tenía sesión iniciada en esta máquina. Antes de borrar
se listaron las llaves foráneas que de verdad apuntan a `rifas` (consultando
`information_schema`, no adivinando): `folios`, `boletos` y `sorteo_log` —
esta última casi se queda fuera, el primer intento de borrado falló por
violar esa llave—. Orden correcto: `folios` → `boletos` → `sorteo_log` →
`rifas`, confirmado con un conteo antes y después.

| Tabla | Filas |
| --- | --- |
| `rifas` | 0 |
| `boletos` | 0 |
| `folios` | 0 |
| `sorteo_log` | 0 |

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
| Service worker | `rifa-v43` |
| Etiquetas del panel | `?v=43` |

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
- El panel y el boleto pasan **240 comprobaciones** automáticas
  (`node pruebas/panel.mjs`), todas en verde.

### La transmisión por YouTube — quitada (27 de octubre de 2026)

Esta sección documentaba el video de YouTube dentro del boleto. **Se quitó
entera**, pedido explícito del dueño: menos gente con la pantalla abierta
esperando un video significa menos conexiones activas al mismo tiempo —menos
riesgo de las 200 conexiones de Realtime del plan gratis, y de paso se lleva
consigo la latencia de YouTube que había dado problemas el día anterior—.
Ver «Se quita la transmisión por YouTube» más abajo para el detalle completo
de qué se tocó y qué se dejó adrede sin tocar.

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
