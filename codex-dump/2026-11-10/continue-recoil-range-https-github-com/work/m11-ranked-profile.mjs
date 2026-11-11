import fs from 'node:fs';
const p='js/core/profile.js';let s=fs.readFileSync(p,'utf8');
const edit=(a,b)=>{if(!s.includes(a))throw Error(a);s=s.replace(a,Array.isArray(b)?b.join('\n'):b);};
edit("import { RARITIES", "import { HISTORY_LIMIT, START_RATING, ratingOf } from './ranked.js?v=9dd0f7b-mwbioun8';\nimport { RARITIES");
edit('const LEGEND_BYTE =', "const OUTCOMES = ['loss', 'draw', 'win'];\nconst RANK_RECORD = 18;\nconst LEGEND_BYTE =");
edit('    this.kills = 0; this.packs = 0;', '    this.kills = 0; this.packs = 0;\n    this.rating = START_RATING; this.rankedHistory = [];');
edit('  get canOpen()',[
'  applyRanked(change) {',
"    if (!change || !/^[0-9a-f]{32}$/.test(change.id) || !OUTCOMES.includes(change.outcome)",
'      || !Number.isInteger(change.delta) || Math.abs(change.delta) > 32',
'      || this.rankedHistory.some(entry => entry.id === change.id)) return null;',
'    const next = ratingOf(this.rating + change.delta);',
'    const entry = { ...change, delta: next - this.rating };',
'    this.rating = next;',
'    this.rankedHistory = [entry, ...this.rankedHistory].slice(0, HISTORY_LIMIT);',
'    this._changed();',
'    return entry;',
'  }',
'',
'  get canOpen()']);
edit('new Uint8Array(1 + 4 + this.owned.length + SLOTS + 4 + 2)', 'new Uint8Array(1 + 4 + this.owned.length + SLOTS + 4 + 2 + 3 + RANK_RECORD * this.rankedHistory.length)');
edit('b[o++] = 2;                                   // format version (2: 201 skins)', 'b[o++] = 3;                                   // format version (3: local ranked rating and history)');
edit('    dv.setUint16(o, Math.min(this.packs, 0xffff), true);\n    return b;',[
'    dv.setUint16(o, Math.min(this.packs, 0xffff), true); o += 2;',
'    dv.setUint16(o, this.rating, true); o += 2;',
'    b[o++] = this.rankedHistory.length;',
'    for (const { id, delta, outcome } of this.rankedHistory) {',
'      for (let i = 0; i < 32; i += 2) b[o++] = Number.parseInt(id.slice(i, i + 2), 16);',
'      dv.setInt8(o++, delta);',
'      b[o++] = OUTCOMES.indexOf(outcome);',
'    }',
'    return b;']);
edit('if (body[0] !== 1 && body[0] !== 2)', 'if (![1, 2, 3].includes(body[0]))');
edit('    let o = 1;\n    this.points',[
'    const len = b[0] === 1 ? 25 : Math.ceil(SKIN_COUNT / 8);',
'    const base = 1 + 4 + len + SLOTS + 4 + 2;',
'    const count = b[0] === 3 ? b[base + 2] : 0;',
'    const expected = b[0] === 3 ? base + 3 + RANK_RECORD * count : base;',
"    if (b.length !== expected || count > HISTORY_LIMIT) throw new Error('The save code has an invalid length.');",
'    const history = [];',
'    let rating = START_RATING;',
'    if (b[0] === 3) {',
'      rating = ratingOf(dv.getUint16(base, true));',
'      let offset = base + 3;',
'      for (let i = 0; i < count; i++) {',
"        const id = Array.from(b.subarray(offset, offset + 16), v => v.toString(16).padStart(2, '0')).join('');",
'        offset += 16;',
'        const delta = dv.getInt8(offset++), outcome = OUTCOMES[b[offset++]];',
"        if (!outcome || Math.abs(delta) > 32 || history.some(entry => entry.id === id)) throw new Error('The ranked history is invalid.');",
'        history.push({ id, delta, outcome });',
'      }',
'    }',
'    let o = 1;',
'    this.points']);
edit('    // Version 1 codes hold 200 skins (25 bytes), version 2 holds 201 (26 bytes).\n    const len = b[0] === 1 ? 25 : Math.ceil(SKIN_COUNT / 8);\n','');
edit('    this.packs = dv.getUint16(o, true);','    this.packs = dv.getUint16(o, true);\n    this.rating = rating; this.rankedHistory = history;');
fs.writeFileSync(p,s);

