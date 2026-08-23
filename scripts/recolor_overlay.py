"""
Перекраска пользовательского PNG-слоя змей/стрел (нарисован отдельно, вне
этого репозитория — форма/стиль оставляем как есть, полностью в их власти)
в тона игры. Держим этот шаг скриптом, а не ручной правкой в графредакторе,
чтобы можно было один раз поправить палитру и просто перезапустить.

Почему нельзя покрасить змей и стрелы в РАЗНЫЕ цвета автоматически: все
непрозрачные пиксели исходника — чистый чёрный (0,0,0), вся форма/мягкость
краёв закодирована ИСКЛЮЧИТЕЛЬНО в альфа-канале — по цвету пиксель не
отличить, змея это или стрела. Поэтому красим всё в один акцентный тон
(золото — главный акцентный цвет во всём приложении), а под ним — мягкий
тёмный тёплый ореол (расширенная альфа-маска), чтобы линии читались что на
тёмных клетках доски, что на ярких чакра-клетках.
"""
from PIL import Image, ImageFilter

SRC = "scripts/assets/classic-v1-transitions-source.png"
OUT = "public/board/classic-v1-transitions.png"

GOLD = (0xF2, 0xB4, 0x4D)       # --gold-soft — основной тон линий
HALO = (0x3A, 0x1E, 0x0C)       # тёплый тёмно-коричневый — ореол под линиями
HALO_DILATE_PX = 7              # на сколько px "расширить" маску под ореол
HALO_OPACITY_SCALE = 0.75       # ореол чуть прозрачнее основной линии


def recolor(path_in: str, path_out: str) -> None:
    src = Image.open(path_in).convert("RGBA")
    alpha = src.split()[3]

    halo_alpha = alpha.filter(ImageFilter.MaxFilter(HALO_DILATE_PX * 2 + 1))
    halo_alpha = halo_alpha.point(lambda a: int(a * HALO_OPACITY_SCALE))

    halo_layer = Image.new("RGBA", src.size, HALO + (0,))
    halo_layer.putalpha(halo_alpha)

    main_layer = Image.new("RGBA", src.size, GOLD + (0,))
    main_layer.putalpha(alpha)

    result = Image.alpha_composite(halo_layer, main_layer)
    result.save(path_out)


if __name__ == "__main__":
    recolor(SRC, OUT)
    print(f"{OUT} готов ({GOLD} + тёплый ореол {HALO})")
