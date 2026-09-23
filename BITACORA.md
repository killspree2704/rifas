# Bitácora del proyecto

Por qué el sistema es como es. El código dice *qué* hace; esto dice *por qué*,
y qué se intentó antes que no funcionó, para no repetirlo.

Escrito al cierre de la etapa de construcción, septiembre de 2026.

## Qué es

Rifas con boleto de papel. Cada boleto lleva un folio, un código de
verificación y un QR. Quien lo escanea ve su folio y, a la hora del sorteo, si
ganó o no — sin registrarse, sin instalar nada.

## Las siete decisiones de fondo

**1. Aquí no vive ningún dato personal.**
Ni nombres, ni teléfonos, ni correos. Solo números. Quién compró cada boleto lo
lleva el vendedor en una libreta. No es una omisión ni una etapa pendiente: es
el diseño, y vino del cliente —«el registro se hará de la única forma
inhackeable, a mano y libreta»—. Todo lo demás se acomodó alrededor de eso.

**2. La página tiene que abrir con la peor señal.**
Es un evento con cientos de personas en la misma antena. Todo lo que pesa se
subordinó a esto: ni tipografías de terceros, ni CDN, ni reproductor
incrustado de arranque. La librería de Supabase se descarga *después* de que el
boleto ya está en pantalla. Medido en 3G saturado: **de más de 12 s a 1.4 s.**

**3. El folio manda, no una configuración.**
La pantalla del participante no está atada a ninguna rifa: la resuelve el folio
impreso, con `rifa_de_folio(folio, codigo)`. Por eso un boleto de hace un año
sigue abriendo su propio resultado, y estrenar una rifa no necesita publicar el
sitio otra vez.

**4. El ganador es inmutable.**
Un disparador en la base impide escribirlo antes de revelar y cambiarlo
después. **Ni con la llave de servicio.** Es la única acción irreversible del
sistema, y por eso el panel obliga a cotejar el folio con su código contra el
talón de papel antes de encender el botón.

**5. La página no transmite ni reproduce video de arranque.**
Transmitir es trabajo de la app de YouTube. Un navegador no puede mandar video
a YouTube —no habla RTMP— y hacerlo pediría un servidor propio de por medio.
La página enseña un botón; el reproductor se mete solo cuando alguien lo toca.

**6. Un boleto vale por cuatro números, pero gana una sola vez.**
El boleto de papel lleva cuatro folios —configurable— y cada uno entra a la
tómbola por separado. Es lo que hacen las rifas de calle: por veinte pesos te
llevas cuatro oportunidades, no cuatro premios. El ganador sigue siendo **uno
solo**, y por eso el candado de irreversibilidad no cambió ni una línea.
Se consideró la otra lectura —varios premios, primer y segundo lugar— y se
descartó: habría pedido una tabla de ganadores y rehacer el disparador que
hoy hace que el ganador no se pueda tocar. Esa garantía vale más.
El folio sigue siendo único de por vida entre todas las rifas; lo que cambió
es que ahora hay dos tablas, `boletos` (el papel) y `folios` (sus números).

**7. El panel no escribe en la base.**
Todo pasa por la función de borde `sorteo`, que exige la clave en cada acción.
El público solo puede leer el estado de la rifa; `boletos` no tiene ni una
política, así que los códigos no salen.

## Lo que se intentó y no funcionó

Vale más que la lista de aciertos: es lo que evita repetir el camino.

| Intento | Qué pasó |
| --- | --- |
| **GitHub Pages** | La red móvil del cliente **no alcanzaba los servidores de GitHub**. La página no cargaba con datos, en ninguna compañía. Se comprobó con `diagnostico.html`, que se construyó justo para eso. Se migró a Cloudflare: 103 ms sobre una conexión de 0.25 Mbps |
| **Hipótesis de IPv6** | Yo sostuve que GitHub Pages siendo solo IPv4 lo explicaba. La prueba del cliente salió al revés y **la hipótesis era incorrecta**. No se migró sobre una premisa falsa; se migró cuando hubo evidencia |
| **Google Fonts** | La hoja de estilos bloqueaba el primer pintado: en 3G saturado el boleto **no aparecía ni en 12 segundos**. Sin ella, 2.4 s. Difiriendo además `supabase-js`, 1.4 s |
| **Un solo caché para todo** | El trabajador de servicio devolvía `index.html` a *toda* navegación, así que **pedir el panel mostraba la pantalla del boleto**. Arreglado en `rifa-v5` |
| **Registrar el trabajador en `load`** | `load` espera a que baje todo, incluidos 215 KB de librería. En la red mala donde más falta hacía, **nunca llegaba a instalarse** |
| **Tratar el error de red como boleto falso** | Sin señal, `validar()` marcaba **Boleto no válido**: acusaba a alguien por tener mala antena. Ahora solo un «no» explícito del servidor invalida |
| **Transmitir desde el navegador** | Imposible con YouTube. Y aunque se pudiera (Cloudflare Stream sí acepta WHIP), un navegador de celular corta la transmisión al bloquearse la pantalla |
| **Fecha fija en las pruebas** | La fecha sembrada a mano se volvió pasado y **la prueba empezó a fallar sola**, sin que nada se hubiera roto. Ahora es relativa a hoy |
| **Crear rifa sin activarla** | El panel seguía manejando la anterior —normalmente cerrada, con todo apagado— y **parecía trabado**. Ahora salta solo a la recién creada |
| **Cerrar sin revelar** | La pantalla decía «No ganaste · Folio ganador: **null**». Mentirle a alguien que no perdió. Ahora dice «Rifa cerrada» |
| **Un código por folio** | Con cuatro números por boleto habría cuatro códigos en un papel que solo tiene espacio para uno. El código se firma sobre el BOLETO: un papel, un código, un QR |
| **Folios consecutivos en un boleto** | Si los cuatro números de un papel fueran seguidos, ver uno daría pistas de los otros tres. Se revuelven antes de repartirlos |
| **Verificar sin código** | Se dejó pasar la consulta por folio suelto «para cotejar la bolita». Una prueba lo cachó: así cualquier número tecleado decía «boleto original», que es justo lo contrario de lo que esa pantalla existe para probar. El código se exige siempre |
| **Dejar `rifaId` en nulo sin más** | Al quitar la rifa fija de la configuración, la pantalla dejó de preguntarle al servidor: la comprobación exigía saber la rifa para ir a averiguar cuál era. Circular. Ahora resolver el boleto solo pide conexión |
| **Sacar el azar de un `Uint32`** | 32 bits alcanzan para un folio de 8 dígitos, pero no para el identificador de boleto de 10: `azar % espacio` dejaba fuera todo lo que pasara de 5.294.967.295, así que **ningún boleto podía empezar con 6, 7, 8 ni 9** y solo se usaba el 47,7 % del espacio. Y el residuo, además, reparte de más los valores bajos. Se cambió por muestreo por rechazo sobre 53 bits. Medido después: los diez dígitos completos y chi-cuadrado 10,7 sobre 9 grados de libertad |
| **Estrenar el servidor antes que el sitio** | Se publicó la función nueva mientras el sitio seguía en la versión vieja. El panel pedía `boleto.folio`, campo que el servidor ya no mandaba, y la hoja salió con **C-undefined**. Primero el sitio o al mismo tiempo; nunca el servidor solo |
| **Servir los archivos del panel desde la copia guardada** | La *página* del panel ya se pedía a la red, pero su `panel.js` no: quedaba HTML nuevo corriendo JavaScript viejo, y el «undefined» siguió saliendo después de corregir el servidor. Ahora `panel.js` y `panel.css` van a la red primero, y las etiquetas llevan `?v=` a la par de `CACHE` para que el trabajador de servicio anterior tampoco pueda servir lo viejo |
| **Una vista previa que dibuja por su cuenta** | Era lo cómodo: un boleto de mentiras en el panel y el de verdad en la hoja. Pero dos dibujos separados se separan, y de eso uno se entera con doscientos boletos ya impresos. La vista previa y la hoja llaman a las MISMAS dos funciones, y una prueba compara el fondo de las dos |
| **Dejar que el tema pintara el QR** | Con el tema oscuro, el QR quedaba negro sobre azul marino: ilegible para cualquier teléfono. Ahora el QR va siempre sobre un parche blanco con su margen, gane lo que gane el gusto de quien diseña |

## Cómo llegó a ser lo que es

1. **Prototipo** — una página con folio y QR.
2. **Separación** — salió del repo de Koppert a su propio repositorio.
3. **Cloudflare** — porque la red móvil no alcanzaba GitHub.
4. **Blindaje de red** — caché, sondeo adaptativo, reintentos, diagnóstico.
   Medido con 30 navegadores reales cayéndose y volviendo.
5. **Panel de administración** — historial, rifas nuevas con folios firmados,
   hoja imprimible, verificador de boletos.
6. **Transmisión** — enlace de YouTube, reproductor a petición, candado de un
   solo aparato transmitiendo.
7. **Lo irreversible y lo que miente** — cotejo del folio contra el talón, y
   una cuarta prueba en el diagnóstico para que no diga «todo bien» con el
   motor del panel caído.

## Lo que está medido, no supuesto

- **30 pantallas reales** con la red cayéndose alrededor del revelado, y el
  canal en vivo apagado a propósito: 30/30 vieron el resultado, peor caso
  13.7 s. Proyección a 500: 167 consultas/s.
- **Con el servidor caído** (60 respuestas 503 seguidas): ninguna pantalla se
  rompe, todas siguen con el cronómetro.
- **108 comprobaciones automáticas** (`node pruebas/panel.mjs`), incluida la
  lectura del QR impreso para confirmar a dónde apunta, y que un boleto gana
  si CUALQUIERA de sus cuatro números sale.
- **Que el público no ve los números**: consultando la base como `anon`,
  `boletos` y `folios` devuelven cero filas. El estado de la rifa sí es
  público, que es el diseño.
- **Que el azar reparte parejo**: 300.000 identificadores de diez dígitos
  cubren el espacio entero y empiezan con los nueve dígitos posibles; 600.000
  tiradas en diez casillas dan chi-cuadrado 10,7 (por debajo de 21,7, el
  umbral con 9 grados de libertad). Importa dos veces: un lote predecible es
  adivinable, y el folio ganador se saca con ese mismo sorteo.
- **El panel, contra el servidor real:** se creó una rifa de 500 boletos, se
  transmitió, se reveló al azar y se cerró. Funcionó.

## Lo que queda pendiente

- **Supabase Pro** para el mes del evento (~25 USD) si serán 500 teléfonos a la
  vez: el plan gratis da 200 conexiones de Realtime. Sin Pro no se rompe —el
  sondeo cubre, y está medido— pero tardan unos segundos más.
- **El nombre de la rifa** es temporal y se cambia al crear cada una.
- Ideas evaluadas y **descartadas con razón**: página pública de resultados (la
  libreta ya resuelve el boleto perdido), confirmar entrega del premio (igual),
  y sorteo verificable por criptografía (no aplica mientras la bolita se saque
  a mano frente a la cámara: el azar ya es visible).

## Cómo trabajar en esto

Ver [`CONTINUIDAD.md`](CONTINUIDAD.md): direcciones, llaves, el guion del día
de la rifa y cómo retomar desde otro equipo. Y [`README.md`](README.md) para
cómo está armado por dentro.

**Al tocar archivos del sitio, sube la versión del caché en `sw.js`** o los
teléfonos que ya abrieron la página seguirán viendo la vieja.
