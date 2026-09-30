figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

const WEIGHT_STYLE = { 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold' };

function styleFor(w) {
  if (w >= 700) return 'Bold';
  if (w >= 600) return 'Semi Bold';
  if (w >= 500) return 'Medium';
  return 'Regular';
}

let FONT_MAP = null;
const FONT_CACHE = {};
const WEIGHT_CHAIN = {
  300: ['Light', 'Regular'],
  400: ['Regular', 'Normal', 'Book'],
  500: ['Medium', 'Regular'],
  600: ['SemiBold', 'Semi Bold', 'Semibold', 'Bold'],
  700: ['Bold', 'SemiBold', 'Semi Bold']
};

// CSS font-family 목록에서 Figma에 있는 첫 번째 폰트를 골라 로드 (없으면 Inter)
async function resolveFont(stack, weight) {
  if (!FONT_MAP) {
    FONT_MAP = {};
    for (const f of await figma.listAvailableFontsAsync()) {
      (FONT_MAP[f.fontName.family] = FONT_MAP[f.fontName.family] || {})[f.fontName.style] = true;
    }
  }
  const w = weight >= 700 ? 700 : weight >= 600 ? 600 : weight >= 500 ? 500 : weight <= 300 ? 300 : 400;
  const key = stack + '|' + w;
  if (FONT_CACHE[key]) return FONT_CACHE[key];

  const families = String(stack || '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).concat(['Inter']);
  for (const fam of families) {
    const styles = FONT_MAP[fam];
    if (!styles) continue;
    for (const st of WEIGHT_CHAIN[w]) {
      if (!styles[st]) continue;
      const font = { family: fam, style: st };
      try { await figma.loadFontAsync(font); FONT_CACHE[key] = font; return font; } catch (e) { /* 다음 후보 */ }
    }
  }
  const fb = { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(fb);
  return (FONT_CACHE[key] = fb);
}

async function loadFonts() {
  for (const s of ['Regular', 'Medium', 'Semi Bold', 'Bold']) {
    await figma.loadFontAsync({ family: 'Inter', style: s });
  }
}

function paint(c) {
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
}

function toPaint(L) {
  if (L.kind === 'linear' || L.kind === 'radial') {
    return {
      type: L.kind === 'linear' ? 'GRADIENT_LINEAR' : 'GRADIENT_RADIAL',
      gradientTransform: L.transform,
      gradientStops: L.stops.map((s) => ({ position: s.p, color: { r: s.c.r, g: s.c.g, b: s.c.b, a: s.c.a } }))
    };
  }
  const img = figma.createImage(new Uint8Array(L.bytes));
  const p = { type: 'IMAGE', imageHash: img.hash, scaleMode: L.mode || 'FILL' };
  if (L.mode === 'TILE') p.scalingFactor = L.scale || 1;
  return p;
}

function place(node, n, parent) {
  const inAuto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  if (inAuto && n.abs) node.layoutPositioning = 'ABSOLUTE';
  if (!inAuto || n.abs) { node.x = n.x; node.y = n.y; }
}

async function build(n, parent) {
  let node;

  if (n.type === 'text') {
    node = figma.createText();
    parent.appendChild(node);
    node.fontName = await resolveFont(n.fontFamily, n.fontWeight);
    node.fontSize = n.fontSize;
    node.characters = n.text;
    node.fills = (n.layers && n.layers.length) ? n.layers.map(toPaint) : [paint(n.color)];
    node.textAlignHorizontal = n.textAlign;
    if (n.lineHeight) node.lineHeight = { value: n.lineHeight, unit: 'PIXELS' };
    if (n.letterSpacing) node.letterSpacing = { value: n.letterSpacing, unit: 'PIXELS' };
    if (n.underline) node.textDecoration = 'UNDERLINE';
    if (n.single) {
      node.textAutoResize = 'WIDTH_AND_HEIGHT';
    } else {
      node.textAutoResize = 'HEIGHT';
      node.resize(Math.max(1, n.w), node.height);
    }
    place(node, n, parent);
    node.name = n.name || n.text.slice(0, 30);
    return node;
  }

  if (n.type === 'svg') {
    try {
      node = figma.createNodeFromSvg(n.svg);
      parent.appendChild(node);
      node.resize(Math.max(1, n.w), Math.max(1, n.h));
      place(node, n, parent);
      node.name = n.name;
      return node;
    } catch (e) {
      // SVG 실패 시 빈 프레임으로 대체
    }
  }

  node = figma.createFrame();
  parent.appendChild(node);
  node.name = n.name;
  place(node, n, parent);
  node.resize(Math.max(1, n.w), Math.max(1, n.h));
  node.clipsContent = !!n.clip;
  node.opacity = n.opacity;

  if (n.layout) {
    const L = n.layout;
    node.layoutMode = L.mode;
    node.primaryAxisSizingMode = 'FIXED';
    node.counterAxisSizingMode = 'FIXED';
    node.resize(Math.max(1, n.w), Math.max(1, n.h));
    node.paddingTop = L.pad[0]; node.paddingRight = L.pad[1];
    node.paddingBottom = L.pad[2]; node.paddingLeft = L.pad[3];
    node.itemSpacing = L.gap || 0;
    node.primaryAxisAlignItems = L.primary;
    node.counterAxisAlignItems = L.counter;
    if (L.wrap) { node.layoutWrap = 'WRAP'; node.counterAxisSpacing = L.rowGap || 0; }
  }

  const fills = [];
  if (n.fill && n.fill.a > 0) fills.push(paint(n.fill));
  for (const L of n.layers || []) {
    try { fills.push(toPaint(L)); } catch (e) { /* 지원되지 않는 이미지 형식은 건너뜀 */ }
  }
  node.fills = fills;

  if (n.radius) {
    node.topLeftRadius = n.radius[0];
    node.topRightRadius = n.radius[1];
    node.bottomRightRadius = n.radius[2];
    node.bottomLeftRadius = n.radius[3];
  }

  if (n.border) {
    node.strokes = [paint(n.border.color)];
    node.strokeAlign = 'INSIDE';
    node.strokeTopWeight = n.border.w[0];
    node.strokeRightWeight = n.border.w[1];
    node.strokeBottomWeight = n.border.w[2];
    node.strokeLeftWeight = n.border.w[3];
  }

  if (n.shadow) {
    node.effects = [{
      type: 'DROP_SHADOW',
      color: n.shadow.color,
      offset: { x: n.shadow.x, y: n.shadow.y },
      radius: n.shadow.blur,
      spread: n.shadow.spread,
      visible: true,
      blendMode: 'NORMAL'
    }];
  }

  for (const c of n.children || []) {
    await build(c, node);
  }
  return node;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'import') return;
  try {
    await loadFonts();
    const start = figma.viewport.center;
    let x = Math.round(start.x);
    const y = Math.round(start.y);
    const created = [];
    for (const item of msg.items) {
      const root = await build(item.tree, figma.currentPage);
      root.name = item.name;
      root.x = x;
      root.y = y;
      x += Math.round(root.width) + (msg.gap || 20);
      created.push(root);
    }
    figma.currentPage.selection = created;
    figma.viewport.scrollAndZoomIntoView(created);
    figma.ui.postMessage({ type: 'done', count: created.length });
    figma.notify(created.length + '개 디자인을 가져왔어요');
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};
