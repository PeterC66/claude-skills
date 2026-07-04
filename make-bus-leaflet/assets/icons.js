// Reusable POI pictograms. Each returns an SVG string centred at (x,y),
// drawn to fit roughly a 5mm box (scale s = half-extent in mm, default 2.2).
function icon(cat, x, y, s = 2.2) {
  const T = (inner) => `<g transform="translate(${x} ${y}) scale(${s/2.2})">${inner}</g>`;
  const plus = (col) => `<rect x="-0.55" y="-1.5" width="1.1" height="3" fill="${col}"/><rect x="-1.5" y="-0.55" width="3" height="1.1" fill="${col}"/>`;
  switch (cat) {
    case 'shop': // supermarket trolley
      return T(`<g fill="none" stroke="#e2001a" stroke-width="0.5" stroke-linejoin="round">
        <path d="M-2.6,-1.7 h0.9 l1.3,3.2 h2.7"/>
        <path d="M-1.4,-0.9 h3.9 l-0.5,2.0 h-2.6 z" fill="#e2001a" stroke="none"/></g>
        <circle cx="-0.2" cy="2.2" r="0.5" fill="#e2001a"/><circle cx="1.8" cy="2.2" r="0.5" fill="#e2001a"/>`);
    case 'gp':
      return T(`<rect x="-2.1" y="-2.1" width="4.2" height="4.2" rx="0.8" fill="#fff" stroke="#d00" stroke-width="0.5"/>${plus('#d00')}`);
    case 'pharmacy':
      return T(`<rect x="-2.1" y="-2.1" width="4.2" height="4.2" rx="0.8" fill="#fff" stroke="#0a8a3a" stroke-width="0.5"/>${plus('#0a8a3a')}`);
    case 'library': // open book
      return T(`<g fill="#fff" stroke="#8a5a00" stroke-width="0.45" stroke-linejoin="round">
        <path d="M0,-1.5 C-1,-2.1 -2.4,-2.0 -2.4,-1.4 V1.5 C-2.4,1.0 -1,0.9 0,1.5 Z"/>
        <path d="M0,-1.5 C1,-2.1 2.4,-2.0 2.4,-1.4 V1.5 C2.4,1.0 1,0.9 0,1.5 Z"/></g>`);
    case 'museum': // classical building
      return T(`<g fill="#6a3d9a">
        <path d="M0,-2.3 L2.6,-0.7 H-2.6 Z"/>
        <rect x="-2.2" y="-0.5" width="0.6" height="2.3"/><rect x="-0.9" y="-0.5" width="0.6" height="2.3"/>
        <rect x="0.3" y="-0.5" width="0.6" height="2.3"/><rect x="1.6" y="-0.5" width="0.6" height="2.3"/>
        <rect x="-2.6" y="1.8" width="5.2" height="0.7"/></g>`);
    case 'leisure': // running figure
      return T(`<g fill="#ff7f00" stroke="#ff7f00" stroke-width="0.55" stroke-linecap="round">
        <circle cx="0.6" cy="-1.7" r="0.7" stroke="none"/>
        <path d="M-1.2,1.9 L0.2,0.2 L1.4,1.0 M0.2,0.2 L-0.2,-1.0 L1.6,-0.4 M-0.2,-1.0 L-1.6,-0.2"/></g>`);
    case 'school': // mortarboard
      return T(`<g fill="#1f78b4">
        <path d="M0,-1.9 L2.7,-0.6 L0,0.7 L-2.7,-0.6 Z"/>
        <path d="M-1.5,0.0 V1.4 C-1.5,2.0 1.5,2.0 1.5,1.4 V0.0 L0,0.7 Z" opacity="0.85"/>
        <path d="M2.4,-0.45 V1.3" stroke="#1f78b4" stroke-width="0.3"/><circle cx="2.4" cy="1.4" r="0.4"/></g>`);
    case 'park': // tree
      return T(`<rect x="-0.45" y="0.4" width="0.9" height="2.0" fill="#7a4f1d"/>
        <circle cx="0" cy="-0.4" r="1.9" fill="#2ca02c"/><circle cx="-1.2" cy="0.5" r="1.1" fill="#2ca02c"/><circle cx="1.2" cy="0.5" r="1.1" fill="#2ca02c"/>`);
    case 'industrial': // factory
      return T(`<g fill="#777">
        <rect x="1.5" y="-2.3" width="0.8" height="2.0"/>
        <path d="M-2.6,2.2 V-0.3 L-0.7,0.7 V-0.3 L1.1,0.7 V-0.3 L2.6,0.5 V2.2 Z"/></g>`);
    case 'community': // two people
      return T(`<g fill="#00868b">
        <circle cx="-1.1" cy="-1.2" r="0.8"/><path d="M-2.4,2.0 C-2.4,-0.2 0.2,-0.2 0.2,2.0 Z"/>
        <circle cx="1.2" cy="-1.0" r="0.7"/><path d="M0.1,2.0 C0.1,0.1 2.4,0.1 2.4,2.0 Z"/></g>`);
    case 'townhall': // civic building with flag
      return T(`<g fill="#444">
        <rect x="-2.2" y="-0.6" width="4.4" height="3.0"/><path d="M0,-2.6 V-0.6"/>
        <path d="M0,-2.6 L1.4,-2.2 L0,-1.8 Z"/><rect x="-2.6" y="2.2" width="5.2" height="0.5"/></g>`);
    case 'allotments': // bed rows behind a low frame
      return T(`<rect x="-2.2" y="-1.6" width="4.4" height="3.4" rx="0.4" fill="#e8dcc0" stroke="#7a8f3c" stroke-width="0.35"/>
        <path d="M-1.4,-1.0 V1.4 M0,-1.0 V1.4 M1.4,-1.0 V1.4" stroke="#7a8f3c" stroke-width="0.5" fill="none"/>`);
    default:
      return `<circle cx="${x}" cy="${y}" r="${s*0.7}" fill="#888"/>`;
  }
}
module.exports = { icon };
