"""Theme tokens (light and dark) derived from apps/web/src/app/globals.css, and
the WCAG contrast check the build runs against them."""

LIGHT = dict(
    name="light",
    bg="#FBFAF9", border="#E1DFD8", lane="#F3F2EE", lane_line="#E1DFD8",
    card="#FFFFFF", card_line="#BDBAAE", ink="#15131F", muted="#5B5968",
    accent="#6A50F2", accent_wash="#EFEBFE", accent_text="#5238E0",
    good="#0E9A62", good_wash="#E3F6EE", good_text="#0A6E46",
    bad="#D22B4C", bad_wash="#FCE8EC", bad_text="#B3203D",
    flow="#77758A",
)

DARK = dict(
    name="dark",
    bg="#0A0A10", border="#2B2A3A", lane="#13131B", lane_line="#2B2A3A",
    card="#1B1B26", card_line="#4A485F", ink="#F6F5F2", muted="#A4A3B6",
    accent="#836EF9", accent_wash="#262050", accent_text="#B3A6FF",
    good="#3FD69A", good_wash="#12342A", good_text="#3FD69A",
    bad="#FF6680", bad_wash="#3A1A24", bad_text="#FF8CA0",
    flow="#8483A0",
)

THEMES = (LIGHT, DARK)

FONT = "Inter, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"


def _lin(c: int) -> float:
    v = c / 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def luminance(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


# (text colour, surface colour) pairs that carry text anywhere in a figure.
TEXT_PAIRS = [
    ("ink", "card"), ("ink", "bg"), ("ink", "lane"),
    ("muted", "card"), ("muted", "bg"), ("muted", "lane"),
    ("ink", "accent_wash"), ("muted", "accent_wash"),
    ("ink", "good_wash"), ("muted", "good_wash"),
    ("ink", "bad_wash"), ("muted", "bad_wash"),
    ("accent_text", "bg"), ("accent_text", "lane"),
    ("good_text", "bg"), ("good_text", "lane"),
    ("bad_text", "bg"), ("bad_text", "lane"),
]


def check_contrast(theme: dict) -> None:
    for fg, bg in TEXT_PAIRS:
        ratio = contrast(theme[fg], theme[bg])
        assert ratio >= 4.5, f"{theme['name']}: {fg} on {bg} is {ratio:.2f}, below WCAG AA 4.5"
