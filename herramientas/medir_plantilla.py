"""
Medir una foto de boleto para sacar las coordenadas que pide `PLANTILLAS`
en `assets/panel.js` (caja, qr, fechas, precio, pie) — SIN repetir, cada
vez, el trabajo manual de cuentagotas y contador de píxeles que costó
"Suertudito" y "Bono Gana Hoy".

No es magia ni adivina solo: sigue pidiendo un punto APROXIMADO de dónde
cae cada cosa —el ojo humano para eso sigue siendo más rápido que
cualquier detector genérico—, pero AFINA ese punto a la coordenada exacta
en píxeles, igual que se hizo a mano la primera vez. Lo que ahorra es la
parte lenta: contar píxeles de borde a mano, con un cuentagotas, renglón
por renglón.

Requiere Pillow y NumPy. Para medir desde un PDF en vez de una imagen ya
recortada, PyMuPDF (`pip install pymupdf`).

USO TÍPICO, paso a paso
========================

    from medir_plantilla import *

    img = cargar("assets/boleto-bono-gana-hoy.png")
    ancho, alto = img.size              # para fotoAncho/fotoAlto en PLANTILLAS

    # 1) Un recuadro de número: dar un punto APROXIMADO cerca de su borde
    #    (basta con verlo a ojo en cualquier visor de imágenes) y que la
    #    herramienta encuentre el borde EXACTO escaneando alrededor.
    caja = recuadro_cercano(img, x_aprox=0.10, y_aprox=0.40)
    print(caja)   # {'left': 7.43, 'top': 37.27, 'width': 26.43, 'height': 7.24}

    # 2) Los cuatro recuadros de un jalón, dado un punto aproximado DENTRO
    #    de cada uno —el orden no importa, se ordenan solos—:
    cajas = cuadricula_de_cajas(img, [
        (0.10, 0.40), (0.80, 0.40),      # arriba: izquierda, derecha
        (0.10, 0.80), (0.80, 0.80),      # abajo: izquierda, derecha
    ])
    print(cajas)
    # {'primer': 37.27, 'ultimo': 76.29, 'alto': 7.24, 'ancho': 26.43,
    #  'columna': [7.43, 69.03]}
    # ^ esto se pega TAL CUAL en el campo `caja` de PLANTILLAS.

    # 3) El color exacto de un punto (para "trebol" en el tema, o para
    #    confirmar el fondo detrás de un recuadro):
    print(color_hex(img, 0.5, 0.02))   # '#e4e9e3'

    # 4) Si lo que se midió es el recorte de un PDF, no una imagen suelta:
    img = pdf_a_imagen("Boletos A - 250.pdf", pagina=0, dpi=400)

Todas las coordenadas que entran y salen son FRACCIONES de 0 a 1 (no
porcentajes ni píxeles) excepto donde se indique lo contrario; multiplica
por 100 para pegarlas en `PLANTILLAS`, que si usa porcentaje.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
import numpy as np


# ---------------------------------------------------------------------------
# Cargar
# ---------------------------------------------------------------------------

def cargar(ruta) -> Image.Image:
    """Abre una imagen (png/jpg/webp) en RGB, sin canal alfa —que estorba
    al comparar colores—."""
    img = Image.open(ruta)
    return img.convert("RGB") if img.mode != "RGB" else img


def pdf_a_imagen(ruta_pdf, pagina: int = 0, dpi: int = 400) -> Image.Image:
    """Rasteriza una página de un PDF a imagen, a la resolución pedida.

    400 DPI de ida —para medir con precisión—, y LUEGO se achica la imagen
    final a su tamaño de verdad (típicamente 900×1228 o parecido) antes de
    usarla como fondo del boleto: 400 DPI final pesaría varios megabytes
    por nada.
    """
    import fitz  # pymupdf

    doc = fitz.open(ruta_pdf)
    pix = doc[pagina].get_pixmap(dpi=dpi)
    modo = "RGBA" if pix.alpha else "RGB"
    img = Image.frombytes(modo, (pix.width, pix.height), pix.samples)
    return img.convert("RGB") if img.mode != "RGB" else img


# ---------------------------------------------------------------------------
# Lo básico: color y arreglos
# ---------------------------------------------------------------------------

def _arreglo(img: Image.Image) -> np.ndarray:
    return np.asarray(img)


def color_hex(img: Image.Image, x: float, y: float) -> str:
    """El color de un punto, como lo pide `TEMAS` en panel.js (`#rrggbb`).

    `x`, `y` son fracciones de 0 a 1 del ancho/alto de la imagen —el mismo
    sistema que usa `PLANTILLAS` en porcentaje, nada más que sin el ×100—.
    """
    a = _arreglo(img)
    alto, ancho = a.shape[:2]
    px, py = int(x * ancho), int(y * alto)
    px = max(0, min(ancho - 1, px))
    py = max(0, min(alto - 1, py))
    r, g, b = a[py, px][:3]
    return "#{:02x}{:02x}{:02x}".format(int(r), int(g), int(b))


# ---------------------------------------------------------------------------
# El corazón: afinar un punto aproximado al borde exacto de un recuadro
# ---------------------------------------------------------------------------

def _escala_de_grises(a: np.ndarray) -> np.ndarray:
    return a[:, :, :3].astype(np.int32).sum(axis=2) // 3


def _primer_salto(perfil: np.ndarray, centro: int, umbral: int, direccion: int) -> int:
    """Desde `centro`, camina en `direccion` (+1 o -1) sobre una fila o
    columna de luminancia hasta el primer salto de contraste mayor a
    `umbral` contra el valor en `centro` —el borde del recuadro—. Si no
    encuentra ninguno antes del límite de la ventana, se queda en la orilla.
    """
    base = int(perfil[centro])
    i = centro
    n = len(perfil)
    while 0 <= i + direccion < n:
        i += direccion
        if abs(int(perfil[i]) - base) > umbral:
            return i
    return i


def recuadro_cercano(
    img: Image.Image,
    x_aprox: float,
    y_aprox: float,
    ventana: float = 0.10,
    umbral: int = 24,
) -> dict:
    """Dado un punto aproximado DENTRO o sobre el borde de un recuadro con
    marco (como los números del boleto), encuentra su rectángulo exacto.

    Funciona buscando, desde el punto dado, hacia los cuatro lados, dónde
    el contraste de la línea de píxeles cruza `umbral` —el marco del
    recuadro, más oscuro o más claro que su relleno—. `ventana` acota la
    búsqueda (como fracción del ancho de la imagen) para no salirse al
    recuadro vecino si el punto dado cae cerca de la mitad entre dos.

    Devuelve `{'left', 'top', 'width', 'height'}` en PORCENTAJE (0-100),
    listo para construir el `caja` de `PLANTILLAS`.
    """
    a = _arreglo(img)
    gris = _escala_de_grises(a)
    alto, ancho = gris.shape

    cx, cy = int(x_aprox * ancho), int(y_aprox * alto)
    radio = int(ventana * max(ancho, alto))

    x0, x1 = max(0, cx - radio), min(ancho, cx + radio)
    y0, y1 = max(0, cy - radio), min(alto, cy + radio)

    fila = gris[cy, x0:x1]
    columna = gris[y0:y1, cx]
    cx_local, cy_local = cx - x0, cy - y0

    li = _primer_salto(fila, cx_local, umbral, -1)
    ld = _primer_salto(fila, cx_local, umbral, +1)
    ti = _primer_salto(columna, cy_local, umbral, -1)
    td = _primer_salto(columna, cy_local, umbral, +1)

    izq_px, der_px = x0 + li, x0 + ld
    arr_px, aba_px = y0 + ti, y0 + td

    return {
        "left": round(100 * izq_px / ancho, 2),
        "top": round(100 * arr_px / alto, 2),
        "width": round(100 * (der_px - izq_px) / ancho, 2),
        "height": round(100 * (aba_px - arr_px) / alto, 2),
    }


def cuadricula_de_cajas(img: Image.Image, puntos_aprox: list[tuple[float, float]], **kw) -> dict:
    """Los cuatro recuadros de números de un boleto —dos columnas, uno o
    más renglones—, a partir de un punto aproximado DENTRO de cada uno
    (en cualquier orden). Devuelve el `caja` completo tal como lo pide
    `PLANTILLAS`: `{'primer', 'ultimo', 'alto', 'ancho', 'columna'}`.

    Si los recuadros no miden EXACTO lo mismo entre sí —una foto nunca
    está perfectamente escaneada—, se promedia; la diferencia real suele
    ser de una fracción de punto porcentual, que no se nota impreso.
    """
    cajas = [recuadro_cercano(img, x, y, **kw) for x, y in puntos_aprox]

    columnas_izq = sorted(set(round(c["left"], 1) for c in cajas))
    # Dos valores de `left` esperados (dos columnas); si el detector dio
    # más por ruido, se agrupan los que caen a menos de 2% uno del otro.
    agrupadas: list[float] = []
    for v in columnas_izq:
        if not agrupadas or v - agrupadas[-1] > 2:
            agrupadas.append(v)
    columna_izquierda = min(agrupadas)
    columna_derecha = max(agrupadas) if len(agrupadas) > 1 else columna_izquierda

    tops = sorted(set(round(c["top"], 1) for c in cajas))
    agrupadas_t: list[float] = []
    for v in tops:
        if not agrupadas_t or v - agrupadas_t[-1] > 2:
            agrupadas_t.append(v)
    primer = min(agrupadas_t)
    ultimo = max(agrupadas_t) if len(agrupadas_t) > 1 else primer

    ancho_prom = round(sum(c["width"] for c in cajas) / len(cajas), 2)
    alto_prom = round(sum(c["height"] for c in cajas) / len(cajas), 2)

    return {
        "primer": primer,
        "ultimo": ultimo,
        "alto": alto_prom,
        "ancho": ancho_prom,
        "columna": [columna_izquierda, columna_derecha],
    }


# ---------------------------------------------------------------------------
# Línea de comandos: un vistazo rápido sin escribir Python
# ---------------------------------------------------------------------------

def _main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nUso: python medir_plantilla.py <foto.png> [x_aprox y_aprox]")
        return
    ruta = Path(sys.argv[1])
    img = pdf_a_imagen(ruta) if ruta.suffix.lower() == ".pdf" else cargar(ruta)
    print(f"Tamaño: {img.size[0]}×{img.size[1]} (fotoAncho/fotoAlto)")
    if len(sys.argv) >= 4:
        x, y = float(sys.argv[2]), float(sys.argv[3])
        print("Recuadro cercano:", recuadro_cercano(img, x, y))
        print("Color en ese punto:", color_hex(img, x, y))


if __name__ == "__main__":
    _main()
