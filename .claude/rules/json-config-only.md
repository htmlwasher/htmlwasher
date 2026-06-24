# JSON Config Only in Documentation

All documentation, help text, examples, and user-facing references must use JSON for configuration files — never YAML.

## Rule

- Document config files as `.json` only (e.g., `config.json`, not `config.yaml`)
- CLI help strings: "Path to JSON config file"
- Examples: always show JSON format
- README, specs, JSDoc: reference JSON config only

## Implementation Note

Any config file referenced in docs or examples is JSON only — no YAML handling. Keep YAML out of all documentation, help text, and examples.
