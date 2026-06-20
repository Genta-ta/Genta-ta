const { createCanvas } = require('canvas');
const obelisk = require('obelisk.js');
const fetch = require('node-fetch');

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

async function fetchContributions() {
  const query = `
    query {
      user(login: "${USERNAME}") {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
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
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

function getColor(count) {
  if (count === 0) return new obelisk.ColorRGB(22, 27, 34);
  if (count < 3) return new obelisk.ColorRGB(14, 68, 41);
  if (count < 6) return new obelisk.ColorRGB(0, 109, 50);
  if (count < 10) return new obelisk.ColorRGB(38, 166, 65);
  return new obelisk.ColorRGB(57, 211, 83);
}

async function main() {
  const weeks = await fetchContributions();

  // ambil cuma 26 minggu terakhir (half-year) biar persegi
  const recentWeeks = weeks.slice(-26);

  const canvas = createCanvas(1200, 700);
  const point = new obelisk.Point(550, 50);
  const pixelView = new obelisk.PixelView(canvas, point);

  const CUBE_DIM = new obelisk.CubeDimension(20, 20, 6);

  recentWeeks.forEach((week, weekIdx) => {
    week.contributionDays.forEach((day, dayIdx) => {
      const color = getColor(day.contributionCount);
      const height = Math.min(day.contributionCount * 2 + 4, 40);
      const dim = new obelisk.CubeDimension(20, 20, height);
      const cube = new obelisk.Cube(dim, color, false);

      const x = weekIdx * 20;
      const y = dayIdx * 20;
      const p3d = new obelisk.Point3D(x, y, 0);

      pixelView.renderObject(cube, p3d);
    });
  });

  const fs = require('fs');
  const out = fs.createWriteStream('profile-3d-contrib/profile-square-isometric.png');
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  out.on('finish', () => console.log('PNG generated'));
}

main();
