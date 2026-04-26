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
    draw.rounded_rectangle((28, 52, 100, 112), radius=18, outline=color, width=7)
    draw.line((38, 58, 64, 34, 90, 58), fill=color, width=7, joint="curve")


def draw_schedule(draw, color):
    draw.rounded_rectangle((22, 28, 106, 108), radius=20, outline=color, width=7)
    draw.line((22, 50, 106, 50), fill=color, width=7)
    draw.line((48, 28, 48, 108), fill=color, width=7)
    draw.line((80, 28, 80, 108), fill=color, width=7)
    draw.line((22, 78, 106, 78), fill=color, width=7)


def draw_homework(draw, color):
    draw.rounded_rectangle((28, 18, 100, 114), radius=20, outline=color, width=7)
    draw.line((44, 46, 84, 46), fill=color, width=7)
    draw.line((44, 66, 84, 66), fill=color, width=7)
    draw.line((44, 86, 70, 86), fill=color, width=7)
    draw.line((34, 46, 34, 46), fill=color, width=9)
    draw.line((34, 66, 34, 66), fill=color, width=9)


def draw_notice(draw, color):
    draw.rounded_rectangle((18, 34, 110, 98), radius=20, outline=color, width=7)
    draw.line((24, 42, 64, 74, 104, 42), fill=color, width=7, joint="curve")


def nav_icon(name, painter):
    size = 128
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    painter(draw, "#5b6572")
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
