import fs from 'node:fs';
const path='docs/ENGINE_API.md';
let s=fs.readFileSync(path,'utf8');
s=s.replace(/Network play means the existing relay and WebRTC Battle only[^\\n]*\\n[^\\n]*/, 'Network play uses the existing relay and WebRTC links with a player as host.');
const a=s.indexOf('This increment covers first-person replay state.');
const b=s.indexOf('\n## Network',a);
if(a<0||b<0)throw new Error('Missing replay section');
s=s.slice(0,a)+[
'Hold the bound grenade action to follow your confirmed throw. Releasing it returns to',
'first person. Grenade deaths replay the recorded path and hold on the blast for one second.',
'The path may play faster to fit the respawn window. The camera clips against walls.',
'Online clients record positions from the existing host messages. Battle links the kill',
'feed to the blast by grenade ID. Match modes associate a grenade kill with its boom',
'and send the resulting ID in the same event stream. A kill cam uses first person if it',
'cannot establish the projectile identity or path.',
'',
'The win screen uses the last player-caused kill in Battle, Team Deathmatch, Capture',
'the Flag and Bomb. The final kill always plays from the killer’s first-person view.',
'Afterward, the winning side appears in a 3D lineup with the full leaderboard.',
'Draws can line up the top six by kills and deaths. Matches without a recorded kill go',
'straight to results. The host sends the final scores with the end message.',
'',
].join('\n')+s.slice(b);
fs.writeFileSync(path,s);
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.scripts['test:finale']='node tests/finale-browser.mjs';
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');

