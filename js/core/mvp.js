// Your match in numbers for the MVP card: damage dealt, longest kill, fastest double kill
// (two kills in a row, closest together). best() picks the stat that stands out most.
export class MatchStats {
  constructor() { this.reset(); }
  reset() { this.damage = 0; this.kills = 0; this.longest = 0; this.double = Infinity; this.lastKill = -Infinity; }
  hit(dmg) { this.damage += Math.max(0, dmg || 0); }
  kill(t, metres) {
    this.kills++;
    this.longest = Math.max(this.longest, metres || 0);
    if (t - this.lastKill < this.double) this.double = t - this.lastKill;
    this.lastKill = t;
  }
  // [{ key, label, text, score }], the standout first (null with nothing to show).
  card() {
    const out = [];
    if (this.longest > 0) out.push({ key: 'longest', label: 'Longest kill', text: this.longest.toFixed(0) + ' m', score: this.longest / 30 });
    if (this.double < 10) out.push({ key: 'double', label: 'Fastest double', text: this.double.toFixed(2) + ' s', score: 1.2 / Math.max(0.15, this.double) });
    if (this.damage > 0) out.push({ key: 'damage', label: 'Damage', text: Math.round(this.damage) + '', score: this.damage / 800 });
    return out.length ? out.sort((a, b) => b.score - a.score) : null;
  }
}
// The card as a DOM node (or null).
export function mvpCard(stats) {
  const c = stats.card();
  if (!c) return null;
  const box = document.createElement('div'); box.className = 'mvp-card';
  const top = document.createElement('div'); top.className = 'mvp-top';
  top.innerHTML = '<span class="mvp-tag">Your best</span>';
  const big = document.createElement('b'); big.textContent = c[0].text;
  const lab = document.createElement('span'); lab.textContent = c[0].label;
  top.append(big, lab);
  const rest = document.createElement('div'); rest.className = 'mvp-rest';
  rest.textContent = c.slice(1).map((x) => x.label + ' ' + x.text).join(' · ');
  box.append(top, rest);
  return box;
}
