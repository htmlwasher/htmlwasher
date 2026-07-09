import { access, copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Options } from 'tsup';

/** The esbuild plugin shape, derived from tsup so no direct esbuild import is needed. */
type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

// The napi-rs crate lives INSIDE this package (native/), unlike contextractor's
// sibling layout — so NATIVE_DIR is one level down, not `../extraction/native`.
const NATIVE_DIR = path.join(__dirname, 'native');

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

// The napi-rs loader stays an external CJS file next to the bundle (it locates its
// `.node` via a relative require against its own dir); redirect the bare
// `@trafilaturacore/native` specifier to it so the crate is never bundled/resolved.
const nativeAddonRedirect: EsbuildPlugin = {
  name: 'native-addon-redirect',
  setup(build) {
    build.onResolve({ filter: /^@trafilaturacore\/native$/ }, () => ({
      path: './native/index.cjs',
      external: true,
    }));
  },
};

/**
 * The published/consumed `trafilaturacore` package must carry NO
 * `@trafilaturacore/native` runtime dependency — that crate is a `private: true`
 * `workspace:*` package, so a plain-`tsc` build leaves an unresolvable dep and the
 * website's `file:` consumption (trafilatura-web/api) breaks. This bundles the TS
 * shell into `dist/` and stages the napi-rs loader plus every committed `.node`
 * prebuild under `dist/native/`, where the loader's relative-require branch picks
 * the right one at runtime. Public deps (sanitize-html, linkedom, parse5, …) stay
 * external regular `dependencies`. Types come from `tsc --emitDeclarationOnly`
 * (the public `clean()` surface never references native — see pipeline.ts), so no
 * api-extractor rollup is needed.
 */
export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Declarations come from `tsc -p tsconfig.json --emitDeclarationOnly` (the build
  // script) — the public type surface is native-free, so a plain tsc dts suffices.
  dts: false,
  clean: true,
  sourcemap: false,
  // Split shared code into chunks emitted into the dist/ root so the relative
  // `./native/index.cjs` external below resolves from both cli.js and index.js
  // (and any chunk), and cli.ts's own `isMainEntry(import.meta.url)` check stays
  // in the cli entry chunk.
  splitting: true,
  noExternal: [/^@trafilaturacore\//],
  // tsup auto-externalizes `dependencies` but NOT `optionalDependencies`. The
  // hardened DOMPurify/jsdom backend is opt-in and heavy (jsdom ~5 MB) — keep it
  // external so it is resolved from node_modules only when a consumer installs it.
  external: ['dompurify', 'jsdom'],
  banner: {
    // The staged napi loader is CJS; give the ESM output a `require` for any
    // bundled CJS access. The aliased name avoids colliding with source-level
    // createRequire imports.
    js: "import { createRequire as __bundleCreateRequire } from 'node:module'; const require = __bundleCreateRequire(import.meta.url);",
  },
  esbuildPlugins: [nativeAddonRedirect],
  async onSuccess() {
    const outNative = path.join(__dirname, 'dist', 'native');
    await mkdir(outNative, { recursive: true });
    // The napi-rs loader (requires its platform `.node` relative to itself).
    await copyFile(path.join(NATIVE_DIR, 'index.js'), path.join(outNative, 'index.cjs'));

    // Stage every COMMITTED per-target prebuild under native/npm/<target>/ that
    // actually carries a `.node` (partial prebuilds are expected before the
    // build-native CI refresh populates all six targets), plus any freshly-built
    // local `.node` next to the crate — so at least the host arch is present.
    const staged = new Set<string>();
    const npmDir = path.join(NATIVE_DIR, 'npm');
    if (await exists(npmDir)) {
      const targets = (await readdir(npmDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      for (const target of targets) {
        const file = `trafilaturacore-native.${target}.node`;
        const src = path.join(npmDir, target, file);
        if (await exists(src)) {
          await copyFile(src, path.join(outNative, file));
          staged.add(file);
        }
      }
    }
    for (const entry of await readdir(NATIVE_DIR)) {
      if (entry.endsWith('.node') && !staged.has(entry)) {
        await copyFile(path.join(NATIVE_DIR, entry), path.join(outNative, entry));
        staged.add(entry);
      }
    }
    if (staged.size === 0) {
      throw new Error(
        `no native prebuilds staged into ${outNative} — the tarball would ship without a loadable addon`,
      );
    }

    // Ship the Apache-2.0 LICENSE + third-party NOTICE in dist/ (the PyPI wheel
    // vendors this dist tree). Both sit at the workspace root in the engine AND
    // the mirror — two levels up from this package — so one resolution works in both.
    const resolveDoc = async (name: string): Promise<string> => {
      const candidate = path.join(__dirname, '..', '..', name);
      if (!(await exists(candidate))) {
        throw new Error(`tsup: could not locate ${name} at the workspace root (${candidate})`);
      }
      return candidate;
    };
    await copyFile(await resolveDoc('NOTICE'), path.join(__dirname, 'dist', 'NOTICE'));
    await copyFile(await resolveDoc('LICENSE'), path.join(__dirname, 'dist', 'LICENSE'));
  },
});
