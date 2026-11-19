// Interface icons from Lucide (https://lucide.dev), ISC licence, copyright (c) Lucide Icons and Contributors (lucide-static 1.75.0).
// Icon('name') returns an inline <svg> that takes the surrounding text colour and size; <i data-i="name"></i> in static markup is swapped
// for the same thing by Icon.hydrate(). Classic script (not a module) so both index.html and bryce.js can use it.
(function () {
  const PATHS = {
    plus: '<path d="M5 12h14"/> <path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    'undo-2': '<path d="M9 14 4 9l5-5"/> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    'redo-2': '<path d="m15 14 5-5-5-5"/> <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/> <path d="M19 12H5"/>',
    'arrow-right': '<path d="M5 12h14"/> <path d="m12 5 7 7-7 7"/>',
    'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="M15 3v18"/>',
    'picture-in-picture-2': '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/> <rect width="10" height="7" x="12" y="13" rx="2"/>',
    'dice-5': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/> <path d="M16 8h.01"/> <path d="M8 8h.01"/> <path d="M8 16h.01"/> <path d="M16 16h.01"/> <path d="M12 12h.01"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/> <path d="m3.3 7 8.7 5 8.7-5"/> <path d="M12 22V12"/>',
    sparkle: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    x: '<path d="M18 6 6 18"/> <path d="m6 6 12 12"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/> <circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/> <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/> <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/> <path d="m2 2 20 20"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    cylinder: '<ellipse cx="12" cy="5" rx="9" ry="3"/> <path d="M3 5v14a9 3 0 0 0 18 0V5"/>',
    cone: '<path d="m20.9 18.55-8-15.98a1 1 0 0 0-1.8 0l-8 15.98"/> <ellipse cx="12" cy="19" rx="9" ry="3"/>',
    pyramid: '<path d="M2.5 16.88a1 1 0 0 1-.32-1.43l9-13.02a1 1 0 0 1 1.64 0l9 13.01a1 1 0 0 1-.32 1.44l-8.51 4.86a2 2 0 0 1-1.98 0Z"/> <path d="M12 2v20"/>',
    torus: '<ellipse cx="12" cy="11" rx="3" ry="2"/> <ellipse cx="12" cy="12.5" rx="10" ry="8.5"/>',
    gem: '<path d="M10.5 3 8 9l4 13 4-13-2.5-6"/> <path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/> <path d="M2 9h20"/>',
    lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/> <path d="M9 18h6"/> <path d="M10 22h4"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    landmark: '<path d="M10 18v-7"/> <path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"/> <path d="M14 18v-7"/> <path d="M18 18v-7"/> <path d="M3 22h18"/> <path d="M6 18v-7"/>',
    castle: '<path d="M10 5V3"/> <path d="M14 5V3"/> <path d="M15 21v-3a3 3 0 0 0-6 0v3"/> <path d="M18 3v8"/> <path d="M18 5H6"/> <path d="M22 11H2"/> <path d="M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"/> <path d="M6 3v8"/>',
    'brick-wall': '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="M12 9v6"/> <path d="M16 15v6"/> <path d="M16 3v6"/> <path d="M3 15h18"/> <path d="M3 9h18"/> <path d="M8 15v6"/> <path d="M8 3v6"/>',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/> <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/> <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
    package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/> <path d="M12 22V12"/> <polyline points="3.29 7 12 12 20.71 7"/> <path d="m7.5 4.27 9 5.15"/>',
    triangle: '<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>',
    diamond: '<path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/> <path d="M12 2v2"/> <path d="M12 20v2"/> <path d="m4.93 4.93 1.41 1.41"/> <path d="m17.66 17.66 1.41 1.41"/> <path d="M2 12h2"/> <path d="M20 12h2"/> <path d="m6.34 17.66-1.41 1.41"/> <path d="m19.07 4.93-1.41 1.41"/>',
    sunrise: '<path d="M12 2v8"/> <path d="m4.93 10.93 1.41 1.41"/> <path d="M2 18h2"/> <path d="M20 18h2"/> <path d="m19.07 10.93-1.41 1.41"/> <path d="M22 22H2"/> <path d="m8 6 4-4 4 4"/> <path d="M16 18a4 4 0 0 0-8 0"/>',
  };
  const Icon = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
  Icon.hydrate = root => root.querySelectorAll('i[data-i]').forEach(el => { el.outerHTML = Icon(el.dataset.i); });
  window.Icon = Icon;
})();
