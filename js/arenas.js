// Themed arenas drawn as inline SVG plus CSS particles, so there's nothing to download.

const rand = (a, b) => a + Math.random() * (b - a);

function svg(body) {
  return `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function dojo() {
  return svg(`
    <defs><linearGradient id="dj-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b1b4a"/><stop offset=".55" stop-color="#c2456b"/><stop offset="1" stop-color="#ffb36b"/>
    </linearGradient></defs>
    <rect width="1600" height="900" fill="url(#dj-sky)"/>
    <circle cx="1150" cy="500" r="170" fill="#ffd9a0" opacity=".85"/>
    <path d="M0 620 L220 450 L420 580 L640 400 L900 600 L1150 460 L1400 580 L1600 480 V900 H0Z" fill="#5a2a55" opacity=".75"/>
    <path d="M0 700 L300 560 L520 680 L800 540 L1100 700 L1350 590 L1600 680 V900 H0Z" fill="#3a1a40"/>
    <g fill="#1d0d22">
      <rect x="250" y="430" width="28" height="340"/><rect x="560" y="430" width="28" height="340"/>
      <path d="M180 410 Q420 370 660 410 L660 440 Q420 405 180 440Z"/>
      <rect x="220" y="470" width="400" height="22"/>
    </g>
    <rect y="760" width="1600" height="140" fill="#3b2230"/>
    <g stroke="#2a1622" stroke-width="4">${Array.from({ length: 8 }, (_, i) => `<line x1="${i * 220}" y1="760" x2="${i * 220 - 120}" y2="900"/>`).join("")}</g>
  `);
}

function neon() {
  let buildings = "";
  let x = -20;
  while (x < 1600) {
    const w = rand(70, 150);
    const h = rand(220, 520);
    const top = 760 - h;
    buildings += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="#120b26"/>`;
    for (let wy = top + 18; wy < 740; wy += 26)
      for (let wx = x + 10; wx < x + w - 12; wx += 20)
        if (Math.random() < 0.35)
          buildings += `<rect x="${wx}" y="${wy}" width="9" height="12" fill="${Math.random() < 0.5 ? "#ffd36b" : "#5ef1ff"}" opacity="${rand(0.3, 0.9).toFixed(2)}"/>`;
    x += w + rand(6, 24);
  }
  return svg(`
    <defs>
      <linearGradient id="ne-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#07041a"/><stop offset=".6" stop-color="#3a0f5a"/><stop offset="1" stop-color="#ff2e88"/>
      </linearGradient>
      <filter id="ne-glow"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1600" height="900" fill="url(#ne-sky)"/>
    ${buildings}
    <g filter="url(#ne-glow)" fill="none" stroke-width="6">
      <rect x="1180" y="300" width="220" height="80" rx="16" stroke="#ff3ea5"/>
      <path d="M1210 340 h60 M1300 320 v40 M1330 320 l40 40 M1330 360 l40 -40" stroke="#5ef1ff"/>
      <circle cx="260" cy="260" r="46" stroke="#ffe46b"/>
    </g>
    <rect y="760" width="1600" height="140" fill="#0c0718"/>
    <g stroke="#ff3ea5" stroke-opacity=".35" stroke-width="2">
      ${Array.from({ length: 13 }, (_, i) => `<line x1="800" y1="760" x2="${i * 140 - 40}" y2="900"/>`).join("")}
      <line x1="0" y1="800" x2="1600" y2="800"/><line x1="0" y1="850" x2="1600" y2="850"/>
    </g>
  `);
}

function volcano() {
  return svg(`
    <defs>
      <linearGradient id="vo-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#140303"/><stop offset=".6" stop-color="#5a0f0a"/><stop offset="1" stop-color="#ff5a1f"/>
      </linearGradient>
      <radialGradient id="vo-crater" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#ffe17a"/><stop offset=".5" stop-color="#ff7a1f" stop-opacity=".8"/><stop offset="1" stop-color="#ff3d00" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#vo-sky)"/>
    <ellipse cx="820" cy="300" rx="260" ry="140" fill="url(#vo-crater)" class="pulse"/>
    <path d="M300 800 L700 310 L940 310 L1350 800Z" fill="#2a0c08"/>
    <path d="M760 310 Q790 450 740 560 Q700 660 760 800 L800 800 Q760 660 800 560 Q850 450 830 310Z" fill="#ff6a1f" opacity=".9"/>
    <path d="M0 800 L150 650 L330 760 L480 680 L620 800Z M1100 800 L1260 660 L1420 740 L1600 640 V800Z" fill="#1a0705"/>
    <rect y="780" width="1600" height="120" fill="#140504"/>
    <path d="M0 830 Q400 800 800 840 T1600 820" stroke="#ff5a1f" stroke-width="6" fill="none" opacity=".7"/>
  `);
}

function beach() {
  return svg(`
    <defs><linearGradient id="be-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3fb7ff"/><stop offset="1" stop-color="#c9f1ff"/>
    </linearGradient></defs>
    <rect width="1600" height="900" fill="url(#be-sky)"/>
    <circle cx="1300" cy="180" r="90" fill="#fff3b0"/>
    <g fill="#fff" opacity=".85"><ellipse cx="300" cy="170" rx="120" ry="34"/><ellipse cx="380" cy="150" rx="80" ry="34"/><ellipse cx="900" cy="230" rx="100" ry="26"/></g>
    <rect y="560" width="1600" height="180" fill="#1c8ad0"/>
    <g class="waves" stroke="#e8fbff" stroke-width="5" fill="none" opacity=".7">
      <path d="M-200 600 q50 -18 100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0"/>
      <path d="M-200 660 q50 -18 100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0"/>
    </g>
    <path d="M0 720 Q800 690 1600 730 V900 H0Z" fill="#f2d49b"/>
    <g transform="translate(180 0)">
      <path d="M60 860 Q40 640 120 470" stroke="#7a4a22" stroke-width="26" fill="none" stroke-linecap="round"/>
      <g fill="#1f9a4a">
        <path d="M120 470 Q20 420 -60 480 Q40 450 120 480Z"/><path d="M120 470 Q230 410 310 470 Q210 450 120 482Z"/>
        <path d="M120 470 Q80 370 0 360 Q90 400 116 480Z"/><path d="M120 470 Q170 370 260 360 Q170 400 126 480Z"/>
      </g>
    </g>
  `);
}

export const ARENAS = [
  { id: "dojo", name: "Dusk Dojo", draw: dojo, particle: "petal" },
  { id: "neon", name: "Neon Rooftop", draw: neon, particle: "rain" },
  { id: "volcano", name: "Volcano Rim", draw: volcano, particle: "ember" },
  { id: "beach", name: "Sunny Beach", draw: beach, particle: "sparkle" },
];

export function arenaById(id) {
  return ARENAS.find((a) => a.id === id) || ARENAS[0];
}

/** Pick a random arena id, different from the current one. */
export function randomArena(exclude) {
  const pool = ARENAS.filter((a) => a.id !== exclude);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/** Cross-fade the background container to the given arena. */
export function showArena(container, id) {
  const arena = arenaById(id);
  if (container.dataset.arena === arena.id) return arena;
  container.dataset.arena = arena.id;

  const layer = document.createElement("div");
  layer.className = `arena-layer arena-${arena.id}`;
  layer.innerHTML = arena.draw();
  const particles = document.createElement("div");
  particles.className = "particles";
  const count = arena.particle === "rain" ? 60 : 26;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = `p-${arena.particle}`;
    p.style.left = `${rand(0, 100)}%`;
    p.style.animationDuration = `${arena.particle === "rain" ? rand(0.5, 0.9) : rand(5, 11)}s`;
    p.style.animationDelay = `-${rand(0, 10)}s`;
    particles.appendChild(p);
  }
  layer.appendChild(particles);
  container.appendChild(layer);
  requestAnimationFrame(() => layer.classList.add("in"));
  const old = [...container.children].filter((c) => c !== layer);
  setTimeout(() => old.forEach((c) => c.remove()), 900);
  return arena;
}
