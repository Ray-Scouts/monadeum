"""Orthogonal edge router: builds a polyline of horizontal and vertical
segments from explicit anchors and waypoints, and renders it with small rounded
corners. There is no automatic obstacle search on purpose: the author chooses
the route on the grid, and the build asserts that the route is clean."""

Point = tuple


class RouteError(Exception):
    pass


def simplify(points: list) -> list:
    """Drop repeated points and collinear middle points."""
    pts = []
    for p in points:
        if not pts or abs(p[0] - pts[-1][0]) > 0.01 or abs(p[1] - pts[-1][1]) > 0.01:
            pts.append(p)
    changed = True
    while changed:
        changed = False
        for i in range(1, len(pts) - 1):
            a, b, c = pts[i - 1], pts[i], pts[i + 1]
            if (abs(a[0] - b[0]) < 0.01 and abs(b[0] - c[0]) < 0.01) or \
               (abs(a[1] - b[1]) < 0.01 and abs(b[1] - c[1]) < 0.01):
                del pts[i]
                changed = True
                break
    return pts


def check_orthogonal(points: list, name: str) -> None:
    for a, b in zip(points, points[1:]):
        if abs(a[0] - b[0]) > 0.01 and abs(a[1] - b[1]) > 0.01:
            raise RouteError(f"edge {name}: diagonal segment {a} -> {b}")


def segments(points: list) -> list:
    return list(zip(points, points[1:]))


def seg_len(s) -> float:
    return abs(s[1][0] - s[0][0]) + abs(s[1][1] - s[0][1])


def rounded_path(points: list, radius: float = 10.0) -> str:
    """SVG path data through the points with quadratic rounded corners."""
    def f(v):
        return f"{v:.1f}"
    d = [f"M{f(points[0][0])} {f(points[0][1])}"]
    for i in range(1, len(points) - 1):
        p0, p1, p2 = points[i - 1], points[i], points[i + 1]
        l1 = abs(p1[0] - p0[0]) + abs(p1[1] - p0[1])
        l2 = abs(p2[0] - p1[0]) + abs(p2[1] - p1[1])
        r = min(radius, l1 / 2, l2 / 2)
        def toward(a, b, dist):
            ln = abs(b[0] - a[0]) + abs(b[1] - a[1])
            return (a[0] + (b[0] - a[0]) * dist / ln, a[1] + (b[1] - a[1]) * dist / ln)
        a = toward(p1, p0, r)
        b = toward(p1, p2, r)
        d.append(f"L{f(a[0])} {f(a[1])}")
        d.append(f"Q{f(p1[0])} {f(p1[1])} {f(b[0])} {f(b[1])}")
    d.append(f"L{f(points[-1][0])} {f(points[-1][1])}")
    return " ".join(d)


def seg_rect_hit(seg, rect, shrink: float = 2.0) -> bool:
    """True when an axis-aligned segment passes through the interior of a rect."""
    (x1, y1), (x2, y2) = seg
    rx, ry, rw, rh = rect
    left, right, top, bottom = rx + shrink, rx + rw - shrink, ry + shrink, ry + rh - shrink
    if left >= right or top >= bottom:
        return False
    if abs(y1 - y2) < 0.01:
        return top < y1 < bottom and min(x1, x2) < right and max(x1, x2) > left
    return left < x1 < right and min(y1, y2) < bottom and max(y1, y2) > top


def seg_relation(s, t, tol: float = 1.0):
    """'cross' for a proper perpendicular crossing, 'overlap' for a shared
    stretch of collinear segments, None otherwise."""
    (ax1, ay1), (ax2, ay2) = s
    (bx1, by1), (bx2, by2) = t
    s_h = abs(ay1 - ay2) < 0.01
    t_h = abs(by1 - by2) < 0.01
    if s_h and t_h:
        if abs(ay1 - by1) <= tol:
            lo, hi = max(min(ax1, ax2), min(bx1, bx2)), min(max(ax1, ax2), max(bx1, bx2))
            if hi - lo > 2:
                return "overlap"
        return None
    if not s_h and not t_h:
        if abs(ax1 - bx1) <= tol:
            lo, hi = max(min(ay1, ay2), min(by1, by2)), min(max(ay1, ay2), max(by1, by2))
            if hi - lo > 2:
                return "overlap"
        return None
    h, v = (s, t) if s_h else (t, s)
    hy = h[0][1]
    vx = v[0][0]
    if min(h[0][0], h[1][0]) + tol < vx < max(h[0][0], h[1][0]) - tol and \
       min(v[0][1], v[1][1]) + tol < hy < max(v[0][1], v[1][1]) - tol:
        return "cross"
    return None
