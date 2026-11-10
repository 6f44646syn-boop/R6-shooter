#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/rust/loadout"
if [ "${1:-}" = "--test" ]; then cargo test; fi
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/loadout.wasm "$root/wasm/loadout.wasm"
chmod 644 "$root/wasm/loadout.wasm"
cat Cargo.toml $(ls src/*.rs | sort) | sha256sum | cut -d' ' -f1 > "$root/wasm/loadout.hash"
