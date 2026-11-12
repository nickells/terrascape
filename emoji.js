// Pixel emoji: turns the system's glossy colour emoji into tiny 16-colour pixel icons.
// Each emoji is drawn once at 13x13, its soft edges are cut to hard on/off pixels, and its colours are
// snapped (with a little ordered dither) to the classic 16-colour VGA / Windows palette.
// A MutationObserver keeps menus, dialogs and lists converted as they redraw.

const S = 13;   // icon size in pixels
const PALETTE = ['000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
  '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff']
  .map(h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const cache = new Map();
function nearest(r, g, b) {
  let best = PALETTE[0], bd = Infinity;
  for (const p of PALETTE) {
    // weight green most, like the eye does, so skin and wood tones land on sensible colours
    const d = 0.3 * (r - p[0]) ** 2 + 0.59 * (g - p[1]) ** 2 + 0.11 * (b - p[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
export function pixelEmoji(ch) {
  if (cache.has(ch)) return cache.get(ch);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${S - 1}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.fillText(ch, S / 2, S / 2 + 1);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (d[i + 3] < 120) { d[i + 3] = 0; continue; }          // hard edge: no partial transparency
    const t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * 56; // ordered dither before snapping colours
    const p = nearest(d[i] + t, d[i + 1] + t, d[i + 2] + t);
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL();
  cache.set(ch, url);
  return url;
}

// characters the browser draws as colour emoji (plus the eye, which macOS shows in colour without a selector)
const RE = /(?:\p{Emoji_Presentation}|\u{1F441}|[☀-➿])️?/gu;
const COLOUR_ONLY = /\p{Emoji_Presentation}|\u{1F441}|️/u;   // skip plain text symbols like ✓ ▶ ●
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION', 'SELECT', 'INPUT']);

function convertText(node) {
  const text = node.nodeValue;
  if (!text || !RE.test(text)) return;
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0, changed = false;
  for (const m of text.matchAll(RE)) {
    if (!COLOUR_ONLY.test(m[0])) continue;
    changed = true;
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const im = document.createElement('img');
    im.className = 'pxe'; im.alt = m[0]; im.src = pixelEmoji(m[0].replace('️', ''));
    frag.appendChild(im);
    last = m.index + m[0].length;
  }
  if (!changed) return;
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  node.parentNode.replaceChild(frag, node);
}
function convertTree(root) {
  if (root.nodeType === 3) { if (!SKIP.has(root.parentNode?.nodeName)) convertText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => SKIP.has(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(convertText);
}

export function startPixelEmoji(root = document.body) {
  const style = document.createElement('style');
  // pointer-events:none keeps clicks landing on the button/span around the icon
  style.textContent = `img.pxe{width:${S}px;height:${S}px;image-rendering:pixelated;vertical-align:-2px;pointer-events:none;}`;
  document.head.appendChild(style);
  convertTree(root);
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') convertText(m.target);
      else m.addedNodes.forEach(convertTree);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
