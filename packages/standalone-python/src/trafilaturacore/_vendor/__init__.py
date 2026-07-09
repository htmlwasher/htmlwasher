# The staged Node CLI tree is materialized under _vendor/cli at wheel-build time
# by scripts/stage_vendor.py (gitignored; force-included via the wheel `artifacts`
# glob). This package marker exists so importlib.resources can traverse the tree.
