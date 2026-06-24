// SPDX-License-Identifier: Apache-2.0
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { decodeBuffer } from './decode.js';

describe('decodeBuffer', () => {
  it('returns empty string for an empty buffer', () => {
    const result = decodeBuffer(Buffer.alloc(0));
    expect(result.html).toBe('');
    expect(result.messages).toEqual([]);
  });

  it('uses the fast path for valid UTF-8 (no messages)', () => {
    const buf = Buffer.from('<p>héllo wörld</p>', 'utf-8');
    const result = decodeBuffer(buf);
    expect(result.html).toBe('<p>héllo wörld</p>');
    expect(result.messages).toEqual([]);
  });

  it('honors a UTF-8 BOM and strips it', () => {
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<p>héllo</p>', 'utf-8'),
    ]);
    const result = decodeBuffer(buf);
    expect(result.html).toBe('<p>héllo</p>');
  });

  it('reports and converts a UTF-16LE BOM document', () => {
    // iconv's `utf-16` (not `utf-16le`) prepends the FF FE little-endian BOM.
    const buf = iconv.encode('<p>héllo</p>', 'utf-16');
    expect([buf[0], buf[1]]).toEqual([0xff, 0xfe]);
    const result = decodeBuffer(buf);
    expect(result.html).toBe('<p>héllo</p>');
    expect(result.messages.some((m) => m.type === 'info' && /UTF-16LE/.test(m.text))).toBe(true);
  });

  it('detects and decodes a legacy single-byte (latin1) buffer', () => {
    // High-bit bytes make this invalid UTF-8, forcing the chardet+iconv fallback.
    const buf = iconv.encode('<p>Café déjà vu — naïve façade</p>', 'latin1');
    const result = decodeBuffer(buf);
    expect(result.html).toBeDefined();
    expect(result.html).toContain('<p>');
    expect(result.html).toContain('</p>');
    // A legacy encoding was detected and converted → an info message is recorded.
    expect(result.messages.some((m) => m.type === 'info')).toBe(true);
  });
});
