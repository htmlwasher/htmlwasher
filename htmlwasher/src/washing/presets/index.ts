// SPDX-License-Identifier: Apache-2.0
// Maps htmlwasher's WashingLevel onto the four base sanitize presets ported from
// htmlprocessing-server. The `*-reader` presets are intentionally NOT ported —
// htmlwasher's boilerplate-removal pillar replaces the Readability stage.
//
// `correct` is NOT a sanitize preset (it applies no tag allow-list), so it is
// absent from this map; `getSanitizeConfig('correct')` returns `undefined`. Note
// `correct` is normalize-only for the allow-list ONLY — `washHtml` still runs the
// mandatory security floor (`enforceSecurityFloor` + `sanitizeStyledHtml`) on the
// no-config path, so `<script>`/`on*`/dangerous URLs/CSS are stripped at `correct` too.

import type { WashingLevel } from '../../types.js';
import { minimalSetup } from './minimal.js';
import { permissiveSetup } from './permissive.js';
import { standardSetup } from './standard.js';
import { styledSetup } from './styled.js';
import type { SanitizeConfig } from './types.js';

export type { SanitizeConfig } from './types.js';

/** The four washing levels that map to a sanitize preset (everything except `correct`). */
const sanitizePresets: Record<Exclude<WashingLevel, 'correct'>, SanitizeConfig> = {
  minimal: minimalSetup,
  standard: standardSetup,
  permissive: permissiveSetup,
  styled: styledSetup,
};

/**
 * Resolve a washing level to its sanitize configuration. Returns `undefined`
 * for `correct`, which skips sanitization entirely (normalize + format only).
 */
export function getSanitizeConfig(level: WashingLevel): SanitizeConfig | undefined {
  if (level === 'correct') {
    return undefined;
  }
  return sanitizePresets[level];
}
