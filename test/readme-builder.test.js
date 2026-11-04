import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildReadme, excerpts, formatTree, projectInfo, sanitizeRemote } from '../src/readme-builder.js';
import { tmp, writeFiles } from './helpers.js';

const files = ['package.json', 'package-lock.json', 'index.html', 'src/main.jsx', 'src/App.jsx', 'src/components/Nav.jsx', 'src/components/deep/Item.jsx', 'public/logo.png', 'LICENSE', '.github/workflows/ci.yml'];

test('formatTree renders two levels and skips lock files', () => {
  const tree = formatTree(files);
  assert.match(tree, /^\./);
  assert.match(tree, /src\//);
  assert.match(tree, /components\//);
  assert.doesNotMatch(tree, /package-lock/);
  assert.doesNotMatch(tree, /Item\.jsx/);
});

test('projectInfo detects stack and commands from package.json', () => {
  const root = tmp('aigf-pkg-');
  writeFiles(root, {
    'package.json': JSON.stringify({
      description: 'A demo site',
      dependencies: { react: '^18', swiper: '^11' },
      devDependencies: { vite: '^5', typescript: '^5' },
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest', lint: 'eslint .' },
    }),
  });
  const info = projectInfo(root, files);
  assert.equal(info.description, 'A demo site');
  assert.deepEqual(info.install, ['npm install']);
  assert.deepEqual(info.usage.map((u) => u.command), ['npm run dev', 'npm run build', 'npm test', 'npm run lint']);
  for (const item of ['React', 'Vite', 'TypeScript', 'Swiper', 'GitHub Actions']) assert.ok(info.stack.includes(item), item);
  assert.ok(info.stack.includes('JavaScript'));
});

test('projectInfo falls back to a static site', () => {
  const info = projectInfo('/x/site', ['index.html', 'style.css']);
  assert.deepEqual(info.usage, [{ labelKey: 'OpenHtml', command: '' }]);
  assert.ok(info.stack.includes('HTML'));
});

test('sanitizeRemote strips credentials', () => {
  assert.equal(sanitizeRemote('https://user:token@github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.equal(sanitizeRemote('git@github.com:a/b.git'), 'git@github.com:a/b.git');
});

test('excerpts never read env files', () => {
  const root = tmp('aigf-ex-');
  writeFiles(root, { 'index.html': '<h1>hi</h1>', '.env': 'SECRET=1', 'src/main.js': 'console.log(1)' });
  const text = excerpts(root, ['index.html', '.env', 'src/main.js']);
  assert.match(text, /index\.html/);
  assert.doesNotMatch(text, /SECRET/);
});

test('buildReadme assembles sections in the requested language', () => {
  const root = tmp('aigf-rd-');
  writeFiles(root, { LICENSE: 'MIT License\n\nCopyright' });
  const info = { name: 'demo', description: null, stack: ['React'], prereqs: ['Node.js (LTS)'], install: ['npm install'], usage: [{ labelKey: 'Dev', command: 'npm run dev' }] };
  const text = buildReadme({
    info, narrative: { description: 'Модель говорит.', features: ['Раз', 'Два'] }, tree: '.\n└── a', files: ['LICENSE'], root,
    remote: 'https://tok@github.com/a/demo.git', lang: 'ru',
  });
  assert.match(text, /^# demo\n\nМодель говорит\./);
  assert.match(text, /## Возможности\n\n- Раз\n- Два/);
  assert.match(text, /git clone https:\/\/github\.com\/a\/demo\.git/);
  assert.match(text, /Запуск в режиме разработки: `npm run dev`/);
  assert.match(text, /Распространяется под лицензией MIT License/);
  assert.doesNotMatch(text, /tok@/);
  const en = buildReadme({ info, narrative: { description: null, features: [] }, tree: '.', files: [], root, remote: null, lang: 'en' });
  assert.match(en, /The demo project\./);
  assert.doesNotMatch(en, /## Features/);
  assert.ok(fs.existsSync(path.join(root, 'LICENSE')));
});
