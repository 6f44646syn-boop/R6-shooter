// CrazyGames SDK v3 (https://docs.crazygames.com/sdk/game/), loaded on CrazyGames only (portal.js).
// Everywhere else, or if the SDK fails or is slow, every call is a no-op: the game never waits on it.
// Rooms: a relay game code is the room id, and invitees get it back as the 'code' invite param.
import { onPortal } from './portal.js?v=baf45fb-mwym4iwy';

let game = null;   // SDK.game, once init has finished on a CrazyGames domain
let username = null;   // the signed-in CrazyGames user's name (null for guests): shown to friends in network games
const call = (fn) => { try { if (game) fn(game); } catch (e) { console.warn('[CrazyGames]', e); } };

export const ready = !onPortal ? Promise.resolve() : new Promise((done) => {
  const s = document.createElement('script');
  s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
  s.onload = () => window.CrazyGames.SDK.init()
    .then(async () => {
      const SDK = window.CrazyGames.SDK;
      if (SDK.environment === 'disabled') return;
      game = SDK.game;
      try { username = (await SDK.user.getUser())?.username || null; } catch (e) { /* guest, or no user module */ }
    })
    .catch((e) => console.warn('[CrazyGames]', e)).finally(done);
  s.onerror = () => done();
  document.head.append(s);
  setTimeout(done, 5000);   // a slow SDK never holds up the game
});

let playing = false;   // gameplayStart/Stop only on a real change
export const cg = {
  loadingStart: () => call((g) => g.loadingStart()),
  loadingStop: () => call((g) => g.loadingStop()),
  gameplay(on) { if (on !== playing) { playing = on; call((g) => (on ? g.gameplayStart() : g.gameplayStop())); } },
  room: (code) => call((g) => g.updateRoom({ roomId: code, isJoinable: true, inviteParams: { code } })),
  leftRoom: () => call((g) => g.leftRoom()),
  get inviteCode() { try { return game?.getInviteParam('code') || null; } catch (e) { return null; } },
  get instant() { return !!game?.isInstantMultiplayer; },
  get username() { return username; },
  onJoin: (fn) => call((g) => g.addJoinRoomListener((p) => { if (p?.code) fn(String(p.code)); })),
};
