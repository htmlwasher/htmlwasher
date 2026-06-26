// SPDX-License-Identifier: Apache-2.0
// Author normalization ported from trafilatura/json_metadata.py
// (normalize_authors) and trafilatura/metadata.py (check_authors) — Apache-2.0.

import { stripHtmlTags, trim, unescapeHtml } from './text.js';

const AUTHOR_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
// Split on / ; , | & or a standalone "and"/"und" (word-bounded), case-insensitive.
const AUTHOR_SPLIT = /\/|;|,|\||&|(?:^|\W)[ua]nd(?:$|\W)/i;
const AUTHOR_TWITTER = /@[\w]+/g;
const AUTHOR_REPLACE_JOIN = /[._+]/g;
const AUTHOR_REMOVE_NICKNAME = /["‘({[’'][^"]+?[‘’"')\]}]/g;
const AUTHOR_REMOVE_SPECIAL = /[^\w]+$|[:()?*$#!%/<>{}~¿]/g;
const AUTHOR_PREFIX = /^([a-zäöüß]+(?:ed|t))? ?(?:written by|words by|words|by|von|from) /i;
const AUTHOR_REMOVE_NUMBERS = /\d[\s\S]+?$/;
const AUTHOR_REMOVE_PREPOSITION = /\b\s+(?:am|on|for|at|in|to|from|of|via|with|—|-|–)\s+([\s\S]*)/i;
// Emoji ranges trafilatura strips (AUTHOR_EMOJI_REMOVE).
const AUTHOR_EMOJI_REMOVE =
  /[✀-➾\u{1f600}-\u{1f64f}☀-⛿\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1fa70}-\u{1faff}\u{1f680}-\u{1f6ff}]+/gu;

/** Title-case mirroring Python `str.title()` on the first character path used here. */
function pythonTitle(s: string): string {
  // Python's str.title() upper-cases the first letter of each word and lower-cases
  // the rest. trafilatura only applies it when the first char is not uppercase.
  return s.replace(/([A-Za-zÀ-ɏ])([A-Za-zÀ-ɏ]*)/g, (_m, head: string, tail: string) => {
    return head.toUpperCase() + tail.toLowerCase();
  });
}

function firstCharIsUpper(s: string): boolean {
  const c = s[0];
  return c !== undefined && c !== c.toLowerCase() && c === c.toUpperCase();
}

/**
 * Normalize author info to focus on author names only. Faithful port of
 * `json_metadata.normalize_authors`: splits on `/;,|&` / "and"/"und", strips
 * twitter handles, nicknames, prefixes ("by", "von"…), trailing numbers and
 * prepositions, title-cases lowercase names, dedupes, and drops names that are
 * substrings of another. Returns `current` unchanged when nothing survives.
 */
export function normalizeAuthors(
  current: string | undefined,
  authorString: string,
): string | undefined {
  let s = authorString;
  if (s.toLowerCase().startsWith('http') || AUTHOR_EMAIL.test(s)) {
    return current;
  }
  const newAuthors: string[] = current ? current.split('; ') : [];

  if (s.includes('\\u')) {
    s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
  }
  if (s.includes('&#') || s.includes('&amp;')) {
    s = unescapeHtml(s);
  }
  s = stripHtmlTags(s);

  for (const raw of s.split(AUTHOR_SPLIT)) {
    if (raw === undefined) continue;
    let author = trim(raw);
    author = author.replace(AUTHOR_EMOJI_REMOVE, '');
    author = author.replace(AUTHOR_TWITTER, '');
    author = trim(author.replace(AUTHOR_REPLACE_JOIN, ' '));
    author = author.replace(AUTHOR_REMOVE_NICKNAME, '');
    author = author.replace(AUTHOR_REMOVE_SPECIAL, '');
    author = author.replace(AUTHOR_PREFIX, '');
    author = author.replace(AUTHOR_REMOVE_NUMBERS, '');
    author = author.replace(AUTHOR_REMOVE_PREPOSITION, '');

    if (!author || (author.length >= 50 && !author.includes(' ') && !author.includes('-'))) {
      continue;
    }
    if (!firstCharIsUpper(author)) {
      author = pythonTitle(author);
    }
    if (!newAuthors.includes(author)) {
      newAuthors.push(author);
    }
  }

  // Keep only the fullest form of each name (drop names contained in another).
  const filtered = newAuthors.filter((n) => !newAuthors.some((m) => n !== m && m.includes(n)));
  if (filtered.length === 0) {
    return current;
  }
  return filtered.join('; ').replace(/^;\s*|\s*;$/g, '');
}

/**
 * Filter an authors string against a blacklist of names. Mirrors
 * `metadata.check_authors`. Returns undefined when nothing survives.
 */
export function checkAuthors(authors: string, blacklist: ReadonlySet<string>): string | undefined {
  const lower = new Set([...blacklist].map((a) => a.toLowerCase()));
  const kept = authors
    .split(';')
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && !lower.has(a.toLowerCase()));
  if (kept.length > 0) {
    return kept.join('; ').replace(/^;\s*|\s*;$/g, '');
  }
  return undefined;
}
