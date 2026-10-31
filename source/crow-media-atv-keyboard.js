/*
 * Crow Media Player — Apple TV keyboard everywhere (fork addition, not part of upstream)
 * Upstream shows its Apple TV Keyboard panel only in the remote view. With the card option
 * `apple_tv_keyboard: true` this shows the same panel in the full view too, gives the compact view a keyboard
 * button that opens it, adds a Clear button, and (unless `keyboard_live: false`) sends the field to the TV as you
 * type. Everything is found from the selected entity: its device's keyboard focus sensor, and its config entry.
 * Anything missing or failing: upstream's own behaviour.
 */
(() => {
'use strict';
const K = window.CrowMediaKit || (window.CrowMediaKit = { ready: {} });
if (K.ready.atvkb) return;

const RETRY = 60000;
const LIVE_MS = 300;
const found = new Map();   // media_player -> { info: { binarySensorId, configEntryId } | null | false (lookup failed), at }
const looking = new Set(); // media_player entities being looked up

const KB_ICON = 'M19,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.9 20.1,3 19,3M11,5H13V7H11V5M8,5H10V7H8V5M5,5H7V7H5V5M5,8H7V10H5V8M5,11H7V13H5V11M19,19H5V16H19V19M19,13H17V11H19V13M19,10H17V8H19V10M16,13H14V11H16V13M16,10H14V8H16V10M16,7H14V5H16V7M19,7H17V5H19V7M13,13H11V11H13V13M13,10H11V8H13V10M10,13H8V11H10V13M10,10H8V8H10V10Z';

// the keyboard focus sensor on the same device, and the config entry this media_player belongs to
async function lookup(hass, entityId) {
  const ent = hass.entities?.[entityId];
  const dev = ent?.device_id;
  if (!dev) return null;
  const sensor = Object.values(hass.entities).find(e => e?.device_id === dev && e.entity_id?.startsWith('binary_sensor.') &&
    (e.translation_key === 'keyboard_focus' || e.entity_id.endsWith('_keyboard_focus')));
  if (!sensor) return null;
  const entries = hass.devices?.[dev]?.config_entries || [];
  let configEntryId = entries.length === 1 ? entries[0] : null;
  if (!configEntryId) {
    const reg = await hass.callWS({ type: 'config/entity_registry/get', entity_id: entityId });
    configEntryId = reg?.config_entry_id || null;
  }
  return configEntryId ? { binarySensorId: sensor.entity_id, configEntryId } : null;
}

// undefined while looking, then the answer: null for none, false when the lookup failed (upstream's own lookup
// takes over then); looked up again a minute after either
function resolve(card, entityId) {
  const hit = found.get(entityId);
  if (hit && (hit.info || Date.now() - hit.at < RETRY)) return hit.info;
  if (!looking.has(entityId)) {
    looking.add(entityId);
    Promise.resolve().then(() => lookup(card._hass, entityId)).catch(() => false).then(info => {
      found.set(entityId, { info, at: Date.now() });
      looking.delete(entityId);
      // upstream's cache too: its update check watches the sensor from there
      if (info !== false) {
        if (!card._atvKeyboardInfoCache) card._atvKeyboardInfoCache = {};
        card._atvKeyboardInfoCache[entityId] = info;
        card._hassWatch = null;
      }
      if (card.isConnected && card._entity === entityId) { try { card._checkAppleTVKeyboard(card._isAppleTV); } catch (_) {} }
    });
  }
  return hit ? hit.info : undefined;
}

function send(card, service, data) {
  try {
    return Promise.resolve(card._hass.callService('apple_tv', service, data, undefined, false)).catch(() => {});
  } catch (_) { return Promise.resolve(); }
}

// live typing and a Clear button, added to upstream's panel
function enhance(card, info) {
  const panel = card.shadowRoot?.getElementById('atvKeyboardPanel');
  if (!panel || panel.dataset.crowFork) return panel;
  panel.dataset.crowFork = info.configEntryId;
  const input = panel.querySelector('#atvKeyboardInput');
  const sendBtn = panel.querySelector('#atvKeyboardSend');
  if (!input) return panel;
  const cfg = card._config || {};
  const entry = { config_entry_id: info.configEntryId };
  let timer = null, last = null;
  if (cfg.keyboard_live !== false) {
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = input.value;
        if (text === last) return;
        last = text;
        send(card, 'set_keyboard_text', { ...entry, text });
      }, LIVE_MS);
    });
    // Enter and Send already send the field (upstream); that's what the TV has now
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); last = input.value; } });
    sendBtn?.addEventListener('click', () => { clearTimeout(timer); last = input.value; });
  }
  if (sendBtn) {
    const clear = document.createElement('button');
    clear.id = 'atvKeyboardClearAll';
    clear.textContent = 'Clear';
    clear.style.cssText = sendBtn.style.cssText + ';background:' + (card._pt?.('bg') || '#2c2c2e') + ';color:' + (card._pt?.('text') || '#fff') +
      ';border:1px solid ' + (card._pt?.('border') || 'rgba(255,255,255,0.15)');
    clear.addEventListener('pointerdown', e => {
      e.preventDefault();
      clearTimeout(timer);
      input.value = '';
      last = '';
      input.dispatchEvent(new Event('input'));
      input.focus();
      send(card, 'clear_keyboard_text', entry);
    });
    sendBtn.parentNode.insertBefore(clear, sendBtn);
  }
  // the compact card is short: the explanation goes, so the field fits
  if (card.shadowRoot.getElementById('cardOuter')?.classList.contains('mode-compact')) {
    const note = panel.querySelector('.info-popup-content > div:first-child');
    if (note && !note.querySelector('input')) note.style.display = 'none';
  }
  return panel;
}

function open(card, info, fromTap) {
  card._atvKeyboardManuallyDismissed = false;
  const done = () => {
    const panel = enhance(card, info);
    // a tap can bring up the phone's keyboard; focusing without one (the panel appearing on its own) can't
    if (fromTap) panel?.querySelector('#atvKeyboardInput')?.focus();
    button(card, null);
  };
  let r;
  try { r = card._showAppleTVKeyboardPanel(info.configEntryId); } catch (_) { return; }
  if (r && typeof r.then === 'function') r.then(done, () => {}); else done();
}

// the small keyboard button (compact view, or after the panel was closed): shown while the TV wants text
function button(card, info) {
  const r = card.shadowRoot;
  const outer = r?.getElementById('cardOuter');
  let btn = r?.getElementById('atvKeyboardForkBtn');
  if (!info || !outer) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'atvKeyboardForkBtn';
    btn.title = 'Apple TV Keyboard';
    btn.setAttribute('aria-label', 'Apple TV Keyboard');
    btn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:40;width:32px;height:32px;padding:6px;border:none;border-radius:50%;' +
      'background:#0A84FF;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;';
    btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#fff;display:block;"><path d="' + KB_ICON + '"/></svg>';
    outer.appendChild(btn);
  }
  btn.onclick = e => { e.stopPropagation(); open(card, info, true); };
}

// Called first thing in upstream's _checkAppleTVKeyboard. true: handled here; false: upstream carries on.
function check(card, isAppleTV) {
  try {
    if (!isAppleTV || card._config?.atv_keyboard_panel === false || !card._hass) { button(card, null); return false; }
    const entityId = card._entity;
    const info = resolve(card, entityId);
    if (info === undefined) return true;   // still looking; upstream mustn't start its own lookup
    if (info === false) return false;      // couldn't look it up: upstream's panel, as upstream does it
    if (!info) { button(card, null); return false; }
    if (card._hass.states[info.binarySensorId]?.state !== 'on') { button(card, null); return false; }
    // the TV wants text: have the panel ready, so a tap opens it at once (and the phone keyboard with it)
    if (!K.ready.panels) { try { K.kit?.crowMediaLoad?.('panels')?.catch(() => {}); } catch (_) {} }
    let panel = card.shadowRoot?.getElementById('atvKeyboardPanel');
    // open for another Apple TV (the player was switched while both wanted text): start again for this one
    if (panel?.dataset.crowFork && panel.dataset.crowFork !== info.configEntryId) { panel.remove(); panel = null; }
    if (panel) { enhance(card, info); button(card, null); return true; }
    const compact = card.shadowRoot?.getElementById('cardOuter')?.classList.contains('mode-compact');
    if (compact || card._atvKeyboardManuallyDismissed) { button(card, info); return true; }
    open(card, info, false);
    return true;
  } catch (e) {
    console.warn('[Crow Media Player] Apple TV keyboard', e);
    return false;
  }
}

window.CrowMediaAtvKb = { check, lookup };
K.ready.atvkb = true;
})();
