// Offline end-to-end corpus runner for trafilaturacore.
//
// Loads the WCXB-derived `corpus.json` manifest, reads each saved HTML fixture
// from disk (NO network — local files only), and runs `clean()` across every
// boilerplate mode (plus one custom-config combo). For every (fixture, combo)
// it records the detected page type, confidence, cleaned-HTML length, and
// title, plus a set of PASS/FAIL assertions.
//
// Assertions split into two tiers:
//   - HARD (security + structural invariants): any failure fails the run.
//   - SOFT (page-type plausibility): a single classifier mismatch is a warning,
//     never a hard failure; only an aggregate accuracy below the floor fails.
//
// The runner is deterministic: the same fixtures always produce the same report.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BoilerplateMode,
  type CleanConfig,
  type CleanResult,
  clean,
  DEFAULT_CLEAN_CONFIG,
  type PageType,
} from 'trafilaturacore';
import { findEventHandlerAttr, hasJavascriptUrl, hasScriptTag } from './security-detectors.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// `src/` (tsx) and `dist/` (compiled) both sit one level under the package dir.
const PACKAGE_DIR = resolve(MODULE_DIR, '..');
const CORPUS_PATH = resolve(PACKAGE_DIR, 'corpus.json');
const FIXTURES_DIR = resolve(PACKAGE_DIR, 'fixtures');

/** Page-type accuracy below this floor fails the whole run. */
export const PAGE_TYPE_ACCURACY_FLOOR = 0.4;

/**
 * Minimum body-text length (chars, tags + scripts stripped) for an input to be
 * considered to carry extractable main content. Below this a page is a JS-shell
 * / near-empty document (e.g. "You need to enable JavaScript to run this app"),
 * so empty extraction output is legitimate, not a failure.
 */
export const SUBSTANTIAL_BODY_TEXT = 200;

/**
 * A custom cleaning config that additionally keeps class / inline style / the
 * `<style>` tag — the one combo where a CSS-URL allow-list regression would
 * surface across real fixtures (the default config drops all styling).
 */
const STYLED_CONFIG: CleanConfig = {
  ...DEFAULT_CLEAN_CONFIG,
  allowedTags: [...(DEFAULT_CLEAN_CONFIG.allowedTags ?? []), 'style'],
  allowedAttributes: {
    ...DEFAULT_CLEAN_CONFIG.allowedAttributes,
    '*': ['class', 'style'],
  },
  nonTextTags: (DEFAULT_CLEAN_CONFIG.nonTextTags ?? []).filter((tag) => tag !== 'style'),
};

/**
 * The combos every fixture is run through: each boilerplate mode with the
 * default Trafilatura-aligned config, plus one custom-config combo
 * (`balanced+styled-config`) that keeps styling so the CSS cleaner stays
 * exercised end-to-end.
 */
export const COMBOS: readonly {
  label: string;
  boilerplate: BoilerplateMode;
  config?: CleanConfig;
}[] = [
  { label: 'balanced', boilerplate: 'balanced' },
  { label: 'precision', boilerplate: 'precision' },
  { label: 'recall', boilerplate: 'recall' },
  // Whole-document cleaning: no extraction, no classification, no FFI.
  { label: 'clean-keep-boilerplate', boilerplate: 'clean-keep-boilerplate' },
  { label: 'balanced+styled-config', boilerplate: 'balanced', config: STYLED_CONFIG },
];

type Combo = (typeof COMBOS)[number];

interface CorpusFixture {
  file: string;
  expectedPageType: PageType;
  domain: string;
  url: string;
}

interface CorpusManifest {
  _attribution: string;
  fixtures: CorpusFixture[];
}

/** A single failed assertion, with enough context to debug it. */
export interface AssertionFailure {
  fixture: string;
  combo: string;
  /** `hard` failures fail the run; `soft` are recorded but do not. */
  tier: 'hard' | 'soft';
  assertion: string;
  detail: string;
}

/** Per-(fixture, combo) result. */
export interface ComboResult {
  /** The combo label (mode name, or `balanced+styled-config`). */
  combo: string;
  boilerplate: BoilerplateMode;
  pageType?: PageType;
  confidence?: number;
  htmlLength: number;
  title?: string;
  /** All HARD assertions passed for this combo. */
  pass: boolean;
}

/** Per-fixture rollup across all combos. */
export interface FixtureResult {
  file: string;
  expectedPageType: PageType;
  domain: string;
  /** Detected page type (from the `balanced` reference combo). */
  detectedPageType?: PageType;
  confidence?: number;
  /** Whether `detectedPageType` matches `expectedPageType`. */
  pageTypeMatch: boolean;
  combos: ComboResult[];
  /** Number of combos whose HARD assertions all passed. */
  hardPassCount: number;
  /** Total combos run for this fixture. */
  comboCount: number;
}

/** The full corpus report. */
export interface CorpusReport {
  attribution: string;
  generatedFromFixtureCount: number;
  comboCount: number;
  fixtures: FixtureResult[];
  /** Fraction of fixtures whose detected page type matched the expected one. */
  pageTypeAccuracy: number;
  pageTypeAccuracyFloor: number;
  /** Page-type mismatches (soft warnings). */
  pageTypeMismatches: { file: string; expected: PageType; detected?: PageType }[];
  /** Every HARD assertion failure across the corpus. */
  hardFailures: AssertionFailure[];
  /** Every SOFT assertion failure (recorded, non-fatal). */
  softFailures: AssertionFailure[];
  /** Count of combos where a script/handler/javascript: URL survived (must be 0). */
  securityFailureCount: number;
  /** Overall verdict: zero hard failures AND accuracy >= floor. */
  ok: boolean;
}

// --- structural detectors (operate on the cleaned output HTML; the HARD
// security detectors live in security-detectors.ts, anchored to tag context so
// escaped visible text can never trip them) ---

/** Distinct lowercased tag names appearing as opening tags in `html`. */
function distinctTagNames(html: string): Set<string> {
  const names = new Set<string>();
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)/g;
  let match: RegExpExecArray | null = re.exec(html);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) names.add(name.toLowerCase());
    match = re.exec(html);
  }
  return names;
}

/** Visible body-text length: tags, scripts, styles, and entities stripped. */
function bodyTextLength(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/** Load + validate the corpus manifest. */
function loadManifest(): CorpusManifest {
  const raw = readFileSync(CORPUS_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('fixtures' in parsed) ||
    !Array.isArray((parsed as { fixtures: unknown }).fixtures)
  ) {
    throw new Error(`corpus.json is malformed: expected { fixtures: [...] }`);
  }
  const manifest = parsed as CorpusManifest;
  for (const fx of manifest.fixtures) {
    if (typeof fx.file !== 'string' || typeof fx.expectedPageType !== 'string') {
      throw new Error(`corpus.json fixture entry is malformed: ${JSON.stringify(fx)}`);
    }
  }
  return manifest;
}

/** Outcome of asserting one (fixture, combo): pass + how many security checks failed HARD. */
interface AssertOutcome {
  pass: boolean;
  /** Security failures counted against the run (all combos — the floor is unconditional). */
  hardSecurityFailures: number;
}

/**
 * Assert the security + structural invariants for one (fixture, combo) result.
 * Mutates `hardFailures`. Returns whether all HARD passed and how many security
 * checks failed.
 */
function assertCombo(
  fixture: CorpusFixture,
  combo: Combo,
  result: CleanResult,
  balancedTagCount: number,
  inputBodyTextLength: number,
  hardFailures: AssertionFailure[],
): AssertOutcome {
  const comboLabel = combo.label;
  const html = result.html;
  let pass = true;
  let hardSecurityFailures = 0;

  const fail = (assertion: string, detail: string): void => {
    pass = false;
    hardFailures.push({
      fixture: fixture.file,
      combo: comboLabel,
      tier: 'hard',
      assertion,
      detail,
    });
  };
  // SECURITY is HARD for EVERY combo. In v2 the TS cleaning floor is UNCONDITIONAL
  // (context doc 09): `enforceSecurityFloor` + `cleanStyledHtml` run as the final
  // pass on every path (default AND custom config), so a surviving
  // <script>/on*/javascript: URL is always a real failure.
  const securityFail = (assertion: string, detail: string): void => {
    hardSecurityFailures += 1;
    fail(assertion, detail);
  };

  // SECURITY (core invariant): no script tag survives in any combo.
  if (hasScriptTag(html)) {
    securityFail('no-script', '<script> survived in cleaned output');
  }
  // SECURITY: no inline event-handler attribute survives inside any tag
  // (tag-anchored — escaped prose like "chapter one = intro" never matches).
  const handlerAttr = findEventHandlerAttr(html);
  if (handlerAttr !== undefined) {
    securityFail('no-event-handler', `event-handler attribute survived: ${handlerAttr}`);
  }
  // SECURITY: no javascript: URL survives in a URL-bearing attribute
  // (tag-anchored — escaped text like "javascript:void(0)" never matches).
  if (hasJavascriptUrl(html)) {
    securityFail('no-javascript-url', 'javascript: URL survived in cleaned output');
  }

  // STRUCTURAL: cleaned HTML is non-empty — unless the input is a JS-shell /
  // near-empty page with no substantial body text, in which case empty
  // extraction output is legitimate.
  const inputHasContent = inputBodyTextLength >= SUBSTANTIAL_BODY_TEXT;
  if (html.trim().length === 0 && inputHasContent) {
    fail(
      'non-empty',
      `cleaned HTML is empty but the input has ${inputBodyTextLength} chars of body text`,
    );
  }

  // STRUCTURAL: the styled-config combo's allow-list is a strict superset of
  // the default config, and it runs on the SAME `balanced` extraction input —
  // so it must keep at least as many distinct tag names as the default-config
  // `balanced` combo. A custom config silently dropping tags the default keeps
  // would surface here.
  if (combo.label === 'balanced+styled-config') {
    const styledTagCount = distinctTagNames(html).size;
    if (styledTagCount < balancedTagCount) {
      fail(
        'styled-config-superset',
        `styled-config kept ${styledTagCount} distinct tags but the default config kept ${balancedTagCount}`,
      );
    }
  }

  return { pass, hardSecurityFailures };
}

/** Run the full offline corpus and produce the report. */
export async function runCorpus(): Promise<CorpusReport> {
  const manifest = loadManifest();
  const hardFailures: AssertionFailure[] = [];
  const softFailures: AssertionFailure[] = [];
  const fixtureResults: FixtureResult[] = [];
  const mismatches: { file: string; expected: PageType; detected?: PageType }[] = [];
  let securityFailureCount = 0;

  for (const fixture of manifest.fixtures) {
    const html = readFileSync(resolve(FIXTURES_DIR, fixture.file), 'utf8');
    const inputBodyTextLength = bodyTextLength(html);

    // Run all combos first so the `balanced` tag count is known before asserting
    // the styled-config superset property. The combos are independent, so clean
    // them concurrently (the Rust extraction runs on the libuv threadpool);
    // Promise.all preserves combo order, and the assertion/report fold below
    // iterates COMBOS in order, so the output stays deterministic. Fixtures
    // themselves stay sequential to bound memory and keep logs readable.
    const cleaned = new Map<string, CleanResult>(
      await Promise.all(
        COMBOS.map(async (combo): Promise<[string, CleanResult]> => {
          const result = await clean(html, {
            boilerplate: combo.boilerplate,
            config: combo.config,
            url: fixture.url,
          });
          return [combo.label, result];
        }),
      ),
    );

    // Baseline for the `styled-config-superset` assertion: the `balanced` combo
    // shares the SAME extraction input as `balanced+styled-config`, so the
    // comparison isolates the config difference (default vs styling-superset).
    const balancedResult = cleaned.get('balanced');
    const balancedTagCount =
      balancedResult !== undefined ? distinctTagNames(balancedResult.html).size : 0;

    const comboResults: ComboResult[] = [];
    let hardPassCount = 0;

    for (const combo of COMBOS) {
      const result = cleaned.get(combo.label);
      if (result === undefined) continue;
      const { pass, hardSecurityFailures } = assertCombo(
        fixture,
        combo,
        result,
        balancedTagCount,
        inputBodyTextLength,
        hardFailures,
      );
      securityFailureCount += hardSecurityFailures;
      if (pass) hardPassCount += 1;

      const comboResult: ComboResult = {
        combo: combo.label,
        boilerplate: combo.boilerplate,
        htmlLength: result.html.length,
        pass,
      };
      if (result.pageType !== undefined) comboResult.pageType = result.pageType;
      if (result.confidence !== undefined) comboResult.confidence = result.confidence;
      if (result.metadata?.title !== undefined) comboResult.title = result.metadata.title;
      comboResults.push(comboResult);
    }

    // Use the `balanced` combo as the reference for the detected type
    // (it both classifies and is the default mode).
    const reference = balancedResult;
    const detectedPageType = reference?.pageType;
    const confidence = reference?.confidence;
    const pageTypeMatch = detectedPageType === fixture.expectedPageType;

    if (!pageTypeMatch) {
      mismatches.push({
        file: fixture.file,
        expected: fixture.expectedPageType,
        detected: detectedPageType,
      });
      softFailures.push({
        fixture: fixture.file,
        combo: 'balanced',
        tier: 'soft',
        assertion: 'page-type-match',
        detail: `expected ${fixture.expectedPageType}, detected ${detectedPageType ?? '<none>'}`,
      });
    }

    const fixtureResult: FixtureResult = {
      file: fixture.file,
      expectedPageType: fixture.expectedPageType,
      domain: fixture.domain,
      pageTypeMatch,
      combos: comboResults,
      hardPassCount,
      comboCount: comboResults.length,
    };
    if (detectedPageType !== undefined) fixtureResult.detectedPageType = detectedPageType;
    if (confidence !== undefined) fixtureResult.confidence = confidence;
    fixtureResults.push(fixtureResult);
  }

  const matched = fixtureResults.filter((f) => f.pageTypeMatch).length;
  const pageTypeAccuracy = fixtureResults.length === 0 ? 0 : matched / fixtureResults.length;

  const ok = hardFailures.length === 0 && pageTypeAccuracy >= PAGE_TYPE_ACCURACY_FLOOR;

  return {
    attribution: manifest._attribution,
    generatedFromFixtureCount: fixtureResults.length,
    comboCount: COMBOS.length,
    fixtures: fixtureResults,
    pageTypeAccuracy,
    pageTypeAccuracyFloor: PAGE_TYPE_ACCURACY_FLOOR,
    pageTypeMismatches: mismatches,
    hardFailures,
    softFailures,
    securityFailureCount,
    ok,
  };
}
