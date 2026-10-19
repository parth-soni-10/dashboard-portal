/* Launchpad — the six dashboards stand on a pad.
 *
 * The tiles come from the portal's own manifest, so the drawing and the list
 * cannot disagree. Pointing at a tile lifts it off the pad and reads the
 * dashboard's name and host: a preview of the destination before the click.
 *
 * Wrapped in an IIFE: the engine's figures are written at top level, and two of
 * them on one page would collide on their destructured names.
 */
(function () {
const {
  Cam, facing, fit, hull, open, poly, proj, rrect, ringAt, run, seg,
  spring, stepS, register, disposer, mk, pointer,
} = HL;

const TILE_Z0 = 1.8, TILE_Z1 = 5.2, LIFT = 7.2;
const HW = 13, HD = 9;
const POS = [
  [-30, -14], [0, -14], [30, -14],
  [-30, 14], [0, 14], [30, 14],
];

/** A rounded box, drawn from its foot and top rings. */
function boxAt(parent, P, front, cx, cy, hw, hd, z0, z1, r) {
  const foot = rrect(cx - hw, cy - hd, cx + hw, cy + hd, r, 6);
  const top = rrect(cx - hw + 0.9, cy - hd + 0.9, cx + hw - 0.9, cy + hd - 0.9, Math.max(0.6, r - 0.9), 6);
  const g = mk('g', {}, parent);
  const sil = mk('path', { d: poly(hull(ringAt(P, foot, z0).concat(ringAt(P, top, z1)))), class: 'sil' }, g);
  const cr = mk('path', { d: open(ringAt(P, run(top, front), z1)), class: 'nf lo' }, g);
  return { g, sil, cr, foot, top };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();

  const C = Cam(45, 0.5, 2.42);
  fit(C, [[-54, -38, 0], [54, 38, 0], [-54, -38, 14], [54, 38, 14]], 200, 164);
  const P = proj(C), front = facing(C);
  const root = mk('g', {}, svg);

  let items = [];
  let tiles = [];
  let selected = -1;
  // Null, not '', so the first set() builds even when the manifest is empty.
  let signature = null;
  let board = null;

  function readDefault() {
    const n = items.length;
    read.textContent = n ? `${n} dashboards on the pad` : 'No dashboards on the pad';
    stage.setAttribute(
      'aria-label',
      n
        ? `${n} deployed dashboards standing on a launchpad. Point at a tile to preview its destination.`
        : 'No dashboards are published.',
    );
  }

  function drawTile(tile, z) {
    tile.sil.setAttribute('d', poly(hull(ringAt(P, tile.foot, TILE_Z0).concat(ringAt(P, tile.top, z)))));
    tile.cr.setAttribute('d', open(ringAt(P, run(tile.top, front), z)));
  }

  function build() {
    if (board) {
      bag.add(board.unregister);
      board = null;
    }
    root.replaceChildren();
    selected = -1;

    // The pad: one plate with a dim inner crease and three launch marks.
    const pad = boxAt(root, P, front, 0, 0, 50, 31, 0, TILE_Z0, 6);
    for (let x = -36; x <= 36; x += 12) {
      mk('path', { d: seg(P(x, -25, TILE_Z0), P(x, -17, TILE_Z0)), class: 'nf dash' }, pad.g);
    }

    tiles = items.slice(0, POS.length).map((item, i) => {
      const [cx, cy] = POS[i];
      const box = boxAt(root, P, front, cx, cy, HW, HD, TILE_Z0, TILE_Z1, 2);
      const sp = spring(0, { k: 150, c: 20 });
      const tile = { item, i, cx, cy, sil: box.sil, cr: box.cr, foot: box.foot, top: box.top, sp, lastZ: -1 };
      drawTile(tile, TILE_Z1);
      tile.lastZ = TILE_Z1;
      return tile;
    });

    // Painter's order for the static pad and tiles; the lift only changes z,
    // never which tile is in front, so this order can be fixed once.
    const order = [{ key: 0, g: pad.g }, ...tiles.map((t) => ({ key: t.cx + t.cy, g: t.sil.parentNode }))];
    order.sort((a, b) => a.key - b.key).forEach((o) => root.appendChild(o.g));

    board = register(stage, (dt) => {
      let moving = false;
      for (const tile of tiles) {
        if (stepS(tile.sp, dt)) moving = true;
        const z = TILE_Z1 + tile.sp.x * LIFT;
        if (Math.abs(z - tile.lastZ) > 0.02) {
          tile.lastZ = z;
          drawTile(tile, z);
        }
      }
      return moving;
    });
    bag.add(board.unregister);
    // register() keeps the board; the disposer must not double-unregister it.
    bag.add(() => { board = null; });

    readDefault();
  }

  function highlight(i) {
    if (i === selected) return;
    selected = i;
    tiles.forEach((tile, k) => {
      tile.sp.t = k === i ? 1 : 0;
      tile.sil.setAttribute('class', k === i ? 'sil hi' : 'sil');
    });
    if (board) board.wake();
    if (i < 0) {
      readDefault();
      return;
    }
    const item = tiles[i].item;
    const host = item.host || (item.href ? String(item.href).replace(/^https?:\/\//, '').replace(/\/$/, '') : '');
    read.textContent = host ? `${item.title} · ${host}` : item.title;
  }

  function pick(pt) {
    const [u, v] = HL.unproj(C, pt[0], pt[1], TILE_Z1 + LIFT);
    let best = -1, distance = Infinity;
    tiles.forEach((tile, i) => {
      const d = Math.hypot(u - tile.cx, (v - tile.cy) * 1.35);
      if (d < distance && Math.abs(u - tile.cx) <= HW + 2 && Math.abs(v - tile.cy) <= HD + 2) {
        distance = d;
        best = i;
      }
    });
    return best;
  }

  function set(next) {
    const list = Array.isArray(next) ? next : [];
    const sig = list.map((x) => `${x.title}:${x.href || ''}`).join('|');
    if (sig === signature) return;
    signature = sig;
    items = list;
    build();
  }

  bag.add(pointer(stage, {
    move: (p) => highlight(pick(p)),
    down: (p) => highlight(pick(p)),
    leave: () => highlight(-1),
  }));
  bag.add(() => svg.replaceChildren());

  set(value);
  return { set, destroy: bag.dispose };
}

hairline({
  name: 'launchpad',
  means: 'Deployed dashboards stand on a launchpad; point at a tile to preview its destination.',
  rules: [1, 4, 6, 8],
  range: [0, 6, 1],
  tour: [[150, 140], [200, 120], [260, 170], [310, 210], null],
  mount,
});
})();
