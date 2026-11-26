// Rank badges: one drawing per rank (Copper a plain medal ... Champion a crown), a laurel from Bronze
// up, and the division (5 lowest ... 1 highest) on the badge; Champion shows its world number.
import { rankOf, rankDivision } from '../core/ranked.js?v=7141ab8-mwx5zl37';

const TIER = {   // light, dark, laurel colour
  Copper: ['#e39a6a', '#7a3d1d', null],
  Bronze: ['#f0b47a', '#8a5226', '#c58a4f'],
  Silver: ['#f4f6f9', '#7d8894', '#aab4bf'],
  Gold: ['#ffe58f', '#b8860b', '#e6b230'],
  Platinum: ['#d4fff6', '#2f9e8c', '#5fc9b6'],
  Emerald: ['#b8ffd2', '#0f8a4a', '#3fd17f'],
  Diamond: ['#e2f1ff', '#3f6fe0', '#7aa6ff'],
  Champion: ['#ff8a80', '#b0161b', '#ffd36b'],
};
// The emblem in the middle of each rank (64 x 64 box, centred on 32, 30).
const EMBLEM = {
  Copper: '<circle cx="32" cy="34" r="15"/>',
  Bronze: '<circle cx="32" cy="34" r="14"/>',
  Silver: '<path d="M32 16 L46 21 V33 C46 42 40 48 32 51 C24 48 18 42 18 33 V21 Z"/>',
  Gold: '<path d="M32 15 L36.7 26.5 L49 27.4 L39.6 35.3 L42.6 47.4 L32 40.8 L21.4 47.4 L24.4 35.3 L15 27.4 L27.3 26.5 Z"/>',
  Platinum: '<path d="M32 15 L46 23 V39 L32 47 L18 39 V23 Z"/>',
  Emerald: '<path d="M25 15 H39 L47 23 V41 L39 49 H25 L17 41 V23 Z"/>',
  Diamond: '<path d="M22 20 H42 L50 29 L32 50 L14 29 Z"/>',
  Champion: '<path d="M16 42 L14 22 L24 30 L32 16 L40 30 L50 22 L48 42 Z"/><rect x="16" y="43" width="32" height="5" rx="1.5"/>',
};
// Facet lines that make the gems and the crown read as such (drawn lighter on top).
const SHINE = {
  Platinum: '<path d="M32 15 V31 M18 23 L32 31 L46 23" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>',
  Emerald: '<path d="M26 21 H38 L41 24 V40 L38 43 H26 L23 40 V24 Z M25 15 L26 21 M39 15 L38 21 M47 23 L41 24 M47 41 L41 40 M39 49 L38 43 M25 49 L26 43 M17 41 L23 40 M17 23 L23 24" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.1"/>',
  Diamond: '<path d="M14 29 H50 M27 20 L23 29 L32 50 L41 29 L37 20" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>',
  Champion: '<circle cx="32" cy="16" r="2.4" fill="#fff"/><circle cx="14" cy="22" r="2" fill="#fff"/><circle cx="50" cy="22" r="2" fill="#fff"/>',
};
// A laurel: leaves along an arc on each side, meeting under the emblem.
function laurel(color) {
  let leaves = '';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const deg = 245 - i * 24, a = deg * Math.PI / 180, r = 25;   // from near the bottom (a gap in the middle) up the side
      const x = 32 + side * Math.cos(a) * -r, y = 36 - Math.sin(a) * -r * 0.95;
      const rot = side * (90 - deg) + (side < 0 ? 180 : 0) + side * 35;
      leaves += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="5.2" ry="2.3" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
  }
  return `<g fill="${color}" stroke="#0006" stroke-width=".6">${leaves}</g>`;
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];   // divisions in Roman numerals (Champion: its world number)
let uid = 0;
// The badge as an SVG string. champ: a Champion's world number (0 if not known yet).
export function rankIconSvg(rating, champ = 0) {
  const rank = rankOf(rating), div = rankDivision(rating), [hi, lo, leaf] = TIER[rank], id = 'rk' + (++uid);
  const label = rank === 'Champion' ? (champ ? '#' + champ : '') : ROMAN[div];
  const ribbon = rank === 'Copper' || rank === 'Bronze'
    ? `<path d="M24 4 H31 L33 20 H26 Z" fill="${lo}"/><path d="M40 4 H33 L31 20 H38 Z" fill="${hi}" opacity=".85"/>` : '';
  const text = label ? `<text x="32" y="${rank === 'Champion' ? 61 : 39}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="${rank === 'Champion' ? (label.length > 4 ? 9 : 11) : label.length > 2 ? 11 : 14}" fill="${rank === 'Champion' ? '#ffd36b' : '#101418'}" stroke="${rank === 'Champion' ? '#3a0608' : 'none'}" stroke-width="${rank === 'Champion' ? 2.5 : 0}" paint-order="stroke">${label}</text>` : '';
  return `<svg viewBox="0 0 64 64" width="100%" height="100%" role="img" aria-label="${rank}${label ? ' ' + label : ''}">`
    + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>`
    + ribbon + (leaf ? laurel(leaf) : '')
    + `<g fill="url(#${id})" stroke="#0008" stroke-width="1.4" stroke-linejoin="round">${EMBLEM[rank]}</g>`
    + (SHINE[rank] || '') + text + '</svg>';
}
