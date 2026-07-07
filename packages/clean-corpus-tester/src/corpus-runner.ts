// Offline end-to-end corpus runner for trafilaturacore.
//
// Loads the WCXB-derived `corpus.json` manifest, reads each saved HTML fixture
// from disk (NO network — local files only), and runs `clean()` across a matrix
// of boilerplate x level combos. For every (fixture, combo) it records the
// detected page type, confidence, cleaned-HTML length, and title, plus a set of
// PASS/FAIL assertions.
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
import { type CleanResult, clean, type PageType } from 'trafilaturacore';
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

/** The (boilerplate, level) combos every fixture is run through. */
export const COMBOS = [
  { boilerplate: 'balanced', level: 'standard' },
  { boilerplate: 'balanced', level: 'minimal' },
  { boilerplate: 'none', level: 'correct' },
  // Same full-document (`none`) input as `none`x`correct`, but the sanitizing
  // `minimal` level — the baseline for the `correct-superset` assertion so that
  // both sides share the SAME boilerplate input and differ only by level.
  { boilerplate: 'none', level: 'minimal' },
  { boilerplate: 'recall', level: 'permissive' },
  // `precision` boilerplate (most aggressive extraction) and the `styled`
  // sanitizing level (the only level that keeps inline style/class and the
  // <style> tag) are otherwise never exercised end-to-end across real fixtures;
  // `styled` is where a CSS-URL allow-list regression would surface.
  { boilerplate: 'balanced', level: 'styled' },
  { boilerplate: 'precision', level: 'minimal' },
] as const;

type Combo = (typeof COMBOS)[number];
type BoilerplateMode = Combo['boilerplate'];
type CleaningLevel = Combo['level'];

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
  boilerplate: BoilerplateMode;
  level: CleaningLevel;
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
  /** Detected page type (from the `balanced`x`standard` reference combo). */
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
  /** Security failures counted against the run (all levels — the floor is unconditional). */
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
  minimalTagCount: number,
  inputBodyTextLength: number,
  hardFailures: AssertionFailure[],
): AssertOutcome {
  const comboLabel = `${combo.boilerplate}x${combo.level}`;
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
  // SECURITY is HARD at EVERY level. In v2 the TS cleaning floor is UNCONDITIONAL
  // (context doc 09): `enforceSecurityFloor` + `cleanStyledHtml` run as the final
  // pass on every level INCLUDING `correct`, so a surviving <script>/on*/javascript:
  // URL is always a real failure — never a documented normalize-only exemption.
  const securityFail = (assertion: string, detail: string): void => {
    hardSecurityFailures += 1;
    fail(assertion, detail);
  };

  // SECURITY (core invariant): no script tag survives at any level.
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

  // STRUCTURAL: `correct` (normalize-only) keeps at least as many distinct tag
  // names as `minimal` on the SAME boilerplate input (both `none` — the whole
  // document, no extraction), so the two differ only by cleaning level. This is
  // the real invariant: normalize-only `correct` must not drop tags that the
  // sanitizing `minimal` level keeps.
  if (combo.boilerplate === 'none' && combo.level === 'correct') {
    const correctTagCount = distinctTagNames(html).size;
    if (correctTagCount < minimalTagCount) {
      fail(
        'correct-superset',
        `correct kept ${correctTagCount} distinct tags but minimal kept ${minimalTagCount}`,
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

    // Run all combos first so we know `minimal`'s tag count before asserting
    // `correct`'s superset property. The combos are independent, so clean them
    // concurrently (the Rust extraction runs on the libuv threadpool);
    // Promise.all preserves combo order, and the assertion/report fold below
    // iterates COMBOS in order, so the output stays deterministic. Fixtures
    // themselves stay sequential to bound memory and keep logs readable.
    const cleaned = new Map<string, CleanResult>(
      await Promise.all(
        COMBOS.map(async (combo): Promise<[string, CleanResult]> => {
          const result = await clean(html, {
            boilerplate: combo.boilerplate,
            level: combo.level,
            url: fixture.url,
          });
          return [`${combo.boilerplate}x${combo.level}`, result];
        }),
      ),
    );

    // Baseline for the `correct-superset` assertion: the `none`x`minimal` combo
    // shares the SAME full-document input as `none`x`correct`, so the comparison
    // isolates the level difference (sanitizing vs normalize-only) rather than a
    // boilerplate-mode difference (full doc vs extracted subset).
    const minimalResult = cleaned.get('nonexminimal');
    const minimalTagCount =
      minimalResult !== undefined ? distinctTagNames(minimalResult.html).size : 0;

    const comboResults: ComboResult[] = [];
    let hardPassCount = 0;

    for (const combo of COMBOS) {
      const result = cleaned.get(`${combo.boilerplate}x${combo.level}`);
      if (result === undefined) continue;
      const { pass, hardSecurityFailures } = assertCombo(
        fixture,
        combo,
        result,
        minimalTagCount,
        inputBodyTextLength,
        hardFailures,
      );
      securityFailureCount += hardSecurityFailures;
      if (pass) hardPassCount += 1;

      const comboResult: ComboResult = {
        boilerplate: combo.boilerplate,
        level: combo.level,
        htmlLength: result.html.length,
        pass,
      };
      if (result.pageType !== undefined) comboResult.pageType = result.pageType;
      if (result.confidence !== undefined) comboResult.confidence = result.confidence;
      if (result.metadata?.title !== undefined) comboResult.title = result.metadata.title;
      comboResults.push(comboResult);
    }

    // Use the `balanced`x`standard` combo as the reference for the detected type
    // (it both classifies and is the default mode).
    const reference = cleaned.get('balancedxstandard');
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
        combo: 'balancedxstandard',
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
