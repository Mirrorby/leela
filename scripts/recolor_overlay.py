"""
Перекраска пользовательских PNG-слоёв змей и стрел (нарисованы отдельно,
вне этого репозитория — форму/стиль не трогаем, это художественная часть
пользователя) в тона игры. Держим шагом-скриптом, а не ручной правкой в
графредакторе — один раз поправить палитру и просто перезапустить.

Теперь ДВА отдельных исходника (scripts/assets/classic-v1-snakes-source.png
и classic-v1-arrows-source.png) — значит, в отличие от объединённого файла
раньше, змей и стрелы можно красить в РАЗНЫЕ тона (раньше все непрозрачные
пиксели были чистым чёрным без различий, отличить фигуры друг от друга
было нельзя в принципе).

Оба результата кладутся отдельными файлами в public/board/ — Board.tsx
рисует их как два независимых слоя поверх чистой доски (см. GameHome.tsx:
getBoardOverlaySrc возвращает оба пути, boardCoordinates.ts).
"""
from PIL import Image, ImageFilter

# (исходник, целевой файл, цвет линии, цвет ореола)
LAYERS = [
    (
        "scripts/assets/classic-v1-snakes-source.png",
        "public/board/classic-v1-snakes.png",
        (0xB3, 0x40, 0x2B),  # тёплый терракотовый/ржавый — "опасность/падение"
        (0x3A, 0x14, 0x0C),
    ),
    (
        "scripts/assets/classic-v1-arrows-source.png",
        "public/board/classic-v1-arrows.png",
        (0xF2, 0xB4, 0x4D),  # --gold-soft — "подъём/благословение"
        (0x3A, 0x1E, 0x0C),
    ),
]

HALO_DILATE_PX = 7        # на сколько px "расширить" маску под ореол
HALO_OPACITY_SCALE = 0.75  # ореол чуть прозрачнее основной линии


def recolor(path_in: str, path_out: str, line_color, halo_color) -> None:
    src = Image.open(path_in).convert("RGBA")
    alpha = src.split()[3]

    halo_alpha = alpha.filter(ImageFilter.MaxFilter(HALO_DILATE_PX * 2 + 1))
    halo_alpha = halo_alpha.point(lambda a: int(a * HALO_OPACITY_SCALE))

    halo_layer = Image.new("RGBA", src.size, halo_color + (0,))
    halo_layer.putalpha(halo_alpha)

    main_layer = Image.new("RGBA", src.size, line_color + (0,))
    main_layer.putalpha(alpha)

    result = Image.alpha_composite(halo_layer, main_layer)
    result.save(path_out)


if __name__ == "__main__":
    for path_in, path_out, line_color, halo_color in LAYERS:
        recolor(path_in, path_out, line_color, halo_color)
        print(f"{path_out} готов (линия {line_color}, ореол {halo_color})")
