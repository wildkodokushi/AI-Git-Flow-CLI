import fs from 'node:fs';
import path from 'node:path';

const LANGUAGE_BY_EXTENSION = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
  '.vue': 'Vue', '.py': 'Python', '.cs': 'C#', '.php': 'PHP', '.java': 'Java', '.go': 'Go', '.rs': 'Rust',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'Sass', '.sass': 'Sass', '.sql': 'SQL', '.ps1': 'PowerShell',
};

const NPM_STACK = {
  react: 'React', vue: 'Vue', svelte: 'Svelte', '@angular/core': 'Angular', next: 'Next.js', nuxt: 'Nuxt',
  typescript: 'TypeScript', vite: 'Vite', webpack: 'webpack', express: 'Express', tailwindcss: 'Tailwind CSS',
  sass: 'Sass', 'react-router-dom': 'React Router', pinia: 'Pinia', vuex: 'Vuex', '@reduxjs/toolkit': 'Redux Toolkit',
  redux: 'Redux', axios: 'Axios', swiper: 'Swiper', three: 'Three.js', vitest: 'Vitest', jest: 'Jest',
  eslint: 'ESLint', prettier: 'Prettier',
};

const SKIP_IN_TREE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock|Cargo\.lock|go\.sum|\.gitattributes)$/;

/** Plain-text tree limited to two levels so that it stays readable in a README. */
export function formatTree(files) {
  const tee = '\u251C\u2500\u2500 ';
  const elbow = '\u2514\u2500\u2500 ';
  const pipe = '\u2502   ';

  const top = new Map();
  for (const file of files.filter((f) => !SKIP_IN_TREE.test(f))) {
    const parts = file.split('/');
    const first = parts[0];
    if (parts.length === 1) {
      if (!top.has(first)) top.set(first, null);
      continue;
    }
    if (!top.get(first)) top.set(first, new Set());
    top.get(first).add(parts.length > 2 ? `${parts[1]}/` : parts[1]);
  }

  const names = [...top.keys()].sort((a, b) => Number(top.get(a) === null) - Number(top.get(b) === null) || a.localeCompare(b));
  const lines = ['.'];
  const limit = 25;
  const shown = names.slice(0, limit);
  shown.forEach((name, i) => {
    const last = i === shown.length - 1 && names.length <= limit;
    const children = top.get(name);
    if (children === null) {
      lines.push(`${last ? elbow : tee}${name}`);
      return;
    }
    lines.push(`${last ? elbow : tee}${name}/`);
    const prefix = last ? '    ' : pipe;
    const sorted = [...children].sort((a, b) => Number(!a.endsWith('/')) - Number(!b.endsWith('/')) || a.localeCompare(b));
    const childShown = sorted.slice(0, 8);
    childShown.forEach((child, j) => {
      const childLast = j === childShown.length - 1 && sorted.length <= 8;
      lines.push(`${prefix}${childLast ? elbow : tee}${child}`);
    });
    if (sorted.length > 8) lines.push(`${prefix}${elbow}...`);
  });
  if (names.length > limit) lines.push(`${elbow}...`);
  return lines.join('\n');
}

export function projectInfo(root, files) {
  const has = (name) => files.includes(name);
  const stack = [];
  const prereqs = [];
  const install = [];
  const usage = [];
  let description = null;

  const counts = new Map();
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name);

  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      if (pkg.description) description = String(pkg.description);
      const deps = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
      for (const [dep, label] of Object.entries(NPM_STACK)) if (deps.has(dep)) stack.push(label);

      const manager = has('yarn.lock') ? 'yarn' : has('pnpm-lock.yaml') ? 'pnpm' : 'npm';
      prereqs.push('Node.js (LTS)');
      install.push(`${manager} install`);
      const scripts = Object.keys(pkg.scripts ?? {});
      const wanted = [
        ['Dev', ['dev', 'start', 'serve']],
        ['Build', ['build']],
        ['Test', ['test']],
        ['Lint', ['lint']],
      ];
      for (const [labelKey, names] of wanted) {
        const found = names.find((n) => scripts.includes(n));
        if (!found) continue;
        let command;
        if (manager === 'npm') command = found === 'start' || found === 'test' ? `npm ${found}` : `npm run ${found}`;
        else command = `${manager} ${found}`;
        usage.push({ labelKey, command });
      }
    } catch {
      // Invalid package.json: fall back to file based detection.
    }
  }
  if (has('requirements.txt')) {
    prereqs.push('Python 3');
    install.push('pip install -r requirements.txt');
  }
  const entry = ['main.py', 'app.py'].find(has);
  if (entry) usage.push({ labelKey: 'Run', command: `python ${entry}` });
  if (files.some((f) => /\.(csproj|sln)$/.test(f))) {
    prereqs.push('.NET SDK');
    install.push('dotnet restore');
    usage.push({ labelKey: 'Build', command: 'dotnet build' }, { labelKey: 'Run', command: 'dotnet run' });
  }
  if (has('composer.json')) {
    prereqs.push('PHP, Composer');
    install.push('composer install');
  }
  if (usage.length === 0 && install.length === 0 && has('index.html')) usage.push({ labelKey: 'OpenHtml', command: '' });
  if (files.some((f) => /(^|\/)dockerfile/i.test(f))) stack.push('Docker');
  if (files.some((f) => f.startsWith('.github/workflows/'))) stack.push('GitHub Actions');

  const combined = [...new Set([...languages, ...stack])].slice(0, 12);
  return { name: path.basename(root), description, stack: combined, prereqs, install, usage };
}

/** A few lines from entry files, never from secrets such as .env. */
export function excerpts(root, files) {
  const patterns = [/^index\.html$/i, /^src\/main\.[a-z]+$/i, /^src\/index\.[a-z]+$/i, /^src\/App\.[a-z]+$/i, /^(main|app)\.py$/i, /^(index|server|app)\.js$/i, /^Program\.cs$/i];
  const chosen = [];
  for (const pattern of patterns) {
    if (chosen.length >= 3) break;
    const match = files.find((f) => pattern.test(f));
    if (match) chosen.push(match);
  }
  return chosen
    .map((file) => {
      try {
        const text = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).slice(0, 60).join('\n').slice(0, 1500);
        return `--- ${file} ---\n${text}`;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

const STRINGS = {
  ru: {
    Features: 'Возможности', Stack: 'Стек технологий', Start: 'Быстрый старт', Prereq: 'Требования', Install: 'Установка',
    Usage: 'Использование', Structure: 'Структура проекта', License: 'Лицензия', Dev: 'Запуск в режиме разработки',
    Build: 'Сборка', Test: 'Тесты', Lint: 'Проверка кода', Run: 'Запуск', OpenHtml: 'Откройте файл index.html в браузере',
    Licensed: (name, file) => `Распространяется под лицензией ${name}. Подробности в файле [${file}](${file}).`,
    LicenseRef: (file) => `Подробности в файле [${file}](${file}).`,
    Fallback: (name) => `Проект ${name}.`,
  },
  en: {
    Features: 'Features', Stack: 'Tech stack', Start: 'Getting started', Prereq: 'Prerequisites', Install: 'Installation',
    Usage: 'Usage', Structure: 'Project structure', License: 'License', Dev: 'Development server', Build: 'Build',
    Test: 'Tests', Lint: 'Linting', Run: 'Run', OpenHtml: 'Open index.html in a browser',
    Licensed: (name, file) => `Distributed under the ${name}. See [${file}](${file}) for details.`,
    LicenseRef: (file) => `See [${file}](${file}) for details.`,
    Fallback: (name) => `The ${name} project.`,
  },
};

/** Credentials embedded in a remote URL must never reach a public README. */
export const sanitizeRemote = (url) => url.replace(/(?<=\/\/)[^/@]+@/, '');

export function buildReadme({ info, narrative, tree, files, root, remote, lang }) {
  const s = STRINGS[lang] ?? STRINGS.en;
  const out = [`# ${info.name}`, ''];
  out.push(info.description?.trim() || narrative.description?.trim() || s.Fallback(info.name), '');

  if (narrative.features?.length) {
    out.push(`## ${s.Features}`, '', ...narrative.features.map((f) => `- ${f}`), '');
  }
  if (info.stack.length) out.push(`## ${s.Stack}`, '', ...info.stack.map((item) => `- ${item}`), '');

  const cloneUrl = remote ? sanitizeRemote(remote) : null;
  if (info.install.length || info.usage.length) {
    out.push(`## ${s.Start}`, '');
    if (info.prereqs.length) out.push(`### ${s.Prereq}`, '', '- Git', ...info.prereqs.map((p) => `- ${p}`), '');
    if (cloneUrl || info.install.length) {
      out.push(`### ${s.Install}`, '', '```bash');
      if (cloneUrl) out.push(`git clone ${cloneUrl}`, `cd ${path.basename(root)}`);
      out.push(...info.install, '```', '');
    }
    if (info.usage.length) {
      out.push(`### ${s.Usage}`, '');
      for (const entry of info.usage) {
        out.push(entry.command ? `- ${s[entry.labelKey]}: \`${entry.command}\`` : `- ${s[entry.labelKey]}`);
      }
      out.push('');
    }
  }

  out.push(`## ${s.Structure}`, '', '```text', tree, '```', '');

  const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find((name) => files.includes(name));
  if (licenseFile) {
    out.push(`## ${s.License}`, '');
    let name = null;
    try {
      const first = fs.readFileSync(path.join(root, licenseFile), 'utf8').split(/\r?\n/).find((l) => l.trim())?.trim();
      if (first) name = /unencumbered/i.test(first) ? 'Unlicense' : first.length <= 60 ? first : null;
    } catch {
      // Ignore: the generic reference below is used.
    }
    out.push(name ? s.Licensed(name, licenseFile) : s.LicenseRef(licenseFile), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
