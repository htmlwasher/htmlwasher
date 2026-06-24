// SPDX-License-Identifier: Apache-2.0
// Ported verbatim from htmlprocessing-server presets/types.ts (Apache-2.0).
// Internal sanitize configuration used by the washing presets.

/**
 * Internal sanitize configuration type.
 * Defines the subset of sanitize-html options used by presets.
 */
export interface SanitizeConfig {
  /** Tags to allow in the output. */
  allowedTags?: string[];
  /** Attributes allowed per tag. Key is tag name, value is array of allowed attribute names. */
  allowedAttributes?: Record<string, string[]>;
  /** CSS classes allowed per tag. Key is tag name, value is array of allowed class names. */
  allowedClasses?: Record<string, string[]>;
  /** Tags that are self-closing. */
  selfClosing?: string[];
  /** Tags whose content should be completely discarded (not preserved as text). */
  nonTextTags?: string[];
  /** Tags to transform to other tags. Key is source tag, value is target tag. */
  transformTags?: Record<string, string>;
}
