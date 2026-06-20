const fs = require('fs');
const fetch = require('node-fetch');
const { createSVGWindow } = require('svgdom');
const { SVG, registerWindow } = require('@svgdotjs/svg.js');

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

const TILE = 36;       // ukuran footprint kotak (benar-benar persegi, bukan persegi panjang)
const MAX_BUILDINGS = 30; // batasi biar gak terlalu padat
const MAX_HEIGHT = 140;
const MIN_HEIGHT = 24;

// ---------- 1. FETCH DATA ----------
async function fetchRepos() {
  const query = `
    query {
      user(login: "${USERNAME}") {
        repositories(first: ${MAX_BUILDINGS}, ownerAffiliation: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
          nodes {
            name
            pushedAt
            defaultBranchRef {
              target {
                ... on Commit {
                  history(first: 0) { totalCount }
                }
              }
            }
            languages(first: 5, orderBy: {field: SIZE, direction: DESC}) {
              edges {
                size
                node { name color }
              }
            }
          }
        }
      }
    }`;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();
  if (!json.data || !json.data.user) {
    console.error('GraphQL error:', JSON.stringify(json));
    return [];
  }

  return json.data.user.repositories.nodes
    .filter(r => r.defaultBranchRef) // skip repo kosong
    .map(r => ({
      name: r.name,
      commits: r.defaultBranchRef.target.history.totalCount,
      languages: r.languages.edges.map(e => ({
        name: e.node.name,
        color: e.node.color || '#888888',
        size: e.size,
      })),
    }));
}

// ---------- 2. HELPER ----------
function shade(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  let r = (num >> 16) + percent;
  let g = ((num >> 8) & 0x00ff) + percent;
  let b = (num & 0x0000ff) + percent;
  r = Math.max(Math.min(255, r), 0);
  g = Math.max(Math.min(255, g), 0);
  b = Math.max(Math.min(255, b), 0);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function isoTransform(originX, originY, x, y, z) {
  const screenX = originX + (x - y) * (TILE / 2);
  const screenY = originY + (x + y) * (TILE / 4) - z;
  return { screenX, screenY };
}

// ---------- 3. MAIN ----------
async function main() {
  const repos = await fetchRepos();

  if (repos.length === 0) {
    console.error('No repo data, aborting render.');
    return;
  }

  const maxCommits = Math.max(...repos.map(r => r.commits), 1);
  const cols = Math.ceil(Math.sqrt(repos.length)); // grid persegi berdasarkan jumlah repo
  const rows = Math.ceil(repos.length / cols);

  const window = createSVGWindow();
  const document = window.document;
  registerWindow(window, document);

  const canvasWidth = (cols + rows) * TILE + 240;
  const canvasHeight = (cols + rows) * (TILE / 2) + MAX_HEIGHT + 200;

  const draw = SVG(document.documentElement).size(canvasWidth, canvasHeight);
  draw.attr('shape-rendering', 'crispEdges');
  draw.attr('style', 'image-rendering: pixelated;');

  // background gelap
  draw.rect(canvasWidth, canvasHeight).fill('#0d1117');

  const originX = canvasWidth / 2;
  const originY = 120;

  // urutkan render belakang-ke-depan biar gedung gak ketimpa salah (painter's algorithm)
  const positioned = repos.map((repo, i) => ({
    ...repo,
    gx: i % cols,
    gy: Math.floor(i / cols),
  })).sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));

  positioned.forEach(repo => {
    const { gx: x, gy: y, commits, name, languages } = repo;

    const heightRatio = commits / maxCommits;
    const height = MIN_HEIGHT + heightRatio * (MAX_HEIGHT - MIN_HEIGHT);

    const top = isoTransform(originX, originY, x, y, height);
    const topRight = isoTransform(originX, originY, x + 1, y, height);
    const topLeft = isoTransform(originX, originY, x, y + 1, height);
    const topCenter = isoTransform(originX, originY, x + 1, y + 1, height);
    const baseRight = isoTransform(originX, originY, x + 1, y, 0);
    const baseLeft = isoTransform(originX, originY, x, y + 1, 0);
    const baseCenter = isoTransform(originX, originY, x + 1, y + 1, 0);

    // total ukuran bahasa, buat hitung proporsi tiap bahasa
    const totalSize = languages.reduce((sum, l) => sum + l.size, 0) || 1;
    let segments = languages.length > 0
      ? languages.map(l => ({ color: l.color, ratio: l.size / totalSize }))
      : [{ color: '#8b949e', ratio: 1 }];

    // --- TOP FACE: warna bahasa dominan ---
    const dominantColor = segments[0].color;
    draw.polygon([
      [top.screenX, top.screenY],
      [topRight.screenX, topRight.screenY],
      [topCenter.screenX, topCenter.screenY],
      [topLeft.screenX, topLeft.screenY],
    ]).fill(dominantColor).stroke({ width: 1.2, color: '#010409' });

    // --- LEFT & RIGHT FACE: stacked horizontal bands sesuai proporsi bahasa ---
    function drawStripedFace(p1, p2, p3, p4, shadePercent) {
      let accumRatio = 0;
      segments.forEach(seg => {
        const yStart = accumRatio;
        const yEnd = accumRatio + seg.ratio;
        accumRatio = yEnd;

        // interpolasi posisi vertikal band di antara top & base (top = z height, base = 0)
        const zTop = height - yStart * height;
        const zBot = height - yEnd * height;

        const pTop1 = isoTransform(originX, originY, p1.gx, p1.gy, zTop);
        const pTop2 = isoTransform(originX, originY, p2.gx, p2.gy, zTop);
        const pBot2 = isoTransform(originX, originY, p2.gx, p2.gy, zBot);
        const pBot1 = isoTransform(originX, originY, p1.gx, p1.gy, zBot);

        draw.polygon([
          [pTop1.screenX, pTop1.screenY],
          [pTop2.screenX, pTop2.screenY],
          [pBot2.screenX, pBot2.screenY],
          [pBot1.screenX, pBot1.screenY],
        ]).fill(shade(seg.color, shadePercent)).stroke({ width: 0.8, color: '#010409' });
      });
    }

    // left face (x, y+1) ke (x+1, y+1)
    drawStripedFace({ gx: x, gy: y + 1 }, { gx: x + 1, gy: y + 1 }, null, null, -30);
    // right face (x+1, y) ke (x+1, y+1)
    drawStripedFace({ gx: x + 1, gy: y }, { gx: x + 1, gy: y + 1 }, null, null, -12);

    // --- LABEL BUBBLE nama repo di atas gedung ---
    const labelY = top.screenY - 14;
    const labelText = name.length > 14 ? name.slice(0, 13) + '…' : name;
    const bubbleWidth = labelText.length * 6.2 + 14;

    draw.rect(bubbleWidth, 18)
      .radius(9)
      .fill('#161b22')
      .stroke({ width: 1, color: dominantColor })
      .move(top.screenX - bubbleWidth / 2, labelY - 18);

    draw.text(labelText)
      .font({ size: 10, family: 'monospace', fill: '#e6edf3', anchor: 'middle' })
      .move(top.screenX - bubbleWidth / 2 + 7, labelY - 16);
  });

  // ---------- 4. STATS PANEL (pojok kanan atas) ----------
  const topRepos = [...repos].sort((a, b) => b.commits - a.commits).slice(0, 5);

  const panelX = canvasWidth - 230;
  const panelY = 16;
  const panelW = 214;
  const panelH = 28 + topRepos.length * 20;

  draw.rect(panelW, panelH)
    .radius(8)
    .fill('#161b22')
    .stroke({ width: 1, color: '#30363d' })
    .move(panelX, panelY);

  draw.text('🏆 Top Commits')
    .font({ size: 12, family: 'monospace', fill: '#39d353', anchor: 'start' })
    .move(panelX + 10, panelY + 6);

  topRepos.forEach((r, i) => {
    const lineY = panelY + 26 + i * 20;
    const label = r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name;
    draw.text(`${i + 1}. ${label}`)
      .font({ size: 10, family: 'monospace', fill: '#c9d1d9', anchor: 'start' })
      .move(panelX + 10, lineY);
    draw.text(`${r.commits}`)
      .font({ size: 10, family: 'monospace', fill: '#58a6ff', anchor: 'end' })
      .move(panelX + panelW - 10, lineY);
  });

  // ---------- 5. WRITE FILE ----------
  fs.mkdirSync('profile-3d-contrib', { recursive: true });

  let svgOutput = draw.svg();
  if (!svgOutput.includes('xmlns=')) {
    svgOutput = svgOutput.replace(
      '<svg',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
    );
  }

  fs.writeFileSync('profile-3d-contrib/profile-square-isometric.svg', svgOutput);
  console.log('SVG generated:', canvasWidth, 'x', canvasHeight, '| repos:', repos.length);
}

main();
