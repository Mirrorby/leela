"""
Генератор фоновой мандалы (public/bg/mandala.svg).

Правка №2 (первая версия была почти не видна — золотые линии на янтарном
фоне слишком близки по тону/светлоте, контраста не хватало): теперь узор —
не редкие едва заметные медальоны, а замощённый по всей высоте паттерн
(SVG <pattern>, повторяется как обои), линии светлые кремовые (не золотые)
и заметно контрастнее/толще, чтобы рисунок действительно читался на фоне,
а не только теоретически присутствовал в файле.
"""

WIDTH, HEIGHT = 800, 1600
LINE = "#FBE8CE"  # кремовый — контрастнее золота на тёплом янтарном фоне
TILE = 220

# Светлее и теплее прежней тёмно-коричневой версии.
GRADIENT_STOPS = [
    (0, "#6E3A17"),
    (35, "#A85420"),
    (70, "#D97A2E"),
    (100, "#EBA656"),
]


def rosette(cx, cy, r, opacity_line=0.42, opacity_dot=0.55):
    """Одна розетка-мандала: кольца + лепестки + точки-акценты, всё в одном
    тоне (LINE), но с явно читаемой толщиной и непрозрачностью."""
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
    parts.append(rosette(400, 260, 190, opacity_line=0.5, opacity_dot=0.6))
    parts.append(rosette(400, 1340, 190, opacity_line=0.4, opacity_dot=0.5))
    parts.append("</svg>")
    return "\n".join(parts)


if __name__ == "__main__":
    svg = build_svg()
    with open("public/bg/mandala.svg", "w", encoding="utf-8") as f:
        f.write(svg)
    print("public/bg/mandala.svg regenerated (tiled pattern + 2 accent medallions)")
