#!/usr/bin/env bash
# Builds the Rust core to WebAssembly: rust/core -> wasm/recoil_core.wasm (committed, served
# as a static file). Needs the Rust compiler; adds the wasm target if it is missing.
#   tools/build-wasm.sh          build and copy
#   tools/build-wasm.sh --test   also run the Rust unit tests first
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/rust/core"
rustup target list --installed | grep -q wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown
if [ "${1:-}" = "--test" ]; then cargo test --quiet; fi
cargo build --release --target wasm32-unknown-unknown --quiet
mkdir -p "$root/wasm"
cp target/wasm32-unknown-unknown/release/recoil_core.wasm "$root/wasm/recoil_core.wasm"
# The hash of the sources this .wasm was built from (npm test checks it is up to date).
cat Cargo.toml $(ls src/*.rs | sort) | sha256sum | cut -d' ' -f1 > "$root/wasm/recoil_core.hash"
echo "built wasm/recoil_core.wasm ($(wc -c < "$root/wasm/recoil_core.wasm") bytes) from sources $(cut -c1-12 "$root/wasm/recoil_core.hash")"
