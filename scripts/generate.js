const fs = require('fs');
const fetch = require('node-fetch');
const { createSVGWindow } = require('svgdom');
const { SVG, registerWindow } = require('@svgdotjs/svg.js');

const USERNAME = process.env.GH_USERNAME;

const TILE = 36;
const GAP = 1.6; // jarak antar gedung (1 = nempel, makin besar makin renggang)
const MAX_BUILDINGS = 30;
const MAX_HEIGHT = 140;
const MIN_HEIGHT = 24;

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
  Java: '#b07219', Kotlin: '#A97BFF', C: '#555555', 'C++': '#f34b7d',
  Shell: '#89e051', Makefile: '#427819', Rust: '#dea584', Go: '#00ADD8',
  HTML: '#e34c26', CSS: '#563d7c', Dart: '#00B4AB', Swift: '#F05138',
  Ruby: '#701516', PHP: '#4F5D95', 'C#': '#178600', Vue: '#41b883',
};

async function fetchRepos() {
  const res = await fetch(
    `https://api.github.com/users/${USERNAME}/repos?per_page=${MAX_BUILDINGS}&sort=pushed&direction=desc`,
    { headers: { 'User-Agent': 'repo-skyline-generator' } }
  );
  if (!res.ok) {
    console.error('REST API error:', res.status, await res.text());
    return [];
  }
  const repoList = await res.json();
  const filtered = repoList.filter(r => !r.fork);
  const results = [];

  for (const repo of filtered) {
    const commitsRes = await fetch(
      `https://api.github.com/repos/${USERNAME}/${repo.name}/commits?per_page=1`,
      { headers: { 'User-Agent': 'repo-skyline-generator' } }
    );
    let commitCount = 0;
    const linkHeader = commitsRes.headers.get('link');
    if (linkHeader && linkHeader.includes('rel="last"')) {
      const match = linkHeader.match(/page=(\d+)>; rel="last"/);
      commitCount = match ? parseInt(match[1]) : 1;
    } else if (commitsRes.ok) {
      const commitsData = await commitsRes.json();
      commitCount = Array.isArray(commitsData) ? commitsData.length : 0;
    }

    const langRes = await fetch(
      `https://api.github.com/repos/${USERNAME}/${repo.name}/languages`,
      { headers: { 'User-Agent': 'repo-skyline-generator' } }
    );
    const langData = langRes.ok ? await langRes.json() : {};
    const languages = Object.entries(langData)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, size]) => ({ name, size, color: LANGUAGE_COLORS[name] || '#8b949e' }));

    results.push({ name: repo.name, commits: commitCount, languages });
  }
  return results;
}

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
  const screenX = originX + (x - y) * (TILE * GAP / 2);
  const screenY = originY + (x + y) * (TILE * GAP / 4) - z;
  return { screenX, screenY };
}

async function main() {
  const repos = await fetchRepos();
  if (repos.length === 0) {
    console.error('No repo data, aborting render.');
    process.exit(1);
  }

  const maxCommits = Math.max(...repos.map(r => r.commits), 1);
  const cols = Math.ceil(Math.sqrt(repos.length));
  const rows = Math.ceil(repos.length / cols);

  const window = createSVGWindow();
  const document = window.document;
  registerWindow(window, document);

  const canvasWidth = (cols + rows) * TILE * GAP + 260;
  const canvasHeight = (cols + rows) * (TILE * GAP / 2) + MAX_HEIGHT + 220;

  const draw = SVG(document.documentElement).viewbox(0, 0, canvasWidth, canvasHeight).size(canvasWidth, canvasHeight);
  draw.attr('shape-rendering', 'crispEdges');
  draw.attr('style', 'image-rendering: pixelated;');

  // background full nutup canvas
  draw.rect(canvasWidth, canvasHeight).move(0, 0).fill('#0d1117');

  const originX = canvasWidth / 2;
  const originY = 130;

  // --- GROUND GRID PUTIH ---
  for (let gx = 0; gx <= cols; gx++) {
    const p1 = isoTransform(originX, originY, gx, 0, 0);
    const p2 = isoTransform(originX, originY, gx, rows, 0);
    draw.line(p1.screenX, p1.screenY, p2.screenX, p2.screenY)
      .stroke({ width: 1, color: '#ffffff', opacity: 0.15 });
  }
  for (let gy = 0; gy <= rows; gy++) {
    const p1 = isoTransform(originX, originY, 0, gy, 0);
    const p2 = isoTransform(originX, originY, cols, gy, 0);
    draw.line(p1.screenX, p1.screenY, p2.screenX, p2.screenY)
      .stroke({ width: 1, color: '#ffffff', opacity: 0.15 });
  }

  const positioned = repos.map((repo, i) => ({
    ...repo,
    gx: i % cols,
    gy: Math.floor(i / cols),
  })).sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));

  positioned.forEach(repo => {
    const { gx: x, gy: y, commits, name, languages } = repo;
    const heightRatio = commits / maxCommits;
    const height = MIN_HEIGHT + heightRatio * (MAX_HEIGHT - MIN_HEIGHT);

    // footprint gedung dipersempit dikit dari grid cell (biar ada jarak/gang)
    const pad = 0.18;
    const top = isoTransform(originX, originY, x + pad, y + pad, height);
    const topRight = isoTransform(originX, originY, x + 1 - pad, y + pad, height);
    const topLeft = isoTransform(originX, originY, x + pad, y + 1 - pad, height);
    const topCenter = isoTransform(originX, originY, x + 1 - pad, y + 1 - pad, height);

    const totalSize = languages.reduce((sum, l) => sum + l.size, 0) || 1;
    let segments = languages.length > 0
      ? languages.map(l => ({ color: l.color, ratio: l.size / totalSize }))
      : [{ color: '#8b949e', ratio: 1 }];

    const dominantColor = segments[0].color;

    draw.polygon([
      [top.screenX, top.screenY],
      [topRight.screenX, topRight.screenY],
      [topCenter.screenX, topCenter.screenY],
      [topLeft.screenX, topLeft.screenY],
    ]).fill(dominantColor).stroke({ width: 1.2, color: '#010409' });

    function drawStripedFace(p1, p2, shadePercent) {
      let accumRatio = 0;
      segments.forEach(seg => {
        const yStart = accumRatio;
        const yEnd = accumRatio + seg.ratio;
        accumRatio = yEnd;
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

    drawStripedFace({ gx: x + pad, gy: y + 1 - pad }, { gx: x + 1 - pad, gy: y + 1 - pad }, -30);
    drawStripedFace({ gx: x + 1 - pad, gy: y + pad }, { gx: x + 1 - pad, gy: y + 1 - pad }, -12);

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

  // --- PANEL TOP COMMITS (pojok kanan atas, dengan margin) ---
  const topRepos = [...repos].sort((a, b) => b.commits - a.commits).slice(0, 5);
  const panelW = 200;
  const panelH = 28 + topRepos.length * 20;
  const panelX = canvasWidth - panelW - 24;
  const panelY = 24;

  draw.rect(panelW, panelH)
    .radius(8)
    .fill('#161b22')
    .stroke({ width: 1, color: '#30363d' })
    .move(panelX, panelY);

  draw.text('Top Commits')
    .font({ size: 12, family: 'monospace', fill: '#39d353', anchor: 'start' })
    .move(panelX + 10, panelY + 6);

  topRepos.forEach((r, i) => {
    const lineY = panelY + 26 + i * 20;
    const label = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name;
    draw.text(`${i + 1}. ${label}`)
      .font({ size: 10, family: 'monospace', fill: '#c9d1d9', anchor: 'start' })
      .move(panelX + 10, lineY);
    draw.text(`${r.commits}`)
      .font({ size: 10, family: 'monospace', fill: '#58a6ff', anchor: 'end' })
      .move(panelX + panelW - 10, lineY);
  });

  fs.mkdirSync('assets', { recursive: true });

  let svgOutput = draw.svg();
  if (!svgOutput.includes('xmlns=')) {
    svgOutput = svgOutput.replace(
      '<svg',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
    );
  }

  fs.writeFileSync('assets/skyline.svg', svgOutput);
  console.log('SVG generated:', canvasWidth, 'x', canvasHeight, '| repos:', repos.length);
}

main();
