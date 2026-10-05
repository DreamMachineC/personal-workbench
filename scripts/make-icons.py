"""生成 PWA 图标（蓝底圆角方块 +「工」字）。

配色取自工作台当前色板：--primary #409eff（全站唯一强调色），字为纯白。
构图刻意做得简单：一个圆角方块加一个字，缩到 16px 也认得出。
4 倍超采样后缩放，保证边缘平滑；不使用渐变（设计禁区）。

用法：python3 scripts/make-icons.py
（macOS 的 .icns 另需 iconset + `iconutil -c icns`，不走这个脚本。）
"""
from PIL import Image, ImageDraw, ImageFont

PRIMARY = (64, 158, 255, 255)   # --primary #409eff
WHITE = (255, 255, 255, 255)    # 方块上的字
SS = 4                          # 超采样倍数
RADIUS = 0.22                   # 圆角占边长比例

# macOS 上 PingFang.ttc 常常读不到，Hiragino Sans GB 是稳定的中文形来源
FONT_CANDIDATES = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("/Library/Fonts/Arial Unicode.ttf", 0),
]


def load_font(px):
    for path, idx in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, px, index=idx)
        except Exception:
            continue
    return ImageFont.load_default()


def make(size, glyph_ratio=0.56):
    """glyph_ratio：字高占画布比例。maskable 要更小才落在圆形安全区内。"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * RADIUS), fill=PRIMARY)
    f = load_font(max(8, int(s * glyph_ratio)))
    bbox = d.textbbox((0, 0), "工", font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((s - w) / 2 - bbox[0], (s - h) / 2 - bbox[1]), "工", font=f, fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    import os

    out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "icons"))
    make(192).save(os.path.join(out, "icon-192.png"))
    make(512).save(os.path.join(out, "icon-512.png"))
    # maskable：字缩到 0.46，保证落在系统裁出的圆形安全区内
    make(512, glyph_ratio=0.46).save(os.path.join(out, "maskable-512.png"))
    # iOS 自己会加圆角，所以铺满不留透明
    make(180).save(os.path.join(out, "apple-touch-icon.png"))
    print("icons written to", out)
