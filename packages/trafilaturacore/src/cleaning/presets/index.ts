// SPDX-License-Identifier: Apache-2.0
// Maps trafilaturacore's CleaningLevel onto the four base sanitize presets ported from
// htmlprocessing-server. The `*-reader` presets are intentionally NOT ported —
// trafilaturacore's boilerplate-removal pillar replaces the Readability stage.
//
// `correct` is NOT a sanitize preset (it applies no tag allow-list), so it is
// absent from this map; `getCleanConfig('correct')` returns `undefined`. Note
// `correct` is normalize-only for the allow-list ONLY — `cleanHtml` still runs the
// mandatory security floor (`enforceSecurityFloor` + `cleanStyledHtml`) on the
// no-config path, so `<script>`/`on*`/dangerous URLs/CSS are stripped at `correct` too.

import type { CleaningLevel } from '../../types.js';
import { minimalSetup } from './minimal.js';
import { permissiveSetup } from './permissive.js';
import { standardSetup } from './standard.js';
import { styledSetup } from './styled.js';
import type { CleanConfig } from './types.js';

export type { CleanConfig } from './types.js';

/** The four cleaning levels that map to a sanitize preset (everything except `correct`). */
const cleanPresets: Record<Exclude<CleaningLevel, 'correct'>, CleanConfig> = {
  minimal: minimalSetup,
  standard: standardSetup,
  permissive: permissiveSetup,
  styled: styledSetup,
};

/**
 * Resolve a cleaning level to its sanitize configuration. Returns `undefined`
 * for `correct`, which skips sanitization entirely (normalize + format only).
 */
export function getCleanConfig(level: CleaningLevel): CleanConfig | undefined {
  if (level === 'correct') {
    return undefined;
  }
  return cleanPresets[level];
}
