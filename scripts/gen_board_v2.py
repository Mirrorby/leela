"""
Генератор доски «Лила» classic-v1: 9 колонок x 8 рядов (редизайн этапа 7,
п.3-6). Питоновский скрипт держим в репозитории (scripts/) как и просили —
"регенерация через Python-скрипты", а не руками правим сгенерированный SVG.

Что делает:
  - считает координаты всех 72 клеток (боустрофедон, старт левый нижний
    угол, как в классической "змеях и лестницах") и пишет их в
    src/data/board/classic-v1-coordinates.json;
  - рисует public/board/classic-v1-board.svg: тёплая янтарно-оранжевая
    палитра, центральная колонка клеток 5-14-23-32-41-50-59-68 подсвечена
    цветами чакр снизу вверх, 10 змей + 10 стрел — реальные переходы,
    снятые с физической доски пользователя (REAL_SNAKES/REAL_ARROWS ниже),
    нарисованы минималистичными силуэтами (голова/глаза/язык у змеи,
    наконечник/оперение у стрелы), а не просто линиями.
"""
import json
import math

RULESET_ID = "classic-v1"
COLS = 9
ROWS = 8
CELL = 80          # шаг сетки
TILE = 70           # видимый размер плашки (внутри шага сетки)
MARGIN = 48
WIDTH = COLS * CELL + MARGIN * 2
HEIGHT = ROWS * CELL + MARGIN * 2

# Клетки "духовного столбца" (п.3-4 задания): ровно середина 9 колонок,
# индекс колонки 4 (0-based) = 5-я колонка. Цвета чакр снизу вверх.
CHAKRA_CELLS = [5, 14, 23, 32, 41, 50, 59, 68]
CHAKRA_COLORS = [
    "#D64545",  # 1. Муладхара — красный
    "#F2711F",  # 2. Свадхистхана — оранжевый
    "#F0C419",  # 3. Манипура — жёлтый
    "#3FA34D",  # 4. Анахата — зелёный
    "#3A8FD9",  # 5. Вишудха — синий
    "#4B4FC4",  # 6. Аджна — индиго
    "#8E4FD1",  # 7. Сахасрара — фиолетовый
    "#F7D774",  # 8. Клетка 68 — финиш/золото
]

GOLD = "#F2B44D"
GOLD_DIM = "#E8A23D"
DARK_TEXT = "#2B1608"

# Реальные переходы — сняты с физической доски пользователя (не рефересная
# картинка чужого приложения). Тот же список, что и в
# src/data/rulesets/classic-v1.json (transitions.snakes/arrows) — держим их
# синхронно вручную, т.к. это два разных представления одних и тех же
# данных (игровая логика и картинка).
REAL_SNAKES = [
    (12, 8), (16, 4), (24, 7), (29, 6), (44, 9),
    (52, 35), (55, 3), (61, 13), (63, 2), (72, 51),
]
REAL_ARROWS = [
    (10, 23), (17, 69), (20, 32), (22, 60), (27, 41),
    (28, 50), (37, 66), (45, 67), (46, 62), (54, 68),
]


def cubic_bezier(p0, c1, c2, p3, t):
    mt = 1 - t
    x = mt**3 * p0[0] + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * p3[0]
    y = mt**3 * p0[1] + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * p3[1]
    return x, y


def cell_xy(cell_id: int):
    """Боустрофедон: клетка 1 — левый нижний угол, дальше змейкой вверх.
    Чётные (от низа) ряды идут слева направо, нечётные — справа налево —
    именно эта раскладка на 9x8 даёт центральную колонку 5-14-23-...-68."""
    idx = cell_id - 1
    row_from_bottom = idx // COLS
    pos_in_row = idx % COLS
    if row_from_bottom % 2 == 0:
        col = pos_in_row
    else:
        col = COLS - 1 - pos_in_row
    x = MARGIN + CELL / 2 + col * CELL
    y = HEIGHT - MARGIN - CELL / 2 - row_from_bottom * CELL
    return x, y


COORDS = {cid: cell_xy(cid) for cid in range(1, 73)}


def row_base_fill(cell_id: int) -> str:
    """Базовая заливка обычной (не чакра) клетки — интерполяция от тёмного
    амбера внизу доски к более светлому апельсиновому оттенку наверху,
    чтобы вся сетка тоже читалась как единый тёплый градиент."""
    _, y = COORDS[cell_id]
    row_from_bottom = round((HEIGHT - MARGIN - CELL / 2 - y) / CELL)
    t = row_from_bottom / (ROWS - 1)
    c0 = (0x35, 0x1C, 0x0B)  # низ — тёмный амбер-коричневый
    c1 = (0x8A, 0x3F, 0x14)  # верх — тёплый апельсиновый коричневый
    r = round(c0[0] + (c1[0] - c0[0]) * t)
    g = round(c0[1] + (c1[1] - c0[1]) * t)
    b = round(c0[2] + (c1[2] - c0[2]) * t)
    return f"#{r:02X}{g:02X}{b:02X}"


def petal_ring(cx, cy, rx, ry, count, opacity, stroke_width, color=GOLD):
    step = 360 / count
    parts = []
    for i in range(count):
        angle = step * i
        d = f"M{cx},{cy} C{cx-rx*0.72:.2f},{cy-ry*0.5:.2f} {cx-rx*0.16:.2f},{cy-ry:.2f} {cx},{cy-ry*1.1:.2f} C{cx+rx*0.16:.2f},{cy-ry:.2f} {cx+rx*0.72:.2f},{cy-ry*0.5:.2f} {cx},{cy} Z"
        parts.append(
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{stroke_width}" '
            f'transform="rotate({angle:.1f} {cx} {cy})" />'
        )
    return f'<g opacity="{opacity}">{"".join(parts)}</g>'


def snake_path(x1, y1, x2, y2, color, dark_color):
    """Минималистичный силуэт змеи: S-образное тело, сужающееся от головы
    (у клетки-источника, x1,y1) к хвосту (у клетки-назначения, x2,y2), с
    маленькой треугольной головой, двумя точками-глазами и раздвоенным
    язычком. Тонкая декоративная линия, не объёмное существо (п.6)."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    # Амплитуда волны растёт вместе с длиной перехода, но не безгранично.
    amp = min(22, max(12, length * 0.14))

    # Инсеты — не залезаем на цифры клеток на обоих концах.
    inset = 15
    p0 = (x1 + ux * inset, y1 + uy * inset)
    p3 = (x2 - ux * inset, y2 - uy * inset)
    dx3, dy3 = p3[0] - p0[0], p3[1] - p0[1]
    c1 = (p0[0] + dx3 * 0.33 + nx * amp, p0[1] + dy3 * 0.33 + ny * amp)
    c2 = (p0[0] + dx3 * 0.66 - nx * amp, p0[1] + dy3 * 0.66 - ny * amp)

    # Тело рисуем сегментами с убывающей толщиной — эффект сужения к хвосту.
    n = 14
    pts = [cubic_bezier(p0, c1, c2, p3, i / n) for i in range(n + 1)]
    segs = []
    for i in range(n):
        w = 5.2 - (5.2 - 1.4) * (i / (n - 1))
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        segs.append(
            f'<line x1="{ax:.1f}" y1="{ay:.1f}" x2="{bx:.1f}" y2="{by:.1f}" '
            f'stroke="{color}" stroke-width="{w:.2f}" stroke-linecap="round" />'
        )

    # Голова у точки p0 (клетка-источник), развёрнута по касательной кривой.
    hx, hy = pts[0]
    hx2, hy2 = pts[1]
    hux, huy = hx - hx2, hy - hy2
    hlen = math.hypot(hux, huy) or 1
    hux, huy = hux / hlen, huy / hlen
    hpx, hpy = -huy, hux
    head_len, head_w = 11, 6.5
    tip = (hx + hux * head_len * 0.5, hy + huy * head_len * 0.5)
    base_l = (hx - hux * head_len * 0.5 + hpx * head_w, hy - huy * head_len * 0.5 + hpy * head_w)
    base_r = (hx - hux * head_len * 0.5 - hpx * head_w, hy - huy * head_len * 0.5 - hpy * head_w)
    eye_l = (hx - hux * 1 + hpx * 2.6, hy - huy * 1 + hpy * 2.6)
    eye_r = (hx - hux * 1 - hpx * 2.6, hy - huy * 1 - hpy * 2.6)
    tongue_base = (tip[0] + hux * 1.5, tip[1] + huy * 1.5)
    tongue_l = (tongue_base[0] + hux * 6 + hpx * 3, tongue_base[1] + huy * 6 + hpy * 3)
    tongue_r = (tongue_base[0] + hux * 6 - hpx * 3, tongue_base[1] + huy * 6 - hpy * 3)

    head = (
        f'<polygon points="{tip[0]:.1f},{tip[1]:.1f} {base_l[0]:.1f},{base_l[1]:.1f} '
        f'{base_r[0]:.1f},{base_r[1]:.1f}" fill="{color}" />'
        f'<circle cx="{eye_l[0]:.1f}" cy="{eye_l[1]:.1f}" r="0.9" fill="{dark_color}" />'
        f'<circle cx="{eye_r[0]:.1f}" cy="{eye_r[1]:.1f}" r="0.9" fill="{dark_color}" />'
        f'<line x1="{tongue_base[0]:.1f}" y1="{tongue_base[1]:.1f}" x2="{tongue_l[0]:.1f}" y2="{tongue_l[1]:.1f}" '
        f'stroke="{color}" stroke-width="0.9" stroke-linecap="round" />'
        f'<line x1="{tongue_base[0]:.1f}" y1="{tongue_base[1]:.1f}" x2="{tongue_r[0]:.1f}" y2="{tongue_r[1]:.1f}" '
        f'stroke="{color}" stroke-width="0.9" stroke-linecap="round" />'
    )

    return f'<g opacity="0.92">{"".join(segs)}{head}</g>'


def arrow_path(x1, y1, x2, y2, color, color_dark):
    """Силуэт стрелы: строго прямое древко (настоящая лучная стрела летит
    по прямой — никакой дуги), гранёный наконечник-ромб у клетки-назначения
    и оперение из трёх пёрышек у клетки-источника."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    px, py = -uy, ux

    inset = 16
    p0 = (x1 + ux * inset, y1 + uy * inset)
    p1 = (x2 - ux * inset, y2 - uy * inset)

    head_len, head_w = 15, 5.5
    tip = (p1[0] + ux * head_len * 0.5, p1[1] + uy * head_len * 0.5)
    head_back = (p1[0] - ux * head_len * 0.5, p1[1] - uy * head_len * 0.5)
    hbase_l = (head_back[0] + px * head_w, head_back[1] + py * head_w)
    hbase_r = (head_back[0] - px * head_w, head_back[1] - py * head_w)
    # Ромбовидный (гранёный) наконечник — не просто треугольник: у него
    # есть "плечи" чуть шире середины древка, ближе к настоящему лучному.
    shaft_w = 2.6
    should_l = (head_back[0] + px * shaft_w, head_back[1] + py * shaft_w)
    should_r = (head_back[0] - px * shaft_w, head_back[1] - py * shaft_w)
    head = (
        f'<polygon points="{tip[0]:.1f},{tip[1]:.1f} {hbase_l[0]:.1f},{hbase_l[1]:.1f} '
        f'{should_l[0]:.1f},{should_l[1]:.1f} {should_r[0]:.1f},{should_r[1]:.1f} '
        f'{hbase_r[0]:.1f},{hbase_r[1]:.1f}" fill="{color}" stroke="{color_dark}" stroke-width="0.6" />'
    )

    # Древко — прямая линия от p0 до точки, где начинается наконечник.
    shaft_mid = ((should_l[0] + should_r[0]) / 2, (should_l[1] + should_r[1]) / 2)
    shaft = (
        f'<line x1="{p0[0]:.1f}" y1="{p0[1]:.1f}" x2="{shaft_mid[0]:.1f}" y2="{shaft_mid[1]:.1f}" '
        f'stroke="{color}" stroke-width="{shaft_w:.1f}" stroke-linecap="butt" />'
    )

    # Оперение у p0 (клетка-источник): три пёрышка веером, как у настоящей стрелы.
    feather_len, feather_w = 11, 5
    fbase = (p0[0] - ux * 1, p0[1] - uy * 1)

    def feather(offset_scale, spread):
        side = (fbase[0] + px * offset_scale, fbase[1] + py * offset_scale)
        tip_f = (side[0] - ux * feather_len + px * spread, side[1] - uy * feather_len + py * spread)
        mid = (
            side[0] - ux * feather_len * 0.5 + px * (spread * 0.5 + feather_w * (1 if spread >= 0 else -1)),
            side[1] - uy * feather_len * 0.5 + py * (spread * 0.5 + feather_w * (1 if spread >= 0 else -1)),
        )
        return (
            f'<path d="M{side[0]:.1f},{side[1]:.1f} Q{mid[0]:.1f},{mid[1]:.1f} {tip_f[0]:.1f},{tip_f[1]:.1f} '
            f'L{side[0]:.1f},{side[1]:.1f} Z" fill="{color}" opacity="0.95" />'
        )

    fletching = feather(2.4, 5) + feather(-2.4, -5) + feather(0, 0)

    return f'<g opacity="0.95">{fletching}{shaft}{head}</g>'


def build_svg() -> str:
    parts = [
        f'<svg viewBox="0 0 {WIDTH} {HEIGHT}" xmlns="http://www.w3.org/2000/svg" '
        f'font-family="\'Segoe UI\', system-ui, sans-serif">',
        "<defs>",
        '<radialGradient id="cellGlow" cx="50%" cy="50%" r="60%">',
        f'  <stop offset="0%" stop-color="{GOLD}" stop-opacity="0.3" />',
        f'  <stop offset="100%" stop-color="{GOLD}" stop-opacity="0" />',
        "</radialGradient>",
        '<linearGradient id="chakraColumnGlow" x1="0" y1="0" x2="0" y2="1">',
        f'  <stop offset="0%" stop-color="{CHAKRA_COLORS[-1]}" stop-opacity="0.22" />',
        f'  <stop offset="100%" stop-color="{CHAKRA_COLORS[0]}" stop-opacity="0.22" />',
        "</linearGradient>",
        "</defs>",
    ]

    # Мягкое сияние на всю высоту центральной колонки — визуально связывает
    # 8 чакра-клеток в единый "столбец" (п.4), не превращая доску в
    # иллюстрацию (сама заливка тонкая, клетки остаются "таблетками").
    col5_x, _ = COORDS[CHAKRA_CELLS[0]]
    parts.append(
        f'<rect x="{col5_x - TILE/2 - 6:.1f}" y="{MARGIN - 6}" width="{TILE + 12}" '
        f'height="{HEIGHT - MARGIN*2 + 12}" rx="20" fill="url(#chakraColumnGlow)" />'
    )

    # Плашки клеток (сначала все прямоугольники — без цифр, чтобы змеи/
    # стрелы легли поверх фона, но НЕ поверх текста; цифры рисуем отдельным
    # проходом в самом конце, см. ниже).
    cell_meta = {}
    for cid in range(1, 73):
        x, y = COORDS[cid]
        if cid in CHAKRA_CELLS:
            fill = CHAKRA_COLORS[CHAKRA_CELLS.index(cid)]
            fill_opacity = 0.88
            text_color = DARK_TEXT
            text_opacity = 0.88
        else:
            fill = row_base_fill(cid)
            fill_opacity = 0.82
            text_color = GOLD_DIM
            text_opacity = 0.78
        cell_meta[cid] = (text_color, text_opacity)
        rx, ry = x - TILE / 2, y - TILE / 2
        parts.append(
            f'<rect x="{rx:.1f}" y="{ry:.1f}" width="{TILE}" height="{TILE}" rx="14" '
            f'fill="{fill}" fill-opacity="{fill_opacity}" stroke="{GOLD}" '
            f'stroke-opacity="0.35" stroke-width="1.2" />'
        )

    # Пунктирный путь через центры клеток по порядку 1..72 — визуализирует
    # маршрут фишки (как и в исходной доске).
    points = " ".join(f"{COORDS[c][0]:.1f},{COORDS[c][1]:.1f}" for c in range(1, 73))
    parts.append(
        f'<polyline points="{points}" fill="none" stroke="{GOLD}" stroke-width="1.2" '
        f'stroke-opacity="0.2" stroke-dasharray="2 7" stroke-linecap="round" />'
    )

    # Змеи и стрелы — реальные переходы с физической доски (см.
    # REAL_SNAKES/REAL_ARROWS выше и src/data/rulesets/classic-v1.json).
    # Рисуем ДО цифр клеток, чтобы номера оставались читаемыми поверх них.
    for frm, to in REAL_SNAKES:
        x1, y1 = COORDS[frm]
        x2, y2 = COORDS[to]
        parts.append(f'<!-- snake {frm} -> {to} -->')
        parts.append(snake_path(x1, y1, x2, y2, "#B3402B", "#2B1608"))
    for frm, to in REAL_ARROWS:
        x1, y1 = COORDS[frm]
        x2, y2 = COORDS[to]
        parts.append(f'<!-- arrow {frm} -> {to} -->')
        parts.append(arrow_path(x1, y1, x2, y2, "#4E8B57", "#274A2C"))

    # Цифры клеток — последним проходом, поверх заливки И поверх черновых
    # змей/стрел, чтобы номер клетки был читаем всегда.
    for cid in range(1, 73):
        x, y = COORDS[cid]
        text_color, text_opacity = cell_meta[cid]
        parts.append(
            f'<text x="{x:.1f}" y="{y+5:.1f}" font-size="15" font-weight="600" '
            f'fill="{text_color}" fill-opacity="{text_opacity}" text-anchor="middle">{cid}</text>'
        )

    # Декор клетки рождения (1) — маленький лепестковый венок.
    x1, y1 = COORDS[1]
    parts.append(petal_ring(x1, y1, 9, 34, 16, 0.5, 1.2, GOLD))

    # Декор клетки финиша (68, вершина духовного столбца) — двойной лотос
    # покрупнее, золотой.
    x68, y68 = COORDS[68]
    parts.append(petal_ring(x68, y68, 26, 30, 10, 0.7, 1.6, "#FBE8CE"))
    parts.append(petal_ring(x68, y68, 14, 17, 8, 0.85, 1.4, "#FBE8CE"))

    parts.append("</svg>")
    return "\n".join(parts)


def build_coordinates_json() -> dict:
    return {
        "rulesetId": RULESET_ID,
        "viewBox": f"0 0 {WIDTH} {HEIGHT}",
        "cells": [
            {"cellId": cid, "x": round(COORDS[cid][0], 1), "y": round(COORDS[cid][1], 1)}
            for cid in range(1, 73)
        ],
    }


if __name__ == "__main__":
    svg = build_svg()
    with open("public/board/classic-v1-board.svg", "w", encoding="utf-8") as f:
        f.write(svg)

    coords = build_coordinates_json()
    with open("src/data/board/classic-v1-coordinates.json", "w", encoding="utf-8") as f:
        json.dump(coords, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"viewBox: 0 0 {WIDTH} {HEIGHT}")
    print("chakra column cells:", CHAKRA_CELLS, "all at x =", COORDS[5][0])
