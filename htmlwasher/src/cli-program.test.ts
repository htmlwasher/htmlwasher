import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { buildProgram, type CliIo, type ResolvedCliOptions, runWash } from './cli-program.js';
import { DEFAULT_BOILERPLATE_MODE, DEFAULT_WASHING_LEVEL } from './types.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/classifier/0488.html', import.meta.url));

const SCRATCH =
  '/private/tmp/claude-501/-Users-miroslavsekera-r-htmlwasher/52b04631-938a-4661-9405-ebbaaf5aef1a/scratchpad';

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
    level: DEFAULT_WASHING_LEVEL,
    minify: false,
    json: false,
    quiet: false,
    ...overrides,
  };
}

const tmpFiles: string[] = [];
function tmpPath(name: string): string {
  const p = join(SCRATCH, `cli-test-${Date.now()}-${name}`);
  tmpFiles.push(p);
  return p;
}

afterAll(async () => {
  await Promise.all(tmpFiles.map((p) => rm(p, { force: true })));
});

describe('runWash', () => {
  it('default mode emits cleaned HTML to stdout (no <script>, keeps article text)', async () => {
    const io = makeIo(PAGE);
    const code = await runWash(opts({ input: '-' }), io);
    expect(code).toBe(0);
    expect(io.stdout.text).toContain('genuine article body');
    expect(io.stdout.text).not.toMatch(/<script/i);
    expect(io.stdout.text).not.toContain('© 2026');
  });

  it('reads from a real fixture file path', async () => {
    const io = makeIo();
    const code = await runWash(opts({ input: FIXTURE }), io);
    expect(code).toBe(0);
    expect(io.stdout.text.length).toBeGreaterThan(0);
    expect(io.stdout.text).not.toMatch(/<script/i);
  });

  it('--minify output is shorter and has no double spaces vs non-minified', async () => {
    const plain = makeIo(PAGE);
    await runWash(opts({ input: '-', boilerplate: 'none' }), plain);
    const minified = makeIo(PAGE);
    await runWash(opts({ input: '-', boilerplate: 'none', minify: true }), minified);
    expect(minified.stdout.text.length).toBeLessThanOrEqual(plain.stdout.text.length);
    expect(minified.stdout.text).not.toMatch(/ {2}/);
  });

  it('--json emits valid JSON with html + pageType keys', async () => {
    const io = makeIo(PAGE);
    const code = await runWash(opts({ input: '-', json: true }), io);
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
    const code = await runWash(opts({ input: '-', boilerplate: 'none', level: 'correct' }), io);
    expect(code).toBe(0);
    expect(io.stdout.text).toContain('<custom-x>');
  });

  it('-o <file> writes the file and stdout stays empty', async () => {
    const out = tmpPath('out.html');
    const io = makeIo(PAGE);
    const code = await runWash(opts({ input: '-', output: out }), io);
    expect(code).toBe(0);
    expect(io.stdout.text).toBe('');
    const written = await readFile(out, 'utf8');
    expect(written).toContain('genuine article body');
    expect(io.stderr.text).toContain('Wrote ');
  });

  it('--quiet suppresses the stderr diagnostics + page-type line', async () => {
    const io = makeIo(PAGE);
    const code = await runWash(opts({ input: '-', quiet: true }), io);
    expect(code).toBe(0);
    expect(io.stderr.text).toBe('');
  });

  it('writes the page-type line to stderr when extracting (non-quiet)', async () => {
    const io = makeIo(PAGE);
    await runWash(opts({ input: '-' }), io);
    // [<pageType> <confidence>] line
    expect(io.stderr.text).toMatch(
      /\[(article|forum|product|collection|listing|documentation|service)/,
    );
  });

  it('missing input file → exit code 1 + stderr error', async () => {
    const io = makeIo();
    const code = await runWash(opts({ input: '/no/such/file/at/all.html' }), io);
    expect(code).toBe(1);
    expect(io.stdout.text).toBe('');
    expect(io.stderr.text).toMatch(/cannot read input file/i);
  });

  it('empty stdin → exit code 1 + stderr error', async () => {
    const io = makeIo('');
    const code = await runWash(opts({ input: '-' }), io);
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
      program.parse(['node', 'htmlwasher', ...argv]);
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
