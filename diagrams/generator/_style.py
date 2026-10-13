"""
Shared design system for every Monadeum diagram.

Palette: derived from the real app theme in apps/web/src/app/globals.css
(accent #6A50F2 and #836EF9, berry, mint, sky, sun, and the warm neutral
surfaces). Node fills are light and opaque, and every piece of text sits on
a light card, so a diagram stays legible on a transparent background in both
light and dark mode.

Status convention, used by every diagram without exception:

  thick solid border  : implemented and exercised on Monad testnet
  thin solid border   : implemented, but off by default or not yet run on testnet
  dashed border       : designed, not built or not deployed

Border hue and fill tint carry the component category (see KINDS), never the
status. Edges follow the same rule: a solid edge is a path that exists in
code, a dashed edge is a path that is designed or switched off.
"""
from pathlib import Path

# ---------------------------------------------------------------- typography
FONT = "Helvetica"
INK = "#15131F"      # app --fg (light)
MUTED = "#5B5968"    # app --muted (light)
FAINT = "#8E8C9A"    # app --faint (light)

# ------------------------------------------------------------------- surfaces
CARD = "#FFFFFF"
PANEL = "#F7F6F3"        # cluster fill, close to app --surface-2
PANEL_LINE = "#D9D6CC"   # cluster border, close to app --line

# ------------------------------------------------------------- component kinds
# kind -> (fill tint, border hue). Hues are the app's accent, mint, sky, sun,
# berry and bad colors; fills are their light washes made opaque.
KINDS = {
    "neutral":  ("#F3F2EE", "#6D6C80"),   # generic component
    "service":  ("#EFEBFE", "#6A50F2"),   # Monadeum process or library (accent)
    "chain":    ("#E2F1F9", "#0B8BC0"),   # contract or account on Monad (sky)
    "external": ("#FBF0DC", "#C77A00"),   # third party (sun)
    "control":  ("#E3F6EE", "#0C9E74"),   # a safeguard or a gate (mint)
    "threat":   ("#FBE6F1", "#B8126A"),   # attacker, risk, or an off switch (berry)
    "bad":      ("#FCE8EC", "#D22B4C"),   # refusal, failure, no-go
}

# --------------------------------------------------------------------- status
IMPL = "impl"      # thick solid
OFF = "off"        # thin solid
DESIGN = "design"  # dashed

_STATUS = {
    IMPL:   {"style": "filled,rounded", "penwidth": "2.8"},
    OFF:    {"style": "filled,rounded", "penwidth": "1.0"},
    DESIGN: {"style": "filled,rounded,dashed", "penwidth": "1.5"},
}

# ---------------------------------------------------------------------- edges
# Mid-tone hues that read on both a light and a dark page.
EDGE = {
    "flow":    "#8C8AA3",
    "control": "#7B63F5",
    "gate":    "#12A67C",
    "danger":  "#E0455F",
    "chain":   "#2E9BCB",
}

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "docs-site" / "images" / "diagrams"


def esc(text) -> str:
    """Escape text for a Graphviz HTML-like label."""
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace("\n", "<BR/>"))


def render(g, name: str, out=None) -> None:
    """Render a graph to NN-name.svg and NN-name.png in docs-site/images/diagrams."""
    out = Path(out) if out else OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{name}.svg").write_bytes(g.pipe(format="svg"))
    png = g.pipe(format="png")
    (out / f"{name}.png").write_bytes(png)
    w = int.from_bytes(png[16:20], "big")
    h = int.from_bytes(png[20:24], "big")
    print(f"  ok {name}  (.svg + .png, {w}x{h}px)")


def graph_attr(**extra):
    return {
        "bgcolor": "transparent",
        "fontname": FONT,
        "fontsize": "12",
        "fontcolor": INK,
        "labelloc": "t",
        "labeljust": "l",
        "pad": "0.35",
        "nodesep": "0.4",
        "ranksep": "0.6",
        "dpi": "150",
        "splines": "spline",
        **extra,
    }


def node_attr(**extra):
    return {
        "shape": "box",
        "style": "filled,rounded",
        "fillcolor": CARD,
        "color": KINDS["neutral"][1],
        "fontname": FONT,
        "fontsize": "12",
        "fontcolor": INK,
        "margin": "0.16,0.10",
        "penwidth": "1.0",
        **extra,
    }


def edge_attr(**extra):
    return {
        "color": EDGE["flow"],
        "fontname": FONT,
        "fontsize": "11",
        "fontcolor": INK,
        "arrowsize": "0.8",
        "penwidth": "1.4",
        **extra,
    }


def new_graph(name, rankdir="TB", title="", subtitle="", source="", legend_extra=(), **extra):
    """Create a graph with the shared defaults and the standard header card."""
    import graphviz
    g = graphviz.Digraph(name)
    g.attr(**graph_attr(rankdir=rankdir, label=header(title, subtitle, source, legend_extra), **extra))
    g.attr("node", **node_attr())
    g.attr("edge", **edge_attr())
    return g


def body(title, lines=(), size=14, small=11):
    """Inner HTML for a node: bold title and muted detail lines."""
    s = f'<FONT POINT-SIZE="{size}"><B>{esc(title)}</B></FONT>'
    for line in lines:
        s += f'<BR/><FONT POINT-SIZE="{small}" COLOR="{MUTED}">{esc(line)}</FONT>'
    return s


def card(g, nid, title, lines=(), kind="neutral", status=IMPL, size=14, small=11, **attrs):
    """Add a node. `kind` picks the hue, `status` picks the border convention."""
    fill, hue = KINDS[kind]
    st = _STATUS[status]
    g.node(nid, label=f"<{body(title, lines, size, small)}>", fillcolor=fill, color=hue,
           style=st["style"], penwidth=st["penwidth"], **attrs)


def chip(text, small=10.5):
    """Edge label as a light chip so it stays readable on any page color."""
    lines = str(text).split("\n")
    inner = "<BR/>".join(f'<FONT POINT-SIZE="{small}">{esc(t)}</FONT>' for t in lines)
    return (f'<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="3" '
            f'COLOR="{PANEL_LINE}" BGCOLOR="{CARD}"><TR><TD>{inner}</TD></TR></TABLE>>')


def link(g, a, b, label=None, kind="flow", dashed=False, **attrs):
    """Add an edge. `dashed` marks a path that is designed or switched off."""
    a_ = dict(color=EDGE[kind], **attrs)
    if dashed:
        a_["style"] = "dashed"
    if label:
        a_["label"] = chip(label)
    g.edge(a, b, **a_)


def panel(title, tint=PANEL, line=PANEL_LINE):
    """Attributes for a titled cluster: `with g.subgraph(name="cluster_x") as c: c.attr(**panel("Title"))`."""
    return dict(label=f'<<FONT POINT-SIZE="11" COLOR="{MUTED}"><B>{esc(title)}</B></FONT>>',
                style="filled,rounded", fillcolor=tint, color=line, penwidth="1.0",
                labeljust="l", labelloc="t", margin="14", fontname=FONT)


def _swatch(status):
    hue = KINDS["neutral"][1]
    border, style = {IMPL: ("3", "rounded"), OFF: ("1", "rounded"),
                     DESIGN: ("1", "rounded,dashed")}[status]
    return (f'<TABLE BORDER="{border}" COLOR="{hue}" BGCOLOR="#F3F2EE" CELLBORDER="0" '
            f'CELLSPACING="0" CELLPADDING="0" STYLE="{style}">'
            f'<TR><TD WIDTH="26" HEIGHT="13" FIXEDSIZE="TRUE"> </TD></TR></TABLE>')


def header(title, subtitle="", source="", legend_extra=()):
    """Title card with a subtitle, the status legend, and the source section."""
    def legend_cell(status, text):
        return (f'<TD>{_swatch(status)}</TD>'
                f'<TD ALIGN="LEFT"><FONT POINT-SIZE="11" COLOR="{MUTED}">{esc(text)}</FONT></TD>')

    cells = [
        legend_cell(IMPL, "Exercised on Monad testnet"),
        legend_cell(OFF, "Implemented, off or not yet run on testnet"),
        legend_cell(DESIGN, "Designed, not built or not deployed"),
    ]
    legend = ('<TR><TD ALIGN="LEFT"><TABLE BORDER="0" CELLSPACING="6" CELLPADDING="0"><TR>'
              + "".join(cells) + "</TR></TABLE></TD></TR>")
    extra = ""
    if legend_extra:
        extra = ('<TR><TD ALIGN="LEFT"><TABLE BORDER="0" CELLSPACING="6" CELLPADDING="0"><TR>'
                 + "".join(f'<TD><FONT POINT-SIZE="11" COLOR="{MUTED}">{esc(t)}</FONT></TD>'
                           for t in legend_extra) + "</TR></TABLE></TD></TR>")
    sub = (f'<TR><TD ALIGN="LEFT"><FONT POINT-SIZE="11" COLOR="{MUTED}">{esc(subtitle)}</FONT></TD></TR>'
           if subtitle else "")
    src = (f'<TR><TD ALIGN="LEFT"><FONT POINT-SIZE="9" COLOR="{FAINT}">Source: {esc(source)}</FONT></TD></TR>'
           if source else "")
    return (f'<<TABLE BORDER="1" COLOR="{PANEL_LINE}" BGCOLOR="{CARD}" CELLBORDER="0" '
            f'CELLSPACING="0" CELLPADDING="5" STYLE="rounded">'
            f'<TR><TD ALIGN="LEFT"><FONT POINT-SIZE="17" COLOR="{INK}"><B>{esc(title)}</B></FONT></TD></TR>'
            f'{sub}{legend}{extra}{src}</TABLE>>')
