"""Text measurement. No font files are bundled and the figures use a system
font stack, so widths come from a conservative table: Helvetica advance widths
(per 1000 em), widened by 8 percent to cover Inter and other fallbacks, and by a
further 6 percent for bold."""

_W = {" ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
      "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
      ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
      "[": 278, "\\": 278, "]": 278, "_": 556}
for _ch in "0123456789":
    _W[_ch] = 556
for _ch, _w in zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                   [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
                    722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611]):
    _W[_ch] = _w
for _ch, _w in zip("abcdefghijklmnopqrstuvwxyz",
                   [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
                    556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500]):
    _W[_ch] = _w

SAFETY = 1.08
BOLD = 1.06


def text_width(text: str, size: float, bold: bool = False) -> float:
    total = sum(_W.get(c, 600) for c in text) / 1000 * size * SAFETY
    return total * (BOLD if bold else 1.0)
