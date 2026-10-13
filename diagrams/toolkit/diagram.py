"""Diagram model, layout grid, SVG writer, and the build-time assertions.

Design contract (see diagrams/README.md): a fixed 1200 px wide canvas, a grid of
equal columns with equal gutters, equal node heights, orthogonal edges routed on
that grid, one status encoding, and a build that FAILS on text overflow, on
unintended overlaps, on edges that pass through cards, and on edge crossings.
"""
import shutil
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

from .router import (RouteError, check_orthogonal, rounded_path, seg_len, seg_rect_hit,
                     seg_relation, segments, simplify)
from .textfit import text_width
from .theme import FONT, THEMES, check_contrast

OBSERVED, BUILT, DESIGN = "observed", "built", "design"

DASHES = (chr(0x2014), chr(0x2013))

W = 1200
MARGIN = 32          # canvas edge to lane edge
ZPAD = 20            # lane edge to first node column
NODE_H = 76
TITLE_FS, SUB_FS, LABEL_FS, HEAD_FS = 18, 14.5, 14.5, 15
DIAG_TITLE_FS, DIAG_SUB_FS = 24, 16
PILL_H = 26
CONTENT_TOP = 124
ZONE_HEAD = 52       # lane top to first node row
ZONE_FOOT = 24
RADIUS = 12

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "docs-site" / "images" / "diagrams"


class DiagramError(Exception):
    pass


def _words(s: str) -> int:
    return len(s.split())


def _no_dash(s: str, where: str) -> None:
    if any(c in s for c in DASHES):
        raise DiagramError(f"{where}: em or en dash in text {s!r}")


class Node:
    def __init__(self, nid, title, sub, col, row, span, status, kind):
        self.id, self.title, self.sub = nid, title, sub
        self.col, self.row, self.span = col, row, span
        self.status, self.kind = status, kind
        self.x = self.y = self.w = self.h = 0.0

    @property
    def rect(self):
        return (self.x, self.y, self.w, self.h)

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2


class Edge:
    def __init__(self, a, b, label, kind, dashed, mode, so, to, via, mid, lseg, lpos,
                 both, cross_ok, sa, sb):
        self.a, self.b, self.label, self.kind, self.dashed = a, b, label, kind, dashed
        self.mode, self.so, self.to, self.via, self.mid = mode, so, to, via, mid
        self.lseg, self.lpos, self.both, self.cross_ok = lseg, lpos, both, cross_ok
        self.sa, self.sb = sa, sb
        self.points = []
        self.pill = None


class Zone:
    def __init__(self, label, rows, cols):
        self.label, self.rows, self.cols = label, rows, cols
        self.rect = (0, 0, 0, 0)


class Diagram:
    def __init__(self, slug, title, subtitle, desc, cols=4, gutter=48, rows=1, gaps=None,
                 legend_filled="Observed on testnet", legend_ring="Built, off or unrun",
                 legend_dashed="Design only"):
        self.slug, self.title, self.subtitle, self.desc = slug, title, subtitle, desc
        self.cols, self.gutter = cols, gutter
        self.legend_text = (legend_filled, legend_ring, legend_dashed)
        self.nodes: dict = {}
        self.edges: list = []
        self.zones: list = []
        inner = W - 2 * MARGIN - 2 * ZPAD
        self.colw = (inner - (cols - 1) * gutter) / cols
        if self.colw < 150:
            raise DiagramError(f"{slug}: columns are {self.colw:.0f} px wide, below 150")
        if gutter < 40:
            raise DiagramError(f"{slug}: gutter {gutter} is below 40")
        gaps = gaps or {}
        self.row_ys = []
        y = CONTENT_TOP + gaps.get(0, 0)
        for r in range(rows):
            if r > 0:
                y += gaps.get(r, 72)
            self.row_ys.append(y)
            y += NODE_H
        for s in (title, subtitle, desc, *self.legend_text):
            _no_dash(s, slug)

    # ------------------------------------------------------------------ grid
    def col_x(self, c):
        return MARGIN + ZPAD + c * (self.colw + self.gutter)

    def col_cx(self, c):
        return self.col_x(c) + self.colw / 2

    def row_y(self, r):
        return self.row_ys[r]

    def gap_y(self, r, frac=0.5):
        """Y inside the gap below row r."""
        top = self.row_ys[r] + NODE_H
        return top + (self.row_ys[r + 1] - top) * frac

    def gutter_x(self, c, frac=0.5):
        """X inside the gutter to the right of column c."""
        return self.col_x(c) + self.colw + self.gutter * frac

    # -------------------------------------------------------------- elements
    def node(self, nid, title, sub="", col=0, row=0, span=1, status=None, kind="default"):
        if nid in self.nodes:
            raise DiagramError(f"duplicate node {nid}")
        if _words(title) > 3:
            raise DiagramError(f"{self.slug}: node title over 3 words: {title!r}")
        if _words(sub) > 6:
            raise DiagramError(f"{self.slug}: node subline over 6 words: {sub!r}")
        for s in (title, sub):
            _no_dash(s, nid)
        n = Node(nid, title, sub, col, row, span, status, kind)
        n.x = self.col_x(col)
        n.y = self.row_y(row)
        n.w = span * self.colw + (span - 1) * self.gutter
        n.h = NODE_H
        self.nodes[nid] = n
        return n

    def zone(self, label, rows, cols=None):
        _no_dash(label, "zone")
        z = Zone(label, rows, cols)
        self.zones.append(z)
        return z

    def edge(self, a, b, label=None, kind="flow", dashed=False, mode=None, so=0, to=0,
             via=None, mid=None, lseg=None, lpos=0.5, both=False, cross_ok=False,
             sa=None, sb=None):
        if label is not None:
            if not 1 <= _words(label) <= 3:
                raise DiagramError(f"{self.slug}: edge label must be 1 to 3 words: {label!r}")
            _no_dash(label, "edge")
        e = Edge(self.nodes[a], self.nodes[b], label, kind, dashed, mode, so, to, via, mid,
                 lseg, lpos, both, cross_ok, sa, sb)
        self.edges.append(e)
        return e

    # --------------------------------------------------------------- routing
    @staticmethod
    def _anchor(n, side, off):
        return {"left": (n.x, n.cy + off), "right": (n.x + n.w, n.cy + off),
                "top": (n.cx + off, n.y), "bottom": (n.cx + off, n.y + n.h)}[side]

    def _route(self, e: Edge):
        a, b = e.a, e.b
        dx, dy = b.cx - a.cx, b.cy - a.cy
        mode = e.mode
        if mode is None:
            if abs(dy) < 1:
                mode = "straight"
            elif abs(dx) < 1 and e.so == e.to:
                mode = "straight"
            else:
                mode = "vhv"
        A = self._anchor
        if e.via is not None:
            if not (e.sa and e.sb):
                raise DiagramError("via routes need sa and sb")
            pts = [A(a, e.sa, e.so), *e.via, A(b, e.sb, e.to)]
        elif mode == "straight":
            if abs(dy) < 1:
                sa, sb = ("right", "left") if dx > 0 else ("left", "right")
            else:
                sa, sb = ("bottom", "top") if dy > 0 else ("top", "bottom")
            pts = [A(a, sa, e.so), A(b, sb, e.to)]
        elif mode == "vhv":
            sa, sb = ("bottom", "top") if dy > 0 else ("top", "bottom")
            p, q = A(a, sa, e.so), A(b, sb, e.to)
            ym = e.mid if e.mid is not None else (p[1] + q[1]) / 2
            pts = [p, (p[0], ym), (q[0], ym), q]
        elif mode == "hvh":
            sa, sb = ("right", "left") if dx > 0 else ("left", "right")
            p, q = A(a, sa, e.so), A(b, sb, e.to)
            xm = e.mid if e.mid is not None else (p[0] + q[0]) / 2
            pts = [p, (xm, p[1]), (xm, q[1]), q]
        elif mode == "hv":
            sa = "right" if dx > 0 else "left"
            sb = "top" if dy > 0 else "bottom"
            p, q = A(a, sa, e.so), A(b, sb, e.to)
            pts = [p, (q[0], p[1]), q]
        elif mode == "vh":
            sa = "bottom" if dy > 0 else "top"
            sb = "left" if dx > 0 else "right"
            p, q = A(a, sa, e.so), A(b, sb, e.to)
            pts = [p, (p[0], q[1]), q]
        else:
            raise DiagramError(f"unknown mode {mode}")
        e.points = simplify(pts)
        try:
            check_orthogonal(e.points, f"{a.id}->{b.id}")
        except RouteError as exc:
            raise DiagramError(str(exc))

    # ---------------------------------------------------------------- layout
    def _layout(self):
        for z in self.zones:
            r0, r1 = z.rows
            c0, c1 = z.cols if z.cols else (0, self.cols - 1)
            x0 = self.col_x(c0) - ZPAD
            x1 = self.col_x(c1) + self.colw + ZPAD
            y0 = self.row_y(r0) - ZONE_HEAD
            y1 = self.row_y(r1) + NODE_H + ZONE_FOOT
            z.rect = (x0, y0, x1 - x0, y1 - y0)
        for e in self.edges:
            self._route(e)
        bottoms = [n.y + n.h for n in self.nodes.values()] + [z.rect[1] + z.rect[3] for z in self.zones]
        self.content_bottom = max(bottoms)
        self.legend_y = self.content_bottom + 44
        self.height = int(self.legend_y + 20 + 36)
        self._place_pills()

    def _surface_at(self, x, y):
        for z in self.zones:
            zx, zy, zw, zh = z.rect
            if zx <= x <= zx + zw and zy <= y <= zy + zh:
                return "lane"
        return "bg"

    def _straddles_zone(self, p):
        for z in self.zones:
            zx, zy, zw, zh = z.rect
            inside = zx <= p[0] and p[0] + p[2] <= zx + zw and zy <= p[1] and p[1] + p[3] <= zy + zh
            outside = (p[0] + p[2] <= zx or p[0] >= zx + zw or p[1] + p[3] <= zy or p[1] >= zy + zh)
            if not inside and not outside:
                return True
        return False

    def _place_pills(self):
        for e in self.edges:
            if not e.label:
                continue
            segs = segments(e.points)
            idx = e.lseg
            if idx is None:
                idx = max(range(len(segs)), key=lambda i: seg_len(segs[i]))
            (x1, y1), (x2, y2) = segs[idx]
            pw = text_width(e.label, LABEL_FS) + 20
            cands = [e.lpos] if e.lpos != 0.5 else [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75]
            for lp in cands:
                cx = x1 + (x2 - x1) * lp
                cy = y1 + (y2 - y1) * lp
                e.pill = (cx - pw / 2, cy - PILL_H / 2, pw, PILL_H)
                if not self._straddles_zone(e.pill):
                    break
            horiz = abs(y1 - y2) < 0.01
            need = (pw if horiz else PILL_H) + 20
            if seg_len(segs[idx]) < need:
                raise DiagramError(
                    f"{self.slug}: edge {e.a.id}->{e.b.id} label {e.label!r}: segment is "
                    f"{seg_len(segs[idx]):.0f} px, needs {need:.0f}; widen the gap or pick lseg")

    # ----------------------------------------------------------------- checks
    def _check(self):
        slug = self.slug
        nodes = list(self.nodes.values())
        for n in nodes:
            tw = text_width(n.title, TITLE_FS, bold=True)
            room = n.w - 32 - (22 if n.status in (OBSERVED, BUILT) else 0)
            if tw > room:
                raise DiagramError(f"{slug}: title {n.title!r} is {tw:.0f} px, room {room:.0f}")
            if n.sub:
                sw = text_width(n.sub, SUB_FS)
                if sw > n.w - 32:
                    raise DiagramError(f"{slug}: subline {n.sub!r} is {sw:.0f} px, room {n.w - 32:.0f}")
        for z in self.zones:
            if text_width(z.label, HEAD_FS, True) > z.rect[2] - 2 * ZPAD:
                raise DiagramError(f"{slug}: zone header {z.label!r} overflows its zone")
        if text_width(self.title, DIAG_TITLE_FS, True) > W - 2 * MARGIN - 16:
            raise DiagramError(f"{slug}: diagram title overflows the canvas")
        if text_width(self.subtitle, DIAG_SUB_FS) > W - 2 * MARGIN - 16:
            raise DiagramError(f"{slug}: diagram subtitle overflows the canvas")

        def hit(r1, r2, gap=0.0):
            return (r1[0] < r2[0] + r2[2] + gap and r2[0] < r1[0] + r1[2] + gap and
                    r1[1] < r2[1] + r2[3] + gap and r2[1] < r1[1] + r1[3] + gap)

        for i, a in enumerate(nodes):
            if a.x < MARGIN or a.x + a.w > W - MARGIN:
                raise DiagramError(f"{slug}: node {a.id} outside the canvas")
            for b in nodes[i + 1:]:
                if hit(a.rect, b.rect):
                    raise DiagramError(f"{slug}: nodes {a.id} and {b.id} overlap")
        heads = []
        for i, z in enumerate(self.zones):
            zr = z.rect
            for n in nodes:
                inside = (zr[0] <= n.x and n.x + n.w <= zr[0] + zr[2] and
                          zr[1] <= n.y and n.y + n.h <= zr[1] + zr[3])
                if not inside and hit(zr, n.rect):
                    raise DiagramError(f"{slug}: node {n.id} straddles zone {z.label!r}")
            for z2 in self.zones[i + 1:]:
                if hit(zr, z2.rect):
                    raise DiagramError(f"{slug}: zones {z.label!r} and {z2.label!r} overlap")
            tw = text_width(z.label, HEAD_FS, True)
            heads.append((z.label, (zr[0] + ZPAD, zr[1] + 12, tw, 24)))
        pills = [(e, e.pill) for e in self.edges if e.pill]
        for e, p in pills:
            for n in nodes:
                if hit(p, n.rect, 4):
                    raise DiagramError(f"{slug}: label {e.label!r} collides with node {n.id}")
            for name, h in heads:
                if hit(p, h, 2):
                    raise DiagramError(f"{slug}: label {e.label!r} collides with header {name!r}")
        for i, (e1, p1) in enumerate(pills):
            for e2, p2 in pills[i + 1:]:
                if hit(p1, p2, 4):
                    raise DiagramError(f"{slug}: labels {e1.label!r} and {e2.label!r} overlap")
        for e in self.edges:
            name = f"{e.a.id}->{e.b.id}"
            for s in segments(e.points):
                for n in nodes:
                    if seg_rect_hit(s, n.rect):
                        raise DiagramError(f"{slug}: edge {name} passes through node {n.id}")
                for hn, h in heads:
                    if seg_rect_hit(s, h, 0):
                        raise DiagramError(f"{slug}: edge {name} crosses header {hn!r}")
                for e2, p in pills:
                    if e2 is not e and seg_rect_hit(s, p, 0):
                        raise DiagramError(f"{slug}: edge {name} runs under label {e2.label!r}")
        crossings = 0
        for i, e1 in enumerate(self.edges):
            for e2 in self.edges[i + 1:]:
                shared = e1.a is e2.a or e1.b is e2.b
                for s in segments(e1.points):
                    for t in segments(e2.points):
                        rel = seg_relation(s, t)
                        if rel == "cross":
                            if not (e1.cross_ok or e2.cross_ok):
                                raise DiagramError(
                                    f"{slug}: edges {e1.a.id}->{e1.b.id} and {e2.a.id}->{e2.b.id} cross")
                            crossings += 1
                        elif rel == "overlap" and not shared:
                            raise DiagramError(
                                f"{slug}: edges {e1.a.id}->{e1.b.id} and {e2.a.id}->{e2.b.id} overlap")
        if crossings > 1:
            raise DiagramError(f"{slug}: {crossings} deliberate crossings, at most 1 allowed")
        if self._legend_width() > W - 2 * MARGIN - 16:
            raise DiagramError(f"{slug}: legend overflows")

    # ------------------------------------------------------------------- svg
    def _legend_items(self):
        items = [("filled", self.legend_text[0]), ("ring", self.legend_text[1]),
                 ("dashed", self.legend_text[2])]
        kinds = {e.kind for e in self.edges}
        if "bad" in kinds:
            items.append(("bad", "Refused or reverts"))
        if "good" in kinds:
            items.append(("good", "Allowed or approved"))
        if any(n.status is None for n in self.nodes.values()):
            items.append(("plain", "Outside actor"))
        return items

    def _legend_width(self):
        return sum(24 + text_width(t, LABEL_FS) + 32 for _, t in self._legend_items())

    def _svg(self, th) -> str:
        def f(v):
            return f"{v:.1f}"
        o = []
        a = o.append
        a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {self.height}" '
          f'width="{W}" height="{self.height}" role="img" aria-labelledby="t d" '
          f'font-family="{FONT}">')
        a(f'<title id="t">{escape(self.title)}</title>')
        a(f'<desc id="d">{escape(self.desc)}</desc>')
        a("<defs>")
        for kind in ("flow", "accent", "good", "bad"):
            col = th["flow"] if kind == "flow" else th[kind]
            a(f'<marker id="e-{kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" '
              f'markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">'
              f'<path d="M1 1 L10 5 L1 9 Z" fill="{col}"/></marker>')
            a(f'<marker id="s-{kind}" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="10" '
              f'markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">'
              f'<path d="M9 1 L0 5 L9 9 Z" fill="{col}"/></marker>')
        a("</defs>")
        a(f'<rect x="0.5" y="0.5" width="{W - 1}" height="{self.height - 1}" rx="14" '
          f'fill="{th["bg"]}" stroke="{th["border"]}"/>')
        a(f'<text x="{MARGIN + 8}" y="58" font-size="{DIAG_TITLE_FS}" font-weight="700" '
          f'fill="{th["ink"]}">{escape(self.title)}</text>')
        a(f'<text x="{MARGIN + 8}" y="88" font-size="{DIAG_SUB_FS}" fill="{th["muted"]}">'
          f'{escape(self.subtitle)}</text>')
        for z in self.zones:
            x, y, w, h = z.rect
            a(f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" rx="{RADIUS}" '
              f'fill="{th["lane"]}" stroke="{th["lane_line"]}"/>')
            a(f'<text x="{f(x + ZPAD)}" y="{f(y + 32)}" font-size="{HEAD_FS}" font-weight="600" '
              f'fill="{th["muted"]}">{escape(z.label)}</text>')
        for e in self.edges:
            col = th["flow"] if e.kind == "flow" else th[e.kind]
            wdt = 2 if e.kind == "accent" else 1.6
            dash = ' stroke-dasharray="6 5"' if e.dashed else ""
            ms = f' marker-start="url(#s-{e.kind})"' if e.both else ""
            a(f'<path d="{rounded_path(e.points, 10)}" fill="none" stroke="{col}" '
              f'stroke-width="{wdt}"{dash} stroke-linejoin="round" '
              f'marker-end="url(#e-{e.kind})"{ms}/>')
        for e in self.edges:
            if not e.pill:
                continue
            x, y, w, h = e.pill
            fill = th[self._surface_at(x + w / 2, y + h / 2)]
            tcol = {"flow": th["muted"], "accent": th["accent_text"], "good": th["good_text"],
                    "bad": th["bad_text"]}[e.kind]
            a(f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" rx="{h / 2}" fill="{fill}"/>')
            a(f'<text x="{f(x + w / 2)}" y="{f(y + h / 2 + 5)}" font-size="{LABEL_FS}" '
              f'font-weight="500" text-anchor="middle" fill="{tcol}">{escape(e.label)}</text>')
        for n in self.nodes.values():
            fill, stroke, sw = th["card"], th["card_line"], 1.2
            if n.kind == "accent":
                fill, stroke, sw = th["accent_wash"], th["accent"], 1.8
            elif n.kind == "bad":
                fill, stroke, sw = th["bad_wash"], th["bad"], 1.5
            elif n.kind == "good":
                fill, stroke, sw = th["good_wash"], th["good"], 1.5
            dash = ' stroke-dasharray="6 5"' if n.status == DESIGN else ""
            a(f'<rect x="{f(n.x)}" y="{f(n.y)}" width="{f(n.w)}" height="{n.h}" rx="{RADIUS}" '
              f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>')
            ty = n.y + (32 if n.sub else 44)
            a(f'<text x="{f(n.x + 16)}" y="{f(ty)}" font-size="{TITLE_FS}" font-weight="650" '
              f'fill="{th["ink"]}">{escape(n.title)}</text>')
            if n.sub:
                a(f'<text x="{f(n.x + 16)}" y="{f(n.y + 56)}" font-size="{SUB_FS}" '
                  f'fill="{th["muted"]}">{escape(n.sub)}</text>')
            if n.status == OBSERVED:
                a(f'<circle cx="{f(n.x + n.w - 18)}" cy="{f(n.y + 20)}" r="5.5" fill="{th["ink"]}"/>')
            elif n.status == BUILT:
                a(f'<circle cx="{f(n.x + n.w - 18)}" cy="{f(n.y + 20)}" r="4.8" fill="{th["card"]}" '
                  f'stroke="{th["ink"]}" stroke-width="1.8"/>')
        x, y = MARGIN + 8, self.legend_y
        for kind, text in self._legend_items():
            if kind == "filled":
                a(f'<circle cx="{f(x + 6)}" cy="{f(y)}" r="5.5" fill="{th["ink"]}"/>')
            elif kind == "ring":
                a(f'<circle cx="{f(x + 6)}" cy="{f(y)}" r="4.8" fill="{th["bg"]}" stroke="{th["ink"]}" stroke-width="1.8"/>')
            elif kind == "dashed":
                a(f'<rect x="{f(x)}" y="{f(y - 7)}" width="16" height="14" rx="4" fill="{th["card"]}" '
                  f'stroke="{th["card_line"]}" stroke-width="1.4" stroke-dasharray="3 2.5"/>')
            elif kind == "plain":
                a(f'<rect x="{f(x)}" y="{f(y - 7)}" width="16" height="14" rx="4" fill="{th["card"]}" '
                  f'stroke="{th["card_line"]}" stroke-width="1.4"/>')
            else:
                a(f'<path d="M{f(x)} {f(y)} L{f(x + 16)} {f(y)}" stroke="{th[kind]}" stroke-width="2"/>')
            a(f'<text x="{f(x + 24)}" y="{f(y + 5)}" font-size="{LABEL_FS}" fill="{th["muted"]}">{escape(text)}</text>')
            x += 24 + text_width(text, LABEL_FS) + 32
        a("</svg>")
        return "\n".join(o)

    # ------------------------------------------------------------------ build
    def render(self) -> dict:
        self._layout()
        self._check()
        for th in THEMES:
            check_contrast(th)
        out = {}
        for th in THEMES:
            svg = self._svg(th)
            if any(c in svg for c in DASHES):
                raise DiagramError(f"{self.slug}: dash character in SVG output")
            out[th["name"]] = svg
        return out


def build(d: Diagram, name: str, out_dir=None, png: bool = True) -> None:
    """Render a diagram to NAME-light.svg, NAME-dark.svg and, with rsvg-convert on
    PATH, the matching PNGs (review and README fallback only)."""
    out = Path(out_dir) if out_dir else OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    for variant, svg in d.render().items():
        svg_path = out / f"{name}-{variant}.svg"
        svg_path.write_text(svg, encoding="utf-8")
        if png:
            tool = shutil.which("rsvg-convert")
            if not tool:
                raise DiagramError("rsvg-convert not found on PATH; install librsvg to write PNGs")
            subprocess.run([tool, "-w", "2000", "-o", str(out / f"{name}-{variant}.png"), str(svg_path)],
                           check=True)
    print(f"ok {name} ({d.height} px high)")
