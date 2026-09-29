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

test("the four workflows exist", () => {
  for (const name of ["_deploy-pages.yml", "publish.yml", "validate-issue.yml"]) assert.ok(names.includes(name), name);
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
  // forms-check is read-only; forms joins source-code-writer only when the forms are stale
  assert.match(yaml, /^ {2}forms-check:\n {4}needs: check\n[\s\S]*?permissions:\n {6}contents: read\n/m);
  assert.match(yaml, /node scripts\/gen-issue-forms\.mjs --check/);
  assert.match(yaml, /^ {2}forms:\n {4}needs: forms-check\n {4}if: needs\.forms-check\.outputs\.stale == 'true'\n[\s\S]*?permissions:\n {6}contents: write\n {4}concurrency:\n {6}group: source-code-writer\n {6}cancel-in-progress: false/m);
  assert.match(yaml, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(yaml, /echo "::add-mask::\$auth_b64"/);
  assert.match(yaml, /user\.name="github-actions\[bot\]" -c user\.email="41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/);
  assert.match(yaml, /commit -m "chore\(forms\): regenerate issue forms"/);
  assert.match(yaml, /for attempt in 1 2 3 4; do/);
  // deploy: reusable workflow in the pages-deploy queue
  assert.match(yaml, /^ {2}deploy:\n {4}needs: check\n {4}permissions:\n {6}contents: read\n {6}pages: write\n {6}id-token: write\n {4}concurrency:\n {6}group: pages-deploy\n {6}cancel-in-progress: false\n {4}uses: \.\/\.github\/workflows\/_deploy-pages\.yml\n {4}with:\n {6}expected_sha: \$\{\{ github\.sha \}\}/m);
  assert.deepEqual(expressions(yaml), ["${{ github.event.before }}", "${{ github.sha }}", "${{ github.token }}", "${{ steps.forms.outputs.stale }}"]);
});
