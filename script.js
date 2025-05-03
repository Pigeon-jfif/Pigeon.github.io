let vinyls = [];
let currentGrouping = 'artist';

function parseVinyls() {
  const input = document.getElementById('vinylInput').value.trim();
  vinyls = input.split('\n').map(line => {
    const [artist, year, number, title] = line.split(' - ');
    return {
      artist: artist.trim(),
      year: parseInt(year.trim()),
      number: parseInt(number.trim()),
      title: title.trim()
    };
  });
}

function setGrouping(groupByKey) {
  currentGrouping = groupByKey;
  renderList();
}

function renderList() {
  parseVinyls();

  const searchQuery = document.getElementById('searchInput').value.toLowerCase();

  const filtered = vinyls.filter(v =>
    v.artist.toLowerCase().includes(searchQuery) ||
    v.title.toLowerCase().includes(searchQuery) ||
    v.year.toString().includes(searchQuery) ||
    v.number.toString().includes(searchQuery)
  );

  const grouped = groupBy(filtered, currentGrouping);
  const container = document.getElementById('vinylList');
  container.innerHTML = '';

  const sortedKeys = Array.from(grouped.keys()).sort(
    currentGrouping === 'artist'
      ? (a, b) => a.localeCompare(b)
      : (a, b) => a - b
  );

  sortedKeys.forEach(key => {
    const section = document.createElement('div');
    section.className = 'section';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = key;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'grid';

    grouped.get(key).forEach(vinyl => {
      const card = document.createElement('div');
      card.className = 'card';

      let infoHTML = '';

      if (currentGrouping === 'artist') {
        infoHTML = `
          <div>${vinyl.year}</div>
          <div>Disks: ${vinyl.number}</div>
        `;
      } else {
        infoHTML = `
          <div>${vinyl.artist}</div>
          <div>Disks: ${vinyl.number}</div>
        `;
      }

      card.innerHTML = `
        <div class="album-title">${vinyl.title}</div>
        <div class="album-info">
          ${infoHTML}
        </div>
      `;
      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const groupKey = item[key];
    if (!map.has(groupKey)) {
      map.set(groupKey, []);
    }
    map.get(groupKey).push(item);
  }
  return map;
}

window.onload = () => setGrouping('artist');
