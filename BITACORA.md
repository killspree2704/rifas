# Bitácora del proyecto

Por qué el sistema es como es. El código dice *qué* hace; esto dice *por qué*,
y qué se intentó antes que no funcionó, para no repetirlo.

Escrito al cierre de la etapa de construcción, septiembre de 2026.

## Qué es

Rifas con boleto de papel. Cada boleto lleva un folio, un código de
verificación y un QR. Quien lo escanea ve su folio y, a la hora del sorteo, si
ganó o no — sin registrarse, sin instalar nada.

## Las ocho decisiones de fondo

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

*Reforzado el 28 de septiembre de 2026:* la inquietud era qué pasa si un
papelito que cae de la tómbola física no es de los que esta rifa imprimió
—ajeno, mal tecleado, o metido de mala fe—. Ya se rechazaba: `revelar` compara
el número contra `folios` de esa rifa y responde 400 si no está, sin
excepción y sin depender de que el panel se porte bien (la comprobación vive
en la función de borde, no en el navegador). Lo que faltaba era la prueba de
que pasó: un rechazo que no queda escrito es un rechazo que nadie puede
enseñar después. Ahora cada intento rechazado se anota en `sorteo_log` como
`intento_rechazado` con el número tecleado, antes de responder el error. La
bitácora del sorteo ya no solo cuenta lo que ganó: también cuenta lo que se
intentó y no pudo.

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

**8. El panel nunca borra de verdad.**
*Añadida el 25 de octubre de 2026.* «Archivar» una rifa solo le apaga un
indicador (`archivada`) y la saca de la lista de siempre: sus boletos y
folios se quedan exactamente donde estaban. El borrado de verdad —el que sí
libera folios, y que de verdad no tiene vuelta atrás— **no tiene ninguna
acción en el panel ni en la función de borde**. Solo pasa a mano, directo en
la base, cuando quien administra el proyecto lo pide explícitamente fuera de
la aplicación. Es la misma filosofía que la decisión 4 —el ganador no se
puede tocar ni con la llave de servicio—, pero mirando al revés: ahí se
protege un hecho del sorteo; aquí se protege a quien usa el panel de su
propio clic de más. La primera versión de esto sí tenía un borrado real
expuesto en el panel —con confirmación tecleada y todo—, pero se cambió
antes de desplegarse de verdad a producción: guardar los datos para siempre
y dejar el borrado fuera del alcance de un clic resultó ser la decisión
correcta.

**9. El folio es único POR RIFA, no entre todas — y lo que impide
falsificar un boleto es el código firmado, no que el número sea raro.**
*Añadida el 25 de octubre de 2026,* al agregar el sorteo de canastas (una
bolita por dígito, números de 1 a un tope — ver CONTINUIDAD.md). Hasta
entonces, el folio era único para toda la vida del proyecto, y esa rareza
—90,000 números posibles, usando como máximo el 30%— era parte de lo que
hacía difícil adivinar uno real. Pedir números chicos y tradicionales
(0001 a 0999, por ejemplo) rompe esa rareza a propósito: con un tope de
999 solo hay 999 posibilidades, y la próxima rifa va a volver a usar el
mismo rango. La pregunta de fondo era si eso debilitaba la seguridad del
sistema, y la respuesta es que no: el código de 4 caracteres que lleva
cada boleto, firmado con HMAC sobre su identificador, nunca dependió del
tamaño del folio para ser imposible de adivinar. Lo único que cambió de
verdad es que `folios` pasó de tener el folio solo como llave primaria a
tener `(rifa_id, folio)` compuesta, y que verificar un boleto solo con su
número —sin el identificador largo del QR— ahora busca la pareja
**folio + código** entre todas las rifas en vez de suponer que el folio ya
identifica una sola. Que dos boletos de rifas distintas compartan folio Y
código firmado es, en la práctica, tan improbable como siempre lo fue
adivinar un código a secas.

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
| **Obligar a crear la rifa antes de diseñarla** | El diseño se guarda dentro de la rifa, así que sin rifa el botón de guardar nacía deshabilitado: con la base recién vaciada, la pestaña entera era un callejón sin salida. Y el orden estaba al revés: primero se decide cómo se va a ver el boleto y después se manda a hacer el lote. Ahora, sin rifa, el diseño se guarda como el de la próxima, y al crearla se le COPIA —no se referencia—, para que cambiarlo después no reescriba ninguna hoja ya impresa |
| **Creer a la prueba en vez de mirar** | Las estrellas del fondo salían en blanco y las 159 comprobaciones seguían en verde: la prueba leía el texto del CSS, que era correcto, no los píxeles. Se vio dibujando los doce fondos y abriendo la imagen. La causa ni siquiera estaba en el producto —el script de vista metía `url("data:…")` dentro de un atributo HTML con comillas dobles y se cortaba solo—, pero sin mirar no se habría sabido |
| **Números imprimibles sin tómbola que los contenga** | Los folios salen al azar por todo el espacio de cinco dígitos —90.000 posibilidades— y eso está bien contra la falsificación, pero no existe la bolsa de bolitas que los traiga. Escribir 800 papelitos a mano es una tarde y un dedazo esperando a pasar, y un papelito mal escrito es un número que la app rechaza el día del sorteo delante de todos. Sortear dígito por dígito tampoco sirve: con 800 vendidos entre 90.000, la combinación cae en uno vendido el 0,9 % de las veces. Ahora la app imprime los papelitos, de la MISMA consulta que los boletos. **Reemplazado el 26 de octubre** por el sorteo de canastas (ver más abajo): el sorteo físico de verdad es con canastas de bolitas por dígito, no con un bombo de un solo papelito por boleto vendido —ese problema de «0,9 % de las veces cae en uno vendido» no existe cuando el tope del sorteo es del tamaño de lo vendido—. El botón «Papelitos de tómbola» y todo su código se quitaron: imprimir un papelito para un sorteo que nunca va a usar papelitos solo habría confundido el día del evento |
| **Dar por hecho que la base siempre está encendida** | El panel empezó a dar «Failed to fetch» y lo primero que se pensó fue en la clave. No era: Supabase había PAUSADO el proyecto por siete días sin actividad, y con la base apagada no hay a quién preguntarle. Una clave mala habría dicho «clave incorrecta»; «Failed to fetch» significa que la petición no llegó a ningún lado. Quedó escrito en CONTINUIDAD.md cómo se despierta y, sobre todo, que los proyectos de pago no se pausan |
| **Suponer que calcar la imagen sería mejor que dibujarla** | Puesto el boleto dibujado contra uno calcado de la foto del cliente —misma hoja, mismo tamaño, lado a lado— la diferencia resultó mínima: el dibujo ya había salido de medir esa foto. Y la imagen pierde en lo que importa para imprimir: el recorte trae 195 puntos por pulgada y ahí se queda, mientras que el SVG sale nítido a cualquier tamaño. La prueba costó veinte minutos y evitó meter un archivo binario de 19 kB en cada hoja impresa a cambio de nada. **Revisitado un mes después** (ver más abajo): cuando el dueño pidió explícitamente la foto TAL CUAL —no «parecida», IDÉNTICA—, esta conclusión dejó de aplicar: ya no era una decisión técnica entre dos resultados visualmente iguales, era un requisito de que fuera la imagen real. Una conclusión que tenía sentido para una pregunta («¿cuál se ve mejor?») puede dejar de servir cuando la pregunta cambia («¿cuál es la foto que de verdad trajo el cliente?») |
| **Dibujar el boleto en vez de usar la foto, cuando lo que se pidió era la foto** | La disposición «Suertudito» llegó a reproducir el boleto del cliente con SVG dibujado a mano —marco, tréboles, rana, título— y durante semanas eso bastó. Cuando el dueño compartió la foto real y pidió explícitamente «aquí sí requiero que lo dejes idéntico [...] requerimos la réplica idéntica», un dibujo —por fiel que fuera— ya no cumplía lo pedido: el dueño no quería un boleto que se PARECIERA al suyo, quería SU boleto. Se reemplazó el SVG entero por la foto como fondo, con los datos dinámicos (números, QR, fechas, precio) encima, tapando con un fondo opaco las muestras que trae la foto («$20», fechas de ejemplo, el QR de muestra) para que nunca se vea un dato falso en un boleto real |
| **Copiar un boleto «a ojo» cuando la foto se puede medir** | El primer «Suertudito» puso cada pieza donde parecía ir y después se defendió diciendo que reproducía el original. No lo reproducía: salía en blanco y negro con números rosas, el título en letra manuscrita y todo el tipo chico. Al medir la foto con un cuentagotas y un contador de píxeles —el marco a 1.84 %, el recuadro a 7.2 % × 27.2 %, el fondo `#e4e9e3`, el título en romana cursiva de 6.1 mm— las correcciones salieron solas. Medir la foto costó veinte minutos; adivinarla costó una entrega devuelta |
| **Pedir letra manuscrita porque el original «se ve cursivo»** | El título del boleto es una romana NEGRITA CURSIVA, no una letra a mano. Se pidió `Segoe Script` y en esta máquina, que no la tiene, cayó en una romana y pasó por buena. En la máquina del cliente, que sí la tiene, el título salía escrito a mano. Lo que falla solo en la computadora del otro no lo cacha mirar la pantalla propia: ahora la prueba comprueba que la familia resuelta sea romana y NO manuscrita |
| **Medir el ancho de un texto contando letras** | Para que el título no se le montara al trébol se encogía según cuántas letras tuviera. «Suertudito» y «Muerde Manos» tienen casi las mismas y la segunda mide un tercio más, porque las emes son anchas: el título seguía montándose. Ahora se mide de verdad, con `measureText` y la letra que tenga esa máquina |
| **Letras en milímetros dentro de un boleto que no siempre mide lo mismo** | Las medidas iban en milímetros del boleto impreso a 60 mm. En papel salía bien; en la pantalla, donde la hoja enseña el boleto al doble, el tipo se veía diminuto, así que lo que el cliente revisaba antes de imprimir no era lo que iba a salir. Ahora todo se mide contra el ancho real del boleto (`cqw`), con el milímetro de respaldo para un navegador viejo. La prueba lo fija: el aviso tiene que medir 1.85 mm en un boleto de 60 mm, mida lo que mida el boleto en pantalla |
| **Diseñar para el boleto que trajo el cliente, no para los que acepta la app** | La disposición «Suertudito» nació con cuatro recuadros fijos porque cuatro trae el boleto del dueño, y los folios que pasaran de ahí se cortaban con un `slice(0, 4)`: seguían valiendo, seguían yendo a la tómbola y podían salir ganadores sin que el papel del comprador los mostrara. El formulario acepta de 1 a 10. Ahora los números se reparten en dos columnas con tantos renglones como hagan falta, y las piezas que vivían en los costados —las fechas de canto, el sello— se mudan cuando el boleto se aprieta |
| **Dejar el código solo dentro del QR** | El mismo boleto vertical llevaba el identificador y el código únicamente codificados en el QR. El procedimiento del día del sorteo es comparar el código que enseña el panel con el del talón del ganador ANTES de revelar, y eso con un QR mojado, arrugado o mal impreso no se puede hacer. Van impresos en letra al pie, como en el clásico |
| **Confiar en una prueba geométrica que solo mira la mitad** | Al acomodar nueve números, la prueba de encimados pasó en verde y la imagen renderizada enseñaba el folio del boleto tachado por un trébol: la prueba comparaba las piezas legibles entre sí, pero no contra los adornos. Segunda vez en este proyecto que la prueba dice que sí y la imagen dice que no. Ahora hay dos medidas —legibles entre sí y adornos contra legibles— y se sigue mirando el PNG |
| **Copiar un diseño a ojo** | El primer intento de reproducir el boleto «Suertudito» puso cada pieza donde parecía ir, y salió todo encimado: el texto de canto sobre una caja, el trébol cortado por el marco, el `$20` debajo de los números en vez de ENTRE ellos. Midiendo la imagen original se vio la estructura real —tres filas: caja·rana·caja, texto·QR·logo, caja·$20·caja— y las posiciones se pasaron a porcentaje. Medir antes de dibujar costó diez minutos y ahorró tres vueltas |
| **Poner una columna en NOT NULL antes de que el código que la llena esté desplegado** | Al agregar `boletos.numero`, la migración la dejó NOT NULL de una vez. La función `sorteo` que ESTABA DESPLEGADA en ese momento no la escribía —ese código vivía en una rama sin publicar—, así que crear una rifa desde el panel real, en ese instante, habría fallado. Se cachó antes de que pasara, no después: la migración y el código que depende de ella no se despliegan solos ni a la vez. Se relajó a NULLABLE hasta desplegar, se volvió a cerrar, y días después la columna entera se quitó junto con vendedores (ver abajo) |
| **Confiar en `new URL(...).pathname` para rutas de archivo en Windows** | Las pruebas (`panel.mjs`, `servidor-de-prueba.mjs`) usaban `.pathname` de una `file://` para encontrar sus propios archivos. En Linux/Mac da una ruta usable tal cual; en Windows da `/C:/Users/…`, con una barra antes de la unidad, y pasada a `spawn` o `require` sin más se resuelve como `C:\C:\Users\…` — una ruta que no existe. `fileURLToPath` sí entiende la diferencia entre sistemas; `.pathname` no. Sin este cambio, las pruebas no corrían en Windows aunque el código sí funcionara |
| **Vendedores: construido, probado, desplegado, y quitado días después** | La pestaña «Vendedores» —catálogo, asignar por lote o números sueltos, reasignar sin bloqueo— llegó a producción completa y probada (242 pruebas en verde). El dueño del proyecto, ya usándola, se dio cuenta de que la logística real —dos rifas el mismo día, un par de horas de diferencia, boletos que se reparten en montones, no en listas numeradas— no se parecía a cómo el reparto se había modelado: la pieza complicaba más de lo que ayudaba. Se quitó entera: tablas, acciones, pestaña, pruebas. Ninguna dato se perdió —ya no había vendedores de verdad dados de alta—, y la columna `boletos.numero`, que solo existía para esto, se fue con ella. La lección no es «no construir»: es que una pieza bien hecha igual puede no ser la pieza correcta, y enterarse de eso a veces solo pasa usándola de verdad, no diseñándola |
| **Un borrado real, con confirmación tecleada, expuesto en el panel** | Se construyó primero así: «Eliminar» con candado de ganador revelado y un cuadro de diálogo que exigía teclear el nombre exacto. Antes de que el dueño lo usara de verdad para limpiar rifas de prueba, se dio cuenta de una consecuencia que el diseño no había puesto sobre la mesa: borrar de verdad libera los folios, y ese era justo el peligro que el proyecto llevaba meses evitando. Se cambió a «archivar» —ver decisión 8— antes de que causara daño. El borrado real que sí hizo falta esa tarde se hizo a mano, fuera del panel, con el dueño confirmando cada rifa por su nombre en el chat |
| **Códigos de boleto que se repetían entre rifas, pero solo en el servidor de prueba** | Al probar que el sorteo de canastas distingue folios repetidos por su código, dos rifas de prueba distintas generaron boletos con el MISMO código («C000»): el servidor de prueba numeraba los códigos otra vez desde cero en cada rifa nueva, cosa que el servidor real nunca hace —ahí el código sale de firmar el identificador del boleto, que es único para siempre—. La prueba lo cachó sola: el segundo «verificar» nunca cambiaba de rifa. Se corrigió metiendo el número de rifa en el código de prueba también. Sin esta prueba exacta —mismo folio, dos rifas, cotejar que cada código apunte a la suya— el hueco no se habría visto: por fuera, cualquier código de 4 letras se ve igual de válido |
| **Una clase CSS reusada por casualidad, y el recuadro del número que no bajaba de 42 px por más que `height` dijera otra cosa** | Al poner la foto real de fondo, las cajas de los cuatro números salían gigantes —casi el doble de lo medido— sin importar si `height` iba en porcentaje, en `calc(var(--u) * N)` o si la caja derivaba su alto de `aspect-ratio`. Horas de probar: `container-type` del boleto, el `aspect-ratio` del boleto (reemplazado por el truco clásico de `padding-top`, que SÍ hace falta y se quedó porque la altura de un `aspect-ratio` no cuenta como «definida» para el `height` en porcentaje de sus hijos absolutos —otro hallazgo real, aparte—), `backdrop-filter` del panel, `transform` de la vista encogida. Nada lo explicaba hasta clonar el recuadro suelto en la página: con solo ponerle `class="caja"` —SIN tocar nada más— el bug aparecía solo. La pestaña «Diseño» ya tenía, desde antes, una regla genérica `.caja { padding: 20px; }` para sus tarjetas de vidrio, y el recuadro del número —pensado y nombrado meses después, sin saber de la otra— comparte ese mismo nombre de clase por pura casualidad. Con `box-sizing: border-box`, un relleno de 20 px por lado que nunca se sobreescribía puso un mínimo de 42 px (padding + borde) por debajo del cual ningún `height` podía bajar: la caja se ACHICABA de verdad, pero el relleno la volvía a estirar. El arreglo fue una sola línea, `padding: 0`, en la regla del recuadro. La lección: cuando una propiedad se ignora sin importar CÓMO se la escriba, sospechar de otra regla que coincide por nombre de clase antes que de la sintaxis —y clonar el elemento con solo su clase, lejos de todo lo demás, para probarlo aislado |
| **Confiar en que el navegador imprime los fondos porque se ven bien en pantalla** | La foto del boleto «Suertudito» desaparecía al imprimir con varios boletos por hoja —salía en blanco, solo bordes y texto—, y en pantalla se veía perfecta. La causa no estaba en el boleto: la casilla «Gráficos de fondo» del diálogo de impresión de Chrome nace DESTILDADA, y sin ella el navegador no imprime ni `background-image` ni `background-color` de nada, sin avisar. Comprobado exportando el mismo PDF con y sin ese ajuste: 43 KB sin fondos contra 1.07 MB con ellos —la foto entera desaparecía—. El arreglo es `print-color-adjust: exact` (con su prefijo `-webkit-`) en la hoja de estilos de impresión: fuerza los fondos sin que quien imprime tenga que saber de esa casilla. La lección: una hoja para imprimir que use `background` para algo que importa —una foto, no solo decoración— necesita esta línea, y probarla con `printBackground: false` explícito, no solo mirar la pantalla |
| **La fecha de emisión impresa, pedida, construida, y quitada por el cliente** | El boleto llegó a imprimir «Emisión: …» de canto, junto a la caducidad, con dos campos para fijarla —uno al crear la rifa, otro para corregirla después—. El cliente confirmó que ya no la quiere: se quitó del boleto y los dos campos que la controlaban. La caducidad —que es otro dato, cuántos días vale el boleto, no cuándo se imprimió— se queda igual, ahora sola en ese hueco de canto, centrada en vez de pegada arriba. La columna de la base y la acción del servidor que la guardaban no se tocaron —nada las llama ya, pero no hacía falta arriesgar producción para borrar un campo que vivía solo en el panel— |
| **Un campo nuevo que se veía bien en la vista previa y se perdía solo al guardar** | El control del «Tono de la foto» (PR anterior, ya en producción) giraba la foto perfecto en la vista previa del panel. Lo que nadie probó fue el viaje completo: guardar, recargar, y ver si seguía ahí. No seguía. La función de borde reconstruye el diseño con `limpiarDiseno()`, una lista FIJA de campos permitidos —por seguridad, para que un dedazo en el cuerpo de la petición no cuele algo que no debería guardarse—, y `tono` no estaba en esa lista: se guardaba, sí, pero como `undefined`, y al recargar volvía a 0 sin aviso ni error. La prueba automática tampoco lo cachó, por la misma razón que el bug pasó: el servidor de PRUEBA hacía `r.diseno = d` a secas —todo el objeto, tal cual llegara—, mientras el de VERDAD reconstruye campo por campo. Dos servidores con compuertas distintas, y la prueba solo conocía la más permisiva. Se corrigió agregando `tono` a la lista del servidor real (con su propia validación, 0–360 entero) y cambiando el servidor de prueba para que TAMBIÉN reconstruya por lista en vez de copiar el objeto completo, así una divergencia futura entre los dos sí truena una prueba. La lección: un campo nuevo en el diseño no está completo hasta que sobrevive guardar-y-recargar contra el servidor de verdad, no solo contra el estado en memoria del navegador —y el mock tiene que imitar las RESTRICCIONES del servidor real, no solo sus respuestas exitosas— |
| **El mismo bug de `.pie` que el de `.caja`, pero más escondido** | El identificador y el código impresos al pie del boleto —el que hay que cotejar el día del sorteo— llevaba semanas sin imprimirse de verdad, y ninguna prueba lo decía. La causa: `estilos.css` —que el panel también carga, para los colores y tipos que comparte con la pantalla del participante— tiene su PROPIA regla `.pie { margin-top: 24px; padding-top: 15px; border-top: ...}`, para el pie de ESA pantalla, sin relación con el boleto impreso. Coincide el nombre de clase por pura casualidad, igual que pasó antes con `.caja`. Esos 24+15 px de más empujaban el pie del boleto FUERA de su propio marco, y `overflow: hidden` lo recortaba entero —invisible, pero seguía estando en el DOM—. Las pruebas que había comprobaban el TEXTO (`textContent`), que no se entera de nada de esto: un elemento recortado por overflow sigue teniendo su texto intacto. Se encontró por casualidad, construyendo el segundo boleto, al medir la posición real del pie en vez de solo leer su contenido. Arreglo de una línea —`margin: 0; padding-top: 0; border-top: none;`— en la regla del pie del boleto. La lección, otra vez: cuando dos partes del sitio comparten una hoja de estilos pero NO su intención, cualquier nombre de clase corto —`.pie`, `.caja`— es territorio compartido por accidente, y una prueba de texto no basta para notar que algo se salió de su caja; hay que medir si el elemento cabe dentro de su contenedor |
| **Boletos chicos en la hoja cuando sobraban columnas** | Con «3 por renglón» pedido pero solo 1 o 2 boletos en el lote, cada uno salía del tamaño de un tercio de hoja, con el resto en blanco al lado: ni se veían grandes ni se aprovechaba el papel. `grid-template-columns: repeat(auto-fit, minmax(…))` en vez de `repeat(columnas, 1fr)` a secas: las columnas que de verdad no tiene nadie —ni en ningún renglón— se colapsan solas y el `1fr` reparte ese espacio entre los boletos que sí hay, así que crecen para llenar la hoja. El `minmax()` sigue topando en el máximo pedido cuando el lote es grande, así que «3 por renglón» con 9 boletos se sigue viendo igual que siempre —solo cambia cuando hay MENOS que el máximo—. `justify-content: center` de paso, para el último renglón cuando queda incompleto |
| **Tratar el logo propio de una foto como si fuera una muestra que hay que tapar** | «Bono Gana Hoy» se construyó poniendo el QR de verdad ENCIMA del logo del centro —la herradura y la bolsa de dinero—, con el mismo criterio que tapar el «$20» de muestra de «Suertudito»: donde la foto trae algo que no aplica al boleto real, se cubre. Pero ese logo no era una muestra, era parte fija del diseño, y el dueño lo notó ya con el boleto impreso en producción: «te comiste el símbolo de la herradura». La diferencia que se pasó por alto: una muestra («$20», un QR de mentiras) es un VALOR que cambia boleto a boleto y hay que reemplazar; un logo es DECORACIÓN fija, como el título o el marco, y nunca debería llevar nada encima. El QR se movió al hueco vacío de abajo del logo, que se queda visible. La lección: antes de decidir que algo en una foto «hay que taparlo», confirmar que de verdad es un valor de muestra y no una parte del diseño que se iba a quedar |
| **Un campo de la rifa que solo se podía fijar una vez, al crearla** | El precio del boleto nació como un dato de captura única en «Nueva rifa», sin forma de corregirlo después —a diferencia de la caducidad o, antes, la fecha de emisión, que sí vivían en Diseño con su propio botón—. Un precio mal tecleado solo se nota con el lote ya andando. Se agregó `fijar_precio` en el servidor (mismo patrón que el ya retirado `fijar_emision`: no toca folios ni boletos, así que no se bloquea con la rifa cerrada) y un campo «Precio del boleto» en Diseño, aparte de «Guardar el diseño» a propósito —el precio es de la RIFA, entra en el total vendido, no es un dato de aspecto— |
| **`addInitScript` de Playwright, con `document.documentElement` todavía en `null`** | Al escribir una captura de pantalla en tema oscuro para revisar el rediseño de la barra lateral, `page.addInitScript(() => { document.documentElement.dataset.theme = 'dark'; })` no hacía nada —ni fallaba, ni se veía el tema oscuro—. Instrumentando paso a paso: `!!document.documentElement` adentro del propio `addInitScript`, en el momento en que corre, daba `false` en esta versión de Playwright (1.64) — el documento aún no existía cuando el script se evalúa, así que `document.documentElement.dataset...` lanzaba un error silencioso (sin manejador) y la función se cortaba ahí. Un `window.__marcador = 42` simple, sin tocar el DOM, sí sobrevivía: `window` existe desde antes que `document.documentElement`. La forma correcta de forzar un tema (o cualquier cosa que dependa de `localStorage`) desde un `addInitScript` es escribir en `localStorage` —que tampoco depende del DOM— y dejar que el script propio de la página, en el `<head>`, lo lea y aplique como ya hace para un usuario de verdad: `localStorage.setItem('tema', 'dark')` en vez de tocar `documentElement` a mano. Más fiel al comportamiento real, de paso |
| **Un encabezado que se quedó visible, solo, sobre la pantalla de entrada** | Al mover el título de la rifa del encabezado global al tope del nuevo contenido (parte del rediseño de la barra lateral), ese `<header>` se quedó sin ninguna condición que lo ocultara antes de iniciar sesión —antes vivía pegado arriba de la tarjeta de clave y pasaba desapercibido; reubicado, quedó flotando solo, muy abajo, mostrando el guion `—` de marcador de posición sobre un fondo vacío—. Se vio en una captura de pantalla, no en las pruebas automáticas, que no revisan la posición de nada que no se consideró parte de ninguna aserción. Arreglado dándole a `#cuerpo` (el contenedor nuevo de navegación + contenido) su propio `hidden` desde el HTML, quitado por `panel.js` en el mismo instante en que se revela `#pestanas` tras entrar |

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

- **El boleto «Suertudito», con la foto real del cliente en vez del dibujo en
  SVG.** El dibujo se parece —salió de medir esa misma foto—, pero no es
  igual, y eso es lo que se pidió: usar la imagen tal cual, con el sistema
  encargándose solo de los datos variables encima (QR, números, código,
  fechas). Pendiente de construir.
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
