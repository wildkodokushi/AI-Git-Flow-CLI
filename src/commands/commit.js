import { UserError } from '../errors.js';
import {
  changedFiles, currentBranch, defaultBranch, enterRepository, git, gitChecked, refExists, remoteUrl,
} from '../git.js';
import { LOCK_FILE, buildPlan } from '../grouping.js';
import { t } from '../i18n.js';
import { createLlm } from '../llm.js';
import { createPullRequest } from '../pr.js';
import { commitPrompt } from '../prompts.js';
import { buildCommitMessage, fallbackMessage } from '../text.js';
import * as ui from '../ui.js';

const CHUNK = 100;

function addPaths(paths) {
  for (let i = 0; i < paths.length; i += CHUNK) {
    gitChecked(['add', '-A', '--', ...paths.slice(i, i + CHUNK)]);
  }
}

function groupContext(group, maxChars) {
  const paths = group.paths.slice(0, 40);
  const stat = git(['diff', '--cached', '--stat=100', '--', ...paths]).stdout;
  const patchPaths = paths.filter((p) => !LOCK_FILE.test(p));
  if (patchPaths.length === 0) return stat;
  let patch = git(['diff', '--cached', '-U1', '--no-color', '--', ...patchPaths]).stdout;
  if (patch.length > maxChars) patch = `${patch.slice(0, maxChars)}\n[diff truncated]`;
  return `${stat}\n\n${patch}`;
}

function showPlan(plan) {
  ui.section(t('commit.planTitle'));
  plan.forEach((group, index) => {
    ui.print(`${ui.c.gray(String(index + 1).padStart(2))}. ${ui.c.white(group.message)}`);
    for (const file of group.files.slice(0, 6)) ui.print(ui.c.gray(`      ${file}`));
    if (group.files.length > 6) ui.print(ui.c.gray(`      ... +${group.files.length - 6}`));
  });
  ui.print('');
}

/** Returns "." to stay on the current branch, otherwise a valid new branch name. */
async function resolveBranch(requested, current) {
  let name = requested;
  const interactive = requested === undefined;
  for (;;) {
    if (name === undefined || name === '') {
      ui.print(ui.c.gray(t('commit.currentBranch', { branch: current })));
      name = await ui.ask(t('commit.branchPrompt'));
      if (!name) throw new UserError(t('commit.branchMissing'));
    }
    name = name.trim();
    if (name === '.') return '.';

    const problem =
      git(['check-ref-format', '--branch', name]).code !== 0
        ? t('commit.invalidBranch', { name })
        : refExists(`refs/heads/${name}`)
          ? t('commit.branchExists', { name })
          : null;
    if (!problem) return name;
    if (!interactive) throw new UserError(problem);
    ui.warn(problem);
    name = undefined;
  }
}

export async function commitCommand(opts, config) {
  ui.banner(t('banner.commit'));
  enterRepository();

  ui.section(t('commit.section.analyse'));
  const changes = changedFiles();
  if (changes.length === 0) {
    ui.ok(t('commit.nothing'));
    return 0;
  }
  ui.info(t('commit.changedFiles', { count: changes.length }));

  const startBranch = currentBranch();
  const startCommit = git(['rev-parse', 'HEAD']).stdout.trim() || null;
  // A pull request goes back to the branch the new one is created from (main -> dev -> feature opens a PR into dev).
  // Detached HEAD has no branch to return to, so the remote default branch is used.
  const base = opts.base || (startBranch !== 'HEAD' ? startBranch : defaultBranch(opts.remote, startBranch));

  const llm = createLlm(opts, config);
  ui.info(t('commit.provider', { name: llm.name, model: llm.models.small }));
  await llm.ready();
  ui.ok(t('commit.connected'));

  ui.section(t('commit.section.plan'));
  const plan = buildPlan(changes, opts.maxCodeGroups);
  ui.info(t('commit.groups', { count: plan.length }));

  // The index is rebuilt per group during execution; here it only serves diff generation.
  gitChecked(['reset', '-q']);
  gitChecked(['add', '-A']);
  try {
    let number = 1;
    for (const group of plan) {
      ui.info(t('commit.messageProgress', { index: number, count: plan.length, key: group.key }));
      number += 1;
      try {
        const prompt = commitPrompt(group, groupContext(group, opts.maxDiffChars), opts.lang);
        const answer = await llm.ask({ ...prompt, tier: 'small', maxTokens: 80 });
        group.message = buildCommitMessage(group, answer, opts.lang);
      } catch (error) {
        ui.warn(t('commit.messageFailed', { key: group.key, error: error.message }));
        group.message = fallbackMessage(group);
      }
    }
  } finally {
    git(['reset', '-q']);
  }
  showPlan(plan);

  if (opts.dryRun) {
    ui.info(t('commit.dryRun'));
    return 0;
  }
  if (!opts.yes && !(await ui.confirm(t('commit.applyPlan')))) {
    ui.info(t('common.cancelled'));
    return 0;
  }

  ui.section(t('commit.section.branch'));
  const choice = opts.stay ? '.' : await resolveBranch(opts.branch, startBranch);
  const stay = choice === '.';
  let branch;
  if (stay) {
    if (startBranch === 'HEAD') throw new UserError(t('commit.detached'));
    branch = startBranch;
    ui.info(t('commit.staying', { branch }));
  } else {
    branch = choice;
    gitChecked(['switch', '-c', branch]);
    ui.ok(t('commit.created', { branch }));
    if (!opts.noPr && !opts.noPush) ui.info(t('commit.prBase', { base }));
  }

  ui.section(t('commit.section.commits'));
  let created = 0;
  for (const group of plan) {
    addPaths(group.paths);
    const result = git(['commit', '-q', '-F', '-'], { input: `${group.message}\n` });
    if (result.code !== 0) {
      const text = `${result.stdout}\n${result.stderr}`;
      if (/nothing (added )?to commit|no changes added/.test(text)) {
        ui.warn(t('commit.skipped', { message: group.message }));
        continue;
      }
      throw new UserError(t('commit.failed', { message: group.message, details: text.trim() }));
    }
    created += 1;
    ui.ok(group.message);
  }
  const left = changedFiles();
  if (left.length > 0) ui.warn(t('commit.leftover', { count: left.length }));

  if (opts.noPush) {
    ui.info(t('commit.pushSkipped'));
  } else if (!remoteUrl(opts.remote)) {
    ui.warn(t('commit.noRemote', { remote: opts.remote }));
  } else {
    ui.section(t('commit.section.push'));
    gitChecked(['push', '-u', opts.remote, branch]);
    ui.ok(t('commit.pushed', { branch, remote: opts.remote }));
    if (stay) ui.info(t('commit.noPrOnCurrent'));
    else if (!opts.noPr) await createPullRequest({ llm, opts, branch, base, fromCommit: base === startBranch ? startCommit : null });
  }

  ui.section(t('commit.section.summary'));
  ui.info(t('commit.summaryBranch', { branch }));
  ui.info(t('commit.summaryCount', { count: created }));
  if (llm.usage.requests > 0) {
    ui.info(t('commit.summaryUsage', {
      requests: llm.usage.requests,
      tokens: llm.usage.total || t('commit.noData'),
    }));
  }
  return 0;
}
