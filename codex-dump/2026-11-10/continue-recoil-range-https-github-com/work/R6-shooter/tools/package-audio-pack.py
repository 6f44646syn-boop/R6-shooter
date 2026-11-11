"""Package optional audio assets using only the Python standard library.

Run after build-audio-pack.mjs and bench-audio-pack.mjs, from the repository root.
"""
from hashlib import sha256
from pathlib import Path
import json
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'work/audio-pack'
output = root / 'packs/audio'
output.mkdir(parents=True, exist_ok=True)
for name in ('recoil-range-audio-v1.rra', 'manifest.json', 'build.json'):
    shutil.copyfile(source / name, output / name)

build = json.loads((output / 'build.json').read_text())
raw = (output / 'recoil-range-audio-v1.rra').read_bytes()
assert build['sha256'] == sha256(raw).hexdigest(), 'Stale build metadata'
benchmark = json.loads((output / 'benchmark.json').read_text())
assert benchmark['packBytes'] == len(raw), 'Benchmark a freshly baked pack first'
manifest = json.loads((output / 'manifest.json').read_text())
clips = sorted((source / 'clips').glob('*.wav'))
expected = {c['id'].replace(':', '_') + '.wav' for c in manifest['clips']}
assert {p.name for p in clips} == expected, 'Missing or stale WAV previews'

archive = output / 'recoil-range-audio-v1.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED,
                     compresslevel=9) as bundle:
    files = [(output / n, n) for n in (
        'recoil-range-audio-v1.rra', 'manifest.json', 'build.json',
        'benchmark.json', 'README.md')]
    files += [(p, 'clips/' + p.name) for p in clips]
    for path, name in files:
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        bundle.writestr(info, path.read_bytes(), compresslevel=9)

(output / 'SHA256SUMS').write_text(''.join(
    f'{sha256((output / name).read_bytes()).hexdigest()}  {name}\n'
    for name in ('recoil-range-audio-v1.rra', archive.name)))
print(f'Packaged {len(clips)} WAV previews: {archive.name}, {archive.stat().st_size} bytes')
