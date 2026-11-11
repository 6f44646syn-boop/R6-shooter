# M10 replays and win screens

The feature branch includes Claude’s M9 online modes and the Bomb drone fix through
`59dfc6a`. Battle, Team Deathmatch, Capture the Flag, and Bomb share the existing
relay and direct connections.

Battle and match recordings keep six seconds at up to 30 Hz. The kill camera plays
the recorded aim, ADS, lean, effective weapon, optic, and skin. Older frame layouts
still play. Playback uses recorded actors and shot traces with the current map
geometry.

Hold the bound grenade action when throwing to follow the projectile. Release it to
return to first person. A grenade death uses the recorded path and holds at the blast
for one second. Flight can play faster to fit the respawn window. When a client has no
usable track or the match cannot attribute a blast to one grenade, the death replay
uses the killer’s view.

The match-end sequence opens on the last player-caused kill from the killer’s
perspective. It then shows the winning side’s 3D lineup and the full leaderboard.
Skip replay cuts directly to the results. A draw can line up the top six. A match with
no recorded kill opens directly on the lineup and leaderboard. Online clients receive
the host’s final scores in the end message.

Run `node tests/replay-browser.mjs` and `node tests/finale-browser.mjs` for the focused
checks. The broad browser suite includes two-session checks for online grenade cameras,
grenade death replays, and the final-kill screen. Run `node tools/check-modes.mjs` for
the simulation checks. The 1080-rpm one-second shot-count check has a known baseline
failure of 18 shots versus 19. The direct tests run locally. Relay tests require a
running relay.

M11 spectator and ranked play and M12 Training Academy follow. Before a live release,
apply the repository’s version stamp and audio pack rebake.
