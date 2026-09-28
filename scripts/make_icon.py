"""生成应用图标 icons/icon.ico（32x32，深蓝渐变圆角底 + 白色四宫格，纯手写字节，无需 PIL）"""
import struct
import os

SIZE = 32
CORNER = 7          # 圆角半径
BLOCKS = [(8, 8), (16, 8), (8, 16), (16, 16)]  # 四宫格小方块左上角
BLOCK = 6           # 小方块边长


def pixel(x, y):
    # 圆角外的四角透明
    for cx, cy in ((0, 0), (SIZE, 0), (0, SIZE), (SIZE, SIZE)):
        dx = x - (cx - CORNER) if x < CORNER else (x - (cx + CORNER) if x >= SIZE - CORNER else 0)
        dy = y - (cy - CORNER) if y < CORNER else (y - (cy + CORNER) if y >= SIZE - CORNER else 0)
        if (dx or dy) and dx * dx + dy * dy > CORNER * CORNER:
            return (0, 0, 0, 0)
    # 对角渐变：#3b82f6 -> #1d4ed8
    t = (x + y) / (2 * (SIZE - 1))
    r = round(59 + (29 - 59) * t)
    g = round(130 + (78 - 130) * t)
    b = round(246 + (216 - 246) * t)
    # 白色四宫格
    for bx, by in BLOCKS:
        if bx <= x < bx + BLOCK and by <= y < by + BLOCK:
            return (255, 255, 255, 255)
    return (b, g, r, 255)


def make_ico(path):
    pixels = bytearray()
    for y in range(SIZE - 1, -1, -1):  # BMP 自下而上
        for x in range(SIZE):
            b, g, r, a = pixel(x, y)
            pixels += struct.pack('<BBBB', b, g, r, a)
    and_mask = bytes(4 * SIZE)  # 32bpp 时 AND 掩码全 0 即可
    bmi = struct.pack('<IiiHHIIiiII', 40, SIZE, SIZE * 2, 1, 32, 0, SIZE * SIZE * 4, 0, 0, 0, 0)
    image = bmi + bytes(pixels) + and_mask
    header = struct.pack('<HHH', 0, 1, 1)
    entry = struct.pack('<BBBBHHII', SIZE, SIZE, 0, 0, 1, 32, len(image), 22)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(header + entry + image)
    print(f'written: {path} ({22 + len(image)} bytes)')


if __name__ == '__main__':
    make_ico(os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons', 'icon.ico'))
