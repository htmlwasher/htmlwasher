// SPDX-License-Identifier: Apache-2.0
// Buffer → UTF-8
// string with WHATWG-priority BOM detection, a valid-UTF-8 fast path, then a
// chardet+iconv-lite fallback (with a 20% confidence floor for legacy encodings).

import { isUtf8 } from 'node:buffer';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type { Message } from '../types.js';

export interface DecodeBufferResult {
  html: string | undefined;
  messages: Message[];
}

export function decodeBuffer(buffer: Buffer): DecodeBufferResult {
  const messages: Message[] = [];

  // 1. Check for empty buffer
  if (buffer.length === 0) {
    return { html: '', messages };
  }

  // 2. Check BOM first (WHATWG highest priority)
  const bomResult = detectBOM(buffer);
  if (bomResult) {
    if (bomResult.encoding !== 'UTF-8') {
      messages.push({
        type: 'info',
        text: `Detected ${bomResult.encoding} encoding via BOM, converted to UTF-8`,
      });
    }
    try {
      const html =
        bomResult.encoding === 'UTF-8'
          ? bomResult.data.toString('utf-8')
          : iconv.decode(bomResult.data, bomResult.iconvEncoding);
      return { html, messages };
    } catch {
      messages.push({
        type: 'error',
        text: `Failed to decode ${bomResult.encoding} encoded content`,
      });
      return { html: undefined, messages };
    }
  }

  // 3. Fast path: if valid UTF-8, use it directly
  if (isUtf8(buffer)) {
    return { html: buffer.toString('utf-8'), messages };
  }

  // 4. Not valid UTF-8 - attempt encoding detection
  const detected = chardet.analyse(buffer);
  if (!detected || detected.length === 0) {
    messages.push({
      type: 'error',
      text: 'Unable to detect file encoding and content is not valid UTF-8',
    });
    return { html: undefined, messages };
  }

  const bestMatch = detected[0];
  if (bestMatch === undefined) {
    messages.push({
      type: 'error',
      text: 'Unable to detect file encoding and content is not valid UTF-8',
    });
    return { html: undefined, messages };
  }

  // 5. Check confidence threshold
  // Note: chardet typically gives 30-40% confidence for ISO-8859-1 even with good samples
  // since single-byte encodings are hard to distinguish. We use 20% as threshold
  // to allow legacy encoding detection while rejecting binary/garbage data.
  if (bestMatch.confidence < 20) {
    messages.push({
      type: 'error',
      text: `Low confidence encoding detection (${bestMatch.confidence}% for ${bestMatch.name}), content is not valid UTF-8`,
    });
    return { html: undefined, messages };
  }

  // 6. Check if iconv-lite supports this encoding
  if (!iconv.encodingExists(bestMatch.name)) {
    messages.push({
      type: 'error',
      text: `Detected encoding ${bestMatch.name} is not supported for conversion`,
    });
    return { html: undefined, messages };
  }

  // 7. Convert to UTF-8
  try {
    const html = iconv.decode(buffer, bestMatch.name);
    messages.push({
      type: 'info',
      text: `Detected ${bestMatch.name} encoding (${bestMatch.confidence}% confidence), converted to UTF-8`,
    });
    return { html, messages };
  } catch (error) {
    messages.push({
      type: 'error',
      text: `Failed to convert from ${bestMatch.name} encoding: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
    return { html: undefined, messages };
  }
}

interface BOMResult {
  encoding: string;
  iconvEncoding: string;
  data: Buffer;
}

function detectBOM(buffer: Buffer): BOMResult | null {
  // UTF-8 BOM: EF BB BF
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      encoding: 'UTF-8',
      iconvEncoding: 'utf-8',
      data: buffer.subarray(3),
    };
  }
  // UTF-16 LE BOM: FF FE (check before UTF-32 LE which starts the same)
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    // Check for UTF-32 LE: FF FE 00 00
    if (buffer.length >= 4 && buffer[2] === 0x00 && buffer[3] === 0x00) {
      return {
        encoding: 'UTF-32LE',
        iconvEncoding: 'utf-32le',
        data: buffer.subarray(4),
      };
    }
    return {
      encoding: 'UTF-16LE',
      iconvEncoding: 'utf-16le',
      data: buffer.subarray(2),
    };
  }
  // UTF-16 BE BOM: FE FF
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      encoding: 'UTF-16BE',
      iconvEncoding: 'utf-16be',
      data: buffer.subarray(2),
    };
  }
  // UTF-32 BE BOM: 00 00 FE FF
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0xfe &&
    buffer[3] === 0xff
  ) {
    return {
      encoding: 'UTF-32BE',
      iconvEncoding: 'utf-32be',
      data: buffer.subarray(4),
    };
  }
  return null;
}
