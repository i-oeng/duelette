// Duelette art: critter avatars and icons as inline SVG, drawn in the sticker style
// (flat fills, thick ink outline). No image files needed; swap any entry for your own art.
window.DL = window.DL || {};

DL.art = (function () {
  const INK = "#1b1035";
  const S = 'stroke="' + INK + '" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';
  const s = (w) => 'stroke="' + INK + '" stroke-width="' + w + '" stroke-linejoin="round" stroke-linecap="round"';
  const eye = (x, y, r, look) =>
    '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fff" ' + s(4) + "/>" +
    '<circle cx="' + (x + (look || 0)) + '" cy="' + (y + 1) + '" r="' + r * 0.5 + '" fill="' + INK + '"/>' +
    '<circle cx="' + (x + (look || 0) - r * 0.2) + '" cy="' + (y - r * 0.15) + '" r="' + r * 0.17 + '" fill="#fff"/>';
  const spikes = (() => {
    let d = "";
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 31 : 43;
      d += (i ? "L" : "M") + (50 + Math.cos(a) * r).toFixed(1) + " " + (54 + Math.sin(a) * r).toFixed(1);
    }
    return d + "Z";
  })();

  // Each critter: a name and the SVG body (viewBox 0 0 100 100).
  const CRITTERS = [
    { name: "Blobby", color: "#ff2e63", body:
      '<path d="M50 12C75 12 88 30 88 54C88 78 72 90 50 90C28 90 12 78 12 54C12 30 25 12 50 12Z" fill="#ff2e63" ' + S + "/>" +
      '<ellipse cx="27" cy="64" rx="6" ry="4" fill="#ff9bb5"/><ellipse cx="73" cy="64" rx="6" ry="4" fill="#ff9bb5"/>' +
      eye(38, 48, 10, 1) + eye(62, 48, 10, 1) + '<path d="M38 66Q50 78 62 66" fill="none" ' + S + "/>" },
    { name: "Bolt", color: "#1f6bff", body:
      '<path d="M50 24V12" ' + S + '/><circle cx="50" cy="10" r="6" fill="#ffe14d" ' + s(4) + "/>" +
      '<rect x="16" y="24" width="68" height="62" rx="15" fill="#1f6bff" ' + S + "/>" +
      '<rect x="25" y="38" width="50" height="22" rx="11" fill="' + INK + '"/>' +
      '<circle cx="40" cy="49" r="5" fill="#00e5e4"/><circle cx="60" cy="49" r="5" fill="#00e5e4"/>' +
      '<path d="M38 72H62M44 68V76M50 68V76M56 68V76" ' + s(4) + "/>" },
    { name: "Peeky", color: "#b6f03c", body:
      '<path d="M50 10C60 10 92 68 88 80C85 90 15 90 12 80C8 68 40 10 50 10Z" fill="#b6f03c" ' + S + "/>" +
      eye(50, 56, 15, 2) + '<path d="M43 79Q50 84 57 79" fill="none" ' + s(4) + "/>" },
    { name: "Spike", color: "#ff7a00", body:
      '<path d="' + spikes + '" fill="#ff7a00" ' + S + "/>" +
      eye(40, 50, 8, 0) + eye(60, 50, 8, 0) +
      '<path d="M31 38L45 43M69 38L55 43" ' + s(4) + '/><path d="M39 63Q50 76 61 63Z" fill="' + INK + '" ' + s(4) + "/>" },
    { name: "Boo", color: "#8c52ff", body:
      '<path d="M20 88V46C20 24 34 12 50 12C66 12 80 24 80 46V88L70 80L60 88L50 80L40 88L30 80Z" fill="#8c52ff" ' + S + "/>" +
      eye(39, 44, 9, -2) + eye(61, 44, 9, -2) + '<ellipse cx="50" cy="64" rx="5" ry="6" fill="' + INK + '"/>' },
    { name: "Drip", color: "#00c9c8", body:
      '<path d="M50 8C50 8 84 46 84 64C84 82 68 92 50 92C32 92 16 82 16 64C16 46 50 8 50 8Z" fill="#00c9c8" ' + S + "/>" +
      '<path d="M32 60Q38 54 44 60" fill="none" ' + S + "/>" + eye(62, 58, 9, 1) +
      '<path d="M40 72Q50 82 60 72" fill="none" ' + S + '/><path d="M50 77Q52 84 56 80" fill="#ff6b8b" ' + s(3) + "/>" },
    { name: "Puff", color: "#fff8e7", body:
      '<path d="M28 82C13 82 9 67 18 59C11 46 24 33 37 40C41 25 61 23 67 38C81 33 92 48 84 59C93 67 87 82 72 82Z" fill="#fff8e7" ' + S + "/>" +
      '<ellipse cx="33" cy="68" rx="6" ry="4" fill="#ffb3c7"/><ellipse cx="67" cy="68" rx="6" ry="4" fill="#ffb3c7"/>' +
      '<circle cx="40" cy="60" r="4.5" fill="' + INK + '"/><circle cx="60" cy="60" r="4.5" fill="' + INK + '"/>' +
      '<path d="M45 69Q50 73 55 69" fill="none" ' + s(4) + "/>" },
    { name: "Gem", color: "#ffe14d", body:
      '<path d="M50 10L86 30V70L50 90L14 70V30Z" fill="#ffe14d" ' + S + "/>" +
      '<path d="M14 30L50 44L86 30M50 44V10" fill="none" stroke="#e0b800" stroke-width="3"/>' +
      '<rect x="23" y="46" width="23" height="14" rx="5" fill="' + INK + '"/><rect x="54" y="46" width="23" height="14" rx="5" fill="' + INK + '"/>' +
      '<path d="M46 52H54" ' + s(4) + '/><path d="M27 50L33 50" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M42 72Q52 76 60 68" fill="none" ' + s(4) + "/>" }
  ];

  // 24 by 24 icons with ink outlines.
  const I = 'stroke="' + INK + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
  const ICONS = {
    bolt: '<path d="M13 2L4 14H11L10 22L20 9H13Z" fill="#ffe14d" ' + I + "/>",
    hat: '<path d="M7 4H17V15H7Z" fill="' + INK + '" ' + I + '/><path d="M7 12H17" stroke="#ff2e63" stroke-width="2.5"/><path d="M3 15H21V18H3Z" fill="' + INK + '" ' + I + "/>",
    flame: '<path d="M12 2C14 7 19 9 19 15C19 19 16 22 12 22C8 22 5 19 5 15C5 11 8 9 9 6C10 9 11 10 12 10C12 7 12 4 12 2Z" fill="#ff7a00" ' + I + '/><path d="M12 13C13 15 15 16 15 18C15 20 13.5 21 12 21C10.5 21 9 20 9 18C9 16 11 15 12 13Z" fill="#ffe14d"/>',
    bulb: '<path d="M12 2C16.5 2 19 5.5 19 9C19 12 17 13.5 16 15V17H8V15C7 13.5 5 12 5 9C5 5.5 7.5 2 12 2Z" fill="#ffe14d" ' + I + '/><path d="M9 20H15M10 17V13L12 11L14 13V17" fill="none" ' + I + "/>",
    clock: '<circle cx="12" cy="13" r="8.5" fill="#fff" ' + I + '/><path d="M12 13V8.5M12 13L15 15M10 2H14M19 5L20.5 6.5" fill="none" ' + I + "/>",
    sparkle: '<path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10Z" fill="#b6f03c" ' + I + "/>",
    palette: '<path d="M12 3C6 3 2 7 2 12C2 17 6 21 11 21C13 21 13.5 19 12.5 18C11.5 16.5 12.5 15 14 15H17C20 15 22 13 22 10C22 6 17 3 12 3Z" fill="#ff7a00" ' + I + '/><circle cx="7.5" cy="12" r="1.8" fill="#1f6bff"/><circle cx="10" cy="7.5" r="1.8" fill="#ff2e63"/><circle cx="15" cy="7.5" r="1.8" fill="#b6f03c"/>',
    camera: '<path d="M8 7L10 4H14L16 7" fill="#00c9c8" ' + I + '/><rect x="2" y="7" width="20" height="14" rx="3" fill="#00c9c8" ' + I + '/><circle cx="12" cy="14" r="4" fill="#fff" ' + I + "/>",
    coin: '<circle cx="12" cy="12" r="9.5" fill="#ffe14d" ' + I + '/><circle cx="12" cy="12" r="6" fill="none" stroke="#e0b800" stroke-width="2"/><path d="M12 8.5V15.5" ' + I + "/>",
    rise: '<path d="M12 3L20 12H15V21H9V12H4Z" fill="#b6f03c" ' + I + "/>",
    double: '<rect x="2" y="5" width="20" height="14" rx="4" fill="#ff2e63" ' + I + '/><path d="M6 9L10 15M10 9L6 15M13 9.5C13 8 17 8 17 10C17 12 13 13 13 15H17.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    crown: '<path d="M3 18L4 7L9 12L12 4L15 12L20 7L21 18Z" fill="#ffe14d" ' + I + '/><path d="M3 18H21V21H3Z" fill="#ffbe0b" ' + I + "/>",
    code: '<path d="M8 6L2 12L8 18M16 6L22 12L16 18M14 4L10 20" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    target: '<circle cx="12" cy="12" r="9.5" fill="#ff7a00" ' + I + '/><circle cx="12" cy="12" r="6" fill="#fff" ' + I + '/><circle cx="12" cy="12" r="2.6" fill="#ff2e63" ' + I + '/>',
    lock: '<rect x="4" y="10" width="16" height="12" rx="3" fill="#ffe14d" ' + I + '/><path d="M8 10V7C8 4.5 9.8 3 12 3C14.2 3 16 4.5 16 7V10" fill="none" ' + I + '/><circle cx="12" cy="16" r="1.6" fill="#1b1035"/>',
    shield: '<path d="M12 2L20 5V11C20 16 16.5 20 12 22C7.5 20 4 16 4 11V5Z" fill="#00c9c8" ' + I + '/><path d="M8.5 12L11 14.5L15.5 9.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    calc: '<rect x="4.5" y="2" width="15" height="20" rx="3" fill="#1f6bff" ' + I + '/><rect x="7.5" y="5" width="9" height="4.5" rx="1" fill="#fff" ' + I + '/><circle cx="8.8" cy="13.3" r="1.3" fill="#fff"/><circle cx="12" cy="13.3" r="1.3" fill="#fff"/><circle cx="15.2" cy="13.3" r="1.3" fill="#fff"/><circle cx="8.8" cy="17.3" r="1.3" fill="#fff"/><circle cx="12" cy="17.3" r="1.3" fill="#fff"/><circle cx="15.2" cy="17.3" r="1.3" fill="#ffe14d"/>',
    toggle: '<rect x="2" y="6" width="20" height="12" rx="6" fill="#fff" ' + I + '/><circle cx="8" cy="12" r="3.6" fill="#ff2e63" ' + I + '/><path d="M14 12L16 14L19.5 10" fill="none" ' + I + '/>',
    hourglass: '<path d="M6 2.5H18M6 21.5H18" fill="none" ' + I + '/><path d="M7.5 2.5C7.5 8 12 9.5 12 12C12 14.5 7.5 16 7.5 21.5H16.5C16.5 16 12 14.5 12 12C12 9.5 16.5 8 16.5 2.5Z" fill="#fff" ' + I + '/><path d="M9.3 20C9.3 17.6 12 16.4 12 16.4C12 16.4 14.7 17.6 14.7 20Z" fill="#ffbe0b"/><path d="M9.8 6.5H14.2C13.5 8 12 8.6 12 9.6C12 8.6 10.5 8 9.8 6.5Z" fill="#ffbe0b"/>',
    pencil: '<path d="M16 3L21 8L9 20L3 21L4 15Z" fill="#ffe14d" ' + I + '/><path d="M14 5L19 10M4 15L9 20" fill="none" ' + I + "/>",
    quiz: '<path d="M4 4H20V17H11L6 21V17H4Z" fill="#fff" ' + I + '/><path d="M9.5 8.5C9.5 6 14.5 6 14.5 8.5C14.5 10.5 12 10.5 12 12.5" fill="none" ' + I + '/><circle cx="12" cy="14.8" r="1.1" fill="' + INK + '"/>',
    chaos: '<path d="M12 12C12 10 14 10 14 12C14 15 9 15 9 12C9 8 16 8 16 12C16 17 6 17 6 12C6 6 18 6 18 12C18 19 4 19 3.5 12" fill="none" stroke="#ff2e63" stroke-width="2.4" stroke-linecap="round"/>',
    globe: '<circle cx="12" cy="12" r="9.5" fill="#00c9c8" ' + I + '/><path d="M2.5 12H21.5M12 2.5C15 6 15 18 12 21.5M12 2.5C9 6 9 18 12 21.5" fill="none" ' + I + "/>"
  };

  const svg = (vb, inner, label, px) =>
    '<svg viewBox="0 0 ' + vb + " " + vb + '" xmlns="http://www.w3.org/2000/svg"' +
    (px ? ' width="' + px + '" height="' + px + '"' : "") +
    (label ? ' role="img" aria-label="' + label + '"' : ' aria-hidden="true"') + ">" + inner + "</svg>";
  const pick = (i) => CRITTERS[((Number(i) || 0) % CRITTERS.length + CRITTERS.length) % CRITTERS.length];

  const cache = {};
  const ZIM = { "#ffe14d": "#e2e2ed", "#ff2e63": "#5b42dc", "#1f6bff": "#2a1d7a", "#b6f03c": "#c9c2ff", "#ff7a00": "#7367ff",
    "#8c52ff": "#5553f5", "#00c9c8": "#9d8fff", "#ffbe0b": "#9d8fff", "#e0b800": "#7367ff", "#1b1035": "#0c0c0c", "#ffd23f": "#c9c2ff" };
  const tint = (m) => (DL.theme && DL.theme() === "zimrany" ? m.replace(/#[0-9a-fA-F]{6}/g, (h) => ZIM[h.toLowerCase()] || h) : m);
  function image(markup) {
    if (!cache[markup]) {
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
      cache[markup] = img;
    }
    return cache[markup];
  }

  return {
    CRITTERS,
    count: CRITTERS.length,
    name: (i) => pick(i).name,
    // Inline SVG markup for an avatar, decorative unless a label is passed.
    avatar: (i, label) => svg(100, pick(i).body, label),
    icon: (k) => tint(svg(24, ICONS[k] || ICONS.sparkle)),
    // Image elements for canvas drawing (wheel hub and wedge icons).
    avatarImage: (i) => image(svg(100, pick(i).body, "", 200)),
    iconImage: (k) => image(tint(svg(24, ICONS[k] || ICONS.sparkle, "", 96))),
    // Avatar ids as stored on the world ranking server.
    toId: (i) => "c" + (Number(i) || 0),
    fromId: (id) => { const m = /^c(\d+)$/.exec(id || ""); return m ? Number(m[1]) % CRITTERS.length : 0; }
  };
})();
