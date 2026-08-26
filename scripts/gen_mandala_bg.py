"""
Генератор фоновой мандалы (public/bg/mandala.svg).

Правка №3 (светлый пастельный редизайн): раньше это был тёплый тёмный
янтарный фон со светлыми кремовыми линиями мандалы (правка №2 — контраст
светлых линий на тёмном фоне). Теперь фон сам стал светлым
бежево-белым/молочным, поэтому линии мандалы, наоборот, должны стать
ТЕМНЕЕ — тем же насыщенным золотом, что использует остальной интерфейс
(--gold из index.css), а не светлым кремовым, который на светлом фоне
был бы почти не виден.
"""

WIDTH, HEIGHT = 800, 1600
LINE = "#B8860B"  # тот же тёмный "насыщенный" золотой, что --gold в index.css
TILE = 220

# Светлый бежево-белый "молочный" градиент — те же стопы, что у --bg-top/
# --bg-mid/--bg-accent/--bg-bottom в index.css (держим синхронно вручную,
# как и раньше: это два разных представления одной палитры).
GRADIENT_STOPS = [
    (0, "#FFFBF3"),
    (35, "#FBF0DA"),
    (70, "#F5E1B8"),
    (100, "#ECCF93"),
]


def rosette(cx, cy, r, opacity_line=0.32, opacity_dot=0.45):
    """Одна розетка-мандала: кольца + лепестки + точки-акценты, всё в одном
    тоне (LINE), но с явно читаемой толщиной и непрозрачностью. Опорные
    значения непрозрачности снижены по сравнению с тёмной темой — тёмное
    золото на светлом фоне визуально "тяжелее" при той же прозрачности,
    чем светлый кремовый на тёмном, поэтому чуть приглушаем, чтобы узор
    остался "мягким пастельным", а не резким."""
    parts = [f'<g opacity="{opacity_line}">']
    ring_count = 4
    for i in range(1, ring_count + 1):
        rr = r * i / ring_count
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{rr:.1f}" fill="none" stroke="{LINE}" stroke-width="1.6" />')

    petal_count = 10
    petal_r = r * 0.78
    ry = r * 0.24
    rx = r * 0.07
    py = cy - petal_r
    step = 360 / petal_count
    for i in range(petal_count):
        angle = step * i
        parts.append(
            f'<ellipse cx="{cx}" cy="{py:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="none" '
            f'stroke="{LINE}" stroke-width="1.6" transform="rotate({angle:.1f} {cx} {cy})" />'
        )
    parts.append("</g>")

    parts.append(f'<circle cx="{cx}" cy="{cy}" r="3" fill="{LINE}" opacity="{opacity_dot}" />')
    return "".join(parts)


def build_pattern_defs() -> str:
    cx = cy = TILE / 2
    r = TILE * 0.36
    return (
        f'<pattern id="mandalaTile" x="0" y="0" width="{TILE}" height="{TILE}" '
        f'patternUnits="userSpaceOnUse">'
        f'{rosette(cx, cy, r)}'
        "</pattern>"
    )


def build_svg() -> str:
    stops = "\n".join(f'  <stop offset="{o}%" stop-color="{c}" />' for o, c in GRADIENT_STOPS)
    parts = [
        f'<svg viewBox="0 0 {WIDTH} {HEIGHT}" xmlns="http://www.w3.org/2000/svg">',
        "<defs>",
        '<linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">',
        stops,
        "</linearGradient>",
        build_pattern_defs(),
        "</defs>",
        f'<rect x="0" y="0" width="{WIDTH}" height="{HEIGHT}" fill="url(#bgGrad)" />',
        # Паттерн замощён по всей высоте — узор виден на любом участке
        # скролла/вьюпорта, не только в одной точке экрана.
        f'<rect x="0" y="0" width="{WIDTH}" height="{HEIGHT}" fill="url(#mandalaTile)" />',
    ]
    # Пара крупных акцентных медальонов поверх мелкого паттерна — для
    # композиционной иерархии (не только однородные "обои", но и пара
    # фокусных точек).
    parts.append(rosette(400, 260, 190, opacity_line=0.38, opacity_dot=0.5))
    parts.append(rosette(400, 1340, 190, opacity_line=0.3, opacity_dot=0.42))
    parts.append("</svg>")
    return "\n".join(parts)


if __name__ == "__main__":
    svg = build_svg()
    with open("public/bg/mandala.svg", "w", encoding="utf-8") as f:
        f.write(svg)
    print("public/bg/mandala.svg regenerated (light pastel bg + golden pattern)")
