import fs from 'node:fs';
function edit(p,pairs){let s=fs.readFileSync(p,'utf8');for(const [a,b] of pairs){if(!s.includes(a))throw Error(p+' '+a);s=s.replace(a,Array.isArray(b)?b.join('\n'):b);}fs.writeFileSync(p,s);}
edit('js/core/ranked.js',[
 ['export async function verifyRankedResult(ticket, packet) {','export function validRankedTicket(ticket) {\n  return !!ticket && /^[0-9a-f]{32}$/.test(ticket.id) && !!ticket.publicKey && Array.isArray(ticket.roster)\n    && ticket.roster.length >= 2 && ticket.roster.length <= 10\n    && new Set(ticket.roster.map(row => row?.[0])).size === ticket.roster.length\n    && ticket.roster.every(row => Array.isArray(row) && row.length === 3 && Number.isInteger(row[0])\n      && [\'A\', \'B\'].includes(row[1]) && Number.isInteger(row[2]) && row[2] >= 0 && row[2] <= 3000);\n}\n\nexport async function verifyRankedResult(ticket, packet) {\n  if (!validRankedTicket(ticket)) return null;'],
]);
edit('js/main.js',[
 ['rankedChange, verifyRankedResult }','rankedChange, validRankedTicket, verifyRankedResult }'],
 ['        if (pending.expires > Date.now()) rankPending.set(pending.ticket.id, pending);','        if (pending.expires > Date.now() && validRankedTicket(pending.ticket)) rankPending.set(pending.ticket.id, pending);'],
 ["    if (!/^[0-9a-f]{32}$/.test(ticket.id) || !Array.isArray(ticket.roster) || ticket.roster.length > 10) return;",'    if (!validRankedTicket(ticket) || !ticket.roster.some(([actorId]) => actorId === id)) return;'],
 ["    $('net-rank-info').textContent = rankOf(profile.rating) + ' · ' + profile.rating + ' Elo · Stored on this profile';",[
 "    const crest = document.createElement('span');",
 "    crest.className = 'rank-crest';",
 '    crest.dataset.rank = rankOf(profile.rating).toLowerCase();',
 "    crest.setAttribute('aria-hidden', 'true');",
 "    $('net-rank-info').replaceChildren(crest, rankOf(profile.rating) + ' · ' + profile.rating + ' Elo · Stored on this profile');"]],
 ["join.textContent = game.map + ' · '", "join.textContent = (MAP_NAMES[game.map]?.split(' (')[0] || game.map) + ' · '"],
 ["  $('net-reset').addEventListener('click', () => { if (battle && battle.active && battle.net) leaveBattle(); netReset(); netStatus('Disconnected.'); });",[
 "  $('net-reset').addEventListener('click', async () => {",
 '    const game = cur();',
 '    if (game?.active && (game.net || game.netRole)) {',
 "      if (game.rankedHost && !game.over) await game._finishRanked(game.me.team === 'A' ? 'B' : 'A', true);",
 '      leaveBattle();',
 '    }',
 "    netReset(); netStatus('Disconnected.');",
 '  });']],
 ['  async function startMode(mode = flow.mode, extra = {}) {\n    controls.release();','  let modeStarting = false;\n  async function startMode(mode = flow.mode, extra = {}) {\n    if (modeStarting) return false;\n    modeStarting = true;\n    controls.release();'],
 ["      return false;\n    }\n    $('hud').hidden = true;\n    flow.inGame = true;\n    $('pause-title').textContent = 'Match paused';", "      return false;\n    } finally { modeStarting = false; }\n    $('hud').hidden = true;\n    flow.inGame = true;\n    $('pause-title').textContent = 'Match paused';"],
]);
edit('js/modes/net-match.js',[
 ["    if (!m || !msg) return;\n    if (msg.k === 'mwatch'", "    if (!m || !msg) return;\n    if (g.viewOnly && !['mwatch', 'mmap', 'mev'].includes(msg.k)) return;\n    if (msg.k === 'mwatch'"],
 ['      const e = decode(raw, m);','      const e = decode(raw, m);\n      if (g.viewOnly && e.type !== \'end\') continue;'],
 ["peer.retired && msg.k !== 'stopped' && msg.k !== 'mrankStatus'", "peer.retired && msg.k !== 'stopped'"],
]);
edit('js/modes/game.js',[
 ['    this.map = new MatchMap(mapData);\n    const seed = o.seed', '    const seed = o.seed'],
 ['    const remotes = players ? teamsFor(o.mode, o.side, players, ranked) : undefined;', '    const remotes = players ? teamsFor(o.mode, o.side, players, ranked) : undefined;\n    this.map = new MatchMap(mapData);'],
]);
edit('js/replay/spectator.js',[
 ["'Free camera · WASD to fly, Space / vault to change height'","'Free camera · movement to fly, sprint for speed, crouch / vault for height'"],
]);

