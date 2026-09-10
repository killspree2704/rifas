# Dónde está todo

Para retomar el proyecto desde cualquier computadora o teléfono, sin depender
de esta máquina ni de esta conversación. Última revisión: 10 de septiembre de
2026.

## Lo primero: qué es durable y qué no

| Cosa | Dónde vive de verdad | ¿Se pierde si cambias de equipo? |
| --- | --- | --- |
| Todo el código | GitHub: `killspree2704/rifas`, rama `main` | No |
| El sitio publicado | Cloudflare Workers, se publica solo con cada `git push` | No |
| Rifas, folios, códigos, ganadores | Supabase, proyecto `fgwavuaolmrwagaymgos` | No |
| La función `sorteo` | Desplegada en Supabase (Edge Functions) | No |
| La llave que firma los códigos | Tabla `llave_firma` en Supabase | No |
| **La clave del panel** | Solo su **hash** está en `panel_clave` | **Sí: si la olvidas, no se recupera** |

Todo lo demás está en el repositorio. **Lo único que tienes que guardar por tu
cuenta —en un gestor de contraseñas o en papel— es la clave del panel.** Si se
pierde, no hay forma de leerla: solo se puede poner una nueva (ver abajo).

## Las llaves

| Llave | Para qué | Dónde conseguirla |
| --- | --- | --- |
| Clave del panel | Entrar a `panel.html` | La sabes tú. Guárdala. |
| Llave de firma (64 caracteres) | Calcular el código de un folio fuera del panel | `select llave from llave_firma where id = 1;` en el editor SQL de Supabase |
| Clave pública de Supabase | Ya está en `assets/config.js` | No es secreta: solo deja leer el estado de la rifa |

La llave de firma **no hace falta para nada del día a día**: el panel firma los
códigos solo. Sirve únicamente si alguna vez quieres volver a generar boletos
desde la terminal con `herramientas/generar-folios.mjs`.

### Si pierdes la clave del panel

En el editor SQL de Supabase, con la clave nueva que quieras:

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
sitio, sube el número de versión en `sw.js`** (`CACHE = 'rifa-v6'` → `v7`) o
los teléfonos que ya abrieron la página seguirán viendo la vieja.

## Cómo está armado

```
El boleto de papel                El teléfono                    El panel
┌──────────────┐                 ┌──────────────┐              ┌──────────────┐
│ Folio A-11052│   escanea QR    │ index.html   │              │ panel.html   │
│ Código  R5VR │ ──────────────► │ + app.js     │              │ + panel.js   │
│    [QR]      │  ?f=…&c=…       └──────┬───────┘              └──────┬───────┘
└──────────────┘                        │                             │
                                 rifa_de_folio()            función de borde
                                 (solo lee)                 `sorteo` (escribe)
                                        │                             │
                                        └────────► Supabase ◄─────────┘
```

- El teléfono **solo lee**. Nunca puede escribir nada.
- El panel **tampoco escribe directo**: todo pasa por la función `sorteo`, que
  pide la clave en cada llamada.
- La rifa que ve cada boleto la decide **el folio impreso**, no una
  configuración. Por eso una rifa nueva no necesita publicar el sitio otra vez.

### En la base de datos

| Tabla | Qué guarda |
| --- | --- |
| `rifas` | Una fila por rifa: estado, fecha, ganador, si es la activa, el enlace de la transmisión y desde qué aparato salió |
| `boletos` | Folio (único de por vida) y su código. **Sin políticas: nadie las lee desde fuera** |
| `sorteo_log` | Cada acción del panel con su hora |
| `panel_clave` | El hash de la clave. Sin políticas |
| `llave_firma` | La llave HMAC. Sin políticas |

| Función | Qué hace |
| --- | --- |
| `rifa_de_folio(folio, codigo)` | Devuelve la rifa de un boleto, y solo si los dos coinciden |
| `validar_boleto(rifa, folio, codigo)` | Verdadero o falso. Quedó de antes |
| `proteger_ganador` (disparador) | Impide escribir el ganador antes de revelar y cambiarlo después. **Ni con la llave de servicio** |

Migraciones aplicadas, en orden: `esquema_rifas`, `realtime_rifas`,
`endurecer_trigger`, `rifa_activa_y_llave`, `rifa_de_folio`.

**Aquí no hay ni un dato personal.** Ni nombres, ni teléfonos, ni correos. Solo
números. Quién compró cada boleto lo lleva el vendedor en su libreta, y ese es
el diseño, no una omisión.

## El día de la rifa

1. Llegar a la sede y abrir `diagnostico.html` con la red del lugar y con
   datos móviles. Dice en segundos si esa red sirve.
2. Entrar al panel y comprobar que la rifa correcta está en **En espera**.
3. Empezar a transmitir en YouTube desde la app. Ya al aire, copiar el enlace
   del directo (o dejar puesto `youtube.com/@tucanal/live`, que sirve para
   siempre) y presionar **Transmitir** en el panel. Los teléfonos cambian
   solos a «La rifa se está llevando a cabo» y traen el botón **Ir a la
   transmisión**, que abre YouTube en otra pestaña. **Quien lo abre no
   necesita cuenta de nada.**
4. Sacar el folio de la tómbola, teclearlo y **Revelar**. Pide confirmar dos
   veces. **Es irreversible**: ni tú ni nadie puede cambiar el ganador después.
5. **Cerrar**. El resultado sigue viéndose para quien escanee, para siempre.

Si algo sale mal con la red: la pantalla del participante funciona con el
reloj del teléfono y se guarda sola para abrirse sin conexión. Lo único que
necesita señal es enterarse del ganador.

## Para la siguiente rifa

Todo desde el panel, sin tocar código ni publicar nada:

1. **Rifas → Nueva rifa**: nombre, serie, día y hora, cuántos boletos, dígitos
   y precio si quieres llevar la cuenta.
2. Se abre la hoja: **Imprimir → Guardar como PDF**, y de ahí a la imprenta.
3. **Manejar esta** para que el panel opere esa rifa.

Los folios nunca se repiten entre rifas. Los boletos viejos siguen abriendo su
propio resultado.

## Estado al 10 de septiembre de 2026

- Una sola rifa: `mm-2026-09`, «Rifa El Muerde Manos», serie A, 10 boletos de
  prueba, sorteo el **domingo 13 de septiembre a las 18:00** (hora de Ciudad de
  México). Sin ganador todavía.
- El panel y el boleto están probados de punta a punta (`pruebas/panel.mjs`,
  41 comprobaciones).

### La transmisión, en corto

- Se transmite **desde la app de YouTube**, no desde la página. Un navegador
  no puede mandar video a YouTube: no habla RTMP, y hacerlo pediría un
  servidor propio de por medio.
- La página **no reproduce el video**, solo apunta a él. Así sigue sin
  depender de ningún dominio ajeno para abrir.
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
