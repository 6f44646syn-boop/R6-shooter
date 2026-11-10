#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/rust/m7_controls"
if [ "${1:-}" = "--test" ]; then cargo test; fi
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/m7_controls.wasm "$root/wasm/m7_controls.wasm"
chmod 644 "$root/wasm/m7_controls.wasm"
cat Cargo.toml $(ls src/*.rs | sort) | sha256sum | cut -d' ' -f1 > "$root/wasm/m7_controls.hash"
