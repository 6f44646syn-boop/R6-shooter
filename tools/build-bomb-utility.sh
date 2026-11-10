#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/rust/bomb_utility"
if [ "${1:-}" = "--test" ]; then cargo test; fi
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/bomb_utility.wasm "$root/wasm/bomb_utility.wasm"
chmod 644 "$root/wasm/bomb_utility.wasm"
cat Cargo.toml $(ls src/*.rs | sort) | sha256sum | cut -d' ' -f1 > "$root/wasm/bomb_utility.hash"
