#!/usr/bin/env python3
"""Генерация PNG-иконок приложения «ГРР-Контроль» из знака в шапке (тот же SVG-логотип).

Знак: скруглённый квадрат с обводкой, вертикальная линия по центру (буровая колонна)
и три горизонтальные линии (горизонты/слои). Белым по тёмно-синему фону #1E3A5F.
"""
from PIL import Image, ImageDraw
import os

NAVY = (30, 58, 95, 255)   # #1E3A5F — тон интерфейса
WHITE = (255, 255, 255, 255)
OUT = os.path.join(os.path.dirname(__file__), "..", "client", "public", "icons")
os.makedirs(OUT, exist_ok=True)


def draw_mark(size: int, pad_ratio: float) -> Image.Image:
    """size — сторона PNG, pad_ratio — доля отступа знака от края (для maskable больше)."""
    ss = 4  # сглаживание через супер-сэмплинг
    img = Image.new("RGBA", (size * ss, size * ss), NAVY)
    d = ImageDraw.Draw(img)
    S = size * ss
    pad = S * pad_ratio
    box = S - 2 * pad
    # исходные координаты знака в системе 32x32
    k = box / 32.0
    def x(v): return pad + v * k
    w = max(2, int(2 * k))  # толщина линий из SVG strokeWidth=2

    d.rounded_rectangle([x(1), x(1), x(31), x(31)], radius=7 * k, outline=WHITE, width=w)
    d.line([x(16), x(5), x(16), x(27)], fill=WHITE, width=w)
    d.line([x(10), x(11), x(22), x(11)], fill=WHITE, width=w)
    d.line([x(11.5), x(17), x(20.5), x(17)], fill=WHITE, width=w)
    d.line([x(13), x(23), x(19), x(23)], fill=WHITE, width=w)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def save(img: Image.Image, name: str):
    p = os.path.join(OUT, name)
    img.save(p, "PNG", optimize=True)
    print(name, img.size, os.path.getsize(p), "байт")


save(draw_mark(192, 0.10), "icon-192.png")
save(draw_mark(512, 0.10), "icon-512.png")
# maskable: знак в безопасной зоне (отступ ~22 %), фон сплошной, без прозрачных краёв
save(draw_mark(512, 0.24), "icon-maskable-512.png")
save(draw_mark(192, 0.24), "icon-maskable-192.png")
save(draw_mark(180, 0.10), "apple-touch-icon-180.png")
save(draw_mark(1024, 0.10), "icon-1024.png")
save(draw_mark(32, 0.06), "favicon-32.png")
save(draw_mark(64, 0.06), "favicon-64.png")
