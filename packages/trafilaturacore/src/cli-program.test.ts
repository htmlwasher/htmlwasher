import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildProgram, type CliIo, type ResolvedCliOptions, runClean } from './cli-program.js';
import { DEFAULT_BOILERPLATE_MODE, DEFAULT_CLEANING_LEVEL } from './types.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/classifier/0488.html', import.meta.url));

// A per-run OS temp directory (created in beforeAll) where the CLI tests write
// their config/output fixtures. Never hardcode a session scratchpad path — those
// are per-session and get cleaned up, ENOENT-ing this suite on any later run.
let scratchDir: string;

const PAGE = `<!doctype html><html><head><title>Real Title — Site</title>
<script>tracker()</script></head>
<body>
  <nav><a href="/">Home</a></nav>
  <main><article class="article-content">
    <h1>Real Title</h1>
    <p>This is the genuine article body with enough words to be selected as the main content of the page.</p>
    <p>A second paragraph with a little more text so the extractor keeps this block.</p>
  </article></main>
  <footer class="site-footer">© 2026</footer>
</body></html>`;

/** A Writable that collects everything written to it as a UTF-8 string. */
class StringSink extends Writable {
  text = '';
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void): void {
    this.text += chunk.toString();
    cb();
  }
}

/** A fake non-TTY stdin pre-loaded with `html` (empty string → empty stdin). */
function fakeStdin(html: string): PassThrough {
  const stream = new PassThrough();
  if (html.length > 0) stream.end(html);
  else stream.end();
  return stream;
}

/** Build a CliIo with a fake stdin and string-collecting stdout/stderr. */
function makeIo(stdinHtml = ''): CliIo & { stdout: StringSink; stderr: StringSink } {
  return {
    stdin: fakeStdin(stdinHtml),
    stdout: new StringSink(),
    stderr: new StringSink(),
  };
}

/** Defaults matching buildProgram, overridable per test. */
function opts(overrides: Partial<ResolvedCliOptions> = {}): ResolvedCliOptions {
  return {
    boilerplate: DEFAULT_BOILERPLATE_MODE,
    level: DEFAULT_CLEANING_LEVEL,
    minify: false,
    json: false,
    quiet: false,
    ...overrides,
  };
}

function tmpPath(name: string): string {
  return join(scratchDir, `cli-test-${Date.now()}-${name}`);
}

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'trafilaturacore-cli-test-'));
});

afterAll(async () => {
  if (scratchDir !== undefined) await rm(scratchDir, { recursive: true, force: true });
});

describe('runClean', () => {
  it('default mode emits cleaned HTML to stdout (no <script>, keeps article text)', async () => {
    const io = makeIo(PAGE);
    const code = await runClean(opts({ input: '-' }), io);
    expect(code).toBe(0);
    expect(io.stdout.text).toContain('genuine article body');
    expect(io.stdout.text).not.toMatch(/<script/i);
    expect(io.stdout.text).not.toContain('© 2026');
  });

  it('reads from a real fixture file path', async () => {
    const io = makeIo();
    const code = await runClean(opts({ input: FIXTURE }), io);
    expect(code).toBe(0);
    expect(io.stdout.text.length).toBeGreaterThan(0);
    expect(io.stdout.text).not.toMatch(/<script/i);
  });

  it('--minify output is shorter and has no double spaces vs non-minified', async () => {
    const plain = makeIo(PAGE);
    await runClean(opts({ input: '-', boilerplate: 'none' }), plain);
    const minified = makeIo(PAGE);
    await runClean(opts({ input: '-', boilerplate: 'none', minify: true }), minified);
    expect(minified.stdout.text.length).toBeLessThanOrEqual(plain.stdout.text.length);
    expect(minified.stdout.text).not.toMatch(/ {2}/);
  });

  it('--json emits valid JSON with html + pageType keys', async () => {
    const io = makeIo(PAGE);
    const code = await runClean(opts({ input: '-', json: true }), io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.stdout.text) as Record<string, unknown>;
    expect(typeof parsed.html).toBe('string');
    expect('pageType' in parsed).toBe(true);
    expect('messages' in parsed).toBe(true);
    // --json keeps stderr clean (payload already carries messages + pageType)
    expect(io.stderr.text).toBe('');
  });

  it('--boilerplate none --level correct passes markup through', async () => {
    const io = makeIo('<div><custom-x>hi there words</custom-x></div>');
    const code = await runClean(opts({ input: '-', boilerplate: 'none', level: 'correct' }), io);
    expect(code).toBe(0);
    expect(io.stdout.text).toContain('<custom-x>');
  });

  it('-o <file> writes the file and stdout stays empty', async () => {
    const out = tmpPath('out.html');
    const io = makeIo(PAGE);
    const code = await runClean(opts({ input: '-', output: out }), io);
    expect(code).toBe(0);
    expect(io.stdout.text).toBe('');
    const written = await readFile(out, 'utf8');
    expect(written).toContain('genuine article body');
    expect(io.stderr.text).toContain('Wrote ');
  });

  it('-c <file.json> applies a custom config and wins over --level', async () => {
    const cfg = tmpPath('config.json');
    await writeFile(cfg, JSON.stringify({ allowedTags: ['p'] }));
    const io = makeIo('<div><p>Hi there words</p><span>x</span></div>');
    const code = await runClean(
      opts({ input: '-', boilerplate: 'none', level: 'permissive', config: cfg }),
      io,
    );
    expect(code).toBe(0);
    expect(io.stdout.text).toContain('<p>Hi there words</p>');
    expect(io.stdout.text).not.toContain('<div');
    expect(io.stdout.text).not.toContain('<span');
  });

  it('a missing config file exits 1 with a clear stderr message', async () => {
    const io = makeIo(PAGE);
    const code = await runClean(opts({ input: '-', config: '/no/such/config.json' }), io);
    expect(code).toBe(1);
    expect(io.stderr.text).toMatch(/cannot read config file/);
  });

  it('a non-JSON config file exits 1', async () => {
    const cfg = tmpPath('bad.json');
    await writeFile(cfg, 'not json {');
    const io = makeIo(PAGE);
    const code = await runClean(opts({ input: '-', config: cfg }), io);
    expect(code).toBe(1);
    expect(io.stderr.text).toMatch(/not valid JSON/);
  });

  it('an invalid-shape config exits 1 with the boundary message', async () => {
    const cfg = tmpPath('shape.json');
    await writeFile(cfg, JSON.stringify({ bogus: true }));
    const io = makeIo(PAGE);
    const code = await runClean(opts({ input: '-', config: cfg }), io);
    expect(code).toBe(1);
    expect(io.stderr.text).toMatch(/invalid cleaning config.*unknown field 'bogus'/);
  });

  it('--quiet suppresses the stderr diagnostics + page-type line', async () => {
    const io = makeIo(PAGE);
    const code = await runClean(opts({ input: '-', quiet: true }), io);
    expect(code).toBe(0);
    expect(io.stderr.text).toBe('');
  });

  it('writes the page-type line to stderr when extracting (non-quiet)', async () => {
    const io = makeIo(PAGE);
    await runClean(opts({ input: '-' }), io);
    // [<pageType> <confidence>] line
    expect(io.stderr.text).toMatch(
      /\[(article|forum|product|collection|listing|documentation|service)/,
    );
  });

  it('missing input file → exit code 1 + stderr error', async () => {
    const io = makeIo();
    const code = await runClean(opts({ input: '/no/such/file/at/all.html' }), io);
    expect(code).toBe(1);
    expect(io.stdout.text).toBe('');
    expect(io.stderr.text).toMatch(/cannot read input file/i);
  });

  it('empty stdin → exit code 1 + stderr error', async () => {
    const io = makeIo('');
    const code = await runClean(opts({ input: '-' }), io);
    expect(code).toBe(1);
    expect(io.stderr.text).toMatch(/empty stdin/i);
  });
});

describe('option validation (parser layer)', () => {
  // exitOverride makes commander throw a CommanderError instead of exiting; the
  // custom argParser throws a plain Error on a bad enum value, which commander
  // surfaces as an invalidArgument error. Both carry a non-zero exitCode and a
  // message that names the bad value.
  function parse(argv: string[]): { exitCode: number; message: string } {
    const program = buildProgram().exitOverride();
    let captured = '';
    program.configureOutput({
      writeErr: (s) => {
        captured += s;
      },
      writeOut: (s) => {
        captured += s;
      },
    });
    try {
      program.parse(['node', 'trafilaturacore', ...argv]);
      return { exitCode: 0, message: captured };
    } catch (error) {
      const code = (error as { exitCode?: number }).exitCode ?? 1;
      const msg = error instanceof Error ? error.message : String(error);
      return { exitCode: code === 0 ? 0 : code, message: `${msg}\n${captured}` };
    }
  }

  it('invalid --boilerplate xyz returns a non-zero code + clear message', () => {
    const { exitCode, message } = parse(['x.html', '--boilerplate', 'xyz']);
    expect(exitCode).not.toBe(0);
    expect(message).toMatch(/boilerplate/i);
    expect(message).toMatch(/xyz/);
  });

  it('invalid --level xyz returns a non-zero code + clear message', () => {
    const { exitCode, message } = parse(['x.html', '--level', 'xyz']);
    expect(exitCode).not.toBe(0);
    expect(message).toMatch(/level/i);
    expect(message).toMatch(/xyz/);
  });
});

describe('commander action handled-error exit path', () => {
  it('a failing input sets exit code 1 with no stray trailing blank line on stderr', async () => {
    // The action runs runClean against the real process streams, then sets
    // process.exitCode. With the old `command.error('', …)` call gone, no empty
    // message is routed through writeErr, so stderr must not gain a lone extra \n.
    const savedExitCode = process.exitCode;
    let captured = '';
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        captured += chunk.toString();
        return true;
      });
    try {
      const program = buildProgram().exitOverride();
      await program.parseAsync(['node', 'trafilaturacore', '/no/such/file/at/all.html']);
      expect(process.exitCode).toBe(1);
      // The only stderr is runClean's single-line read error — no double newline.
      expect(captured).toMatch(/cannot read input file/i);
      expect(captured.endsWith('\n\n')).toBe(false);
    } finally {
      stderrSpy.mockRestore();
      process.exitCode = savedExitCode;
    }
  });
});
