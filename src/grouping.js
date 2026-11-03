export const META = {
  deps: { type: 'build', scope: 'deps', order: 10 },
  ci: { type: 'ci', scope: null, order: 20 },
  config: { type: 'chore', scope: 'config', order: 30 },
  assets: { type: 'chore', scope: 'assets', order: 40 },
  code: { type: null, scope: null, order: 50 },
  style: { type: 'style', scope: null, order: 60 },
  test: { type: 'test', scope: null, order: 70 },
  docs: { type: 'docs', scope: null, order: 80 },
};

export const LOCK_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock|go\.sum|packages\.lock\.json)$/i;

const DEPS = /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.(json|lock)|requirements.*\.txt|pipfile(\.lock)?|poetry\.lock|pyproject\.toml|go\.(mod|sum)|cargo\.(toml|lock)|gemfile(\.lock)?|packages\.lock\.json|.*\.csproj|.*\.sln)$/;
const CI_NAME = /^(\.gitlab-ci\.yml|dockerfile.*|docker-compose.*|\.dockerignore|jenkinsfile)$/;
const CONFIG = /^(\.gitignore|\.gitattributes|\.editorconfig|\.env\.example|\.nvmrc|\.npmrc|\.babelrc.*|\.eslintrc.*|\.prettierrc.*|tsconfig.*\.json|jsconfig\.json|.*\.config\.(js|cjs|mjs|ts|json))$/;
const DOCS = /\.(md|mdx|rst|txt)$/;
const ASSETS = /\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf)$/;
const STYLES = /\.(css|scss|sass|less|styl)$/;

/** Deterministic classification of a repository path. */
export function categoryOf(filePath) {
  const p = filePath.replaceAll('\\', '/').toLowerCase();
  const name = p.slice(p.lastIndexOf('/') + 1);
  if (DEPS.test(name)) return 'deps';
  if (p.startsWith('.github/') || CI_NAME.test(name)) return 'ci';
  if (CONFIG.test(name)) return 'config';
  if (DOCS.test(name) || /^(license|changelog)/.test(name) || p.startsWith('docs/')) return 'docs';
  if (/(^|\/)(tests?|__tests__|e2e)\//.test(p) || /\.(test|spec)\.[a-z0-9]+$/.test(name)) return 'test';
  if (STYLES.test(name)) return 'style';
  if (ASSETS.test(name)) return 'assets';
  return 'code';
}

/** Source files are grouped by their top-level directories: src/components, src/pages, server ... */
export function codeKey(filePath) {
  const segments = filePath.replaceAll('\\', '/').split('/');
  if (segments.length >= 3) return `${segments[0]}/${segments[1]}`;
  if (segments.length === 2) return segments[0];
  return '.';
}

function createGroup(key, category, scope) {
  return { key, category, scope, order: META[category].order, files: [], paths: [], message: null };
}

/**
 * Builds the ordered list of commit groups from `changes` ({ path, paths }).
 * Source code groups beyond `maxCodeGroups` are merged into one `code:other` group.
 */
export function buildPlan(changes, maxCodeGroups = 5) {
  const map = new Map();
  for (const change of changes) {
    const category = categoryOf(change.path);
    let key = category;
    let scope = META[category].scope;
    if (category === 'code') {
      const ck = codeKey(change.path);
      key = `code:${ck}`;
      scope = ck === '.' ? null : ck.split('/').pop();
      if (scope === 'src') scope = null;
    }
    if (!map.has(key)) map.set(key, createGroup(key, category, scope));
    const group = map.get(key);
    group.files.push(change.path);
    group.paths.push(...change.paths);
  }

  let groups = [...map.values()];
  const codeGroups = groups.filter((g) => g.category === 'code').sort((a, b) => b.files.length - a.files.length);
  if (codeGroups.length > maxCodeGroups) {
    const rest = codeGroups.slice(maxCodeGroups - 1);
    const merged = createGroup('code:other', 'code', null);
    for (const g of rest) {
      merged.files.push(...g.files);
      merged.paths.push(...g.paths);
    }
    groups = [...groups.filter((g) => !rest.includes(g)), merged];
  }
  return groups.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}
