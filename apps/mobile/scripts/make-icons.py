#!/usr/bin/env python3
"""生成 Android 启动图标（ADR-0027）。

网页那三张 PNG（`apps/web/static/icons/`）是 Pillow 画的同一套几何：径向渐变
`#17714f -> #0d4432 -> #072b1f`、金色圆环、环里一个金色的「60」。这里按 Android
的 densities 重画，尺寸与留白按各自规则走：

- `ic_launcher[_round].png`：满铺的方图（圆图额外裁成圆），与 maskable 那张同形；
- `ic_launcher_foreground.png`：**透明**前景层，内容缩进到 108dp 画布中央的
  66dp 安全圆里 —— 自适应图标会被启动器裁成圆形/方圆/水滴，超出安全区就被切掉。
  背景层是 `res/values/ic_launcher_background.xml` 里的纯色 `#0d4432`。

只在改图标时手工跑一次（不在 CI 里，CI 不需要 Pillow）：

    python apps/mobile/scripts/make-icons.py

4× 超采样后 LANCZOS 缩小，避免细环出现锯齿。
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
RES = HERE.parent / "android" / "app" / "src" / "main" / "res"

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}

# 语义色与 Web 侧一致（manifest.theme_color / background_color / 金色按钮）
GREEN_INNER = (0x17, 0x71, 0x4F)
GREEN_MID = (0x0D, 0x44, 0x32)
GREEN_OUTER = (0x07, 0x2B, 0x1F)
GOLD = (0xC8, 0xA2, 0x4A)

# 满铺方图：圆环外径占画布 0.38，环宽 0.035，字高 0.39（与 maskable 那张同比例）
RING_RADIUS = 0.190
RING_WIDTH = 0.018
TEXT_HEIGHT = 0.196

# 自适应前景：内容必须落在中央 66/108 的安全圆内，这里取 0.60 的安全边界，
# 于是圆环外径 = 0.60 * (66/108) ≈ 0.367 画布 —— 比满铺那张略小，裁切后仍宽松
FOREGROUND_SCALE = 0.60 * (66.0 / 108.0) / 0.38

SUPERSAMPLE = 4


def _font(size_px: int) -> ImageFont.FreeTypeFont:
    """找一个能画出「60」的粗体：先 Windows 常见的，再退到 Pillow 自带的。"""
    for name in ("arialbd.ttf", "seguisb.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size_px)
        except OSError:
            continue
    return ImageFont.load_default(size_px)


def _gradient_tile(res: int = 256) -> Image.Image:
    """从左上偏中的光源向外衰减的三段径向渐变（与 Web 图标同一支色阶）。

    只在 256² 上逐像素算一次，再放大用：纯 Python 的逐像素循环在 4× 超采样的
    1200×1900 画布上要几十秒一张，而渐变本身足够平滑，放大看不出差别。
    """
    img = Image.new("RGB", (res, res))
    pixels = img.load()
    cx, cy = res * 0.42, res * 0.38
    far = math.hypot(max(cx, res - cx), max(cy, res - cy))
    for y in range(res):
        for x in range(res):
            t = min(1.0, math.hypot(x - cx, y - cy) / far)
            if t < 0.55:
                k = t / 0.55
                a, b = GREEN_INNER, GREEN_MID
            else:
                k = (t - 0.55) / 0.45
                a, b = GREEN_MID, GREEN_OUTER
            pixels[x, y] = (
                round(a[0] + (b[0] - a[0]) * k),
                round(a[1] + (b[1] - a[1]) * k),
                round(a[2] + (b[2] - a[2]) * k),
            )
    return img


def _radial_gradient(width: int, height: int) -> Image.Image:
    return _gradient_tile().resize((width, height), Image.LANCZOS)


def _draw_mark(draw: ImageDraw.ImageDraw, size: int, scale: float) -> None:
    """圆环 + 居中的「60」。scale 缩放整套几何，供前景层缩进安全区用。"""
    cx = cy = size / 2
    radius = size * RING_RADIUS * scale
    width = max(1, round(size * RING_WIDTH * scale))
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        outline=(*GOLD, 120),
        width=width,
    )

    font_size = round(size * TEXT_HEIGHT * scale)
    font = _font(font_size)
    text = "60"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(
        (cx - (right + left) / 2, cy - (bottom + top) / 2),
        text,
        font=font,
        fill=GOLD,
    )


def legacy_icon(size: int, circular: bool = False) -> Image.Image:
    big = size * SUPERSAMPLE
    base = _radial_gradient(big, big).convert("RGBA")
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    _draw_mark(ImageDraw.Draw(layer), big, 1.0)
    base.alpha_composite(layer)

    if circular:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, big - 1, big - 1], fill=255)
        base.putalpha(mask)
    else:
        # 方形图标给一点圆角，桌面上不至于是一个硬角方块
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=round(big * 0.219), fill=255
        )
        base.putalpha(mask)

    return base.resize((size, size), Image.LANCZOS)


def foreground(size: int) -> Image.Image:
    big = size * SUPERSAMPLE
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    _draw_mark(ImageDraw.Draw(layer), big, FOREGROUND_SCALE)
    return layer.resize((size, size), Image.LANCZOS)


# 模板自带的启动图是 Capacitor 的 logo 压在白色上；尺寸沿用 Android 各密度/朝向的既有规格
SPLASHES = {
    "drawable/splash.png": (480, 800),
    "drawable-port-mdpi/splash.png": (320, 480),
    "drawable-port-hdpi/splash.png": (480, 800),
    "drawable-port-xhdpi/splash.png": (720, 1280),
    "drawable-port-xxhdpi/splash.png": (960, 1600),
    "drawable-port-xxxhdpi/splash.png": (1280, 1920),
    "drawable-land-mdpi/splash.png": (480, 320),
    "drawable-land-hdpi/splash.png": (800, 480),
    "drawable-land-xhdpi/splash.png": (1280, 720),
    "drawable-land-xxhdpi/splash.png": (1600, 960),
    "drawable-land-xxxhdpi/splash.png": (1920, 1280),
}


def splash(width: int, height: int) -> Image.Image:
    """整幅渐变 + 居中的圆环与「60」。标记按短边取尺度，横屏也不至于半个屏幕。

    启动图直接按目标尺寸画：它只有一块渐变加两个大图形，没有细环那种锯齿问题，
    4× 超采样在这里只是把 1900×1280 的画布变成 3900 万像素的负担。
    """
    base = _radial_gradient(width, height).convert("RGBA")
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    mark = min(width, height)
    cx, cy = width / 2, height / 2
    radius = mark * 0.31
    width_px = max(1, round(mark * 0.018))
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=(*GOLD, 120), width=width_px)
    font = _font(round(mark * 0.28))
    left, top, right, bottom = draw.textbbox((0, 0), "60", font=font)
    draw.text((cx - (right + left) / 2, cy - (bottom + top) / 2), "60", font=font, fill=GOLD)
    base.alpha_composite(layer)
    return base.convert("RGB")


def main() -> None:
    for name, factor in DENSITIES.items():
        out = RES / f"mipmap-{name}"
        out.mkdir(parents=True, exist_ok=True)

        legacy_icon(round(48 * factor)).save(out / "ic_launcher.png")
        legacy_icon(round(48 * factor), circular=True).save(out / "ic_launcher_round.png")
        foreground(round(108 * factor)).save(out / "ic_launcher_foreground.png")
        print(f"{out.name}: {round(48 * factor)}px 图标 + {round(108 * factor)}px 前景")

    for rel, (width, height) in SPLASHES.items():
        out = RES / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        splash(width, height).save(out, optimize=True)
        print(f"{rel}: {width}x{height} 启动图")


if __name__ == "__main__":
    main()
