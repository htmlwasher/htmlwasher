// SPDX-License-Identifier: Apache-2.0
// Compile-time guard that the FROZEN public `PageType` union stays byte-identical
// to the wire union the @htmlwasher/native Rust core returns
// (`ExtractResult['pageType']`). Both are the 7 wire strings — if either side
// drifts (a renamed/added/removed type), this fails at `tsc` build time (the test
// file is in the `include: ["src"]` tsconfig) and again under vitest typecheck.

import type { ExtractResult } from '@htmlwasher/native';
import { describe, expectTypeOf, it } from 'vitest';
import type { PageType } from './types.js';

type NativePageType = ExtractResult['pageType'];

// Pure type-level assertion (independent of the test runner): a mismatch makes
// `Expect<Equal<...>>` fail to satisfy `true`, so `tsc` errors on this line.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type _AssertPageTypeMatchesNative = Expect<Equal<PageType, NativePageType>>;

describe('public PageType ↔ @htmlwasher/native ExtractResult.pageType', () => {
  it('are the same union, assignable both ways (the 7 wire strings)', () => {
    // Both directions: neither union may carry an extra member the other lacks.
    expectTypeOf<PageType>().toEqualTypeOf<NativePageType>();
    expectTypeOf<NativePageType>().toEqualTypeOf<PageType>();
    // Reference the type-level assertion so it participates in the checked graph.
    const _witness: _AssertPageTypeMatchesNative = true;
    void _witness;
  });
});
