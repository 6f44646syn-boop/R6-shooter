// Paired-seed bot balance evidence, not a human matchmaking win-rate guarantee.
// node tools/measure-bomb-balance.mjs <checkout> <matches-per-map> <result.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2] || '.'),
  n = +(process.argv[3] || 8);
if (!Number.isInteger(n) || n < 1 || n > 100)
  throw Error('Use 1–100 matches per map.');
const { Match } = await import(pathToFileURL(join(root, 'js/modes/sim.js')));
const { MatchMap } = await import(pathToFileURL(join(root, 'js/modes/map.js')));
const json = (p) => JSON.parse(readFileSync(join(root, p)));
const variant = process.argv[5] || 'all';
let appliedPolicy = null;
if (existsSync(join(root, 'js/balance/bomb-utility.js'))) {
  const { utilityFor } = await import(
    pathToFileURL(join(root, 'js/balance/bomb-utility.js'))
  );
  const base = utilityFor('tdm'),
    tuned = utilityFor('bomb');
  const fields = {
    clock: ['actionSeconds'],
    reinforce: ['reinforceSeconds'],
    barricades: ['barricadeSeconds', 'barricadeHp'],
    wire: ['wireHp', 'wireSpeed'],
    durability: ['barricadeHp', 'wireHp', 'wireSpeed'],
    timing: ['reinforceSeconds', 'barricadeSeconds', 'actionSeconds'],
  };
  if (variant !== 'all') {
    if (!fields[variant]) throw Error('Unknown measurement variant.');
    // Test-process-only ablation: production has no variant option or mutable settings.
    globalThis.__recoilBombUtility = [
      base,
      Object.freeze({
        ...base,
        ...Object.fromEntries(fields[variant].map((k) => [k, tuned[k]])),
      }),
    ];
  }
  appliedPolicy = utilityFor('bomb');
}

const inputs = [
  'js/modes/sim.js',
  'js/modes/rules.js',
  'js/modes/abilities.js',
  'js/modes/map.js',
  'data/guns.json',
  'data/abilities.json',
  'data/ops.json',
];
const sha = createHash('sha256');
for (const p of inputs) sha.update(readFileSync(join(root, p)));
const result = {
  method:
    'Normal difficulty, 5v5, abilities enabled, 30 s prep, lethal headshots. Same consecutive seeds on all three maps; full matches with side swaps. Bot rounds are clustered within matches, not independent human games.',
  engineAndDataSha256: sha.digest('hex'),
  matchesPerMap: n,
  variant,
  appliedPolicy,
  maps: {},
};
for (const id of ['ranch', 'embassy', 'workshop']) {
  const rounds = [],
    matches = [];
  for (let seed = 1; seed <= n; seed++) {
    const map = new MatchMap(json('data/maps/' + id + '.json'));
    const m = new Match({
      map,
      mode: 'bomb',
      guns: json('data/guns.json').guns,
      ops: json('data/ops.json'),
      abilities: json('data/abilities.json'),
      teamSize: 5,
      difficulty: 'normal',
      abilitiesOn: true,
      prepTime: 30,
      seed,
      human: null,
    });
    while (!m.over && m.t < 1800) {
      m.step();
      m.events.length = 0;
    }
    if (
      !m.over ||
      m.actors.some((a) => ![a.x, a.y, a.z, a.hp].every(Number.isFinite))
    )
      throw Error('Invalid/incomplete match: ' + id + '/' + seed);
    const r = m.rules.rounds.map((r) => ({
      seed,
      round: r.round,
      side: r.side,
      reason: r.reason,
    }));
    rounds.push(...r);
    matches.push({
      seed,
      seconds: +m.t.toFixed(3),
      defenderWins: r.filter((r) => r.side === 'defend').length,
      rounds: r.length,
    });
    map.dispose();
    console.log(
      id +
        ' seed ' +
        seed +
        ': ' +
        matches.at(-1).defenderWins +
        '/' +
        r.length +
        ' defender rounds',
    );
  }
  const defenderWins = rounds.filter((r) => r.side === 'defend').length;
  result.maps[id] = {
    defenderWins,
    rounds: rounds.length,
    defenderWinPercent: +((defenderWins / rounds.length) * 100).toFixed(2),
    matches,
    roundResults: rounds,
  };
}
if (process.argv[4])
  writeFileSync(process.argv[4], JSON.stringify(result, null, 2) + '\n');
for (const [id, r] of Object.entries(result.maps))
  console.log(
    id +
      ': ' +
      r.defenderWinPercent +
      '% defender wins (' +
      r.defenderWins +
      '/' +
      r.rounds +
      ')',
  );
