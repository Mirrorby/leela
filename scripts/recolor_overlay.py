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
        # Правка после ревью: раньше терракот был совсем тёмным и тяжёлым на
        # светлой пастельной доске ("опасность" читалась слишком мрачно).
        # Тон посветлел — тёплый коралловый терракот вместо тёмно-ржавого,
        # тот же оттенок, просто выше по светлоте.
        (0xD9, 0x78, 0x5A),  # светлый коралловый терракот
        (0x5C, 0x24, 0x15),  # ореол чуть темнее линии — держит контур на светлых клетках
    ),
    (
        "scripts/assets/classic-v1-arrows-source.png",
        "public/board/classic-v1-arrows.png",
        # Раньше тут было золото (сливалось по смыслу с общим золотом доски
        # и мандалы — стрелу было легко спутать с декором). Взяли отдельный
        # свежий оттенок — светлая бирюза/мята ("подъём/благословение"),
        # хорошо отличимый и от золота доски, и от терракотовых змей.
        (0x4F, 0xA8, 0x94),  # светлая бирюза
        (0x1B, 0x40, 0x38),  # тёмный тёкло-зелёный ореол — контур на светлых клетках
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
