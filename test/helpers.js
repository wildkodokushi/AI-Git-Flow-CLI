import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'aigf.js');
export const tmp = (prefix = 'aigf-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Default behaviour of the fake model: deliberately sloppy (past tense, capital letters) like real models. */
export function defaultAnswer(prompt) {
  if (prompt.includes('Subject language: Russian')) return 'обновить документацию';
  if (prompt.includes('one-line commit message')) return 'Feat: added new component';
  if (prompt.includes('Write only the subject')) return 'Updated things';
  if (prompt.includes('pull request title')) return 'Feat: added stuff\nThis change adds things. It helps the project.';
  if (prompt.includes('README file')) return 'DESCRIPTION: A demo project.\nFEATURES:\n- First feature\n- Second feature';
  if (prompt.includes('GitHub issue')) return 'TYPE: bug\nTITLE: Login button is broken\nBODY:\n## Description\nThe button does nothing.';
  return 'ok';
}

/**
 * Fake OpenAI-compatible server. It also implements the GigaChat OAuth endpoint, so one server
 * is enough to test both provider types over plain http.
 */
export async function startMockLlm(answer = defaultAnswer) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, url: req.url, headers: req.headers, raw });
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url.endsWith('/oauth')) return send(200, { access_token: 'tok-123', expires_at: Date.now() + 1800000 });
      if (req.url.endsWith('/models')) return send(200, { data: [{ id: 'model-b' }, { id: 'model-a' }] });
      if (req.url.endsWith('/chat/completions')) {
        const body = JSON.parse(raw);
        const prompt = body.messages.map((m) => m.content).join('\n');
        const text = typeof answer === 'function' ? answer(prompt, body, requests) : answer;
        if (text && text.status) return send(text.status, text.body ?? { error: 'x' });
        if (text && text.emptyLength) {
          return send(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { total_tokens: 1 } });
        }
        return send(200, {
          choices: [{ message: { content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }
      return send(404, { error: 'not found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function writeConfig(home, mock, extra = {}) {
  fs.mkdirSync(home, { recursive: true });
  const config = {
    provider: 'mock',
    providers: {
      mock: { type: 'openai', baseUrl: `${mock.url}/v1`, needsKey: false, models: { small: 'm-small', large: 'm-large' } },
    },
    defaults: {},
    ...extra,
  };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
}

const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
};
export { git };

/** Creates a repository with an initial commit and a bare "origin" next to it. */
export function makeRepo(initialFiles = { 'README.md': '# demo\n' }, { withRemote = true } = {}) {
  const base = tmp('aigf-repo-');
  const dir = path.join(base, 'work');
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test User');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFiles(dir, initialFiles);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: initial');
  let remote = null;
  if (withRemote) {
    remote = path.join(base, 'origin.git');
    git(base, 'init', '-q', '--bare', '-b', 'main', remote);
    git(dir, 'remote', 'add', 'origin', remote);
    git(dir, 'push', '-q', '-u', 'origin', 'main');
  }
  return { dir, remote, base };
}

export function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** A fake `gh` that records arguments and bodies, so PR and issue creation can be verified. */
export function makeFakeGh() {
  const dir = tmp('aigf-gh-');
  const script = `#!/bin/sh
echo "$@" >> "${dir}/log"
case "$1" in
  --version) echo "gh version 0.0.0"; exit 0;;
  auth) exit 0;;
esac
if [ -n "$GH_FAIL_LABEL" ] && echo "$@" | grep -q -- --label; then
  echo "could not add label: 'bug' not found" >&2
  exit 1
fi
cat > "${dir}/body-$1-$2.txt"
if [ "$1" = "pr" ]; then echo "https://github.com/example/repo/pull/1"; else echo "https://github.com/example/repo/issues/1"; fi
`;
  fs.writeFileSync(path.join(dir, 'gh'), script, { mode: 0o755 });
  return {
    dir,
    calls: () => (fs.existsSync(path.join(dir, 'log')) ? fs.readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n') : []),
    body: (kind) => fs.readFileSync(path.join(dir, `body-${kind}-create.txt`), 'utf8'),
  };
}

export function runCli(args, { cwd, home, input = '', env = {}, gh } = {}) {
  return new Promise((resolve) => {
    const pathParts = [gh ? gh.dir : null, process.env.PATH].filter(Boolean);
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: {
        ...process.env,
        AIGF_HOME: home,
        AIGF_RETRY_DELAY_MS: '0',
        NO_COLOR: '1',
        PATH: pathParts.join(path.delimiter),
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, output: stdout + stderr }));
    child.stdin.end(input);
  });
}
