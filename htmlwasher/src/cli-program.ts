// SPDX-License-Identifier: Apache-2.0
// CLI program for htmlwasher — modeled on contextractor's standalone CLI shape
// (buildProgram / runCli / isMainEntry) but OFFLINE-ONLY: it never fetches a URL.
//
// htmlwasher is HTML in → cleaned HTML out. The CLI reads HTML from a file
// argument or stdin, runs wash(), and writes cleaned HTML (or the full JSON
// result) to stdout or a file. The `--url` flag is context only (classifier URL
// heuristics + metadata) and is never fetched.

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { wash } from './index.js';
import {
  type BoilerplateMode,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_WASHING_LEVEL,
  isBoilerplateMode,
  isWashingLevel,
  type SanitizeConfig,
  sanitizeConfigError,
  type WashingLevel,
} from './types.js';

// The package version, resolved at runtime relative to this file: from src/ in
// development and from the bundled dist/ output alike, `../package.json` is the
// package-root manifest, so the CLI reports the version it shipped with.
const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

/**
 * Option parser for `--boilerplate`: validate against the runtime guard so a bad
 * value fails fast with a clear message instead of silently reaching wash().
 */
function parseBoilerplate(value: string): BoilerplateMode {
  if (!isBoilerplateMode(value)) {
    throw new Error(
      `Invalid --boilerplate value: '${value}'. Use precision, balanced, recall, or none.`,
    );
  }
  return value;
}

/** Option parser for `--level`: validate against the runtime guard. */
function parseLevel(value: string): WashingLevel {
  if (!isWashingLevel(value)) {
    throw new Error(
      `Invalid --level value: '${value}'. Use minimal, standard, permissive, styled, or correct.`,
    );
  }
  return value;
}

/**
 * The fully-resolved options the testable {@link runWash} core consumes. The
 * commander action parses argv into this shape and calls runWash with the real
 * process streams; tests build it directly with in-memory streams.
 */
export interface ResolvedCliOptions {
  /** Path to an HTML file, `-`, or `undefined` → read from stdin. */
  input?: string;
  boilerplate: BoilerplateMode;
  level: WashingLevel;
  /** Path to a custom washing-config `.json` file. Takes precedence over `level`. */
  config?: string;
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

/** The three I/O streams runWash reads/writes — injected for testability. */
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
 * The testable CLI core: read input (file or stdin), run wash(), write HTML or
 * JSON to stdout / `-o`, write diagnostics to stderr unless quiet, and return an
 * exit code (0 success, 1 handled error). Never calls process.exit().
 */
export async function runWash(opts: ResolvedCliOptions, io: CliIo): Promise<number> {
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
      io.stderr.write('Error: empty stdin — no HTML to wash.\n');
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

  // --- Resolve a custom washing config (--config <file.json>), if given ---
  // Read + JSON.parse + validate at the boundary, exactly like the library;
  // when supplied it takes precedence over --level.
  let config: SanitizeConfig | undefined;
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
    const configError = sanitizeConfigError(parsed);
    if (configError !== null) {
      io.stderr.write(`Error: invalid washing config '${opts.config}': ${configError}\n`);
      return 1;
    }
    config = parsed as SanitizeConfig;
  }

  // --- Run wash (offline; url is context only, never fetched) ---
  const result = await wash(html, {
    boilerplate: opts.boilerplate,
    level: opts.level,
    config,
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
 * Build the commander program. Named `htmlwasher`; one positional `[input]`
 * (file path, `-`, or omitted → stdin) and the wash() option knobs. The action
 * parses argv into {@link ResolvedCliOptions} and runs {@link runWash} against
 * the real process streams.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('htmlwasher')
    .description(
      'Clean HTML: boilerplate removal + sanitize/normalize/format. ' +
        'HTML in → cleaned HTML out (offline; never fetches).',
    )
    .version(packageVersion)
    .argument('[input]', 'path to an HTML file; omit or use "-" to read HTML from stdin')
    .option(
      '-b, --boilerplate <mode>',
      'boilerplate-removal mode: precision | balanced | recall | none',
      parseBoilerplate,
      DEFAULT_BOILERPLATE_MODE,
    )
    .option(
      '-l, --level <level>',
      'HTML washing level: minimal | standard | permissive | styled | correct',
      parseLevel,
      DEFAULT_WASHING_LEVEL,
    )
    .option(
      '-c, --config <file.json>',
      'custom washing config (JSON SanitizeConfig); takes precedence over --level',
    )
    .option('-m, --minify', 'minify the output HTML instead of pretty-formatting it', false)
    .option('-u, --url <url>', 'source URL for classifier/metadata context only — NEVER fetched')
    .option('-o, --output <file>', 'write the result to a file instead of stdout')
    .option('--json', 'emit the full result as pretty JSON (html, metadata, pageType, …)', false)
    .option('-q, --quiet', 'suppress the diagnostics + page-type line on stderr', false)
    .action(async (input: string | undefined, opts: CommanderOptions) => {
      const resolved: ResolvedCliOptions = {
        input,
        boilerplate: opts.boilerplate,
        level: opts.level,
        config: opts.config,
        minify: opts.minify,
        url: opts.url,
        output: opts.output,
        json: opts.json,
        quiet: opts.quiet,
      };
      const code = await runWash(resolved, {
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
  level: WashingLevel;
  config?: string;
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
