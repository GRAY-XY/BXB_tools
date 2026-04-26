import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageOps


ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(ROOT, "assets")
SOURCE_ICON = os.path.join(os.path.expanduser("~"), "Desktop", "20260424-205440.png")
APP_ICON_OUT = os.path.join(ASSETS_DIR, "app_icon_rounded.png")
APP_ICON_ICNS_OUT = os.path.join(ASSETS_DIR, "app_icon.icns")


def ensure_dir():
    os.makedirs(ASSETS_DIR, exist_ok=True)


def rounded_app_icon():
    source_path = SOURCE_ICON if os.path.exists(SOURCE_ICON) else APP_ICON_OUT
    if not os.path.exists(source_path):
        return
    size = 1024
    image = Image.open(source_path).convert("RGBA")
    image = ImageOps.fit(image, (size, size), method=Image.Resampling.LANCZOS)

    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=56, fill=255)

    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    output.paste(image, (0, 0), mask=mask)

    gloss = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    gdraw = ImageDraw.Draw(gloss)
    gdraw.rounded_rectangle((12, 12, size - 12, int(size * 0.48)), radius=46, fill=(255, 255, 255, 34))
    output = Image.alpha_composite(output, gloss)
    output.save(APP_ICON_OUT, icc_profile=None)


def macos_icns():
    if not os.path.exists(APP_ICON_OUT):
        return
    if os.name != "posix":
        return
    if not shutil.which("iconutil") or not shutil.which("sips"):
        return

    iconset_dir = os.path.join(ASSETS_DIR, "app_icon.iconset")
    if os.path.exists(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir, exist_ok=True)

    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for size in sizes:
        image = Image.open(APP_ICON_OUT).convert("RGBA")
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        filename = f"icon_{size}x{size}.png"
        resized.save(os.path.join(iconset_dir, filename), icc_profile=None)
        if size != 1024:
            retina = image.resize((size * 2, size * 2), Image.Resampling.LANCZOS)
            retina.save(os.path.join(iconset_dir, f"icon_{size}x{size}@2x.png"), icc_profile=None)

    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", APP_ICON_ICNS_OUT], check=True)
    shutil.rmtree(iconset_dir, ignore_errors=True)


def draw_home(draw, color):
    fill = "#eef4ff"
    accent = "#3d6df2"
    shadow = "#dbe7ff"
    draw.rounded_rectangle((18, 18, 110, 110), radius=34, fill=shadow)
    draw.rounded_rectangle((16, 14, 112, 110), radius=34, fill=fill)
    draw.polygon([(64, 34), (96, 62), (88, 70), (64, 48), (40, 70), (32, 62)], fill=accent)
    draw.rounded_rectangle((42, 60, 86, 94), radius=12, fill=color)
    draw.rounded_rectangle((58, 70, 70, 94), radius=6, fill=fill)


def draw_schedule(draw, color):
    fill = "#eff7f2"
    accent = "#32a067"
    shadow = "#d8ecde"
    draw.rounded_rectangle((18, 18, 110, 110), radius=34, fill=shadow)
    draw.rounded_rectangle((16, 14, 112, 110), radius=34, fill=fill)
    draw.rounded_rectangle((34, 34, 94, 90), radius=16, fill="#ffffff")
    draw.rounded_rectangle((34, 34, 94, 50), radius=14, fill=accent)
    draw.rounded_rectangle((46, 24, 54, 40), radius=4, fill=color)
    draw.rounded_rectangle((74, 24, 82, 40), radius=4, fill=color)
    for x in (46, 62, 78):
        for y in (60, 76):
            draw.rounded_rectangle((x, y, x + 8, y + 8), radius=3, fill=color)


def draw_homework(draw, color):
    fill = "#fff4e8"
    accent = "#f08a24"
    shadow = "#ffe6cc"
    draw.rounded_rectangle((18, 18, 110, 110), radius=34, fill=shadow)
    draw.rounded_rectangle((16, 14, 112, 110), radius=34, fill=fill)
    draw.rounded_rectangle((38, 28, 90, 96), radius=18, fill="#ffffff")
    draw.rounded_rectangle((50, 22, 78, 38), radius=8, fill=accent)
    for y in (50, 66, 82):
        draw.rounded_rectangle((50, y, 78, y + 6), radius=3, fill=color)
    draw.line((40, 50, 44, 54, 52, 44), fill=accent, width=5, joint="curve")
    draw.line((40, 66, 44, 70, 52, 60), fill=accent, width=5, joint="curve")


def draw_notice(draw, color):
    fill = "#f3efff"
    accent = "#7a5af8"
    shadow = "#e5dcff"
    draw.rounded_rectangle((18, 18, 110, 110), radius=34, fill=shadow)
    draw.rounded_rectangle((16, 14, 112, 110), radius=34, fill=fill)
    draw.rounded_rectangle((30, 38, 98, 86), radius=16, fill="#ffffff")
    draw.polygon([(34, 42), (64, 66), (94, 42), (94, 48), (64, 72), (34, 48)], fill=accent)
    draw.line((34, 42, 64, 68, 94, 42), fill=accent, width=5, joint="curve")
    draw.rounded_rectangle((76, 26, 94, 44), radius=9, fill=color)
    draw.ellipse((82, 32, 88, 38), fill="#ffffff")


def nav_icon(name, painter):
    size = 128
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    painter(draw, "#223042")
    image = canvas.resize((size, size), Image.Resampling.LANCZOS)
    image.save(os.path.join(ASSETS_DIR, f"nav_{name}.png"), icc_profile=None)


def main():
    ensure_dir()
    rounded_app_icon()
    try:
        macos_icns()
    except Exception:
        pass
    nav_icon("home", draw_home)
    nav_icon("schedule", draw_schedule)
    nav_icon("homework", draw_homework)
    nav_icon("notice", draw_notice)


if __name__ == "__main__":
    main()
