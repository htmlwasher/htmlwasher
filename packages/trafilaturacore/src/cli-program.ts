// SPDX-License-Identifier: Apache-2.0
// CLI program for trafilaturacore — modeled on contextractor's standalone CLI shape
// (buildProgram / runCli / isMainEntry) but OFFLINE-ONLY: it never fetches a URL.
//
// trafilaturacore is HTML in → cleaned HTML out. The CLI reads HTML from a file
// argument or stdin, runs clean(), and writes cleaned HTML (or the full JSON
// result) to stdout or a file. The `--url` flag is context only (classifier URL
// heuristics + metadata) and is never fetched.

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { clean } from './index.js';
import {
  type BoilerplateMode,
  type CleanConfig,
  cleanConfigError,
  DEFAULT_BOILERPLATE_MODE,
  isBoilerplateMode,
} from './types.js';

// The package version, resolved at runtime relative to this file: from src/ in
// development and from the bundled dist/ output alike, `../package.json` is the
// package-root manifest, so the CLI reports the version it shipped with.
const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

/**
 * Option parser for `--boilerplate`: validate against the runtime guard so a bad
 * value fails fast with a clear message instead of silently reaching clean().
 */
function parseBoilerplate(value: string): BoilerplateMode {
  if (!isBoilerplateMode(value)) {
    throw new Error(
      `Invalid --boilerplate value: '${value}'. Use precision, balanced, recall, or keep.`,
    );
  }
  return value;
}

/**
 * The fully-resolved options the testable {@link runClean} core consumes. The
 * commander action parses argv into this shape and calls runClean with the real
 * process streams; tests build it directly with in-memory streams.
 */
export interface ResolvedCliOptions {
  /** Path to an HTML file, `-`, or `undefined` → read from stdin. */
  input?: string;
  boilerplate: BoilerplateMode;
  /** Path to a custom cleaning-config `.json` file. Replaces the default config. */
  config?: string;
  /** Content-inclusion toggles (from `--no-comments`/`--no-tables`/`--no-images`/`--no-links`). Default keep. */
  includeComments?: boolean;
  includeTables?: boolean;
  includeImages?: boolean;
  includeLinks?: boolean;
  minify: boolean;
  /** Context only — never fetched. */
  url?: string;
  /** Write the result to this file instead of stdout. */
  output?: string;
  /** Emit the full result as pretty JSON instead of just HTML. */
  json: boolean;
  /** Suppress the diagnostic/messages + page-type line on stderr. */
  quiet: boolean;
}

/** The three I/O streams runClean reads/writes — injected for testability. */
export interface CliIo {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

/** Drain a readable stream fully to a UTF-8 string. */
async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Write a chunk to a stream and resolve once it has been flushed. */
function writeChunk(stream: Writable, content: string): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    stream.write(content, (error) => {
      // A reader that closed early (`| head`) ends the stream quietly (EPIPE);
      // treat it as success rather than crashing the CLI.
      if (!error || (error as NodeJS.ErrnoException).code === 'EPIPE') resolveWrite();
      else rejectWrite(error);
    });
  });
}

/**
 * The testable CLI core: read input (file or stdin), run clean(), write HTML or
 * JSON to stdout / `-o`, write diagnostics to stderr unless quiet, and return an
 * exit code (0 success, 1 handled error). Never calls process.exit().
 */
export async function runClean(opts: ResolvedCliOptions, io: CliIo): Promise<number> {
  // --- Resolve input ---
  let html: string;
  const fromStdin = opts.input === undefined || opts.input === '-';
  if (fromStdin) {
    // A bare invocation with no piped input and an interactive TTY would hang
    // forever waiting on stdin — fail clearly instead.
    if ((io.stdin as Readable & { isTTY?: boolean }).isTTY) {
      io.stderr.write('Error: no input. Pass an HTML file argument or pipe HTML to stdin.\n');
      return 1;
    }
    html = await readStream(io.stdin);
    if (html.length === 0) {
      io.stderr.write('Error: empty stdin — no HTML to clean.\n');
      return 1;
    }
  } else {
    const inputPath = opts.input as string;
    try {
      html = await readFile(inputPath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`Error: cannot read input file '${inputPath}': ${message}\n`);
      return 1;
    }
  }

  // --- Resolve a custom cleaning config (--config <file.json>), if given ---
  // Read + JSON.parse + validate at the boundary, exactly like the library;
  // when supplied it replaces the default Trafilatura-aligned config.
  let config: CleanConfig | undefined;
  if (opts.config !== undefined) {
    let raw: string;
    try {
      raw = await readFile(opts.config, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`Error: cannot read config file '${opts.config}': ${message}\n`);
      return 1;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`Error: config file '${opts.config}' is not valid JSON: ${message}\n`);
      return 1;
    }
    const configError = cleanConfigError(parsed);
    if (configError !== null) {
      io.stderr.write(`Error: invalid cleaning config '${opts.config}': ${configError}\n`);
      return 1;
    }
    config = parsed as CleanConfig;
  }

  // --- Run clean (offline; url is context only, never fetched) ---
  const result = await clean(html, {
    boilerplate: opts.boilerplate,
    config,
    includeComments: opts.includeComments,
    includeTables: opts.includeTables,
    includeImages: opts.includeImages,
    includeLinks: opts.includeLinks,
    minify: opts.minify,
    url: opts.url,
  });

  // --- Emit primary output ---
  const out = opts.json
    ? `${JSON.stringify(
        {
          html: result.html,
          metadata: result.metadata,
          pageType: result.pageType,
          confidence: result.confidence,
          messages: result.messages,
        },
        null,
        2,
      )}\n`
    : result.html;

  if (opts.output !== undefined) {
    try {
      await writeFile(opts.output, out);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`Error: cannot write output file '${opts.output}': ${message}\n`);
      return 1;
    }
    if (!opts.quiet) io.stderr.write(`Wrote ${resolve(opts.output)}\n`);
  } else {
    await writeChunk(io.stdout, out);
  }

  // --- Diagnostics on stderr (suppressed by --quiet; skipped when --json,
  //     which already carries messages/pageType in its payload) ---
  if (!opts.quiet && !opts.json) {
    for (const message of result.messages) {
      io.stderr.write(`[${message.type}] ${message.text}\n`);
    }
    if (result.pageType !== undefined) {
      const conf = result.confidence !== undefined ? ` ${result.confidence.toFixed(3)}` : '';
      io.stderr.write(`[${result.pageType}${conf}]\n`);
    }
  }

  return 0;
}

/**
 * Build the commander program. Named `trafilaturacore`; one positional `[input]`
 * (file path, `-`, or omitted → stdin) and the clean() option knobs. The action
 * parses argv into {@link ResolvedCliOptions} and runs {@link runClean} against
 * the real process streams.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('trafilaturacore')
    .description(
      'Clean HTML: boilerplate removal + sanitize/normalize/format. ' +
        'HTML in → cleaned HTML out (offline; never fetches).',
    )
    .version(packageVersion)
    .argument('[input]', 'path to an HTML file; omit or use "-" to read HTML from stdin')
    .option(
      '-b, --boilerplate <mode>',
      'boilerplate-removal mode: precision | balanced | recall | keep',
      parseBoilerplate,
      DEFAULT_BOILERPLATE_MODE,
    )
    .option(
      '-c, --config <file.json>',
      'custom cleaning config (JSON CleanConfig); replaces the default config',
    )
    .option('--no-comments', 'drop comments (soft no-op: comment retention follows the page type)')
    .option('--no-tables', 'drop table subtrees (table/caption/tr/td/th/colgroup/col)')
    .option('--no-images', 'drop image subtrees (img/figure/figcaption/picture/source)')
    .option('--no-links', 'unwrap <a> links: keep the anchor text, drop the href')
    .option('-m, --minify', 'minify the output HTML instead of pretty-formatting it', false)
    .option('-u, --url <url>', 'source URL for classifier/metadata context only — NEVER fetched')
    .option('-o, --output <file>', 'write the result to a file instead of stdout')
    .option('--json', 'emit the full result as pretty JSON (html, metadata, pageType, …)', false)
    .option('-q, --quiet', 'suppress the diagnostics + page-type line on stderr', false)
    .action(async (input: string | undefined, opts: CommanderOptions) => {
      const resolved: ResolvedCliOptions = {
        input,
        boilerplate: opts.boilerplate,
        config: opts.config,
        includeComments: opts.comments,
        includeTables: opts.tables,
        includeImages: opts.images,
        includeLinks: opts.links,
        minify: opts.minify,
        url: opts.url,
        output: opts.output,
        json: opts.json,
        quiet: opts.quiet,
      };
      const code = await runClean(resolved, {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
      });
      if (code !== 0) {
        // Set the exit code without exiting mid-pipe so stdout flushes; runCli /
        // commander returns and the process exits with this code naturally.
        process.exitCode = code;
      }
    });

  return program;
}

/** The shape commander hands the action for the options registered above. */
interface CommanderOptions {
  boilerplate: BoilerplateMode;
  config?: string;
  /** `--no-*` negations: commander defaults each to `true`, `--no-x` sets it `false`. */
  comments: boolean;
  tables: boolean;
  images: boolean;
  links: boolean;
  minify: boolean;
  url?: string;
  output?: string;
  json: boolean;
  quiet: boolean;
}

/**
 * stdout carries raw cleaned HTML; a reader that closes early (`| head`) must
 * end the stream quietly instead of crashing the CLI with an uncaught EPIPE.
 * Module-level so repeated runCli calls (tests) attach the listener once.
 */
const swallowStdoutEpipe = (error: NodeJS.ErrnoException): void => {
  if (error.code !== 'EPIPE') throw error;
};

/**
 * Parse argv and run the program. On a thrown error, set `process.exitCode = 1`
 * and report on stderr — never call `process.exit()` mid-pipe, so any queued
 * stdout flushes before the process ends.
 */
export async function runCli(program: Command, argv: string[]): Promise<void> {
  if (!process.stdout.listeners('error').includes(swallowStdoutEpipe)) {
    process.stdout.on('error', swallowStdoutEpipe);
  }
  // Commander's default behavior calls process.exit on errors/help; we want it
  // to throw so we control flushing.
  program.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    // Help/version requests throw a benign override error with exitCode 0.
    const overrideCode = (error as { exitCode?: number }).exitCode;
    if (typeof overrideCode === 'number') {
      if (overrideCode !== 0) process.exitCode = overrideCode;
      return;
    }
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/** Is this module the program's main entry point? realpath-compare like contextractor. */
export function isMainEntry(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return fileURLToPath(metaUrl) === realpathSync(resolve(argv1));
  } catch {
    return false;
  }
}
