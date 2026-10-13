"""
Render every Monadeum diagram to docs-site/images/diagrams/ (SVG + PNG).

Usage, from the repository root:
    python diagrams/generator/render-all.py

Needs the Graphviz `dot` binary on PATH and the Python `graphviz` package
(see diagrams/README.md). Exits non-zero if any script fails or if an expected
output file is missing.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT = ROOT / "docs-site" / "images" / "diagrams"
OUTPUT.mkdir(parents=True, exist_ok=True)

NAMES = [
    "01-system-architecture",
    "02-agent-lifecycle",
    "03-capital-flow",
    "04-spend-control-layers",
    "05-reallocation-retirement",
    "06-deployment-activation",
    "07-x402-payment-flow",
    "08-worker-tick",
    "09-trust-boundaries",
    "10-indexer-sync",
    "11-root-recovery",
    "12-evidence-chain",
]

base = Path(__file__).resolve().parent
errors = []

for name in NAMES:
    result = subprocess.run([sys.executable, str(base / f"{name}.py")], cwd=str(ROOT),
                            capture_output=True, text=True)
    if result.returncode != 0:
        print(f"\nFAILED {name}.py\n{result.stderr}")
        errors.append(name)
    elif result.stdout:
        print(result.stdout.strip())

missing = [f"{n}.{ext}" for n in NAMES for ext in ("svg", "png") if not (OUTPUT / f"{n}.{ext}").exists()]
if missing:
    print(f"\nMissing outputs: {missing}")
    errors.extend(missing)

if errors:
    print(f"\n{len(errors)} problem(s): {errors}")
    sys.exit(1)
print(f"\nAll {len(NAMES)} diagrams rendered to {OUTPUT}")
