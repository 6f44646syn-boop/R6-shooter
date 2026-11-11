import fs from 'node:fs';const root=process.argv[2];const p=root+'/docs/ENGINE_API.md';let s=fs.readFileSync(p,'utf8');const a=s.indexOf('`ModeGame._record()`');const b=s.indexOf('\n## Network',a);s=s.slice(0,a)+`The existing recorders retain six seconds at up to 30 Hz. Match recording is sampled
from the fixed simulation loop. Each new frame has version 2. Match frames have
\`stride: 13\` with the original seven fields first, followed by ADS blend, lean,
catalogue gun slot, firing, recoil yaw and recoil pitch. Per-frame \`loadouts\` carry
attachment code, skin and optic. Unversioned seven-field match frames still play.

Battle frames retain their original ten fields and append lean, catalogue gun slot,
attachment code, skin and optic. Older ten-field frames still play. A kill cam owns
an immutable frame/shot window so live recorder trimming cannot move its shot cursor.
Stopping either mode clears its recording.

\`js/replay/view.js\` applies the live Human lean distance/roll and tangent-space ADS
FOV blend. Kill cams rebuild the recorded effective gun through \`effectiveGun()\`
and draw its first-person rig after the world-post pass. Battle's existing state
messages append lean and optic, with defaults for older peers and bounded lean input.

This increment covers first-person replay state. Grenade trajectories, grenade chase
input and spectator/ranked/Academy features are pending. Online Battle grenades remain
disabled and match modes remain offline as described below.
`+s.slice(b);fs.writeFileSync(p,s);
