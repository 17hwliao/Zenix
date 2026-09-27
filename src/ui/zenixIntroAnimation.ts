// An original, image-free Lottie composition for Zenix's opening sequence.
const still = (value: number | number[] | object) => ({ a: 0, k: value });
const move = (from: number, to: number, start: number, end: number) => ({
  a: 1,
  k: [
    { t: start, s: [from], e: [to], o: { x: 0.22, y: 0 }, i: { x: 0.78, y: 1 } },
    { t: end, s: [to] },
  ],
});

const transform = () => ({ ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100), sk: still(0), sa: still(0) });
const stroke = (color: number[], width: number, opacity = 100) => ({ ty: 'st', c: still(color), o: still(opacity), w: still(width), lc: 2, lj: 2 });
const ring = (diameter: number, width: number, color: number[], opacity: number, from: number, to: number) => ({
  ty: 'gr',
  it: [
    { ty: 'el', p: still([0, 0]), s: still([diameter, diameter]), d: 1 },
    stroke(color, width, opacity),
    { ty: 'tm', s: still(0), e: move(0, 76, 4, 48), o: still(0), m: 1 },
    transform(),
  ],
  nm: 'Light orbit',
  rotation: move(from, to, 0, 84),
});

const zPath = {
  ty: 'sh',
  ks: still({
    c: false,
    v: [[-58, -47], [58, -47], [-58, 47], [58, 47]],
    i: [[0, 0], [0, 0], [0, 0], [0, 0]],
    o: [[0, 0], [0, 0], [0, 0], [0, 0]],
  }),
};

const layer = (name: string, index: number, shapes: object[], rotation = still(0)) => ({
  ddd: 0, ind: index, ty: 4, nm: name, sr: 1,
  ks: { o: still(100), r: rotation, p: still([250, 250, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]) },
  ao: 0, shapes, ip: 0, op: 90, st: 0, bm: 0,
});

export const zenixIntroAnimation = {
  v: '5.12.2', fr: 30, ip: 0, op: 88, w: 500, h: 500, nm: 'Zenix opening', ddd: 0, assets: [],
  layers: [
    layer('Outer orbit', 1, [ring(340, 2, [0.76, 0.85, 1, 1], 40, -112, 50)], move(-112, 50, 0, 88)),
    layer('Inner orbit', 2, [ring(270, 4, [0.95, 0.98, 1, 1], 86, 165, -105)], move(165, -105, 0, 88)),
    layer('Z halo', 3, [{ ty: 'gr', it: [zPath, stroke([0.36, 0.58, 0.9, 1], 32, 22), { ty: 'tm', s: still(0), e: move(0, 100, 8, 56), o: still(0), m: 1 }, transform()] }]),
    layer('Z mark', 4, [{ ty: 'gr', it: [zPath, stroke([1, 1, 1, 1], 15, 100), { ty: 'tm', s: still(0), e: move(0, 100, 8, 56), o: still(0), m: 1 }, transform()] }]),
  ],
};
