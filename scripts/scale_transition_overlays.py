"""
Оверлеи змей и стрел на доске (public/board/classic-v1-snakes.png,
classic-v1-arrows.png).

ВАЖНО — как это на самом деле устроено (важно не наступить на грабли
снова): исходники scripts/assets/classic-v1-snakes-source-2x.png и
classic-v1-arrows-source-2x.png — это НЕ россыпь произвольных декоративных
змей/стрел. Пользователь вручную разместил каждую фигуру под каждый
конкретный переход (from -> to) на макете доски, увеличенном РОВНО в 2
раза (1632×1472 = 816×736 * 2). То есть корректное совмещение с
координатами клеток (src/data/board/classic-v1-coordinates.json) уже
"зашито" в сам файл — никакого дополнительного поворота/масштабирования/
позиционирования по клеткам не требуется, только простой resize 0.5x.

(Отдельная неудачная попытка была раньше — вырезать из листа отдельные
фигуры и раскладывать их по переходам заново через PCA/поворот/масштаб;
она давала хуже результат, чем то, что уже было готово в самом исходнике,
и удалена.)

Если пользователь пришлёт новую версию исходников — они должны быть
ТОЧНО 2x от размера доски (1632×1472 для текущей classic-v1, 816×736*2).
Если размер другой, до пересчёта здесь ничего не трогать — сначала
уточнить, во сколько раз увеличен макет.
"""

from PIL import Image

BOARD_W, BOARD_H = 816, 736

LAYERS = [
    ("scripts/assets/classic-v1-snakes-source-2x.png", "public/board/classic-v1-snakes.png"),
    ("scripts/assets/classic-v1-arrows-source-2x.png", "public/board/classic-v1-arrows.png"),
]


def main():
    for src, dst in LAYERS:
        im = Image.open(src).convert("RGBA")
        if im.size != (BOARD_W * 2, BOARD_H * 2):
            print(f"ВНИМАНИЕ: {src} имеет размер {im.size}, ожидался {(BOARD_W * 2, BOARD_H * 2)} (2x доски).")
            print("  Пропущено — проверьте вручную масштаб перед пересчётом.")
            continue
        resized = im.resize((BOARD_W, BOARD_H), Image.LANCZOS)
        resized.save(dst)
        print(f"{dst} готов (0.5x от {src})")


if __name__ == "__main__":
    main()
