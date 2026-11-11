import fs from 'node:fs';const p=process.argv[2]+'/docs/MILESTONE_10_HANDOFF.md';let s=fs.readFileSync(p,'utf8');const a=s.indexOf('- The exact `package.json`');const b=s.indexOf('- Syntax and whitespace',a);s=s.slice(0,a)+`- The exact \`package.json\` test sequence was executed with bundled Node because
  this desktop has no npm executable. Node/WASM suites pass. The final browser
  run after the roof merge passes 237 checks, with one failure on the 1080-rpm
  one-second shot count (18 shots versus 19). The same failure occurs on unchanged
  M8 \`3a5db4d\`. Direct WebRTC kill cams pass. Relay coverage was skipped because
  no relay was running.
- The shooting fixture now respawns the player before its scripted shots,
  resetting weapon state left by the roaming combat. The skin fixture selects a
  compatible gun when the random reward is gun-specific. Both original gameplay
  assertions pass in the final browser run.
`+s.slice(b);fs.writeFileSync(p,s);
