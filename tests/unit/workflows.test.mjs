// Static checks of the GitHub Actions workflows (architecture 3.14): minimal permissions, official actions
// pinned to full commit SHAs, no expressions inside shell scripts, no user-controlled values anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
/** git runs with LC_ALL=C (the rest of the environment kept), so its output and messages are the English ones compared below. */
const GIT_ENV = { ...process.env, LC_ALL: "C" };

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
    'changed="$(git -c core.hooksPath=/dev/null diff --no-renames --name-status "$remote" HEAD)"',
    'modes="$(git -c core.hooksPath=/dev/null diff --no-renames --no-abbrev --raw "$remote" HEAD)"',
    `if [ "$ahead" != 1 ] || [ -z "$changed" ] || printf '%s\\n' "$changed" | grep -Eqvx "[AM]$tab$allowed" \\`,
    String.raw`|| printf '%s\n' "$modes" | grep -Eqvx ":(000000|100644) 100644 [0-9a-f]+ [0-9a-f]+ [AM]$tab$allowed"; then`,
  ];
  const positions = order.map((s) => step.indexOf(s));
  assert.ok(positions.every((p, i) => p > (positions[i - 1] ?? -1)), JSON.stringify(positions));
  assert.ok(step.includes(`\n${" ".repeat(10)}${ALLOWED_LINE}\n${" ".repeat(10)}${TAB_LINE}\n`), "allowed and tab are defined in the push step");
  assert.doesNotMatch(step, /rebase refs\/remotes|rebase "\$remote"\n|reset --hard|gen-issue-forms|--name-only/);
}

/** The allowed paths and the tab character, defined the same way in both forms steps. */
const ALLOWED_LINE = String.raw`allowed='\.github/ISSUE_TEMPLATE/[A-Za-z0-9_-][A-Za-z0-9._-]*\.yml'`;
const TAB_LINE = String.raw`tab="$(printf '\t')"`;
/** Shell (grep -E) patterns of the forms patch checks, as written in publish.yml. */
const PATCH_DENY = String.raw`^(rename|copy) (from|to|old|new) |^(old|new) mode |^deleted file mode |^(dis)?similarity index |^GIT binary patch|^Binary files `;
const SUMMARY_ALLOWED = " create mode 100644 $allowed";
const STAGED_ALLOWED = "[AM]$tab$allowed";
const RAW_ALLOWED = ":(000000|100644) 100644 [0-9a-f]+ [0-9a-f]+ [AM]$tab$allowed";
/**
 * git's line count per file (apply --numstat, diff --numstat): at least one changed line. A binary file counts
 * as "-<TAB>-"; a section without a hunk, or an empty added file, as "0<TAB>0".
 */
const NUMSTAT_ALLOWED = "([1-9][0-9]*$tab[0-9]+|[0-9]+$tab[1-9][0-9]*)$tab$allowed";

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

test("no job or step uses always(): cancelling a run stops every job (status checks use !cancelled())", () => {
  const code = Object.fromEntries(Object.entries(workflows).map(([name, yaml]) => [name, yaml.replace(/^ *#.*\n/gm, "")]));
  for (const [name, yaml] of Object.entries(code)) {
    assert.doesNotMatch(yaml, /always\(\)/, name);
    // A plain YAML scalar that starts with "!" is a tag, so !cancelled() must be inside ${{ }}.
    assert.doesNotMatch(yaml, /^\s*if: !/m, name);
  }
  assert.equal(Object.values(code).join("\n").match(/!cancelled\(\)/g)?.length, 1, "only report continues after failed jobs");
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

test("concurrency: only apply is in source-code-writer; deployments and reports wait in order (queue: max)", () => {
  // Without queue, GitHub keeps one pending job per group and cancels the older pending one when another is
  // queued. queue: max keeps up to 100 pending jobs in order (never with cancel-in-progress: true). The two
  // writer groups keep the default: a pending writer may be replaced only by a newer run of the same writer,
  // which scans or regenerates everything again. A newer validation of the same Issue cancels the older one.
  const groups = [];
  for (const [name, yaml] of Object.entries(workflows)) {
    assert.doesNotMatch(yaml, /^concurrency:/m, `${name}: no workflow-level concurrency`);
    for (const job of jobsOf(yaml)) {
      const block = /^ {4}concurrency:\n((?: {6}.*\n)+)/m.exec(job.text);
      if (!block) {
        assert.doesNotMatch(job.text, /^ {6}contents: write$/m, `${name}: ${job.name} writes without a concurrency group`);
        continue;
      }
      const keys = Object.fromEntries([...block[1].matchAll(/^ {6}([a-z-]+): (\S.*)$/gm)].map(([, key, value]) => [key, value]));
      assert.equal(Object.keys(keys).length, block[1].split("\n").filter(Boolean).length, `${name}: ${job.name}: one plain value per line`);
      groups.push([`${name}:${job.name}`, keys]);
    }
  }
  const writer = (group) => ({ group, "cancel-in-progress": "false" });
  const queued = (group) => ({ group, "cancel-in-progress": "false", queue: "max" });
  assert.deepEqual(groups.sort(([a], [b]) => (a < b ? -1 : 1)), [
    ["apply-approved.yml:apply", writer("source-code-writer")],
    ["apply-approved.yml:deploy", queued("pages-deploy")],
    ["apply-approved.yml:report", queued("apply-report")],
    ["publish.yml:deploy", queued("pages-deploy")],
    ["publish.yml:forms", writer("issue-forms-writer")],
    ["validate-issue.yml:validate", { group: "validate-issue-${{ github.event.issue.number }}", "cancel-in-progress": "true" }],
  ]);
  const all = Object.values(workflows).join("\n");
  assert.equal(all.match(/^\s*queue:/gm)?.length, 3, "queue is set only in the three groups above");
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
    ALLOWED_LINE,
    TAB_LINE,
    "grep -Eqx '[0-9a-f]{40}([0-9a-f]{24})?'",
    'merge-base --is-ancestor "$FORMS_BASE" HEAD; then',
    'printf \'%s\' "$FORMS_PATCH" | base64 -d > "$patch_file"',
    `grep -Eq '${PATCH_DENY}' "$patch_file"`,
    "grep -qvx 'new file mode 100644'",
    'grep -Eqvx "diff --git a/($allowed) b/\\\\1"',
    'grep -Eqvx -e "--- a/$allowed|\\+\\+\\+ b/$allowed|--- /dev/null"; then',
    "if ! awk '\n",
    `' "$patch_file"; then\n`,
    'echo "::error::A file in the Issue Forms patch is read and written under different names"',
    'summary="$(git -c core.hooksPath=/dev/null apply --summary "$patch_file")"',
    `if [ -n "$summary" ] && printf '%s\\n' "$summary" | grep -Eqvx -e "${SUMMARY_ALLOWED}"; then`,
    'numstat="$(git -c core.hooksPath=/dev/null apply --numstat "$patch_file")"',
    `if [ -z "$numstat" ] || printf '%s\\n' "$numstat" | grep -Eqvx "${NUMSTAT_ALLOWED}"; then`,
    'checkout -q --detach "$FORMS_BASE"',
    'apply --index "$patch_file"',
    'staged="$(git -c core.hooksPath=/dev/null diff --cached --no-renames --name-status)"',
    'modes="$(git -c core.hooksPath=/dev/null diff --cached --no-renames --no-abbrev --raw)"',
    'counts="$(git -c core.hooksPath=/dev/null diff --cached --no-renames --numstat)"',
    `if [ -z "$staged" ] || printf '%s\\n' "$staged" | grep -Eqvx "${STAGED_ALLOWED}" \\`,
    `|| printf '%s\\n' "$modes" | grep -Eqvx "${RAW_ALLOWED}" \\`,
    `|| printf '%s\\n' "$counts" | grep -Eqvx "${NUMSTAT_ALLOWED}"; then`,
    'commit -q -m "chore(forms): regenerate issue forms"',
  ].map((s) => apply.indexOf(s));
  assert.ok(applied.every((p, i) => p > (applied[i - 1] ?? -1)), JSON.stringify(applied));
  assert.doesNotMatch(apply, /git (am|apply --3way|apply --unsafe-paths)|--name-only/);
  assert.match(push, /^name: Push the Issue Forms\n {8}id: push\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n/);
  assertFormsPushLoop(push);
});

const HAS_AWK = (() => {
  try {
    execFileSync("awk", ["BEGIN { exit 0 }"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("publish forms: the ---/+++ names of every file section must be its diff --git names", { skip: HAS_AWK ? false : "awk is not installed" }, () => {
  const apply = stepsOf(jobsOf(workflows["publish.yml"]).find((j) => j.name === "forms").text)[1];
  const program = /if ! awk '([\s\S]*?)' "\$patch_file"; then/.exec(apply)[1];
  // awk reads each patch from stdin, running the program exactly as written in the workflow.
  const namesMatch = (patch) => {
    try {
      execFileSync("awk", [program], { input: patch, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };
  const T = ".github/ISSUE_TEMPLATE";
  const lines = (...rows) => `${rows.join("\n")}\n`;
  const added = lines(`diff --git a/${T}/x.yml b/${T}/x.yml`, "new file mode 100644", "index 0000000..1111111", "--- /dev/null", `+++ b/${T}/x.yml`, "@@ -0,0 +1,2 @@", "+name: x", "+--- content, not a header");
  const changed = lines(`diff --git a/${T}/x.yml b/${T}/x.yml`, "index 1111111..2222222 100644", `--- a/${T}/x.yml`, `+++ b/${T}/x.yml`, "@@ -1,2 +1 @@", "--- content", "+++ content");
  assert.equal(namesMatch(added), true, "added");
  assert.equal(namesMatch(changed), true, "changed");
  assert.equal(namesMatch(added + changed), true, "two sections");

  // Read as config.yml, written as 1-add-point.yml: git reports no rename for it, so the header check and
  // git apply --summary let it through; this rule refuses it before anything is applied.
  const moved = lines(`diff --git a/${T}/config.yml b/${T}/config.yml`, "index 1111111..2222222 100644", `--- a/${T}/config.yml`, `+++ b/${T}/1-add-point.yml`, "@@ -1 +1 @@", "-a", "+b");
  assert.equal(new RegExp(PATCH_DENY, "m").test(moved), false, "the header deny list does not see it");
  const summary = execFileSync("git", ["-c", "core.hooksPath=/dev/null", "apply", "--summary", "-"], { cwd: REPO_ROOT, input: moved, encoding: "utf8", env: GIT_ENV });
  assert.equal(summary, "", "git apply --summary does not see it");
  assert.equal(namesMatch(moved), false, "refused before it is applied");
  const refused = {
    "--- names another form": lines(`diff --git a/${T}/x.yml b/${T}/x.yml`, "index 1..2 100644", `--- a/${T}/config.yml`, `+++ b/${T}/x.yml`, "@@ -1 +1 @@", "-a", "+b"),
    "/dev/null for a file that is not added": lines(`diff --git a/${T}/x.yml b/${T}/x.yml`, "index 0..1", "--- /dev/null", `+++ b/${T}/x.yml`, "@@ -0,0 +1 @@", "+a"),
    "an added file read from a/": lines(`diff --git a/${T}/x.yml b/${T}/x.yml`, "new file mode 100644", `--- a/${T}/x.yml`, `+++ b/${T}/x.yml`, "@@ -0,0 +1 @@", "+a"),
    "no ---/+++ before the hunk": lines(`diff --git a/${T}/x.yml b/${T}/x.yml`, "index 1..2 100644", "@@ -1 +1 @@", "-a", "+b"),
    "no diff --git line": lines(`--- a/${T}/x.yml`, `+++ b/${T}/x.yml`, "@@ -1 +1 @@", "-a", "+b"),
    "a second section that moves": added + moved,
  };
  for (const [name, patch] of Object.entries(refused)) assert.equal(namesMatch(patch), false, name);

  // Applied anyway, it would be staged as a deletion plus a change, and the staged check refuses the deletion.
  const staged = new RegExp(`^(?:${STAGED_ALLOWED.replace("$tab", "\t").replace("$allowed", /^allowed='([^']+)'$/.exec(ALLOWED_LINE)[1])})$`);
  assert.equal(staged.test(`D\t${T}/config.yml`), false);
  assert.equal(staged.test(`M\t${T}/1-add-point.yml`), true);
});

test("publish forms: a binary section (\"Files ... differ\" instead of a hunk) and a section that counts 0 lines are refused by git's line count", { skip: HAS_AWK ? false : "awk is not installed" }, async () => {
  const apply = stepsOf(jobsOf(workflows["publish.yml"]).find((j) => j.name === "forms").text)[1];
  // Each rule is taken from the workflow exactly as written; the patches are read from stdin.
  const rule = (re) => {
    const m = re.exec(apply);
    assert.ok(m, String(re));
    return m[1];
  };
  const allowed = rule(/^\s*allowed='([^']+)'$/m);
  const whole = (pattern) => new RegExp(`^(?:${pattern.replaceAll("$allowed", allowed).replaceAll("$tab", "\t")})$`);
  const deny = new RegExp(rule(/if grep -Eq '([^']+)' "\$patch_file"/), "m");
  const program = rule(/if ! awk '([\s\S]*?)' "\$patch_file"; then/);
  const summaryLine = whole(rule(/printf '%s\\n' "\$summary" \| grep -Eqvx -e "([^"]+)"; then/));
  const numstatRule = rule(/printf '%s\\n' "\$numstat" \| grep -Eqvx "([^"]+)"; then/);
  const countsRule = rule(/printf '%s\\n' "\$counts" \| grep -Eqvx "([^"]+)"; then/);
  assert.equal(numstatRule, NUMSTAT_ALLOWED);
  assert.equal(countsRule, NUMSTAT_ALLOWED);
  const numstatLine = whole(numstatRule);
  const gitApply = (option, patch) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "apply", option, "-"], { cwd: REPO_ROOT, input: patch, encoding: "utf8", env: GIT_ENV });
  const rows = (text) => text.split("\n").filter(Boolean);
  const awkAccepts = (patch) => {
    try {
      execFileSync("awk", [program], { input: patch, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };
  // The four checks before the patch is applied, as the workflow runs them.
  const checks = (patch) => {
    const numstat = rows(gitApply("--numstat", patch));
    return {
      deny: !deny.test(patch),
      names: awkAccepts(patch),
      summary: rows(gitApply("--summary", patch)).every((line) => summaryLine.test(line)),
      numstat: numstat.length > 0 && numstat.every((line) => numstatLine.test(line)),
    };
  };

  const X = ".github/ISSUE_TEMPLATE/x.yml";
  const sha = (c) => c.repeat(40);
  const lines = (...list) => `${list.join("\n")}\n`;
  const added = lines(`diff --git a/${X} b/${X}`, "new file mode 100644", `index ${sha("0")}..${sha("1")}`, "--- /dev/null", `+++ b/${X}`, "@@ -0,0 +1,2 @@", "+name: x", "+description: y");
  const changed = lines(`diff --git a/${X} b/${X}`, `index ${sha("1")}..${sha("2")} 100644`, `--- a/${X}`, `+++ b/${X}`, "@@ -1,2 +1,2 @@", " name: x", "-description: y", "+description: z");
  const all = { deny: true, names: true, summary: true, numstat: true };
  assert.deepEqual(checks(added), all, "added form");
  assert.deepEqual(checks(changed), all, "changed form");
  assert.deepEqual(checks(added + changed), all, "two sections");

  // Where a hunk would start, git takes a line that begins with "Files " or "Binary files " and ends in
  // " differ" as a binary patch; with --index it would write the blob named on the index line (any blob in
  // the repository). The header check refuses "Binary files "; only the line count refuses "Files ".
  const binary = {
    changed: lines(`diff --git a/${X} b/${X}`, `index ${sha("1")}..${sha("2")} 100644`, `--- a/${X}`, `+++ b/${X}`, "Files differ"),
    added: lines(`diff --git a/${X} b/${X}`, "new file mode 100644", `index ${sha("0")}..${sha("2")}`, "--- /dev/null", `+++ b/${X}`, "Files differ"),
  };
  for (const [name, patch] of Object.entries({ ...binary, "after a text section": changed + binary.changed })) {
    assert.ok(rows(gitApply("--numstat", patch)).includes(`-\t-\t${X}`), `${name}: git counts it as binary`);
    assert.deepEqual(checks(patch), { ...all, numstat: false }, name);
  }

  // Any other line there is no binary patch: git counts the section as "0<TAB>0", and the line count refuses
  // it (a regenerated form changes at least one line). In the section of a changed file git cannot parse that
  // line either: apply --index, run right after the line count (bash -e, not inside an if), would fail with
  // "patch with only garbage" before anything is written. In the section of an added file ("new file mode
  // 100644") git takes it as a file without content: the patch applies and would add an empty .yml, so only
  // the line count stops it. apply --check parses and checks the patch as apply does, and writes nothing.
  const gitCheck = (patch) => {
    try {
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", "apply", "--check", "-"], { cwd: REPO_ROOT, input: patch, encoding: "utf8", env: GIT_ENV, stdio: ["pipe", "pipe", "pipe"] });
      return "applies";
    } catch (error) {
      return error.status === 128 && error.stderr.includes("patch with only garbage") ? "garbage" : `fails: ${error.stderr.trim()}`;
    }
  };
  const header = {
    changed: [`diff --git a/${X} b/${X}`, `index ${sha("1")}..${sha("2")} 100644`, `--- a/${X}`, `+++ b/${X}`],
    added: [`diff --git a/${X} b/${X}`, "new file mode 100644", `index ${sha("0")}..${sha("2")}`, "--- /dev/null", `+++ b/${X}`],
  };
  const tails = { "Files differ with a CRLF line end": "Files differ\r", '" differ" without "Files "': " differ", '"x differ"': "x differ" };
  const zero = [];
  for (const [kind, rowsOfHeader] of Object.entries(header)) {
    for (const [name, tail] of Object.entries(tails)) zero.push([`${kind} file, ${name}`, lines(...rowsOfHeader, tail), kind === "changed" ? "garbage" : "applies"]);
  }
  zero.push(["changed file after a text section", changed + lines(...header.changed, " differ"), "garbage"]);
  for (const [name, patch, byGit] of zero) {
    assert.equal(rows(gitApply("--numstat", patch)).at(-1), `0\t0\t${X}`, `${name}: git counts it as 0 lines`);
    assert.deepEqual(checks(patch), { ...all, numstat: false }, `${name}: refused before it is applied`);
    assert.equal(gitCheck(patch), byGit, `${name}: git apply --check`);
  }
  assert.match(apply, /^ {10}git -c core\.hooksPath=\/dev\/null apply --index "\$patch_file"$/m, "a failed apply ends the step");
  assert.doesNotMatch(workflows["publish.yml"], /^\s*shell:|set \+e/m);

  // Controls on a real form, where git can apply the section: a changed line passes the four checks; a binary
  // section whose index line names the form's current blob and another form's blob applies as well, and only
  // the line count refuses it.
  const F = ".github/ISSUE_TEMPLATE/config.yml";
  const [first, second] = (await readFile(path.join(REPO_ROOT, F), "utf8")).split("\n");
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: REPO_ROOT, encoding: "utf8", env: GIT_ENV }).trim();
  const realChanged = lines(`diff --git a/${F} b/${F}`, `index ${sha("1")}..${sha("2")} 100644`, `--- a/${F}`, `+++ b/${F}`, "@@ -1,2 +1,2 @@", `-${first}`, `+${first} (changed)`, ` ${second}`);
  const realBinary = lines(`diff --git a/${F} b/${F}`, `index ${git("hash-object", F)}..${git("rev-parse", "HEAD:.github/ISSUE_TEMPLATE/1-add-point.yml")} 100644`, `--- a/${F}`, `+++ b/${F}`, "Files differ");
  assert.deepEqual(checks(realChanged), all, "changed form");
  assert.deepEqual(checks(realBinary), { ...all, numstat: false }, "binary section of a form");
  for (const [name, patch] of [["changed form", realChanged], ["binary section of a form", realBinary]]) assert.equal(gitCheck(patch), "applies", name);

  // The staged files are counted again after the patch is applied; an empty added file counts "0<TAB>0".
  assert.ok(numstatLine.test(`2\t0\t${X}`) && numstatLine.test(`1\t1\t${X}`) && numstatLine.test(`0\t1\t${X}`) && numstatLine.test(`10\t0\t${X}`));
  for (const line of [`0\t0\t${X}`, `-\t-\t${X}`, `1\t1\tsite/data/config.json`, "1\t1\t.github/ISSUE_TEMPLATE/sub/x.yml", `1\t1\t${X}\textra`]) {
    assert.equal(numstatLine.test(line), false, line);
  }
});

test("publish forms: the patch checks refuse renames (rename old/new too), copies, deletions, mode changes and links", () => {
  const allowed = /^allowed='([^']+)'$/.exec(ALLOWED_LINE)[1];
  const whole = (pattern) => new RegExp(`^(?:${pattern.replaceAll("$allowed", allowed).replaceAll("$tab", "\t")})$`);
  const deny = new RegExp(PATCH_DENY, "m");
  const summaryLine = whole(SUMMARY_ALLOWED);
  // git reads each patch from stdin, exactly as the workflow asks it to; nothing is applied or written.
  const summaryOf = (patch) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "apply", "--summary", "-"], { cwd: REPO_ROOT, input: patch, encoding: "utf8", env: GIT_ENV });
  const summaryAccepts = (patch) => summaryOf(patch).split("\n").filter(Boolean).every((line) => summaryLine.test(line));
  const X = ".github/ISSUE_TEMPLATE/x.yml";
  const patch = (from, to, ...lines) => [`diff --git a/${from} b/${to}`, ...lines, ""].join("\n");

  const refused = {
    "rename old / rename new": patch(X, X, "rename old site/data/config.json", `rename new ${X}`),
    "rename from / rename to": patch(X, X, "similarity index 100%", "rename from site/data/config.json", `rename to ${X}`),
    "dissimilarity index": patch(X, X, "dissimilarity index 100%", "rename old site/data/config.json", `rename new ${X}`),
    "copy": patch(X, X, "similarity index 100%", "copy from site/data/config.json", `copy to ${X}`),
    "deletion": patch(X, X, "deleted file mode 100644"),
    "mode change": patch(X, X, "old mode 100644", "new mode 100755"),
  };
  for (const [name, text] of Object.entries(refused)) {
    assert.ok(deny.test(text), `${name}: refused by the header check`);
    assert.equal(summaryAccepts(text), false, `${name}: refused by git's own summary`);
  }
  const link = patch(X, X, "new file mode 120000", "index 0000000..1111111", "--- /dev/null", `+++ b/${X}`, "@@ -0,0 +1 @@", "+../../scripts", "\\ No newline at end of file");
  assert.equal(summaryAccepts(link), false, "symbolic link: refused by git's own summary");

  const added = patch(X, X, "new file mode 100644", "index 0000000..1111111", "--- /dev/null", `+++ b/${X}`, "@@ -0,0 +1 @@", "+name: x");
  const changed = patch(X, X, "index 1111111..2222222 100644", `--- a/${X}`, `+++ b/${X}`, "@@ -1 +1 @@", "-name: x", "+name: y");
  for (const [name, text] of [["added", added], ["changed", changed]]) {
    assert.equal(deny.test(text), false, name);
    assert.equal(summaryAccepts(text), true, name);
  }

  // Staged and pushed changes are listed without rename detection, so a move is a deletion (refused).
  const staged = whole(STAGED_ALLOWED);
  assert.ok(staged.test(`M\t${X}`) && staged.test(`A\t${X}`));
  for (const line of ["D\tsite/data/config.json", `R100\tsite/data/config.json\t${X}`, "A\t.github/ISSUE_TEMPLATE/sub/x.yml", "M\tsite/data/config.json"]) {
    assert.equal(staged.test(line), false, line);
  }
  const raw = whole(RAW_ALLOWED);
  const sha = (c) => c.repeat(40);
  assert.ok(raw.test(`:100644 100644 ${sha("a")} ${sha("b")} M\t${X}`) && raw.test(`:000000 100644 ${sha("0")} ${sha("b")} A\t${X}`));
  for (const line of [`:100644 100755 ${sha("a")} ${sha("b")} M\t${X}`, `:000000 120000 ${sha("0")} ${sha("b")} A\t${X}`, `:100644 000000 ${sha("a")} ${sha("0")} D\t${X}`]) {
    assert.equal(raw.test(line), false, line);
  }
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
  // deploy: reusable workflow in the pages-deploy queue, where pending deployments wait in order (queue: max)
  assert.match(yaml, /^ {2}deploy:\n {4}needs: check\n {4}permissions:\n {6}contents: read\n {6}pages: write\n {6}id-token: write\n {4}concurrency:\n {6}group: pages-deploy\n {6}cancel-in-progress: false\n {6}queue: max\n {4}uses: \.\/\.github\/workflows\/_deploy-pages\.yml\n {4}with:\n {6}expected_sha: \$\{\{ github\.sha \}\}/m);
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
  // deploy: only when something was written or waits for closing; serialized with every other deployment, in order (queue: max)
  assert.match(yaml, /^ {2}deploy:\n {4}needs: apply\n {4}if: needs\.apply\.outputs\.needs_deploy == 'true'\n {4}permissions:\n {6}contents: read\n {6}pages: write\n {6}id-token: write\n {4}concurrency:\n {6}group: pages-deploy\n {6}cancel-in-progress: false\n {6}queue: max\n {4}uses: \.\/\.github\/workflows\/_deploy-pages\.yml\n {4}with:\n {6}expected_sha: \$\{\{ needs\.apply\.outputs\.head_sha \}\}/m);
  // report: runs after a deployment attempt (also when it failed or ended cancelled on its own),
  // but not when the run itself was cancelled (!cancelled(), not always()); values through env only.
  // deployments: read (and contents: read for the compare API) lets it check whether a newer deployment
  // that followed a cancelled one contains the commit; it waits up to about 10 minutes for that.
  const reportJob = jobsOf(yaml).find((j) => j.name === "report").text;
  assert.match(reportJob, /^ {2}report:\n {4}needs: \[apply, deploy\]\n {4}if: \$\{\{ !cancelled\(\) && needs\.apply\.result == 'success' && needs\.deploy\.result != 'skipped' \}\}\n/);
  // One report at a time (apply-report), so two runs cannot both create the deploy status comment of an Issue;
  // pending reports wait in order (queue: max), so no run loses its report.
  assert.match(reportJob, /\n {4}timeout-minutes: 15\n {4}permissions:\n {6}contents: read\n {6}deployments: read\n {6}issues: write\n(?: {4}#.*\n)* {4}concurrency:\n {6}group: apply-report\n {6}cancel-in-progress: false\n {6}queue: max\n {4}steps:\n/);
  assert.equal(Object.values(workflows).join("\n").match(/group: apply-report$/gm)?.length, 1);
  assert.deepEqual(Object.values(workflows).flatMap((y) => [...y.matchAll(/^\s*deployments: \S+$/gm)].map((m) => m[0].trim())), ["deployments: read"], "only report reads deployments");
  assert.match(yaml, /env:\n {10}DEPLOY_RESULT: \$\{\{ needs\.deploy\.result \}\}\n {10}APPLY_RESULTS: \$\{\{ needs\.apply\.outputs\.results \}\}\n {10}HEAD_SHA: \$\{\{ needs\.apply\.outputs\.head_sha \}\}\n/);
  assert.match(yaml, /const \{ report \} = await import\(`\$\{process\.env\.GITHUB_WORKSPACE\}\/scripts\/apply-requests\.mjs`\);\n {12}await report\(\{ github, context, core \}\);/);
  assert.match(yaml, /^ {2}apply:\n[\s\S]*?timeout-minutes: 10\n/m);
  assert.deepEqual(expressions(yaml), [
    "${{ !cancelled() && needs.apply.result == 'success' && needs.deploy.result != 'skipped' }}",
    "${{ needs.apply.outputs.head_sha }}",
    "${{ needs.apply.outputs.results }}",
    "${{ needs.deploy.result }}",
    "${{ steps.apply.outputs.head_sha }}",
    "${{ steps.apply.outputs.needs_deploy }}",
    "${{ steps.apply.outputs.results }}",
  ]);
});
