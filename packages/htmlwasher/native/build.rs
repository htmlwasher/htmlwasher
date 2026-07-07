// SPDX-License-Identifier: Apache-2.0
//! napi-rs build setup (adds the cdylib link args so the Node-API symbols resolve at
//! load time). No-op for the pure-Rust `lib`/test builds.
fn main() {
    napi_build::setup();
}
