// Game portals (CrazyGames) frame the game with mouse capture allowed, reject off-site links and custom
// fullscreen, and cap the upload at 50 MB, so the optional packs (hd/, skinpack/) are not uploaded there:
// they download from the GitHub Pages copy, which serves them with Access-Control-Allow-Origin: *.
export const onPortal = /(^|\.)crazygames\.[a-z.]+$/.test(location.hostname) || /^https?:\/\/([^/]+\.)?crazygames\./.test(document.referrer);
export const PACK_HOME = 'https://6f44646syn-boop.github.io/R6-shooter/';
