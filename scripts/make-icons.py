"""生成暖色系 PWA 图标（暖可可底 + 暖砂进度环）。

沿用原图标的构图（圆角方块 + 一圈进度环），只把配色从旧的「深灰底 + 冷青环」
换成工作台当前色板：--primary 暖可可 #4a3426 / --shell 暖砂 #ecdcbf。
4 倍超采样后缩放，保证边缘平滑；不使用渐变（设计禁区）。
"""
from PIL import Image, ImageDraw

COCOA = (74, 52, 38, 255)      # --primary 暖可可
SAND = (236, 220, 191, 255)    # --shell 暖砂
TRACK = (107, 84, 66, 255)     # 环底：可可略提亮
SS = 4                          # 超采样倍数
START = -90                     # 起点在 12 点方向
SWEEP = 232                     # 已完成部分约 64%


def rounded_bg(size, radius_ratio=0.225, full_bleed=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if full_bleed:
        d.rectangle([0, 0, size, size], fill=COCOA)
    else:
        r = int(size * radius_ratio)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=COCOA)
    return img


def draw_ring(img, size, ring_ratio=0.60, stroke_ratio=0.115):
    """ring_ratio：环直径占画布比例（maskable 要更小才落在安全区）。"""
    s = size * SS
    img_big = img.resize((s, s), Image.LANCZOS)
    d = ImageDraw.Draw(img_big)
    d_ring = s * ring_ratio
    stroke = s * stroke_ratio
    box = [(s - d_ring) / 2, (s - d_ring) / 2, (s + d_ring) / 2, (s + d_ring) / 2]
    d.arc(box, START, START + 360, fill=TRACK, width=int(stroke))
    d.arc(box, START, START + SWEEP, fill=SAND, width=int(stroke))
    return img_big.resize((size, size), Image.LANCZOS)


def make(size, full_bleed=False, ring_ratio=0.60):
    base = rounded_bg(size * SS, full_bleed=full_bleed)
    img = draw_ring(base, size, ring_ratio=ring_ratio)
    return img


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
    out = os.path.abspath(out)
    make(192).save(os.path.join(out, "icon-192.png"))
    make(512).save(os.path.join(out, "icon-512.png"))
    # maskable：整幅铺底，环缩到 0.42 保证落在圆形安全区内
    make(512, full_bleed=True, ring_ratio=0.42).save(os.path.join(out, "maskable-512.png"))
    # iOS 会自己加圆角，所以铺满不留透明
    make(180, full_bleed=True).save(os.path.join(out, "apple-touch-icon.png"))
    print("icons written to", out)
