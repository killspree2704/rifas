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
| **La clave del panel** | Aquí abajo, y su **hash** en `panel_clave` | No, mientras el repositorio siga privado |

Todo está en el repositorio, **incluida la clave del panel** — por eso el repo
es privado y tiene que seguir siéndolo. Aun así, guarda la clave también en un
gestor de contraseñas: un repositorio no es buen único lugar para un secreto.
De ella la base solo conserva un hash, así que si se pierde no se recupera: se
reemplaza (ver abajo).

## Acceso al panel

| | |
| --- | --- |
| Dirección | https://rifas.el-original.workers.dev/panel.html |
| Usuario | No hay. Solo la clave |
| Clave | `JrIEng7X3lSz` |

> ### ⚠️ Este repositorio tiene que seguir siendo PRIVADO
>
> Esa clave es el control del sorteo: quien la tenga puede revelar un ganador o
> crear rifas. Está escrita aquí porque el repositorio es privado — comprobado:
> un visitante anónimo recibe 404.
>
> **Si algún día lo vuelves público, cambia la clave ANTES de hacerlo.** Git
> conserva para siempre lo que se le escribe: volverlo público publicaría esta
> línea y todo el historial, aunque para entonces ya la hubieras borrado del
> archivo.
>
> Lo mismo al agregar colaboradores: quien tenga acceso al repositorio tendrá
> la clave.

Guárdala también en un gestor de contraseñas: un repositorio no es buen único
lugar para un secreto. En la base solo vive su **hash** SHA-256, en
`panel_clave`, que nadie puede revertir.

### Si se pierde

No se recupera: se reemplaza. En el editor SQL de Supabase:

```sql
-- Cambia SOLO el texto entre comillas por tu clave nueva.
update public.panel_clave
   set hash = encode(sha256('tu-clave-nueva'::bytea), 'hex'),
       actualizado_en = now()
 where id = 1;
```

(Comprobado: así es exactamente como la función compara la clave que tecleas.)

Los boletos ya impresos siguen siendo válidos: la clave del panel y la llave
que firma los códigos son dos cosas distintas.

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

Y un orden que no se negocia: **si cambia la función `sorteo`, el sitio se
publica antes o al mismo tiempo, nunca después**. Al revés el panel le pide al
servidor campos que ya no existen y la hoja sale con «undefined».

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
| `rifas` | Una fila por rifa: estado, fecha, ganador, si es la activa, el enlace de la transmisión y desde qué aparato salió |
| `boletos` | El boleto de papel: su número (el del QR) y su código, uno para todo el papel. **Sin políticas: nadie lo lee desde fuera** |
| `folios` | Un renglón por número impreso. El folio es único de por vida, entre todas las rifas. **Sin políticas** |
| `sorteo_log` | Cada acción del panel con su hora |
| `panel_clave` | El hash de la clave. Sin políticas |
| `llave_firma` | La llave HMAC. Sin políticas |

| Función | Qué hace |
| --- | --- |
| `rifa_de_boleto(boleto, codigo)` | Devuelve la rifa de un boleto **y sus folios**, y solo si los dos coinciden |
| `proteger_ganador` (disparador) | Impide escribir el ganador antes de revelar y cambiarlo después. **Ni con la llave de servicio** |

Migraciones aplicadas, en orden: `esquema_rifas`, `realtime_rifas`,
`endurecer_trigger`, `rifa_activa_y_llave`, `rifa_de_folio`, `transmision`,
`rifa_de_folio_con_transmision`, `boleto_con_varios_folios`.

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

Los folios nunca se repiten entre rifas. Los boletos viejos siguen abriendo su
propio resultado.

## Estado al 23 de septiembre de 2026

Comprobado consultando Supabase, no de memoria.

**Cuatro rifas en la base, las cuatro de ensayo.** Ninguna tiene ganador
revelado, y las cuatro llevan **4 números por boleto**:

| Rifa | Serie | Tamaño | Estado |
| --- | --- | --- | --- |
| `el-muerde-manos-20260922` · El muerde manos | A | 10 boletos · 40 folios | Cerrada |
| `prueba-2-20261001` · PRUEBA 2 | B | 25 boletos · 100 folios | Cerrada |
| `rifa-prueba-3-20261001` · RIFA PRUEBA 3 | C | 50 boletos · 200 folios | Cerrada |
| `pablo-test1-20261001` · PABLO TEST1 | D | 10 boletos · 40 folios | **En espera, y es la que el panel maneja** |

En total **95 boletos y 380 folios**.

### Lo que se comprobó, contra la base real

- **Los 380 folios son distintos** entre las cuatro rifas, y ninguno quedó
  suelto sin boleto. 95 boletos con 95 códigos distintos.
- De `PABLO TEST1` —la primera creada *después* del arreglo del panel—: los 10
  boletos llevan exactamente cuatro números, los 10 identificadores son de 10
  dígitos, y **los 10 códigos son firmas válidas**, recalculadas dentro de la
  base con la misma llave. Si esto fallara, todos los QR dirían «Boleto no
  válido».

El camino panel → función de borde → base está ejercitado de punta a punta. Lo
único que no se puede hacer desde el entorno donde se escribe este código es
*llamar* a la función o abrir el sitio publicado: la política de egreso de la
organización bloquea `supabase.co` y `workers.dev`. Lo que esas rifas dejaron
en la base sí se revisó entero, con SQL.

### El «undefined» de las hojas: qué fue

Las hojas de `PRUEBA 2` y `RIFA PRUEBA 3` salieron con `C-undefined` donde iba
el código. **No fue la base**: los datos de las dos están completos y bien
firmados. Fueron dos errores encadenados, los dos ya corregidos y anotados en
la bitácora:

1. La función `sorteo` se publicó antes que el sitio. El panel viejo pedía
   `boleto.folio`, campo que la función nueva ya no manda.
2. Aun después de publicar el sitio, el trabajador de servicio seguía sirviendo
   `panel.js` desde la copia guardada: HTML nuevo corriendo JavaScript viejo.
   Ahora los archivos del panel van a la red primero y sus etiquetas llevan
   `?v=`, que sube a la par de `CACHE`.

**Las hojas ya impresas de esas dos rifas hay que volver a generarlas** desde
Rifas → Hoja de boletos. No hace falta recrear las rifas: lo que salió mal fue
el dibujo de la hoja, no lo que está guardado.

### El resto del sistema

- Las **8 migraciones** aplicadas; la función de borde `sorteo` en su
  **versión 7**; la clave del panel y la llave de firma en su lugar.
- El trabajador de servicio va en **`rifa-v12`**, a la par del `?v=12` de
  `panel.html`.
- `assets/config.js` **no apunta a ninguna rifa**: sus valores son solo el
  respaldo del primer pintado, y la rifa de verdad la resuelve el boleto.
- El panel y el boleto pasan **108 comprobaciones** automáticas
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
- **Cambiar el nombre** «El Muerde Manos» cuando toque: ya no está escrito en
  ninguna dirección, solo es el nombre de esa rifa en la base.
- **Volver a generar las hojas** de `PRUEBA 2` y `RIFA PRUEBA 3`, las que
  salieron con «undefined». Los datos están intactos; se rehacen desde
  Rifas → Hoja de boletos.
- **Limpiar las rifas de ensayo** cuando vaya a entrar una de verdad. Las
  cuatro que hay son pruebas; ninguna se repartió.
