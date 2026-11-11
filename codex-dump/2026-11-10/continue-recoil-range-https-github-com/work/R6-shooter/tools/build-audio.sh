#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/rust/m8_audio"
if [ "${1:-}" = "--test" ]; then cargo test; fi
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/m8_audio.wasm "$root/wasm/m8_audio.wasm"
chmod 644 "$root/wasm/m8_audio.wasm"
cat Cargo.toml $(ls src/*.rs | sort) | sha256sum | cut -d' ' -f1 > "$root/wasm/m8_audio.hash"
