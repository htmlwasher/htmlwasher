#!/usr/bin/env bash
# Build the trafilaturacore Python wrapper from source and run the examples.
#
# Builds a local platform wheel (which bundles the Node CLI), installs it into a
# throwaway .venv, and runs both example scripts — useful for testing unreleased
# changes. Released users only need:
#   pip install trafilaturacore
#
# Requirements: pnpm, uv, python3 — but NOT Node.js (the wheel bundles a Node
# runtime via nodejs-wheel-binaries). trafilaturacore never fetches the network,
# so there is no browser to provision.
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${EXAMPLE_DIR}/../.." && pwd)"
PY_PKG="${REPO_ROOT}/packages/standalone-python"

# Pick the napi prebuild to keep in the wheel (one per platform).
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  NAPI_PLATFORM=darwin-arm64 ;;
  Darwin-x86_64) NAPI_PLATFORM=darwin-x64 ;;
  Linux-x86_64)  NAPI_PLATFORM=linux-x64-gnu ;;
  Linux-aarch64) NAPI_PLATFORM=linux-arm64-gnu ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
echo ">>> platform: ${NAPI_PLATFORM}"

cd "${REPO_ROOT}"

echo ">>> [1/5] install workspace deps"
pnpm install

echo ">>> [2/5] build the trafilaturacore CLI (dist/cli.js + dist/native/)"
pnpm --filter trafilaturacore build

echo ">>> [3/5] flatten the CLI tree (hoisted node-linker — npm-style real files)"
rm -rf _cli_deploy
pnpm --filter trafilaturacore deploy --prod --config.node-linker=hoisted _cli_deploy

echo ">>> [4/5] stage the bundled CLI assets into the wheel source tree"
python3 packages/standalone-python/scripts/stage_vendor.py \
  --deploy-dir _cli_deploy --keep-platform "${NAPI_PLATFORM}"

echo ">>> [5/5] build the platform wheel, create .venv, install it"
rm -rf "${PY_PKG}/dist"
( cd "${PY_PKG}" && uv build --wheel )
WHEEL="$(ls -t "${PY_PKG}"/dist/trafilaturacore-*.whl | head -1)"
echo "    built ${WHEEL}"

cd "${EXAMPLE_DIR}"
rm -rf .venv
uv venv .venv
uv pip install --python .venv/bin/python "${WHEEL}"

echo ">>> run main.py (sync clean)"
.venv/bin/python main.py

echo ">>> run async_example.py (async aclean)"
.venv/bin/python async_example.py

echo ">>> done"
