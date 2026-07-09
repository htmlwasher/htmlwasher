# trafilaturacore — PyPI library example

Shows the Python wrapper's public API: the sync `clean()` and the async
`aclean()`, the four boilerplate modes, the tri-state content toggles, a custom
JSON cleaning config, and the boundary guards.

The wrapper is a thin subprocess shim over the bundled Node CLI — Python never
loads the native `.node` module, and nothing touches the network: HTML in,
cleaned HTML out.

> The PyPI package is an **alpha, experimental** build — maintained, but not
> fully tested or officially supported.

## Run against the released package

```bash
pip install trafilaturacore
python main.py
python async_example.py
```

## Run against this checkout (unreleased changes)

`./run.sh` builds a local platform wheel (which bundles the Node CLI), installs
it into a throwaway `.venv`, and runs both example scripts. It needs `pnpm`,
`uv`, and `python3` — but **not** a system Node.js install.

```bash
./run.sh
```
