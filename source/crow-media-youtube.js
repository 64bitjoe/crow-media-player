/*
 * Crow Media Player — YouTube artwork (fork addition, not part of upstream)
 * An Apple TV playing the YouTube app reports the video's title and channel but no picture. With the card
 * option `youtube_artwork: true`, this looks the video up through a rest_command in Home Assistant (so the
 * API key stays on the server) and hands the card a copy of hass with entity_picture filled in. Every place
 * the card shows artwork reads hass, so none of them need changing.
 * Needs, in Home Assistant:
 *   rest_command:
 *     youtube_search:
 *       url: "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q={{ q | urlencode }}"
 *       method: GET
 *       headers:
 *         X-goog-api-key: !secret youtube_api_key
 * Anything missing or failing: the card gets hass untouched and behaves exactly as upstream.
 */
(() => {
'use strict';
const K = window.CrowMediaKit || (window.CrowMediaKit = { ready: {} });
if (K.ready.youtube) return;

const MAX = 200;
const looks = new Map();     // entity|title -> Promise<url or ''>
const found = new Map();     // entity|title -> url ('' when nothing was found)
const cards = new Set();     // cards to redraw when a lookup finishes
const raws = new WeakMap();  // a copy of hass handed out -> the hass it was made from
const pics = new WeakMap();  // an entity's state -> { url, state } (the same copy until either changes)
const wraps = new WeakMap(); // card -> { raw, sig, hass } (the last copy, reused while nothing changes)

function isYouTube(a) {
  const s = ((a?.app_name || '') + ' ' + (a?.app_id || '')).toLowerCase();
  return s.includes('youtube') && !s.includes('youtube music') && !s.includes('youtubemusic');
}

function wanted(a) {
  return !!a && !a.entity_picture && !a.entity_picture_local && !!a.media_title && isYouTube(a);
}

function thumb(res) {
  const item = (res?.response ?? res)?.content?.items?.[0];
  const t = item?.snippet?.thumbnails;
  const url = t?.high?.url || t?.medium?.url || t?.default?.url;
  if (url) return String(url).replace(/^http:\/\//i, 'https://');
  const id = item?.id?.videoId;
  return id ? 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg' : '';
}

function lookup(hass, key, a) {
  if (looks.has(key)) return;
  if (looks.size >= MAX) { const old = looks.keys().next().value; looks.delete(old); found.delete(old); }
  const q = [a.media_title, a.media_artist].filter(Boolean).join(' ');
  const p = Promise.resolve()
    .then(() => hass.callService('rest_command', 'youtube_search', { q }, undefined, false, true))
    .then(thumb, () => '')
    .then(url => {
      found.set(key, url);
      if (url) redraw();
      return url;
    });
  looks.set(key, p);
}

function redraw() {
  for (const card of cards) {
    if (!card.isConnected) { cards.delete(card); continue; }
    const raw = wraps.get(card)?.raw;
    if (raw) { try { card.hass = raw; } catch (_) {} }
  }
}

function ids(card) {
  const cfg = card._config || {};
  const out = new Set();
  [card._entity, ...(cfg.entities || []), ...(cfg.ma_entities || [])].forEach(e => {
    const id = typeof e === 'string' ? e : e?.entity;
    if (id && id.startsWith('media_player.')) out.add(id);
  });
  return out;
}

// hass with entity_picture filled in for the YouTube videos that have been found, or hass itself
function wrap(card, hass) {
  try {
    hass = raws.get(hass) || hass;
    const states = hass?.states;
    if (!states) return hass;
    cards.add(card);
    const add = {};
    let sig = '';
    for (const id of ids(card)) {
      const st = states[id];
      const a = st?.attributes;
      if (!wanted(a)) continue;
      if (!hass.services?.rest_command?.youtube_search) continue;
      const key = id + '|' + a.media_title;
      if (!looks.has(key)) lookup(hass, key, a);
      const url = found.get(key);
      if (!url) continue;
      let p = pics.get(st);
      if (!p || p.url !== url) {
        p = { url, state: { ...st, attributes: { ...a, entity_picture: url } } };
        pics.set(st, p);
      }
      add[id] = p.state;
      sig += id + '\n' + url + '\n';
    }
    if (!sig) { wraps.set(card, { raw: hass, sig: '', hass }); return hass; }
    const last = wraps.get(card);
    if (last && last.raw === hass && last.sig === sig) return last.hass;
    const copy = { ...hass, states: { ...states, ...add } };
    raws.set(copy, hass);
    wraps.set(card, { raw: hass, sig, hass: copy });
    return copy;
  } catch (e) {
    console.warn('[Crow Media Player] YouTube artwork', e);
    return raws.get(hass) || hass;
  }
}

window.CrowMediaYouTube = { wrap, isYouTube, thumb };
K.ready.youtube = true;
})();
