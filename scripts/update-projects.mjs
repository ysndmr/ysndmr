import { readFile, writeFile } from 'node:fs/promises';

const USERNAME = process.env.GH_USERNAME ?? 'ysndmr';
const TOKEN = process.env.GITHUB_TOKEN;
const README_PATH = 'README.md';
const OVERRIDES_PATH = new URL('./project-overrides.json', import.meta.url);
const MARKER_START = '<!-- PROJECTS:START -->';
const MARKER_END = '<!-- PROJECTS:END -->';
const PROJECT_COUNT = 10;

async function fetchRepos() {
  const res = await fetch(`https://api.github.com/users/${USERNAME}/repos?sort=created&direction=desc&per_page=100`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  return res.json();
}

function stackFor(repo) {
  const parts = [repo.language, ...(repo.topics ?? [])].filter(Boolean);
  return [...new Set(parts)].join(', ') || '—';
}

function escapeCell(s) {
  return s.replace(/\|/g, '\\|');
}

function rowFor(repo, overrides) {
  const fallback = overrides.fallback?.[repo.name];
  const description = escapeCell(fallback?.description ?? repo.description ?? '—');
  const stack = escapeCell(fallback?.stack ?? stackFor(repo));
  return `| [${repo.name}](${repo.html_url}) | ${description} | ${stack} |`;
}

function pinnedRow(entry) {
  return `| [${entry.name}](${entry.url}) | ${escapeCell(entry.description)} | ${escapeCell(entry.stack)} |`;
}

function buildTable(repos, overrides) {
  const pinned = overrides.pinned ?? [];
  const dynamicCount = Math.max(PROJECT_COUNT - pinned.length, 0);
  const excluded = new Set(overrides.exclude ?? []);
  const dynamicRepos = repos
    .filter(r => !r.fork && !r.archived && !excluded.has(r.name) && r.name.toLowerCase() !== USERNAME.toLowerCase())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, dynamicCount);

  const rows = [...pinned.map(pinnedRow), ...dynamicRepos.map(r => rowFor(r, overrides))];
  return ['| Project | Description | Stack |', '| --- | --- | --- |', ...rows].join('\n');
}

async function main() {
  const [repos, overridesRaw] = await Promise.all([
    fetchRepos(),
    readFile(OVERRIDES_PATH, 'utf-8'),
  ]);
  const overrides = JSON.parse(overridesRaw);

  const table = buildTable(repos, overrides);
  const readme = await readFile(README_PATH, 'utf-8');

  const startIdx = readme.indexOf(MARKER_START);
  const endIdx = readme.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`README.md is missing ${MARKER_START} / ${MARKER_END} markers`);
  }

  const before = readme.slice(0, startIdx + MARKER_START.length);
  const after = readme.slice(endIdx);
  const updated = `${before}\n${table}\n${after}`;

  await writeFile(README_PATH, updated, 'utf-8');
  console.log(`[update-projects] wrote table with ${table.split('\n').length - 2} projects to README.md`);
}

main().catch(err => {
  console.error('[update-projects] fatal error:', err);
  process.exit(1);
});
