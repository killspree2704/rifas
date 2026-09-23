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
| `rifas` | Una fila por rifa: estado, fecha, ganador, si es la activa, el enlace de la transmisión, desde qué aparato salió y el **diseño del boleto impreso** |
| `boletos` | El boleto de papel: su número (el del QR) y su código, uno para todo el papel. **Sin políticas: nadie lo lee desde fuera** |
| `folios` | Un renglón por número impreso. El folio es único de por vida, entre todas las rifas. **Sin políticas** |
| `sorteo_log` | Cada acción del panel con su hora |
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
`diseno_del_boleto`, `ajustes_del_panel`.

**Aquí no hay ni un dato personal.** Ni nombres, ni teléfonos, ni correos. Solo
números. Quién compró cada boleto lo lleva el vendedor en su libreta, y ese es
el diseño, no una omisión.

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
4. Sacar el folio de la tómbola y teclearlo. El panel enseña **de qué boleto
   salió ese número, con su código y sus otros tres números**:
   **compáralo con el talón que traes en la mano** antes de tocar Revelar, que
   no se enciende hasta entonces. Luego pide confirmar dos veces.
   **Es irreversible**: ni tú ni nadie puede cambiar el ganador después.
5. **Cerrar**. El resultado sigue viéndose para quien escanee, para siempre.

Si algo sale mal con la red: la pantalla del participante funciona con el
reloj del teléfono y se guarda sola para abrirse sin conexión. Lo único que
necesita señal es enterarse del ganador.

## Para la siguiente rifa

Todo desde el panel, sin tocar código ni publicar nada:

1. **Rifas → Nueva rifa**: nombre, serie, día y hora, cuántos boletos,
   **cuántos números lleva cada boleto** (4 de omisión), dígitos del folio y
   precio si quieres llevar la cuenta. Ojo con el tope: lo que tiene que caber
   en los dígitos son los *números*, no los boletos. Con 4 por boleto y 5
   dígitos caben 6,750 boletos; el panel te lo dice antes de generar nada.
2. Se abre la hoja: **Imprimir → Guardar como PDF**, y de ahí a la imprenta.
3. **Manejar esta** para que el panel opere esa rifa.
4. Si quieres darle aspecto, **pestaña «Diseño»**: seis temas listos, tus
   colores encima, **doce fondos** —seis de línea, al estilo del papel de
   seguridad, y seis de figura: estrellas, confeti, burbujas, corazones,
   tréboles y fiesta, con sus propios colores—, logo y el aviso de letra
   chica. **Se puede diseñar antes de crear la
   rifa**: sin ninguna, lo que guardes se le copia a la próxima al nacer. Se guarda **en esa rifa**,
   así que cada una puede verse distinta y reimprimir una hoja vieja da la hoja
   de entonces. Solo toca el papel; la pantalla del participante no cambia.
   El QR va siempre sobre blanco, pase lo que pase con el tema: uno sin
   contraste no lo lee ningún teléfono, y de eso uno se entera cuando los
   boletos ya se repartieron.

Los folios nunca se repiten entre rifas. Los boletos viejos siguen abriendo su
propio resultado.

## Estado al 23 de septiembre de 2026

Comprobado consultando Supabase, no de memoria.

**La base está vacía de rifas, a propósito.** Se borraron las cuatro de
ensayo —«El muerde manos», PRUEBA 2, RIFA PRUEBA 3 y PABLO TEST1— con sus 95
boletos, sus 380 folios y su bitácora. Ninguna había repartido nada ni tenía
ganador revelado.

| Tabla | Filas |
| --- | --- |
| `rifas` | 0 |
| `boletos` | 0 |
| `folios` | 0 |
| `sorteo_log` | 0 |
| `panel_ajustes` | 1, sin diseño guardado: la próxima rifa nace con el clásico |
| `llave_firma` | 1 — intacta |
| `panel_clave` | 1 — con la clave de arriba |

Qué significa en la práctica:

- **Todos los números volvieron a estar libres.** La regla de «un folio no se
  repite jamás» se hace comparando contra la tabla `folios`; vacía la tabla, el
  espacio entero vuelve a estar disponible.
- **Los boletos que se hayan impreso de esas cuatro rifas ya no sirven.** Quien
  escanee uno va a ver «Boleto no válido», porque el boleto que respalda ese QR
  ya no existe. Eran todos de prueba.
- **La llave de firma no se tocó**, así que crear una rifa nueva funciona
  igual. La clave del panel sí se movió dos veces el mismo día —se cambió
  desde «Perfil» y se devolvió a la de siempre—, y la que vale es la de la
  tabla de arriba.

La primera rifa que se cree desde aquí empieza de cero, y conviene que sea con
serie `A` otra vez si se quiere el orden limpio. Si quieres darle aspecto,
puedes dejar el diseño listo en la pestaña «Diseño» **antes** de crearla: se le
copia al nacer.

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

### El resto del sistema

- Las **10 migraciones** aplicadas; la función de borde `sorteo` en su
  **versión 11**; la clave del panel y la llave de firma en su lugar.
- El trabajador de servicio va en **`rifa-v16`**, a la par del `?v=16` de
  `panel.html`.
- `assets/config.js` **no apunta a ninguna rifa**: sus valores son solo el
  respaldo del primer pintado, y la rifa de verdad la resuelve el boleto.
- El panel y el boleto pasan **164 comprobaciones** automáticas
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

- **Supabase Pro para el mes del evento.** El plan gratis da 200 conexiones
  simultáneas de Realtime y ustedes esperan 500 teléfonos. Con Pro (~25 USD el
  mes) sobra. Sin Pro tampoco se rompe: el sondeo de respaldo cubre a los que
  no alcancen canal, y está medido —500 pantallas proyectan 167 consultas por
  segundo y todas ven el resultado—, solo que tardan unos segundos más.
- **Borrar la rama vieja** `claude/qr-code-raffle-ticket-ks2mxd` en el
  repositorio de Koppert. Su PR está cerrado y `main` quedó intacto, pero la
  rama sigue ahí.
- **Crear la primera rifa de verdad.** La base quedó vacía a propósito; el
  siguiente paso es Rifas → Nueva rifa, con cuidado en la fecha y la hora.
