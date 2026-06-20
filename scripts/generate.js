const fs = require('fs');
const fetch = require('node-fetch');
const { createSVGWindow } = require('svgdom');
const { SVG, registerWindow } = require('@svgdotjs/svg.js');

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

const WEEKS = 26;
const DAYS = 7;
const TILE = 20;

async function fetchContributions() {
  const query = `
    query {
      user(login: "${USERNAME}") {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays { contributionCount date }
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
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

function getColor(count) {
  if (count === 0) return { top: '#161b22', left: '#0d1117', right: '#13171d' };
  if (count < 3)  return { top: '#0e4429', left: '#08311d', right: '#0a3a22' };
  if (count < 6)  return { top: '#006d32', left: '#004d23', right: '#005a29' };
  if (count < 10) return { top: '#26a641', left: '#1b7a2f', right: '#1f8f37' };
  return            { top: '#39d353', left: '#2bab40', right: '#30c049' };
}

async function main() {
  const weeks = (await fetchContributions()).slice(-WEEKS);

  const window = createSVGWindow();
  const document = window.document;
  registerWindow(window, document);

  const canvasWidth = (WEEKS + DAYS) * TILE + 100;
  const canvasHeight = (WEEKS + DAYS) * (TILE / 2) + 150;

  const draw = SVG(document.documentElement).size(canvasWidth, canvasHeight);
  draw.attr('shape-rendering', 'crispEdges');
  draw.attr('style', 'image-rendering: pixelated;');

  const originX = canvasWidth / 2;
  const originY = 50;

  function isoTransform(x, y, z) {
    const screenX = originX + (x - y) * (TILE / 2);
    const screenY = originY + (x + y) * (TILE / 4) - z;
    return { screenX, screenY };
  }

  weeks.forEach((week, weekIdx) => {
    week.contributionDays.forEach((day, dayIdx) => {
      const count = day.contributionCount;
      const height = Math.min(count * 2 + 4, 40);
      const colors = getColor(count);

      const x = weekIdx;
      const y = dayIdx;

      const top = isoTransform(x, y, height);
      const topRight = isoTransform(x + 1, y, height);
      const topLeft = isoTransform(x, y + 1, height);
      const topCenter = isoTransform(x + 1, y + 1, height);
      const baseRight = isoTransform(x + 1, y, 0);
      const baseLeft = isoTransform(x, y + 1, 0);
      const baseCenter = isoTransform(x + 1, y + 1, 0);

      draw.polygon([
        [top.screenX, top.screenY],
        [topRight.screenX, topRight.screenY],
        [topCenter.screenX, topCenter.screenY],
        [topLeft.screenX, topLeft.screenY],
      ]).fill(colors.top).stroke({ width: 1.5, color: '#010409' });

      draw.polygon([
        [topLeft.screenX, topLeft.screenY],
        [topCenter.screenX, topCenter.screenY],
        [baseCenter.screenX, baseCenter.screenY],
        [baseLeft.screenX, baseLeft.screenY],
      ]).fill(colors.left).stroke({ width: 1.5, color: '#010409' });

      draw.polygon([
        [topRight.screenX, topRight.screenY],
        [topCenter.screenX, topCenter.screenY],
        [baseCenter.screenX, baseCenter.screenY],
        [baseRight.screenX, baseRight.screenY],
      ]).fill(colors.right).stroke({ width: 1.5, color: '#010409' });
    });
  });

  fs.mkdirSync('profile-3d-contrib', { recursive: true });
  fs.writeFileSync(
    'profile-3d-contrib/profile-square-isometric.svg',
    draw.svg()
  );
  console.log('SVG generated:', canvasWidth, 'x', canvasHeight);
}

main();
