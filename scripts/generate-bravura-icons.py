#!/usr/bin/env python3
"""Extract the exact bundled engraving font into synchronous SVG icon exports.

This is an offline maintenance tool, not part of the application or its build.
The checked-in TypeScript needs no font, canvas, parser, or generator at runtime.

Reproduce with Python 3 and temporary dependencies (no package.json changes):
    python3 -m venv /tmp/music-notes-bravura-tools
    /tmp/music-notes-bravura-tools/bin/pip install fonttools==4.59.2 brotli==1.1.0
    /tmp/music-notes-bravura-tools/bin/python scripts/generate-bravura-icons.py

Use --check to verify both source provenance and byte-for-byte generated output.
The source font is Bravura 1.392, supplied by the app's pinned VexFlow 5.0.0.
Its copyright and SIL OFL 1.1 license are in THIRD_PARTY_NOTICES.md.
"""

from __future__ import annotations

import argparse
import base64
from decimal import Decimal
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parent.parent
VEXFLOW_VERSION = "5.0.0"
FONT_VERSION = "Version 1.392"
FONT_SHA256 = "5c25278c208ca455dc7c3c0c95d833e134aca6d740a023767af50d0dfa06ef82"
BOX_SIZE = 24
INK_LIMIT = 20
NOMINAL_FONT_SIZE = 40
COORDINATE_PRECISION = 4

# This maintenance-only source inventory preserves the previous curated SMuFL
# mappings. Every entry is checked against VexFlow's Glyphs table before output.
GLYPHS = (
    ("noteDoubleWhole", 0xE1D0),
    ("noteWhole", 0xE1D2),
    ("noteHalfUp", 0xE1D3),
    ("noteQuarterUp", 0xE1D5),
    ("note8thUp", 0xE1D7),
    ("note16thUp", 0xE1D9),
    ("note32ndUp", 0xE1DB),
    ("note64thUp", 0xE1DD),
    ("note128thUp", 0xE1DF),
    ("restDoubleWhole", 0xE4E2),
    ("restWhole", 0xE4E3),
    ("restHalf", 0xE4E4),
    ("restQuarter", 0xE4E5),
    ("rest8th", 0xE4E6),
    ("rest16th", 0xE4E7),
    ("rest32nd", 0xE4E8),
    ("rest64th", 0xE4E9),
    ("rest128th", 0xE4EA),
    ("restDoubleWholeLegerLine", 0xE4F3),
    ("restWholeLegerLine", 0xE4F4),
    ("restHalfLegerLine", 0xE4F5),
    ("accidentalDoubleFlat", 0xE264),
    ("accidentalThreeQuarterTonesFlatZimmermann", 0xE281),
    ("accidentalFlat", 0xE260),
    ("accidentalQuarterToneFlatStein", 0xE280),
    ("accidentalNatural", 0xE261),
    ("accidentalQuarterToneSharpStein", 0xE282),
    ("accidentalSharp", 0xE262),
    ("accidentalThreeQuarterTonesSharpStein", 0xE283),
    ("accidentalDoubleSharp", 0xE263),
    ("gClef", 0xE050),
    ("fClef", 0xE062),
    ("cClef", 0xE05C),
    ("articAccentAbove", 0xE4A0),
    ("articAccentBelow", 0xE4A1),
    ("articStaccatoAbove", 0xE4A2),
    ("articStaccatoBelow", 0xE4A3),
    ("articTenutoAbove", 0xE4A4),
    ("articTenutoBelow", 0xE4A5),
    ("articStaccatissimoAbove", 0xE4A6),
    ("articStaccatissimoBelow", 0xE4A7),
    ("articMarcatoAbove", 0xE4AC),
    ("articMarcatoBelow", 0xE4AD),
    ("fermataAbove", 0xE4C0),
    ("fermataBelow", 0xE4C1),
    ("ornamentTrill", 0xE566),
    ("ornamentTurn", 0xE567),
    ("ornamentTurnInverted", 0xE568),
    ("ornamentShortTrill", 0xE56C),
    ("ornamentMordent", 0xE56D),
    ("noteheadSlashHorizontalEnds", 0xE101),
    ("noteheadSlashWhiteWhole", 0xE102),
    ("noteheadSlashWhiteHalf", 0xE103),
    ("noteheadSlashWhiteDoubleWhole", 0xE10A),
    ("noteheadBlack", 0xE0A4),
    ("augmentationDot", 0xE1E7),
    ("dynamicForte", 0xE522),
    ("barlineSingle", 0xE030),
    ("tuplet3", 0xE883),
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def number(value: float) -> str:
    """Stable compact SVG numbers, without negative zero or exponent syntax."""
    result = f"{value:.{COORDINATE_PRECISION}f}".rstrip("0").rstrip(".")
    return "0" if result in ("", "-0") else result


NUMBER = r"-?(?:\d+(?:\.\d*)?|\.\d+)"


def compact_svg_path(path: str) -> str:
    """Choose short equivalent absolute/relative commands using exact decimals.

    Input is the explicit M/L/H/V/Q/Z syntax emitted by SVGPathPen for the
    bundled TrueType Bravura font. No coordinate rounding or curve fitting.
    Quadratic T/t is used only when its reflected control is exactly equal.
    """
    def number(value: Decimal) -> str:
        result = format(value, "f")
        if "." in result:
            result = result.rstrip("0").rstrip(".")
        if value == 0:
            return "0"
        if result.startswith("0."):
            return result[1:]
        if result.startswith("-0."):
            return "-" + result[2:]
        return result

    def numbers(values: list[Decimal] | tuple[Decimal, ...]) -> str:
        result = ""
        previous = ""
        for value in values:
            token = number(value)
            # SVG numbers delimit at a sign or a second decimal point.
            if previous and not token.startswith("-") and not (
                token.startswith(".") and "." in previous
            ):
                result += " "
            result += token
            previous = token
        return result

    zero = Decimal(0)
    current = (zero, zero)
    start = current
    quadratic_control = None
    output = ""
    previous_command = ""
    commands = []
    for command, arguments in re.findall(r"([A-Za-z])([^A-Za-z]*)", path):
        values = [Decimal(value) for value in re.findall(NUMBER, arguments)]
        if command not in {"M", "L", "H", "V", "Q", "Z"}:
            raise ValueError(f"Unsupported SVGPathPen command: {command}")
        expected = {"M": 2, "L": 2, "H": 1, "V": 1, "Q": 4, "Z": 0}[command]
        if expected == 0:
            if values:
                raise ValueError(f"Unexpected SVGPathPen arguments: {command}{arguments}")
            commands.append((command, []))
        elif len(values) < expected or len(values) % expected:
            raise ValueError(f"Unexpected SVGPathPen arguments: {command}{arguments}")
        else:
            # SVGPathPen can omit the L immediately after M.
            commands.append((command, values[:expected]))
            for offset in range(expected, len(values), expected):
                commands.append(("L" if command == "M" else command, values[offset:offset + expected]))
    for command, values in commands:
        previous = current
        candidates = [command + numbers(values)]
        if command in {"M", "L"}:
            current = tuple(values)
            candidates.append(command.lower() + numbers([
                current[0] - previous[0], current[1] - previous[1],
            ]))
            if command == "M":
                start = current
            else:
                if current[0] == previous[0]:
                    candidates.extend([
                        "V" + number(current[1]),
                        "v" + number(current[1] - previous[1]),
                    ])
                if current[1] == previous[1]:
                    candidates.extend([
                        "H" + number(current[0]),
                        "h" + number(current[0] - previous[0]),
                    ])
            quadratic_control = None
        elif command == "H":
            current = (values[0], current[1])
            candidates.append("h" + number(current[0] - previous[0]))
            quadratic_control = None
        elif command == "V":
            current = (current[0], values[0])
            candidates.append("v" + number(current[1] - previous[1]))
            quadratic_control = None
        elif command == "Q":
            control = tuple(values[:2])
            current = tuple(values[2:])
            candidates.append("q" + numbers([
                control[0] - previous[0], control[1] - previous[1],
                current[0] - previous[0], current[1] - previous[1],
            ]))
            if quadratic_control is not None and control == (
                2 * previous[0] - quadratic_control[0],
                2 * previous[1] - quadratic_control[1],
            ):
                candidates.extend([
                    "T" + numbers(current),
                    "t" + numbers([
                        current[0] - previous[0], current[1] - previous[1],
                    ]),
                ])
            quadratic_control = control
        else:
            current = start
            quadratic_control = None

        # Repeated drawing commands can omit their letter when the parameter
        # boundary remains unambiguous. Repeated M/m would mean L/l, so exclude.
        spellings = [(candidate, candidate[0]) for candidate in candidates]
        for candidate in candidates:
            if candidate[0] == previous_command and candidate[0] not in {"M", "m", "Z"}:
                payload = candidate[1:]
                last_number = re.search(NUMBER + r"$", output)
                separator = ""
                if not payload.startswith("-") and not (
                    payload.startswith(".") and last_number and "." in last_number[0]
                ):
                    separator = " "
                spellings.append((separator + payload, candidate[0]))
        shortest, previous_command = min(spellings, key=lambda item: len(item[0]))
        output += shortest
    return output


def read_font(vexflow_dir: Path) -> TTFont:
    package = json.loads((vexflow_dir / "package.json").read_text())
    require(
        package["version"] == VEXFLOW_VERSION,
        f"Expected VexFlow {VEXFLOW_VERSION}; found {package['version']}",
    )
    esm_source = vexflow_dir / "build/esm/src"
    glyphs_source = (esm_source / "glyphs.js").read_text()
    vexflow_glyphs = {
        name: int(codepoint, 16)
        for name, codepoint in re.findall(
            r'Glyphs\["([^"\n]+)"\] = "\\u([0-9A-Fa-f]{4})";', glyphs_source
        )
    }
    require(len({name for name, _ in GLYPHS}) == len(GLYPHS), "Duplicate glyph names")
    for name, codepoint in GLYPHS:
        require(
            vexflow_glyphs.get(name) == codepoint,
            f"VexFlow SMuFL mapping changed for {name}: expected U+{codepoint:04X}",
        )

    font_module = (esm_source / "fonts/bravura.js").read_text()
    encoded = re.search(r"export const Bravura = 'data:font/woff2;[^']*base64,([^']+)';", font_module)
    require(encoded is not None, "Could not find the embedded Bravura WOFF2")
    font_bytes = base64.b64decode(encoded[1], validate=True)
    digest = hashlib.sha256(font_bytes).hexdigest()
    require(digest == FONT_SHA256, f"Bundled Bravura WOFF2 changed: SHA-256 {digest}")
    font = TTFont(io.BytesIO(font_bytes))
    require(font["name"].getDebugName(1) == "Bravura", "Expected the Bravura font family")
    require(font["name"].getDebugName(2) == "Regular", "Expected Bravura Regular")
    require(font["name"].getDebugName(5) == FONT_VERSION, f"Expected Bravura {FONT_VERSION}")
    return font


def extract_paths(font: TTFont) -> tuple[list[tuple[str, int, str, str]], dict[str, tuple[float, ...]]]:
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    nominal_scale = NOMINAL_FONT_SIZE / font["head"].unitsPerEm
    result = []
    ink_bounds = {}
    tolerance = 10 ** (1 - COORDINATE_PRECISION)

    for name, codepoint in GLYPHS:
        require(codepoint in cmap, f"Bravura has no glyph for {name} (U+{codepoint:04X})")
        glyph = glyph_set[cmap[codepoint]]
        original_bounds = BoundsPen(glyph_set)
        glyph.draw(original_bounds)
        bounds = original_bounds.bounds
        require(bounds is not None and all(math.isfinite(n) for n in bounds), f"Empty or invalid outline: {name}")
        x_min, y_min, x_max, y_max = bounds
        width, height = x_max - x_min, y_max - y_min
        require(width > 0 and height > 0, f"Degenerate outline: {name}")

        # Keep original font coordinates losslessly (mostly compact integers),
        # flip y, and encode optical fitting in the viewBox. This is the exact
        # same projection as transforming every curve into a 24px square, but
        # avoids thousands of longer, rounded outline coordinates.
        scale = min(nominal_scale, INK_LIMIT / width, INK_LIMIT / height)
        view_size = BOX_SIZE / scale
        view_x = (x_min + x_max - view_size) / 2
        view_y = (-y_min - y_max - view_size) / 2
        view_box = " ".join(number(value) for value in (view_x, view_y, view_size, view_size))
        pen = SVGPathPen(glyph_set, ntos=number)
        glyph.draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
        original_path = pen.getCommands()
        require(bool(original_path), f"No SVG path was generated for {name}")
        path = compact_svg_path(original_path)
        # Prove syntax minimization preserves every endpoint/control point and
        # contour operation, not only the visible bounds of each glyph.
        original_recording = RecordingPen()
        compact_recording = RecordingPen()
        parse_path(original_path, original_recording)
        parse_path(path, compact_recording)
        require(original_recording.value == compact_recording.value,
                f"SVG syntax compression changed outline geometry: {name}")

        # Re-parse the emitted artwork and its viewBox; verify the resulting
        # 24px projection, rather than only checking intermediate font bounds.
        rendered_bounds = BoundsPen(None)
        parse_path(path, rendered_bounds)
        left, top, right, bottom = rendered_bounds.bounds
        view_x, view_y, view_width, view_height = map(float, view_box.split())
        left, right = ((value - view_x) * BOX_SIZE / view_width for value in (left, right))
        top, bottom = ((value - view_y) * BOX_SIZE / view_height for value in (top, bottom))
        margin = (BOX_SIZE - INK_LIMIT) / 2
        require(
            left >= margin - tolerance and top >= margin - tolerance
            and right <= BOX_SIZE - margin + tolerance and bottom <= BOX_SIZE - margin + tolerance,
            f"SVG outline exceeds the ink limit: {name}",
        )
        require(
            abs((left + right) / 2 - BOX_SIZE / 2) <= tolerance
            and abs((top + bottom) / 2 - BOX_SIZE / 2) <= tolerance,
            f"SVG outline is not centered: {name}",
        )
        require(
            right - left <= width * nominal_scale + tolerance
            and bottom - top <= height * nominal_scale + tolerance,
            f"SVG outline exceeds its nominal font size: {name}",
        )
        result.append((name, codepoint, path, view_box))
        ink_bounds[name] = (left, top, right, bottom)

    return result, ink_bounds


def typescript(icons: list[tuple[str, int, str, str]]) -> str:
    lines = [
        "/**",
        " * Actual Bravura 1.392 outlines from VexFlow 5.0.0's bundled WOFF2.",
        " * Generated by scripts/generate-bravura-icons.py; do not edit paths by hand.",
        f" * Source WOFF2 SHA-256: {FONT_SHA256}",
        " * Copyright (c) 2021, Steinberg Media Technologies GmbH.",
        " * SIL Open Font License 1.1; see THIRD_PARTY_NOTICES.md.",
        " *",
        " * Each export is independent and needs no font loading or runtime geometry.",
        " * Original outline coordinates are preserved with SVG's y direction.",
        " * Compact SVG commands preserve every endpoint and control point exactly.",
        " * Each viewBox centers actual ink, fits it to 20/24 of the icon box, and",
        " * caps nominal size at 40px so small marks such as dots stay proportional.",
        " */",
        "import type { IconDefinition } from '../icon-definition.js';",
        "",
    ]
    for name, codepoint, path, view_box in icons:
        export_name = "bravura" + name[0].upper() + name[1:]
        lines += [
            f"/** Bravura {name}, SMuFL U+{codepoint:04X}. */",
            f"export const {export_name}: IconDefinition = {{",
            f"  name: 'music:{name}',",
            f"  viewBox: '{view_box}',",
            f"  paths: ['{path}'],",
            "};",
            "",
        ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="verify without writing")
    parser.add_argument("--vexflow-dir", type=Path, default=ROOT / "node_modules/vexflow")
    parser.add_argument("--output", type=Path, default=ROOT / "src/ui/icons/bravura.ts")
    args = parser.parse_args()
    font = read_font(args.vexflow_dir)
    icons, ink_bounds = extract_paths(font)
    generated = typescript(icons)
    if args.check:
        require(args.output.exists(), f"Generated file is missing: {args.output}")
        require(args.output.read_text() == generated, f"Generated output is stale: {args.output}")
    else:
        args.output.write_text(generated)
    verb = "Verified" if args.check else "Generated"
    print(f"{verb} {len(icons)} Bravura 1.392 SVG icons from VexFlow {VEXFLOW_VERSION}.")
    print(f"Source: {font['head'].unitsPerEm} units/em; WOFF2 SHA-256 {FONT_SHA256}.")
    print("All emitted paths are centered, fit within 20 x 20, and respect the nominal-size cap.")
    for name in ("articStaccatoAbove", "augmentationDot"):
        left, top, right, bottom = ink_bounds[name]
        print(f"{name}: {number(right - left)} x {number(bottom - top)} px of ink.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"Bravura icon generation failed: {error}", file=sys.stderr)
        sys.exit(1)
