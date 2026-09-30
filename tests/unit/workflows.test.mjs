// Static checks of the GitHub Actions workflows (architecture 3.14): minimal permissions, official actions
// pinned to full commit SHAs, no expressions inside shell scripts, no user-controlled values anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";

const DIR = path.join(REPO_ROOT, ".github/workflows");
const PINS = {
  "actions/checkout": ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"],
  "actions/setup-node": ["820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"],
  "actions/github-script": ["3a2844b7e9c422d3c10d287c895573f7108da1b3", "v9.0.0"],
  "actions/upload-pages-artifact": ["fc324d3547104276b827a68afc52ff2a11cc49c9", "v5.0.0"],
  "actions/deploy-pages": ["368f82528645a54fb793d4d04e342629a3f51346", "v5.0.1"],
};
const REUSABLE = "./.github/workflows/_deploy-pages.yml";

const names = (await readdir(DIR)).filter((n) => n.endsWith(".yml")).sort();
const workflows = Object.fromEntries(await Promise.all(names.map(async (n) => [n, (await readFile(path.join(DIR, n), "utf8")).replace(/\r\n/g, "\n")])));

/** Every run: script (single line or block) with its first line number. */
function runScripts(yaml) {
  const lines = yaml.split("\n");
  const scripts = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (!m) return;
    if (!/^[|>]/.test(m[2])) {
      scripts.push({ line: i + 1, text: m[2] });
      return;
    }
    const indent = m[1].length + (line.trimStart().startsWith("-") ? 2 : 0);
    const body = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > indent); j += 1) body.push(lines[j]);
    scripts.push({ line: i + 1, text: body.join("\n") });
  });
  return scripts;
}

const expressions = (yaml) => [...new Set([...yaml.matchAll(/\$\{\{[^}]*\}\}/g)].map((m) => m[0]))].sort();

/** The jobs of a workflow as { name, text } (text: the job's lines, header included). */
function jobsOf(yaml) {
  const body = yaml.slice(yaml.search(/^jobs:$/m));
  return [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\n((?: {4}.*\n|\n)*)/gm)].map(([text, name]) => ({ name, text }));
}

/** The steps of a job (text after "- "), comment lines left out. */
const stepsOf = (jobText) => jobText.replace(/^ *#.*\n/gm, "").split(/^ {6}- /m).slice(1);

/**
 * The push loop of the Issue Forms writer: a rejected push moves only the one forms commit onto the remote
 * head (its parent must be part of the remote), and afterwards exactly that commit, touching nothing but
 * .github/ISSUE_TEMPLATE/, may be ahead of the remote.
 */
function assertFormsPushLoop(step) {
  const order = [
    "remote=refs/remotes/origin/Source_Code",
    "for attempt in 1 2 3 4; do",
    "push origin HEAD:refs/heads/Source_Code; then",
    "fetch origin +refs/heads/Source_Code:$remote",
    'merge-base --is-ancestor HEAD~1 "$remote"; then',
    'rebase --onto "$remote" HEAD~1; then',
    "rebase --abort",
    'rev-list --count "$remote..HEAD"',
    'if [ "$ahead" = 0 ]; then',
    'diff --name-only "$remote" HEAD',
    String.raw`if [ "$ahead" != 1 ] || [ -z "$changed" ] || printf '%s\n' "$changed" | grep -qv '^\.github/ISSUE_TEMPLATE/[^/]*$'; then`,
  ];
  const positions = order.map((s) => step.indexOf(s));
  assert.ok(positions.every((p, i) => p > (positions[i - 1] ?? -1)), JSON.stringify(positions));
  assert.doesNotMatch(step, /rebase refs\/remotes|rebase "\$remote"\n|reset --hard|gen-issue-forms/);
}

test("the four workflows exist", () => {
  for (const name of ["_deploy-pages.yml", "apply-approved.yml", "publish.yml", "validate-issue.yml"]) assert.ok(names.includes(name), name);
});

test("every workflow: no default permissions, pinned official actions or the local reusable workflow", () => {
  for (const [name, yaml] of Object.entries(workflows)) {
    assert.match(yaml, /^permissions: \{\}$/m, name);
    for (const [, target, comment] of yaml.matchAll(/uses: (\S+)(.*)$/gm)) {
      if (target === REUSABLE) continue;
      const [action, sha] = target.split("@");
      assert.ok(PINS[action], `${name}: ${action} is not an allowed action`);
      assert.equal(sha, PINS[action][0], `${name}: ${action} pin`);
      assert.equal(comment, ` # ${PINS[action][1]}`, `${name}: ${action} version comment`);
    }
    assert.doesNotMatch(yaml, /configure-pages/, name);
  }
});

test("every job runs on the pinned ubuntu-24.04 image (ubuntu-latest moves to a new release on its own)", () => {
  let runners = 0;
  for (const [name, yaml] of Object.entries(workflows)) {
    assert.doesNotMatch(yaml, /ubuntu-latest/, name);
    const jobs = jobsOf(yaml);
    assert.ok(jobs.length > 0, `${name}: jobs are found`);
    for (const job of jobs) {
      if (/^ {4}uses: /m.test(job.text)) continue; // a reusable workflow call has no runner of its own
      assert.match(job.text, /^ {4}runs-on: ubuntu-24\.04\n/m, `${name}: ${job.name}`);
      runners += 1;
    }
    assert.equal([...yaml.matchAll(/runs-on:/g)].length, jobs.filter((j) => !/^ {4}uses: /m.test(j.text)).length, `${name}: one runs-on per job`);
  }
  assert.equal(runners, 9);
});

test("every workflow: shell scripts contain no expressions and no Issue or comment content is referenced", () => {
  for (const [name, yaml] of Object.entries(workflows)) {
    assert.ok(runScripts(yaml).length > 0, `${name}: run steps are found`);
    for (const script of runScripts(yaml)) assert.ok(!script.text.includes("${{"), `${name}:${script.line} run: contains an expression`);
    assert.doesNotMatch(yaml, /github\.event\.(issue\.(title|body|user)|comment|pull_request|review|head_commit)|github\.head_ref/, name);
    assert.doesNotMatch(yaml, /run: npm (ci|install)(?! --ignore-scripts)/, `${name}: npm ci --ignore-scripts only`);
  }
});

test("every checkout drops the token except the one that pushes approved requests", () => {
  for (const [name, yaml] of Object.entries(workflows)) {
    const checkouts = [...yaml.matchAll(/uses: actions\/checkout@/g)].length;
    const dropped = [...yaml.matchAll(/persist-credentials: false/g)].length;
    const kept = [...yaml.matchAll(/persist-credentials: true/g)].length;
    if (name === "apply-approved.yml") {
      assert.equal(kept, 1, name);
      assert.equal(dropped, checkouts - 1, name);
    } else {
      assert.equal(kept, 0, name);
      assert.equal(dropped, checkouts, name);
    }
  }
});

test("concurrency: only apply is in source-code-writer, so no other writer can replace a pending apply", () => {
  // GitHub keeps one pending job per group and cancels the older pending one when another is queued.
  const writers = [];
  for (const [name, yaml] of Object.entries(workflows)) {
    for (const job of jobsOf(yaml)) {
      if (!/^ {6}contents: write$/m.test(job.text)) continue;
      const queue = /^ {4}concurrency:\n {6}group: (\S+)\n {6}cancel-in-progress: (\S+)\n/m.exec(job.text);
      assert.ok(queue, `${name}: ${job.name} has a concurrency group`);
      assert.equal(queue[2], "false", `${name}: ${job.name} never cancels a running writer`);
      writers.push([`${name}:${job.name}`, queue[1]]);
    }
  }
  assert.deepEqual(writers.sort(), [
    ["apply-approved.yml:apply", "source-code-writer"],
    ["publish.yml:forms", "issue-forms-writer"],
  ]);
  const shared = Object.entries(workflows).flatMap(([name, yaml]) => [...yaml.matchAll(/group: source-code-writer$/gm)].map(() => name));
  assert.deepEqual(shared, ["apply-approved.yml"]);
});

test("a token passed through env reaches only steps that run git, gh and shell, never node, npm or npx", () => {
  const tokenSteps = [];
  for (const [name, yaml] of Object.entries(workflows)) {
    for (const job of jobsOf(yaml)) {
      for (const step of stepsOf(job.text)) {
        if (!/github\.token|secrets\.|GH_TOKEN|GITHUB_TOKEN/.test(step)) continue;
        const where = `${name}: ${job.name}: ${step.split("\n")[0]}`;
        tokenSteps.push(where);
        assert.doesNotMatch(step, /\b(node|npm|npx)\b/, `${where} runs node, npm or npx`);
        assert.doesNotMatch(step, /^\s*uses:/m, `${where} hands the token to an action`);
        const gitLines = step.split("\n").filter((line) => /(^|\s)git\s/.test(line));
        for (const line of gitLines) assert.match(line, /\bgit -c core\.hooksPath=\/dev\/null /, `${where}: git hooks are off: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(tokenSteps, [
    "publish.yml: forms: name: Push the Issue Forms",
    "publish.yml: forms-recover: name: Run this workflow again to regenerate the Issue Forms",
  ]);
});

test("publish forms-recover: a conflict starts one recovery run, and a recovery run never starts another", () => {
  const yaml = workflows["publish.yml"];
  assert.match(yaml, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}forms_recovery:\n {8}description: .+\n {8}type: boolean\n {8}default: false\n/m);
  const jobs = Object.fromEntries(jobsOf(yaml).map((j) => [j.name, j.text]));
  assert.match(jobs.forms, /\n {4}outputs:\n {6}conflict: \$\{\{ steps\.push\.outputs\.conflict \}\}\n/);
  const push = stepsOf(jobs.forms).at(-1);
  assert.match(push, /^name: Push the Issue Forms\n {8}id: push\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {10}FORMS_RECOVERY: \$\{\{ inputs\.forms_recovery \}\}\n/);
  // A rebase conflict: fail in a recovery run, otherwise report conflict=true and end the job cleanly.
  const onConflict = [
    'rebase --onto "$remote" HEAD~1; then',
    "rebase --abort || true",
    'if [ "$FORMS_RECOVERY" = "true" ]; then',
    "exit 1",
    'echo "conflict=true" >> "$GITHUB_OUTPUT"',
    "exit 0",
  ].reduce((from, s) => {
    const at = push.indexOf(s, from);
    assert.ok(at > from, s);
    return at;
  }, -1);
  assert.ok(onConflict > 0);
  const recover = jobs["forms-recover"];
  assert.match(recover, /^ {2}forms-recover:\n {4}needs: forms\n {4}if: needs\.forms\.outputs\.conflict == 'true' && inputs\.forms_recovery != true\n {4}runs-on: ubuntu-24\.04\n {4}timeout-minutes: 5\n {4}permissions:\n {6}actions: write\n {4}steps:\n/);
  const steps = stepsOf(recover);
  assert.equal(steps.length, 1);
  assert.equal(
    steps[0],
    'name: Run this workflow again to regenerate the Issue Forms\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: gh api --method POST "repos/$GITHUB_REPOSITORY/actions/workflows/publish.yml/dispatches" -f ref=Source_Code -f "inputs[forms_recovery]=true"\n\n',
  );
  const actionsWrite = Object.entries(workflows).flatMap(([name, y]) => jobsOf(y).filter((j) => /^ {6}actions: write$/m.test(j.text)).map((j) => `${name}:${j.name}`));
  assert.deepEqual(actionsWrite, ["publish.yml:forms-recover"], "only forms-recover may start a run");
});

test("publish forms: generated in a read-only job without a token, handed over as a patch, pushed by a job without Node.js", () => {
  const jobs = Object.fromEntries(jobsOf(workflows["publish.yml"]).map((j) => [j.name, j.text]));
  // forms-check: contents: read only; runs the generator and outputs the base commit and the patch.
  const generator = jobs["forms-check"];
  assert.match(generator, /\n {4}permissions:\n {6}contents: read\n {4}outputs:\n {6}stale: \$\{\{ steps\.forms\.outputs\.stale \}\}\n {6}base: \$\{\{ steps\.forms\.outputs\.base \}\}\n {6}patch: \$\{\{ steps\.forms\.outputs\.patch \}\}\n {4}steps:\n/);
  assert.doesNotMatch(generator, /github\.token|secrets\.|GH_TOKEN|GITHUB_TOKEN|persist-credentials: true|contents: write/, "no token reaches the generator job");
  const prepare = stepsOf(generator).at(-1);
  const prepared = [
    "node scripts/gen-issue-forms.mjs --check; then",
    'echo "stale=false" >> "$GITHUB_OUTPUT"',
    "node scripts/gen-issue-forms.mjs\n",
    "git add -- .github/ISSUE_TEMPLATE\n",
    'patch="$(git diff --cached --full-index -- .github/ISSUE_TEMPLATE | base64 -w0)"',
    'if [ -z "$patch" ]; then',
    'if [ "${#patch}" -gt 100000 ]; then',
    'echo "stale=true" >> "$GITHUB_OUTPUT"',
    'echo "base=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"',
    'echo "patch=$patch" >> "$GITHUB_OUTPUT"',
  ].map((s) => prepare.indexOf(s));
  assert.ok(prepared.every((p, i) => p > (prepared[i - 1] ?? -1)), JSON.stringify(prepared));

  // forms: checkout, check and commit the patch (no token), push (token). No Node.js, npm or npx at all.
  const writer = jobs.forms;
  assert.doesNotMatch(writer, /setup-node/);
  const steps = stepsOf(writer);
  assert.doesNotMatch(steps.join("\n"), /\b(node|npm|npx)\b/);
  assert.equal(steps.length, 3);
  assert.match(steps[0], /^name: Check out Source_Code\n {8}uses: actions\/checkout@\S+ # v7\.0\.1\n {8}with:\n {10}ref: Source_Code\n {10}fetch-depth: 0\n {10}persist-credentials: false\n/);
  const [, apply, push] = steps;
  assert.doesNotMatch(apply, /token|auth/i, "no token while the patch is checked and applied");
  assert.match(apply, /^name: Check and commit the Issue Forms patch\n {8}env:\n {10}FORMS_BASE: \$\{\{ needs\.forms-check\.outputs\.base \}\}\n {10}FORMS_PATCH: \$\{\{ needs\.forms-check\.outputs\.patch \}\}\n {8}run: \|\n/);
  const applied = [
    "allowed='\\.github/ISSUE_TEMPLATE/[A-Za-z0-9_-][A-Za-z0-9._-]*\\.yml'",
    "grep -Eqx '[0-9a-f]{40}([0-9a-f]{24})?'",
    'merge-base --is-ancestor "$FORMS_BASE" HEAD; then',
    'printf \'%s\' "$FORMS_PATCH" | base64 -d > "$patch_file"',
    "grep -Eq '^(rename|copy) (from|to) |^(old|new) mode |^deleted file mode |^similarity index |^GIT binary patch|^Binary files ' \"$patch_file\"",
    "grep -qvx 'new file mode 100644'",
    'grep -Eqvx "diff --git a/($allowed) b/\\\\1"',
    'grep -Eqvx -e "--- a/$allowed|\\+\\+\\+ b/$allowed|--- /dev/null"; then',
    'apply --numstat "$patch_file" | cut -f3)"',
    'if [ -z "$paths" ] || printf \'%s\\n\' "$paths" | grep -Eqvx "$allowed"; then',
    'checkout -q --detach "$FORMS_BASE"',
    'apply --index "$patch_file"',
    'staged="$(git -c core.hooksPath=/dev/null diff --cached --name-only)"',
    'if [ -z "$staged" ] || printf \'%s\\n\' "$staged" | grep -Eqvx "$allowed"; then',
    'commit -q -m "chore(forms): regenerate issue forms"',
  ].map((s) => apply.indexOf(s));
  assert.ok(applied.every((p, i) => p > (applied[i - 1] ?? -1)), JSON.stringify(applied));
  assert.doesNotMatch(apply, /git (am|apply --3way|apply --unsafe-paths)/);
  assert.match(push, /^name: Push the Issue Forms\n {8}id: push\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n/);
  assertFormsPushLoop(push);
});

test("_deploy-pages: reusable, builds Source_Code HEAD containing the expected commit, validates, stamps, deploys", () => {
  const yaml = workflows["_deploy-pages.yml"];
  assert.match(yaml, /^ {2}workflow_call:\n {4}inputs:\n {6}expected_sha:\n[\s\S]*?required: false/m);
  assert.match(yaml, /^ {4}outputs:\n {6}page_url:\n[\s\S]*?value: \$\{\{ jobs\.deploy\.outputs\.page_url \}\}/m);
  assert.doesNotMatch(yaml, /^\s*concurrency:/m, "the caller sets the pages-deploy group");
  assert.match(yaml, /^ {2}build:\n[\s\S]*?permissions:\n {6}contents: read\n/m);
  assert.match(yaml, /^ {2}deploy:\n {4}needs: build\n[\s\S]*?permissions:\n {6}pages: write\n {6}id-token: write\n {4}environment:\n {6}name: github-pages/m);
  assert.match(yaml, /ref: Source_Code\n {10}fetch-depth: 0/);
  assert.match(yaml, /EXPECTED_SHA: \$\{\{ inputs\.expected_sha \}\}/);
  assert.match(yaml, /git merge-base --is-ancestor "\$EXPECTED_SHA" HEAD/);
  const order = ["merge-base --is-ancestor", "npm ci --ignore-scripts", "node scripts/validate.mjs", "node scripts/stamp-version.mjs --out _site", "upload-pages-artifact", "path: _site", "deploy-pages"];
  const positions = order.map((s) => yaml.indexOf(s));
  assert.ok(positions.every((p, i) => p > (positions[i - 1] ?? -1)), JSON.stringify(positions));
  assert.deepEqual(expressions(yaml), ["${{ inputs.expected_sha }}", "${{ jobs.deploy.outputs.page_url }}", "${{ steps.deployment.outputs.page_url }}"]);
});

test("publish: check with the push baseline, read-only forms check, forms writer queue, serialized deploy", () => {
  const yaml = workflows["publish.yml"];
  assert.match(yaml, /^ {2}push:\n {4}branches: \[Source_Code\]\n {4}paths:\n/m);
  assert.match(yaml, /^ {2}workflow_dispatch:$/m);
  // check: read-only, full history for X18 against the commit before the push
  assert.match(yaml, /^ {2}check:\n[\s\S]*?permissions:\n {6}contents: read\n[\s\S]*?fetch-depth: 0[\s\S]*?PCMW_BASELINE_REF: \$\{\{ github\.event\.before \}\}\n {8}run: npm run check:ci/m);
  // forms-check is read-only; forms runs (in its own issue-forms-writer queue) only when the forms are stale
  assert.match(yaml, /^ {2}forms-check:\n {4}needs: check\n[\s\S]*?permissions:\n {6}contents: read\n/m);
  assert.match(yaml, /node scripts\/gen-issue-forms\.mjs --check/);
  assert.match(yaml, /^ {2}forms:\n {4}needs: forms-check\n {4}if: needs\.forms-check\.outputs\.stale == 'true'\n[\s\S]*?permissions:\n {6}contents: write\n {4}concurrency:\n {6}group: issue-forms-writer\n {6}cancel-in-progress: false/m);
  assert.match(yaml, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(yaml, /echo "::add-mask::\$auth_b64"/);
  assert.match(yaml, /user\.name="github-actions\[bot\]" -c user\.email="41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/);
  assert.match(yaml, /commit -q -m "chore\(forms\): regenerate issue forms"/);
  assert.match(yaml, /for attempt in 1 2 3 4; do/);
  // deploy: reusable workflow in the pages-deploy queue
  assert.match(yaml, /^ {2}deploy:\n {4}needs: check\n {4}permissions:\n {6}contents: read\n {6}pages: write\n {6}id-token: write\n {4}concurrency:\n {6}group: pages-deploy\n {6}cancel-in-progress: false\n {4}uses: \.\/\.github\/workflows\/_deploy-pages\.yml\n {4}with:\n {6}expected_sha: \$\{\{ github\.sha \}\}/m);
  assert.deepEqual(expressions(yaml), [
    "${{ github.event.before }}",
    "${{ github.sha }}",
    "${{ github.token }}",
    "${{ inputs.forms_recovery }}",
    "${{ needs.forms-check.outputs.base }}",
    "${{ needs.forms-check.outputs.patch }}",
    "${{ steps.forms.outputs.base }}",
    "${{ steps.forms.outputs.patch }}",
    "${{ steps.forms.outputs.stale }}",
    "${{ steps.push.outputs.conflict }}",
  ]);
});

test("apply-approved: approved label, daily schedule or manual run; one writer at a time; deploy and report", () => {
  const yaml = workflows["apply-approved.yml"];
  assert.match(yaml, /^ {2}issues:\n {4}types: \[labeled\]\n {2}schedule:\n {4}- cron: "17 3 \* \* \*"\n {2}workflow_dispatch:$/m);
  // apply: the only job that may push; it keeps the checkout token
  assert.match(yaml, /^ {2}apply:\n {4}if: github\.event_name != 'issues' \|\| github\.event\.label\.name == 'approved'\n/m);
  assert.match(yaml, /^ {2}apply:\n[\s\S]*?permissions:\n {6}contents: write\n {6}issues: write\n {4}concurrency:\n {6}group: source-code-writer\n {6}cancel-in-progress: false\n/m);
  assert.match(yaml, /ref: Source_Code\n {10}fetch-depth: 0\n {10}persist-credentials: true/);
  assert.match(yaml, /id: apply\n {8}uses: actions\/github-script@/);
  assert.match(yaml, /await import\(`\$\{process\.env\.GITHUB_WORKSPACE\}\/scripts\/apply-requests\.mjs`\);\n {12}await run\(\{ github, context, core \}\);/);
  for (const output of ["needs_deploy", "results", "head_sha"]) {
    assert.ok(yaml.includes(`\n      ${output}: $\{{ steps.apply.outputs.${output} }}\n`), output);
  }
  // deploy: only when something was written or waits for closing; serialized with every other deployment
  assert.match(yaml, /^ {2}deploy:\n {4}needs: apply\n {4}if: needs\.apply\.outputs\.needs_deploy == 'true'\n {4}permissions:\n {6}contents: read\n {6}pages: write\n {6}id-token: write\n {4}concurrency:\n {6}group: pages-deploy\n {6}cancel-in-progress: false\n {4}uses: \.\/\.github\/workflows\/_deploy-pages\.yml\n {4}with:\n {6}expected_sha: \$\{\{ needs\.apply\.outputs\.head_sha \}\}/m);
  // report: runs after a deployment attempt (also when it failed or was cancelled); values through env only.
  // deployments: read (and contents: read for the compare API) lets it check whether a newer deployment
  // that replaced a cancelled one contains the commit; it waits up to about 10 minutes for that.
  const reportJob = jobsOf(yaml).find((j) => j.name === "report").text;
  assert.match(reportJob, /^ {2}report:\n {4}needs: \[apply, deploy\]\n {4}if: always\(\) && needs\.apply\.result == 'success' && needs\.deploy\.result != 'skipped'\n/);
  assert.match(reportJob, /\n {4}timeout-minutes: 15\n(?: {4}#.*\n)*? {4}permissions:\n {6}contents: read\n {6}deployments: read\n {6}issues: write\n {4}steps:\n/);
  assert.deepEqual(Object.values(workflows).flatMap((y) => [...y.matchAll(/^\s*deployments: \S+$/gm)].map((m) => m[0].trim())), ["deployments: read"], "only report reads deployments");
  assert.match(yaml, /env:\n {10}DEPLOY_RESULT: \$\{\{ needs\.deploy\.result \}\}\n {10}APPLY_RESULTS: \$\{\{ needs\.apply\.outputs\.results \}\}\n {10}HEAD_SHA: \$\{\{ needs\.apply\.outputs\.head_sha \}\}\n/);
  assert.match(yaml, /const \{ report \} = await import\(`\$\{process\.env\.GITHUB_WORKSPACE\}\/scripts\/apply-requests\.mjs`\);\n {12}await report\(\{ github, context, core \}\);/);
  assert.match(yaml, /^ {2}apply:\n[\s\S]*?timeout-minutes: 10\n/m);
  assert.deepEqual(expressions(yaml), [
    "${{ needs.apply.outputs.head_sha }}",
    "${{ needs.apply.outputs.results }}",
    "${{ needs.deploy.result }}",
    "${{ steps.apply.outputs.head_sha }}",
    "${{ steps.apply.outputs.needs_deploy }}",
    "${{ steps.apply.outputs.results }}",
  ]);
});
