#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw
import qrcode


def build_qr(url: str, output: Path, style: str = "square") -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=18,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)

    image = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    if style == "heart-center":
        image = add_heart_center(image)
    elif style == "heart-frame":
        image = add_heart_frame(image)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)


def add_heart_center(image: Image.Image) -> Image.Image:
    canvas = image.copy()
    w, h = canvas.size
    size = int(min(w, h) * 0.18)
    heart = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(heart)
    red = (228, 75, 95, 255)
    left = (size * 0.22, size * 0.34)
    right = (size * 0.78, size * 0.34)
    bottom = (size * 0.5, size * 0.88)
    draw.ellipse((0, 0, size * 0.5, size * 0.52), fill=red)
    draw.ellipse((size * 0.5, 0, size, size * 0.52), fill=red)
    draw.polygon([left, right, bottom], fill=red)
    x = (w - size) // 2
    y = (h - size) // 2
    canvas = canvas.convert("RGBA")
    canvas.alpha_composite(heart, (x, y))
    return canvas.convert("RGB")


def add_heart_frame(image: Image.Image) -> Image.Image:
    canvas = image.copy().convert("RGBA")
    w, h = canvas.size
    draw = ImageDraw.Draw(canvas)
    color = (228, 75, 95, 255)
    draw.rounded_rectangle(
        (10, 10, w - 10, h - 10),
        radius=70,
        outline=color,
        width=5,
    )
    top = [
        (w * 0.5, 22),
        (w * 0.46, 12),
        (w * 0.39, 12),
        (w * 0.33, 24),
        (w * 0.5, 86),
        (w * 0.67, 24),
        (w * 0.61, 12),
        (w * 0.54, 12),
    ]
    draw.line(top, fill=color, width=4, joint="curve")
    draw.ellipse((w * 0.42, 10, w * 0.48, 36), fill=color)
    draw.ellipse((w * 0.52, 10, w * 0.58, 36), fill=color)
    return canvas.convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a scannable QR code PNG.")
    parser.add_argument(
        "--url",
        default="https://happy.lupeanu.com/",
        help="URL to encode in the QR code.",
    )
    parser.add_argument(
        "--output",
        default="assets/happy-lupeanu-qr.png",
        help="Output PNG path.",
    )
    parser.add_argument(
        "--style",
        choices=["square", "heart-center", "heart-frame"],
        default="square",
        help="Decorative treatment to apply without breaking the QR.",
    )
    args = parser.parse_args()

    build_qr(args.url, Path(args.output), args.style)


if __name__ == "__main__":
    main()
