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

## Ensayo sin tocar la rifa real

`?ensayo=1` corre la pantalla del participante contra el reloj, sin servidor:

```
?f=11052&c=R5VR&ensayo=1                 → espera / en vivo según la hora
?f=11052&c=R5VR&ensayo=1&ganador=11052   → fuerza la pantalla de ganador
```
