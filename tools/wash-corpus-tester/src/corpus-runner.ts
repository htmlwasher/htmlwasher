// Offline end-to-end corpus runner for htmlwasher.
//
// Loads the WCXB-derived `corpus.json` manifest, reads each saved HTML fixture
// from disk (NO network — local files only), and runs `wash()` across a matrix
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
import { type PageType, type WashResult, wash } from 'htmlwasher';

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
 * Washing levels that sanitize the HTML. The security invariant (no <script>,
 * no on*= handler, no javascript: URL) is a HARD assertion at these levels.
 * `correct` is intentionally normalize-only (skips sanitization), so script
 * survival there is documented behavior, recorded only as a soft warning.
 */
const SANITIZING_LEVELS: ReadonlySet<string> = new Set([
  'minimal',
  'standard',
  'permissive',
  'styled',
]);

/** The (boilerplate, level) combos every fixture is run through. */
export const COMBOS = [
  { boilerplate: 'balanced', level: 'standard' },
  { boilerplate: 'balanced', level: 'minimal' },
  { boilerplate: 'none', level: 'correct' },
  { boilerplate: 'recall', level: 'permissive' },
] as const;

type Combo = (typeof COMBOS)[number];
type BoilerplateMode = Combo['boilerplate'];
type WashingLevel = Combo['level'];

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
  level: WashingLevel;
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

// --- security + structural detectors (operate on the cleaned output HTML) ---

const SCRIPT_TAG = /<script[\s/>]/i;
// An HTML event-handler attribute: `on<word>=` preceded by whitespace (so we do
// not match e.g. a literal "lemonade=" substring). Covers onclick, onerror, etc.
const EVENT_HANDLER_ATTR = /\son[a-z]+\s*=/i;
const JAVASCRIPT_URL = /javascript:/i;

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

/** Whether a combo's washing level sanitizes (vs. `correct`'s normalize-only). */
function isSanitizing(level: WashingLevel): boolean {
  return SANITIZING_LEVELS.has(level);
}

/** Outcome of asserting one (fixture, combo): pass + how many security checks failed HARD. */
interface AssertOutcome {
  pass: boolean;
  /** Security failures counted against the run (sanitizing levels only). */
  hardSecurityFailures: number;
}

/**
 * Assert the security + structural invariants for one (fixture, combo) result.
 * Mutates `hardFailures` / `softFailures`. Returns whether all HARD passed and
 * how many sanitizing-level security checks failed.
 */
function assertCombo(
  fixture: CorpusFixture,
  combo: Combo,
  result: WashResult,
  minimalTagCount: number,
  inputBodyTextLength: number,
  hardFailures: AssertionFailure[],
  softFailures: AssertionFailure[],
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
  // SECURITY at sanitizing levels is HARD; at `correct` (normalize-only, skips
  // sanitization by design) it is recorded only as a documented soft warning.
  const sanitizing = isSanitizing(combo.level);
  const securityFail = (assertion: string, detail: string): void => {
    if (sanitizing) {
      hardSecurityFailures += 1;
      fail(assertion, detail);
    } else {
      softFailures.push({
        fixture: fixture.file,
        combo: comboLabel,
        tier: 'soft',
        assertion,
        detail: `${detail} (expected: '${combo.level}' is normalize-only and skips sanitization)`,
      });
    }
  };

  // SECURITY (core invariant): no script tag survives at any sanitizing level.
  if (SCRIPT_TAG.test(html)) {
    securityFail('no-script', '<script> survived in cleaned output');
  }
  // SECURITY: no inline event-handler attribute survives.
  if (EVENT_HANDLER_ATTR.test(html)) {
    const m = EVENT_HANDLER_ATTR.exec(html);
    securityFail(
      'no-event-handler',
      `event-handler attribute survived: ${m?.[0]?.trim() ?? '<unknown>'}`,
    );
  }
  // SECURITY: no javascript: URL survives.
  if (JAVASCRIPT_URL.test(html)) {
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
  // names as `minimal` on the same fixture.
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
    // `correct`'s superset property.
    const washed = new Map<string, WashResult>();
    for (const combo of COMBOS) {
      const result = await wash(html, {
        boilerplate: combo.boilerplate,
        level: combo.level,
        url: fixture.url,
      });
      washed.set(`${combo.boilerplate}x${combo.level}`, result);
    }

    const minimalResult = washed.get('balancedxminimal');
    const minimalTagCount =
      minimalResult !== undefined ? distinctTagNames(minimalResult.html).size : 0;

    const comboResults: ComboResult[] = [];
    let hardPassCount = 0;

    for (const combo of COMBOS) {
      const result = washed.get(`${combo.boilerplate}x${combo.level}`);
      if (result === undefined) continue;
      const { pass, hardSecurityFailures } = assertCombo(
        fixture,
        combo,
        result,
        minimalTagCount,
        inputBodyTextLength,
        hardFailures,
        softFailures,
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
    const reference = washed.get('balancedxstandard');
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
