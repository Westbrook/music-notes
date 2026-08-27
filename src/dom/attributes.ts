/** Shared by the DOM reader and custom-element attribute observers. */
const layout = ['max-measures', 'justify-last', 'measure-numbers', 'print-width', 'print-preview'];
const context = ['clef', 'key', 'meter', 'groups'];
const rhythm = ['duration', 'dots', 'dotted', 'beam', 'stem', 'tie', 'triplet'];
const annotation = ['text', 'placement', 'at'];

export const MUSIC_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  'music-system': ['label', 'bracket', ...context, ...layout],
  'music-staff': ['label', ...context, ...layout],
  'music-measure': ['label', 'number', ...context, 'break-before', 'keep-with-next', 'end-bar', 'repeat-start', 'pickup', 'incomplete', ...layout],
  'music-voice': [],
  'music-tuplet': ['actual', 'normal', 'bracket', 'ratio'],
  'music-note': ['pitch', 'accidental', 'accidental-display', ...rhythm],
  'music-chord': ['pitches', 'accidental-display', ...rhythm],
  'music-rest': ['measure', ...rhythm],
  'music-slash': ['rhythmic', ...rhythm],
  'music-meter': ['top', 'bottom', 'groups'],
  'music-tempo': ['marking', 'bpm', 'beat', 'dots', 'dotted', ...annotation],
  'music-dynamics': ['level', ...annotation],
  'music-direction': annotation,
  'music-harmony': annotation,
  'music-rehearsal': annotation,
};

const globalAttributes = new Set([
  'id', 'class', 'style', 'title', 'slot', 'part', 'exportparts', 'role', 'tabindex',
  'lang', 'dir', 'translate', 'hidden', 'inert', 'accesskey', 'contenteditable',
  'draggable', 'spellcheck', 'autocapitalize', 'autofocus', 'enterkeyhint', 'inputmode',
  'is', 'nonce', 'popover', 'itemscope', 'itemtype', 'itemid', 'itemprop', 'itemref',
]);

// Do not blanket-allow on*: a misspelled notation attribute such as "onset"
// must not be mistaken for an event handler and silently ignored.
const eventAttributes = new Set(([
  'abort', 'animationcancel', 'animationend', 'animationiteration', 'animationstart', 'auxclick',
  'beforeinput', 'beforematch', 'beforetoggle', 'blur', 'cancel', 'canplay', 'canplaythrough',
  'change', 'click', 'close', 'compositionend', 'compositionstart', 'compositionupdate',
  'contextlost', 'contextmenu', 'contextrestored', 'copy', 'cuechange', 'cut', 'dblclick',
  'drag', 'dragend', 'dragenter', 'dragleave', 'dragover', 'dragstart', 'drop', 'durationchange',
  'emptied', 'ended', 'error', 'focus', 'focusin', 'focusout', 'formdata', 'gotpointercapture',
  'input', 'invalid', 'keydown', 'keypress', 'keyup', 'load', 'loadeddata', 'loadedmetadata',
  'loadstart', 'lostpointercapture', 'mousedown', 'mouseenter', 'mouseleave', 'mousemove',
  'mouseout', 'mouseover', 'mouseup', 'paste', 'pause', 'play', 'playing', 'pointercancel',
  'pointerdown', 'pointerenter', 'pointerleave', 'pointermove', 'pointerout', 'pointerover',
  'pointerrawupdate', 'pointerup', 'progress', 'ratechange', 'reset', 'resize', 'scroll',
  'scrollend', 'securitypolicyviolation', 'seeked', 'seeking', 'select', 'selectionchange',
  'selectstart', 'slotchange', 'stalled', 'submit', 'suspend', 'timeupdate', 'toggle',
  'touchcancel', 'touchend', 'touchmove', 'touchstart', 'transitioncancel', 'transitionend',
  'transitionrun', 'transitionstart', 'volumechange', 'waiting', 'webkitanimationend',
  'webkitanimationiteration', 'webkitanimationstart', 'webkittransitionend', 'wheel',
] satisfies (keyof GlobalEventHandlersEventMap)[]).map(name => `on${name}`));

export function isKnownAttribute(tag: string, name: string): boolean {
  return globalAttributes.has(name) || eventAttributes.has(name) || /^(data-|aria-)/.test(name)
    || (Object.hasOwn(MUSIC_ATTRIBUTES, tag) && MUSIC_ATTRIBUTES[tag].includes(name));
}
