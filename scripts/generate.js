const fs = require('fs');
const fetch = require('node-fetch');
const { createSVGWindow } = require('svgdom');
const { SVG, registerWindow } = require('@svgdotjs/svg.js');

const USERNAME = process.env.GH_USERNAME;

const TILE = 36;
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
      .map(([name, size]) => ({
        name,
        size,
        color: LANGUAGE_COLORS[name] || '#8b949e',
      }));

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
  const screenX = originX + (x - y) * (TILE / 2);
  const screenY = originY + (x + y) * (TILE / 4) - z;
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

  const canvasWidth = (cols + rows) * TILE + 240;
  const canvasHeight = (cols + rows) * (TILE / 2) + MAX_HEIGHT + 200;

  const draw = SVG(document.documentElement).size(canvasWidth, canvasHeight);
  draw.attr('shape-rendering', 'crispEdges');
  draw.attr('style', 'image-rendering: pixelated;');
  draw.rect(canvasWidth, canvasHeight).fill('#0d1117');

  const originX = canvasWidth / 2;
  const originY = 120;

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

    drawStripedFace({ gx: x, gy: y + 1 }, { gx: x + 1, gy: y + 1 }, -30);
    drawStripedFace({ gx: x + 1, gy: y }, { gx: x + 1, gy: y + 1 }, -12);

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

  draw.text('Top Commits')
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
