import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaultAnswer, git, makeFakeGh, makeRepo, runCli, startMockLlm, tmp, writeConfig, writeFiles } from './helpers.js';

const skipGh = process.platform === 'win32' ? 'fake gh is a shell script' : false;

let mock;
before(async () => {
  mock = await startMockLlm();
});
after(() => mock.close());

const setup = (files, options) => {
  const repo = makeRepo(undefined, options);
  const home = tmp('aigf-home-');
  writeConfig(home, mock);
  writeFiles(repo.dir, files);
  return { ...repo, home };
};

const FEATURE_FILES = {
  'package.json': '{"name":"demo","scripts":{"dev":"vite"}}',
  'src/components/Nav.jsx': 'export const Nav = () => null;\n',
  'src/pages/Home.jsx': 'export const Home = () => null;\n',
  'style.css': 'body { margin: 0 }\n',
  'README.md': '# demo\n\nchanged\n',
};

const subjects = (dir, range) => git(dir, 'log', '--reverse', '--format=%s', range).trim().split('\n');

test('commit: creates a branch, grouped normalised commits, pushes and opens a PR', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const ctx = setup(FEATURE_FILES);
  const result = await runCli(['--branch', 'feat/demo', '--yes'], { cwd: ctx.dir, home: ctx.home, gh });
  assert.equal(result.code, 0, result.output);

  assert.equal(git(ctx.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feat/demo');
  assert.deepEqual(subjects(ctx.dir, 'main..feat/demo'), [
    'build(deps): update things',
    'feat(components): add new component',
    'feat(pages): add new component',
    'style: update things',
    'docs: update things',
  ]);
  assert.equal(git(ctx.dir, 'status', '--porcelain').trim(), '', 'working tree is clean');
  assert.match(git(ctx.remote, 'branch', '--list'), /feat\/demo/);

  const create = gh.calls().find((line) => line.startsWith('pr create'));
  assert.ok(create, gh.calls().join('\n'));
  assert.match(create, /--base main --head feat\/demo --title feat: add stuff --body-file -/);
  const body = gh.body('pr');
  assert.match(body, /## What changed\n\n- adds things\n- helps the project\n/);
  assert.match(body, /## How to test\n\n```bash\nnpm install\n```/);
  assert.match(body, /## Checklist\n\n- \[ \] CI passes/);
  assert.doesNotMatch(body, /## Summary|## Changes/);
  assert.match(result.output, /токенов: \d+/);
});

test('commit: "." at the branch prompt stays on the current branch and skips the PR', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const ctx = setup({ 'style.css': 'a { color: red }\n', 'README.md': 'x\n' });
  const result = await runCli(['--yes'], { cwd: ctx.dir, home: ctx.home, gh, input: '.\n' });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Напишите \. чтобы остаться в текущей ветке/);
  assert.match(result.output, /Остаёмся в ветке main/);
  assert.equal(git(ctx.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.deepEqual(subjects(ctx.dir, 'origin/main~0...main').length > 0, true);
  assert.match(git(ctx.remote, 'log', '--format=%s', 'main'), /style: update things/);
  assert.equal(gh.calls().some((l) => l.startsWith('pr create')), false);
  assert.match(result.output, /Pull request не создаётся при работе в текущей ветке/);
});

test('commit: --stay works without prompts', async () => {
  const ctx = setup({ 'style.css': 'a { color: blue }\n' });
  const result = await runCli(['--stay', '--yes'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 0, result.output);
  assert.equal(git(ctx.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.match(git(ctx.remote, 'log', '--format=%s', 'main'), /style: update things/);
});

test('commit: --dry-run changes nothing', async () => {
  const ctx = setup(FEATURE_FILES);
  const before = git(ctx.dir, 'rev-parse', 'HEAD');
  const result = await runCli(['--dry-run'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /План коммитов/);
  assert.match(result.output, /dry-run/);
  assert.equal(git(ctx.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.equal(git(ctx.dir, 'rev-parse', 'HEAD'), before);
  assert.equal(git(ctx.dir, 'diff', '--cached', '--name-only').trim(), '', 'index is left clean');
  assert.ok(git(ctx.dir, 'status', '--porcelain').includes('package.json'));
});

test('commit: asks again when the branch name is taken, then accepts a new one', async () => {
  const ctx = setup({ 'style.css': 'b {}\n' });
  const result = await runCli(['--yes'], { cwd: ctx.dir, home: ctx.home, input: 'main\nfeat/second\n' });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Ветка main уже существует/);
  assert.equal(git(ctx.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feat/second');
});

test('commit: an invalid branch passed as a flag fails fast', async () => {
  const ctx = setup({ 'style.css': 'c {}\n' });
  const result = await runCli(['--branch', 'bad name', '--yes'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 1);
  assert.match(result.output, /Недопустимое имя ветки/);
  assert.equal(git(ctx.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
});

test('commit: reports a clean tree', async () => {
  const ctx = setup({});
  const result = await runCli(['--yes'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 0);
  assert.match(result.output, /Нет изменений для коммита/);
});

test('commit: handles spaces, Cyrillic names and renames', async () => {
  const ctx = setup({ 'src/components/Моя кнопка.jsx': 'export default 1;\n', 'src/pages/old name.jsx': 'export default 2;\n' });
  git(ctx.dir, 'add', '-A');
  git(ctx.dir, 'commit', '-q', '-m', 'chore: seed');
  git(ctx.dir, 'mv', 'src/pages/old name.jsx', 'src/pages/new name.jsx');
  writeFiles(ctx.dir, { 'src/components/Ещё один.jsx': 'export default 3;\n' });
  const result = await runCli(['--branch', 'feat/names', '--yes', '--no-pr'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 0, result.output);
  assert.equal(git(ctx.dir, 'status', '--porcelain').trim(), '');
  const tree = git(ctx.dir, '-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', 'HEAD');
  assert.match(tree, /Ещё один\.jsx/);
  assert.match(tree, /new name\.jsx/);
  assert.doesNotMatch(tree, /old name\.jsx/);
});

test('commit: falls back to template messages when the model is unavailable', async () => {
  const broken = await startMockLlm(() => ({ status: 500, body: { error: 'down' } }));
  try {
    const repo = makeRepo();
    const home = tmp('aigf-home-');
    writeConfig(home, broken);
    writeFiles(repo.dir, { 'style.css': 'd {}\n', 'src/lib/util.js': 'export {};\n' });
    const result = await runCli(['--branch', 'feat/fallback', '--yes', '--no-pr'], { cwd: repo.dir, home });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Не удалось получить сообщение/);
    assert.deepEqual(subjects(repo.dir, 'main..feat/fallback'), ['feat(lib): update lib', 'style: update styles']);
  } finally {
    await broken.close();
  }
});

test('commit: a failing hook aborts with a clear message', async () => {
  const ctx = setup({ 'style.css': 'e {}\n' });
  const hook = path.join(ctx.dir, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', { mode: 0o755 });
  const result = await runCli(['--branch', 'feat/hook', '--yes'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 1);
  assert.match(result.output, /Не удалось создать коммит/);
});

test('commit without a configured provider explains how to fix it', async () => {
  const ctx = setup({ 'style.css': 'f {}\n' });
  const result = await runCli(['--yes'], { cwd: ctx.dir, home: tmp('aigf-empty-') });
  assert.equal(result.code, 1);
  assert.match(result.output, /aigf init/);
});

test('license: writes LICENSE, honours dry-run and asks before overwriting', async () => {
  const ctx = setup({});
  const dry = await runCli(['license', '--type', 'mit', '--author', 'Ivan', '--year', '2026', '--dry-run'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(dry.code, 0, dry.output);
  assert.equal(fs.existsSync(path.join(ctx.dir, 'LICENSE')), false);

  const first = await runCli(['license', '--type', 'mit', '--author', 'Ivan', '--year', '2026'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(first.code, 0, first.output);
  assert.match(fs.readFileSync(path.join(ctx.dir, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 Ivan/);

  const declined = await runCli(['license', '--type', 'isc', '--author', 'Ivan'], { cwd: ctx.dir, home: ctx.home, input: 'n\n' });
  assert.match(declined.output, /Операция отменена/);
  assert.match(fs.readFileSync(path.join(ctx.dir, 'LICENSE'), 'utf8'), /MIT License/);

  const forced = await runCli(['license', '--type', 'isc', '--author', 'Ivan', '--force'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(forced.code, 0);
  assert.match(fs.readFileSync(path.join(ctx.dir, 'LICENSE'), 'utf8'), /ISC License/);

  const menu = await runCli(['license', '--author', 'Ivan', '--force'], { cwd: ctx.dir, home: ctx.home, input: '5\n' });
  assert.equal(menu.code, 0, menu.output);
  assert.match(fs.readFileSync(path.join(ctx.dir, 'LICENSE'), 'utf8'), /ISC License/);

  const bad = await runCli(['license', '--type', 'wtfpl'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(bad.code, 1);
  assert.match(bad.output, /Неизвестный тип лицензии/);
});

test('readme: generates README.md from the repository and protects an existing one', async () => {
  const ctx = setup({
    'package.json': JSON.stringify({ description: 'Demo site', dependencies: { react: '1' }, scripts: { dev: 'vite', build: 'vite build' } }),
    'src/main.jsx': 'console.log(1)\n',
  });
  fs.rmSync(path.join(ctx.dir, 'README.md'));
  const created = await runCli(['readme', '--lang', 'en'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(created.code, 0, created.output);
  const text = fs.readFileSync(path.join(ctx.dir, 'README.md'), 'utf8');
  assert.match(text, /^# work\n\nDemo site/);
  assert.match(text, /## Features\n\n- First feature\n- Second feature/);
  assert.match(text, /npm run dev/);
  assert.match(text, /git clone .*origin\.git/);

  fs.writeFileSync(path.join(ctx.dir, 'README.md'), 'mine\n');
  const kept = await runCli(['readme'], { cwd: ctx.dir, home: ctx.home, input: 'n\n' });
  assert.match(kept.output, /Операция отменена/);
  assert.equal(fs.readFileSync(path.join(ctx.dir, 'README.md'), 'utf8'), 'mine\n');
});

test('issue: builds a structured issue and creates it through gh', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const ctx = setup({});
  const result = await runCli(['issue', 'Login button does nothing', '--yes'], { cwd: ctx.dir, home: ctx.home, gh });
  assert.equal(result.code, 0, result.output);
  const call = gh.calls().find((l) => l.startsWith('issue create'));
  assert.match(call, /--title Login button is broken --body-file - --label bug/);
  assert.match(gh.body('issue'), /## Description/);
  assert.match(result.output, /issues\/1/);
});

test('issue: retries without labels when the repository lacks them', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const ctx = setup({});
  const result = await runCli(['issue', 'Something', '--yes'], { cwd: ctx.dir, home: ctx.home, gh, env: { GH_FAIL_LABEL: '1' } });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Повторная попытка без меток/);
  assert.equal(gh.calls().filter((l) => l.startsWith('issue create')).length, 2);
});

test('issue: dry-run prints the issue without creating it', async () => {
  const ctx = setup({});
  const result = await runCli(['issue', 'Add dark theme', '--dry-run'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Login button is broken/);
  assert.match(result.output, /issue не создан/);
});

test('doctor: a capable model passes calibration, a sloppy one is flagged', async () => {
  const ctx = setup({});
  const good = await runCli(['doctor', '--lang', 'en'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(good.code, 0, good.output);
  assert.equal((good.output.match(/PASS/g) ?? []).length, 5, good.output);
  assert.match(good.output, /подходит для тем коммитов/);

  const lazy = await startMockLlm(() => 'ok');
  try {
    const home = tmp('aigf-home-');
    writeConfig(home, lazy);
    const bad = await runCli(['doctor'], { cwd: ctx.dir, home });
    assert.equal(bad.code, 0);
    assert.match(bad.output, /FAIL/);
    assert.match(bad.output, /плохо справляется с темами коммитов/);
    assert.match(bad.output, /нужна модель сильнее/);
  } finally {
    await lazy.close();
  }
});

test('doctor --quick only checks connectivity', async () => {
  const ctx = setup({});
  const before = mock.requests.length;
  const result = await runCli(['doctor', '--quick'], { cwd: ctx.dir, home: ctx.home });
  assert.equal(result.code, 0, result.output);
  assert.equal(mock.requests.length, before, 'no model calls for an OpenAI-compatible provider');
});

test('init --yes configures a custom OpenAI-compatible provider non-interactively', async () => {
  const home = tmp('aigf-home-');
  const result = await runCli(
    ['init', '--provider', 'mycloud', '--base-url', `${mock.url}/v1`, '--small-model', 'tiny', '--large-model', 'big', '--lang', 'ru', '--yes', '--quick'],
    { home, env: { AIGF_MYCLOUD_KEY: 'secret' } },
  );
  assert.equal(result.code, 0, result.output);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(config.provider, 'mycloud');
  assert.deepEqual(config.providers.mycloud.models, { small: 'tiny', large: 'big' });
  assert.equal(config.providers.mycloud.baseUrl, `${mock.url}/v1`);
  assert.equal(config.defaults.lang, 'ru');
  assert.equal(fs.existsSync(path.join(home, 'credentials.json')), false, 'a key from the environment is never copied to disk');
});

test('init --yes sets up GigaChat against a mock OAuth server and runs calibration', async () => {
  const home = tmp('aigf-home-');
  const before = mock.requests.length;
  const result = await runCli(
    ['init', '--provider', 'gigachat', '--base-url', `${mock.url}/api/v1`, '--auth-url', `${mock.url}/api/v2/oauth`, '--yes'],
    { home, env: { GIGACHAT_AUTH_KEY: 'BASE64KEY' } },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal((result.output.match(/PASS/g) ?? []).length, 5, result.output);
  const mine = mock.requests.slice(before);
  assert.ok(mine.some((r) => r.url.endsWith('/oauth') && r.headers.authorization === 'Basic BASE64KEY'));
  const chat = mine.find((r) => r.url.endsWith('/chat/completions'));
  assert.equal(chat.headers.authorization, 'Bearer tok-123');
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(config.provider, 'gigachat');
  assert.deepEqual(config.providers.gigachat.models, { small: 'GigaChat-2', large: 'GigaChat-2-Pro' });
});

test('init: the interactive wizard can add a custom provider and pick models from the list', async () => {
  const home = tmp('aigf-home-');
  const input = ['8', 'myserver', `${mock.url}/v1`, 'n', '1', '', 'ru', 'n', ''].join('\n');
  const result = await runCli(['init'], { home, input });
  assert.equal(result.code, 0, result.output);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(config.provider, 'myserver');
  assert.equal(config.providers.myserver.needsKey, false);
  assert.deepEqual(config.providers.myserver.models, { small: 'model-a', large: 'model-a' });
  assert.equal(config.defaults.lang, 'ru');
});

test('provider and config commands manage settings', async () => {
  const ctx = setup({});
  const list = await runCli(['provider', 'list'], { cwd: ctx.dir, home: ctx.home });
  assert.match(list.output, /\* mock/);
  assert.match(list.output, /gigachat/);

  const models = await runCli(['provider', 'models'], { cwd: ctx.dir, home: ctx.home });
  assert.match(models.output, /model-a\nmodel-b/);

  const key = await runCli(['provider', 'key', 'gigachat'], { home: ctx.home, input: 'NEWKEY\n' });
  assert.equal(key.code, 0, key.output);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.home, 'credentials.json'), 'utf8')).gigachat, 'NEWKEY');

  const use = await runCli(['provider', 'use', 'gigachat'], { home: ctx.home });
  assert.equal(use.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.home, 'config.json'), 'utf8')).provider, 'gigachat');

  const bad = await runCli(['provider', 'use', 'nope'], { home: ctx.home });
  assert.equal(bad.code, 1);

  const set = await runCli(['config', 'set', 'lang', 'ru'], { home: ctx.home });
  assert.equal(set.code, 0, set.output);
  const show = await runCli(['config', 'show'], { home: ctx.home });
  assert.match(show.output, /"lang": "ru"/);
  const invalid = await runCli(['config', 'set', 'lang', 'xx'], { home: ctx.home });
  assert.equal(invalid.code, 1);
  const unset = await runCli(['config', 'unset', 'lang'], { home: ctx.home });
  assert.match(unset.output, /сброшен/);
});

test('cli: version, help and unknown commands', async () => {
  const home = tmp('aigf-home-');
  const version = await runCli(['--version'], { home });
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  const help = await runCli(['help'], { home });
  assert.match(help.stdout, /--stay/);
  assert.match(help.stdout, /readme/);
  const unknown = await runCli(['frobnicate'], { home });
  assert.equal(unknown.code, 1);
  assert.match(unknown.output, /Неизвестная команда/);
  const flag = await runCli(['--nonsense'], { home });
  assert.equal(flag.code, 1);
});

test('default answers of the mock follow the formats the parsers expect', () => {
  assert.match(defaultAnswer('one-line commit message'), /^Feat:/);
});

test('commit --deep-pr sends the diff and adds checks and notes to the PR body', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const deepMock = await startMockLlm((prompt) => {
    if (prompt.includes('Write the pull request text')) {
      return prompt.includes('CHECKS:')
        ? 'TITLE: feat: add navigation\nDONE:\n- adds the navigation menu\n- updates the home page\nCHECKS:\n- open the home page on a phone width\nNOTES:\n- the old menu class is removed'
        : 'TITLE: feat: add navigation\nDONE:\n- adds the navigation menu\n- updates the home page';
    }
    return defaultAnswer(prompt);
  });
  try {
    const repo = makeRepo(undefined, {});
    const home = tmp('aiflow-home-');
    writeConfig(home, deepMock);
    writeFiles(repo.dir, FEATURE_FILES);
    const result = await runCli(['--branch', 'feat/deep', '--yes', '--deep-pr', '--lang', 'en'], { cwd: repo.dir, home, gh });
    assert.equal(result.code, 0, result.output);
    const prRequest = deepMock.requests.filter((r) => r.url.endsWith('/chat/completions')).find((r) => r.raw.includes('CHECKS:'));
    assert.ok(prRequest, 'the deep request includes the CHECKS layout');
    assert.match(prRequest.raw, /Diff:/);
    const body = gh.body('pr');
    assert.match(body, /## What changed\n\n- adds the navigation menu/);
    assert.match(body, /## How to test\n\n```bash\nnpm install\n```\n\n- \[ \] open the home page on a phone width/);
    assert.match(body, /## Notes\n\n- the old menu class is removed/);
  } finally {
    await deepMock.close();
  }
});

test('--ui-lang en switches the interface to English while generated texts keep their language', async () => {
  const home = tmp('aiflow-home-');
  const help = await runCli(['--help', '--ui-lang', 'en'], { home });
  assert.match(help.stdout, /Usage: aigf \[command\] \[options\]/);
  assert.match(help.stdout, /--deep-pr/);

  const ru = await runCli(['--help', '--ui-lang', 'ru'], { home });
  assert.match(ru.stdout, /Использование: aigf/);

  const ctx = makeRepo(undefined, { withRemote: false });
  writeFiles(ctx.dir, { 'style.css': 'g {}\n' });
  const langHome = tmp('aiflow-home-');
  writeConfig(langHome, mock);
  const result = await runCli(['--dry-run', '--ui-lang', 'en', '--lang', 'ru'], { cwd: ctx.dir, home: langHome });
  assert.match(result.output, /Commit plan/);
  assert.match(result.output, /Dry run: nothing was changed/);
  assert.doesNotMatch(result.output, /План коммитов/);
});


// ---------------------------------------------------------------------------
// Pull request base branch: main -> dev -> feature must open a PR into dev
// ---------------------------------------------------------------------------

function repoWithDev({ pushDev = true, extraLocalOnDev = false } = {}) {
  const repo = makeRepo(undefined, {});
  git(repo.dir, 'switch', '-q', '-c', 'dev');
  writeFiles(repo.dir, { 'src/earlier/one.js': 'export const one = 1;\n' });
  git(repo.dir, 'add', '-A');
  git(repo.dir, 'commit', '-q', '-m', 'feat: earlier dev work one');
  writeFiles(repo.dir, { 'src/earlier/two.js': 'export const two = 2;\n' });
  git(repo.dir, 'add', '-A');
  git(repo.dir, 'commit', '-q', '-m', 'feat: earlier dev work two');
  if (pushDev) git(repo.dir, 'push', '-q', '-u', 'origin', 'dev');
  if (extraLocalOnDev) {
    writeFiles(repo.dir, { 'src/earlier/three.js': 'export const three = 3;\n' });
    git(repo.dir, 'add', '-A');
    git(repo.dir, 'commit', '-q', '-m', 'feat: unpushed dev work');
  }
  writeFiles(repo.dir, { 'src/components/Nav.jsx': 'export const Nav = () => null;\n', 'style.css': 'nav { color: red }\n' });
  const home = tmp('aiflow-home-');
  return { ...repo, home };
}

const prPromptOf = (server) =>
  server.requests.filter((r) => r.url.endsWith('/chat/completions')).map((r) => r.raw).find((raw) => raw.includes('Write the pull request text'));

test('PR: a feature branch created from dev opens the pull request into dev, not main', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const spy = await startMockLlm();
  try {
    const ctx = repoWithDev();
    writeConfig(ctx.home, spy);
    const result = await runCli(['--branch', 'feat/nav', '--yes'], { cwd: ctx.dir, home: ctx.home, gh });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Pull request будет создан в dev/);

    const create = gh.calls().find((line) => line.startsWith('pr create'));
    assert.match(create, /--base dev --head feat\/nav/, create);
    assert.doesNotMatch(create, /--base main/);

    const prompt = prPromptOf(spy);
    assert.ok(prompt, 'the model was asked for the PR text');
    assert.match(prompt, /feat\(components\): add new component/);
    assert.match(prompt, /style: update things/);
    assert.doesNotMatch(prompt, /earlier dev work/, 'commits already on dev are not described');
  } finally {
    await spy.close();
  }
});

test('PR: when dev only exists locally the PR is not created against a wrong branch', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const ctx = repoWithDev({ pushDev: false });
  writeConfig(ctx.home, mock);
  const result = await runCli(['--branch', 'feat/nav', '--yes'], { cwd: ctx.dir, home: ctx.home, gh });
  assert.equal(result.code, 0, result.output);
  assert.equal(gh.calls().some((l) => l.startsWith('pr create')), false, 'no PR is opened against a missing branch');
  assert.match(result.output, /Ветки dev нет на origin/);
  assert.match(result.output, /git push -u origin dev/);
  assert.match(result.output, /Текст pull request для ручного создания/);
});

test('PR: warns when local dev is ahead of the remote dev', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const ctx = repoWithDev({ extraLocalOnDev: true });
  writeConfig(ctx.home, mock);
  const result = await runCli(['--branch', 'feat/nav', '--yes'], { cwd: ctx.dir, home: ctx.home, gh });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Локальная dev опережает origin\/dev на 1/);
  assert.match(gh.calls().find((l) => l.startsWith('pr create')), /--base dev/);
});

test('PR: an explicit --base overrides the starting branch and describes what GitHub will show', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const spy = await startMockLlm();
  try {
    const ctx = repoWithDev();
    writeConfig(ctx.home, spy);
    const result = await runCli(['--branch', 'feat/nav', '--yes', '--base', 'main'], { cwd: ctx.dir, home: ctx.home, gh });
    assert.equal(result.code, 0, result.output);
    assert.match(gh.calls().find((l) => l.startsWith('pr create')), /--base main --head feat\/nav/);
    assert.match(prPromptOf(spy), /earlier dev work/, 'against main, GitHub shows the dev commits too, so the text includes them');
  } finally {
    await spy.close();
  }
});

test('PR: starting from main still targets main', { skip: skipGh }, async () => {
  const gh = makeFakeGh();
  const ctx = setup({ 'style.css': 'x {}\n' });
  const result = await runCli(['--branch', 'feat/plain', '--yes'], { cwd: ctx.dir, home: ctx.home, gh });
  assert.equal(result.code, 0, result.output);
  assert.match(gh.calls().find((l) => l.startsWith('pr create')), /--base main --head feat\/plain/);
});
