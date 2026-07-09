#!/usr/bin/env python3
"""Stage the flattened trafilaturacore CLI tree into the wheel's ``_vendor`` dir.

The Python wrapper ships the Node CLI as its **built tsup bundle** (``dist/``)
plus a real-file ``node_modules`` tree — the bundle keeps the public runtime deps
(``commander``, ``sanitize-html``, ``linkedom``, ``parse5``, ``prettier``,
``chardet``, ``html-minifier-terser``, ``iconv-lite``) EXTERNAL, so they must
resolve from ``node_modules`` at runtime. Wheels cannot carry symlinks, so the JS
is flattened with ``pnpm deploy --config.node-linker=hoisted`` first (real files),
then copied here. The napi ``.node`` prebuilds are already staged under
``dist/native/`` by the engine's tsup build; the loader ``dist/native/index.cjs``
picks the matching one at runtime.

Pipeline (run from the engine workspace root, per platform, before ``python -m
build`` / cibuildwheel):

    pnpm install
    pnpm exec turbo run build --filter=trafilaturacore
    pnpm --filter trafilaturacore deploy --prod --config.node-linker=hoisted _cli_deploy
    python packages/standalone-python/scripts/stage_vendor.py \
        --deploy-dir _cli_deploy --keep-platform <napi-platform>

``--keep-platform`` (e.g. ``darwin-arm64``, ``win32-x64-msvc``) prunes every other
platform's prebuilt ``.node`` under ``dist/native/`` so each wheel carries only its
own. ``@trafilaturacore/native`` is a private ``workspace:*`` dep bundled into the
tsup output, so it never appears under ``node_modules`` — no legacy per-platform
package pruning is needed (unlike contextractor's earlier layout).
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDOR = HERE.parent / "src" / "trafilaturacore" / "_vendor"
CLI_DEST = VENDOR / "cli"
# Bundled layout: every committed target's prebuild staged next to the napi loader
# under dist/native/ by the engine tsup build.
NATIVE_DIST_GLOB = "dist/native/trafilaturacore-native.*.node"


def stage(deploy_dir: Path, keep_platform: str | None) -> None:
    if not (deploy_dir / "dist" / "cli.js").is_file():
        raise SystemExit(
            f"deploy dir {deploy_dir} has no dist/cli.js — run "
            "`pnpm exec turbo run build --filter=trafilaturacore` and `pnpm deploy` first"
        )
    if CLI_DEST.exists():
        shutil.rmtree(CLI_DEST)
    # symlinks=False dereferences pnpm's virtual-store symlinks into real files —
    # wheels cannot carry symlinks.
    shutil.copytree(deploy_dir, CLI_DEST, symlinks=False)
    _ensure_esm(CLI_DEST / "package.json")
    if keep_platform:
        _prune_other_platforms(CLI_DEST, keep_platform)
    _seed_init_py(VENDOR)


def _ensure_esm(package_json: Path) -> None:
    # `pnpm deploy` rewrites package.json and can drop `"type": "module"`; the CLI
    # is ESM, so restore it (Node resolves the nearest package.json for dist/cli.js).
    data = json.loads(package_json.read_text(encoding="utf-8"))
    if data.get("type") != "module":
        data["type"] = "module"
        package_json.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _prune_other_platforms(root: Path, keep: str) -> None:
    keep_file = f"trafilaturacore-native.{keep}.node"
    for node_file in root.glob(NATIVE_DIST_GLOB):
        if node_file.name != keep_file:
            node_file.unlink(missing_ok=True)


def _seed_init_py(root: Path) -> None:
    # importlib.resources requires an __init__.py in every resource subdir.
    root.mkdir(parents=True, exist_ok=True)
    dirs = [root, *(p for p in root.rglob("*") if p.is_dir())]
    for directory in dirs:
        init = directory / "__init__.py"
        if not init.exists():
            init.write_text("", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy-dir", required=True, type=Path)
    parser.add_argument("--keep-platform", default=None)
    args = parser.parse_args()
    stage(args.deploy_dir.resolve(), args.keep_platform)


if __name__ == "__main__":
    main()
