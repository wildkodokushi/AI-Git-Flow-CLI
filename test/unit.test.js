import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlan, categoryOf, codeKey } from '../src/grouping.js';
import { parseStatus } from '../src/git.js';
import { parseIssue, parsePr, parseReadme } from '../src/prompts.js';
import { applyImperative, buildCommitMessage, fallbackMessage, toSubject } from '../src/text.js';
import { UserError } from '../src/errors.js';
import { resolveOptions } from '../src/config.js';
import { parseCli } from '../src/cli.js';
import { licenseText, normalizeLicenseKey } from '../src/licenses.js';

test('categoryOf classifies files deterministically', () => {
  const cases = {
    'package.json': 'deps', 'yarn.lock': 'deps', 'App.csproj': 'deps', '.github/workflows/ci.yml': 'ci', Dockerfile: 'ci',
    'vite.config.js': 'config', '.gitignore': 'config', 'tsconfig.app.json': 'config', 'README.md': 'docs', LICENSE: 'docs',
    'docs/guide.html': 'docs', 'src/App.test.tsx': 'test', 'tests/api.js': 'test', 'src/style.scss': 'style',
    'public/logo.png': 'assets', 'src/components/Header.vue': 'code', 'index.html': 'code', 'server.js': 'code',
  };
  for (const [file, category] of Object.entries(cases)) assert.equal(categoryOf(file), category, file);
  assert.equal(categoryOf('SRC\\Style.CSS'), 'style');
});

test('codeKey groups by the first two segments', () => {
  assert.equal(codeKey('src/components/ui/Button.tsx'), 'src/components');
  assert.equal(codeKey('src/main.js'), 'src');
  assert.equal(codeKey('index.html'), '.');
});

test('buildPlan orders groups and merges small code groups', () => {
  const change = (p) => ({ path: p, paths: [p] });
  const plan = buildPlan(['README.md', 'package.json', 'src/a/x.js', 'src/a/y.js', 'src/b/z.js', 'lib/q.js'].map(change), 5);
  assert.deepEqual(plan.map((g) => g.category), ['deps', 'code', 'code', 'code', 'docs']);
  assert.deepEqual(plan.find((g) => g.key === 'code:src/a').files, ['src/a/x.js', 'src/a/y.js']);

  const many = Array.from({ length: 6 }, (_, i) => change(`dir${i}/sub${i}/f.js`));
  const merged = buildPlan(many, 3);
  assert.equal(merged.filter((g) => g.category === 'code').length, 3);
  assert.ok(merged.some((g) => g.key === 'code:other'));
  assert.equal(merged.flatMap((g) => g.files).length, 6);
});

test('parseStatus handles renames and spaces', () => {
  const out = 'R  new name.js\0old name.js\0 M src/a.js\0?? docs/b.md\0';
  const changes = parseStatus(out);
  assert.equal(changes.length, 3);
  assert.deepEqual(changes[0].paths, ['new name.js', 'old name.js']);
  assert.equal(changes[1].path, 'src/a.js');
});

test('toSubject cleans model output', () => {
  assert.equal(toSubject('"Add login form."'), 'add login form');
  assert.equal(toSubject('\n\n- Fix crash\nextra line'), 'fix crash');
  assert.equal(toSubject('   '), null);
  assert.equal(toSubject('x'.repeat(10) + ' ' + 'word '.repeat(30), 64).length <= 64, true);
});

test('applyImperative rewrites past tense verbs only in English', () => {
  assert.equal(applyImperative('added login form', 'en'), 'add login form');
  assert.equal(applyImperative('feat(ui): updated header', 'en'), 'feat(ui): update header');
  assert.equal(applyImperative('fixing bug', 'en'), 'fix bug');
  assert.equal(applyImperative('refactored module', 'en'), 'refactor module');
  assert.equal(applyImperative('simplified setup', 'en'), 'simplify setup');
  assert.equal(applyImperative('built pipeline', 'en'), 'build pipeline');
  assert.equal(applyImperative('add form', 'en'), 'add form');
  assert.equal(applyImperative('добавлен вход', 'ru'), 'добавлен вход');
});

test('buildCommitMessage produces valid Conventional Commits lines', () => {
  const code = { category: 'code', scope: 'components', key: 'code:src/components' };
  assert.equal(buildCommitMessage(code, 'Feat: added swiper', 'en'), 'feat(components): add swiper');
  assert.equal(buildCommitMessage(code, 'fix(x): fixed overflow.', 'en'), 'fix(components): fix overflow');
  assert.equal(buildCommitMessage(code, 'docs: whatever', 'en'), 'feat(components): whatever');
  const docs = { category: 'docs', scope: null, key: 'docs' };
  assert.equal(buildCommitMessage(docs, 'docs: updated guide', 'en'), 'docs: update guide');
  const deps = { category: 'deps', scope: 'deps', key: 'deps' };
  assert.equal(buildCommitMessage(deps, 'Bumped versions', 'en'), 'build(deps): bump versions');
  assert.equal(buildCommitMessage(deps, '', 'en'), fallbackMessage(deps));
  assert.equal(buildCommitMessage(docs, 'обновить документацию', 'ru'), 'docs: обновить документацию');
});

test('parsers extract structured data from model answers', () => {
  const pr = parsePr('TITLE: feat: added stuff\nDONE:\n- adds things\n- second change\nCHECKS:\n- open the page\nNOTES:\n- none', 'en');
  assert.equal(pr.title, 'feat: add stuff');
  assert.deepEqual(pr.done, ['adds things', 'second change']);
  assert.deepEqual(pr.checks, ['open the page']);
  assert.deepEqual(pr.notes, [], 'a literal "none" is not a note');
  assert.equal(parsePr('feat: plain title\nDONE:\n- x', 'en').title, 'feat: plain title');

  const readme = parseReadme('DESCRIPTION: A site.\nFEATURES:\n- one\n* two\n3. three');
  assert.equal(readme.description, 'A site.');
  assert.deepEqual(readme.features, ['one', 'two', 'three']);

  const issue = parseIssue('TYPE: Feature\nTITLE: "Dark theme."\nBODY:\n```markdown\n## Description\nx\n```');
  assert.equal(issue.type, 'feature');
  assert.equal(issue.title, 'Dark theme');
  assert.equal(issue.body, '## Description\nx');
  assert.equal(parseIssue('garbage').type, 'task');
});

test('resolveOptions merges defaults, config and flags and validates', () => {
  const config = { defaults: { lang: 'ru', draft: true } };
  const opts = resolveOptions({ maxCodeGroups: '3' }, config);
  assert.equal(opts.lang, 'ru');
  assert.equal(opts.draft, true);
  assert.equal(opts.maxCodeGroups, 3);
  assert.equal(resolveOptions({ lang: 'en' }, config).lang, 'en');
  assert.throws(() => resolveOptions({ lang: 'de' }, config), UserError);
  assert.throws(() => resolveOptions({ maxCodeGroups: '99' }, config), UserError);
  assert.equal(resolveOptions({ dry: true }, { defaults: {} }).dryRun, true);
});

test('parseCli handles flags, aliases and unknown options', () => {
  const parsed = parseCli(['issue', 'Broken button', '-b', 'feat/x', '--dry-run', '-y', '--labels', 'bug,ui']);
  assert.deepEqual(parsed.positionals, ['issue', 'Broken button']);
  assert.equal(parsed.flags.branch, 'feat/x');
  assert.equal(parsed.flags.dryRun, true);
  assert.equal(parsed.flags.yes, true);
  assert.throws(() => parseCli(['--nope']), UserError);
});

test('licenses: embedded texts are filled in, aliases work, remote texts use the fetcher', async () => {
  const mit = await licenseText('mit', { year: 2026, holder: 'Ivan Petrov' });
  assert.match(mit, /^MIT License\n\nCopyright \(c\) 2026 Ivan Petrov\n/);
  assert.ok(mit.endsWith('SOFTWARE.\n'));
  assert.equal(normalizeLicenseKey('Apache'), 'apache-2.0');
  assert.equal(normalizeLicenseKey('BSD'), 'bsd-3-clause');
  assert.throws(() => normalizeLicenseKey('wtfpl'), UserError);

  const remote = await licenseText('apache-2.0', {
    year: 2026,
    holder: 'X',
    fetcher: async (key) => `Apache text for [fullname] in [year] (${key})\r\n`,
  });
  assert.equal(remote, 'Apache text for X in 2026 (apache-2.0)\n');
});
