// Issue validation entry point (scripts/validate-issue.mjs) and its workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDryRunGithub, readEventFile, run, shouldValidate } from "../../scripts/validate-issue.mjs";
import { repoOf } from "../../scripts/lib/github.mjs";
import { evaluateRequest } from "../../scripts/lib/issue-parse.mjs";
import { REPORT_MARKER, parseSnapshotMarker, snapshotHash } from "../../scripts/lib/snapshot.mjs";
import { createDataset, createDictionaries } from "../fixtures/dataset.mjs";
import { ADD_VALUES, createEvent, createIssue } from "../fixtures/issues.mjs";
import { memoryReader } from "../fixtures/memory.mjs";

const BOT = { login: "github-actions[bot]", type: "Bot" };
const REPO = { owner: "SpaceSquare640", repo: "Player-Club_Minecraft_Website" };
const EVENT_PATH = "/github/workflow/event.json";

/** Octokit stand-in recording every call; labels lists what the Issue currently has. */
function fakeGithub({ comments = [], labels = [] } = {}) {
  const calls = [];
  const state = { comments: comments.map((c) => ({ ...c })), labels: new Set(labels), nextId: 100 };
  const issues = {
    async addLabels(p) {
      calls.push(["addLabels", ...p.labels]);
      p.labels.forEach((l) => state.labels.add(l));
    },
    async removeLabel(p) {
      calls.push(["removeLabel", p.name]);
      if (!state.labels.delete(p.name)) throw Object.assign(new Error("Label does not exist"), { status: 404 });
    },
    async listComments() {
      return { data: state.comments };
    },
    async createComment(p) {
      const comment = { id: state.nextId++, body: p.body, user: BOT };
      state.comments.push(comment);
      calls.push(["createComment", comment.id]);
      return { data: comment };
    },
    async updateComment(p) {
      const comment = state.comments.find((c) => c.id === p.comment_id);
      comment.body = p.body;
      calls.push(["updateComment", p.comment_id]);
      return { data: comment };
    },
  };
  return { calls, state, github: { rest: { issues }, paginate: async (fn, params) => (await fn(params)).data } };
}

async function runEvent(event, { github, dataset = Object.assign(createDataset(), { i18n: createDictionaries() }) } = {}) {
  const fake = github ?? fakeGithub({ labels: event.issue.labels.map((l) => l.name) });
  const infos = [];
  const outcome = await run({
    github: fake.github,
    context: { repo: REPO },
    core: { info: (m) => infos.push(m) },
    env: { GITHUB_EVENT_PATH: EVENT_PATH },
    reader: memoryReader(dataset),
    readFileImpl: async (p) => {
      assert.equal(p, EVENT_PATH);
      return JSON.stringify(event);
    },
  });
  return { outcome, fake, infos, dataset };
}

const reportOf = (fake) => fake.state.comments.find((c) => c.body.startsWith(REPORT_MARKER)).body;

test("the event is read from GITHUB_EVENT_PATH only", async () => {
  await assert.rejects(readEventFile(undefined), /GITHUB_EVENT_PATH is not set/);
  const event = createEvent("opened", createIssue("add", ADD_VALUES));
  assert.deepEqual(await readEventFile("e.json", async () => JSON.stringify(event)), event);
});

test("only open coord-request Issues on opened / edited / reopened are validated", () => {
  const issue = createIssue("add", ADD_VALUES);
  assert.equal(shouldValidate(createEvent("opened", issue)).ok, true);
  assert.equal(shouldValidate(createEvent("reopened", issue)).ok, true);
  assert.equal(shouldValidate(createEvent("labeled", issue)).ok, false);
  assert.equal(shouldValidate(createEvent("edited", { ...issue, state: "closed" })).ok, false);
  assert.equal(shouldValidate(createEvent("edited", { ...issue, labels: [{ name: "type:add" }] })).ok, false);
  assert.equal(shouldValidate(createEvent("opened", { ...issue, pull_request: {} })).ok, false);
});

test("skipped events make no API calls", async () => {
  const fake = fakeGithub();
  const { outcome } = await runEvent(createEvent("opened", { ...createIssue("add", ADD_VALUES), state: "closed" }), { github: fake });
  assert.equal(outcome.skipped, true);
  assert.deepEqual(fake.calls, []);
});

test("pass: report created, pending-review added, needs-fix removed", async () => {
  const event = createEvent("opened", createIssue("add", ADD_VALUES));
  const { outcome, fake, infos, dataset } = await runEvent(event);
  assert.equal(outcome.status, "pass");
  assert.equal(outcome.hash, snapshotHash(evaluateRequest({ dataset, issue: event.issue }).request));
  assert.deepEqual(fake.calls, [["createComment", 100], ["addLabels", "pending-review"], ["removeLabel", "needs-fix"]]);
  assert.deepEqual(parseSnapshotMarker(reportOf(fake)), { version: 1, status: "pass", hash: outcome.hash });
  assert.ok(fake.state.labels.has("pending-review"));
  assert.equal(infos.length, 1);
  assert.ok(!infos[0].includes("My Base"), "user content is not logged");
});

test("fail: the bot report is updated, forged reports are ignored, needs-fix replaces pending-review", async () => {
  const forged = { id: 1, user: { login: "friend-01", type: "User" }, body: `${REPORT_MARKER}\n<!-- pcmw:snapshot v=1 status=pass sha256=${"0".repeat(64)} -->` };
  const previous = { id: 2, user: BOT, body: `${REPORT_MARKER}\nold report` };
  const issue = createIssue("add", { ...ADD_VALUES, x: "1e5" }, { labels: ["coord-request", "type:add", "pending-review"] });
  const fake = fakeGithub({ comments: [forged, previous], labels: ["coord-request", "type:add", "pending-review"] });
  const { outcome } = await runEvent(createEvent("edited", issue), { github: fake });
  assert.equal(outcome.status, "fail");
  assert.deepEqual(fake.calls, [["updateComment", 2], ["addLabels", "needs-fix"], ["removeLabel", "pending-review"]]);
  assert.equal(fake.state.comments[0].body, forged.body);
  assert.equal(parseSnapshotMarker(fake.state.comments[1].body).status, "fail");
  assert.ok(fake.state.labels.has("needs-fix") && !fake.state.labels.has("pending-review"));
});

test("approved is removed first when an approved Issue is edited or reopened", async () => {
  for (const action of ["edited", "reopened", "opened"]) {
    const labels = ["coord-request", "type:add", "pending-review", "approved"];
    const issue = createIssue("add", ADD_VALUES, { labels });
    const fake = fakeGithub({ labels });
    const { outcome } = await runEvent(createEvent(action, issue), { github: fake });
    assert.equal(outcome.approvalRemoved, true);
    assert.deepEqual(fake.calls[0], ["removeLabel", "approved"], action);
    assert.ok(!fake.state.labels.has("approved"));
    assert.ok(reportOf(fake).includes("> [!IMPORTANT]"));
  }
});

test("injection strings in the title and body are never executed or rendered as Markdown", async () => {
  const payload = "$(touch pwned) `id` ${{ github.token }} <img src=x onerror=alert(1)>";
  const issue = { ...createIssue("add", { ...ADD_VALUES, name: "Base", note: payload }), title: payload };
  const { outcome, fake, infos } = await runEvent(createEvent("opened", issue));
  assert.equal(outcome.status, "pass");
  assert.equal(outcome.result.request.note, payload);
  const report = reportOf(fake);
  assert.ok(report.includes(`| Note / 說明 | \`\`${payload}\`\` |`));
  assert.ok(!infos.join("\n").includes("pwned"));
});

test("scripts that handle Issue content never run shell commands or evaluate code", async () => {
  const files = [
    "scripts/validate-issue.mjs",
    "scripts/lib/issue-parse.mjs",
    "scripts/lib/normalize.mjs",
    "scripts/lib/messages.mjs",
    "scripts/lib/snapshot.mjs",
    "scripts/lib/github.mjs",
    "scripts/lib/form-fields.mjs",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    // RegExp.prototype.exec (".exec(") is allowed; a bare exec / execFile / spawn call is not.
    for (const pattern of [/child_process/, /\beval\(/, /new Function\b/, /(?<![.\w])exec(File|Sync)?\(/, /(?<![.\w])spawn(Sync)?\(/]) {
      assert.ok(!pattern.test(source), `${file} matches ${pattern}`);
    }
  }
});

test("dry-run client and repository lookup", async () => {
  const lines = [];
  const github = createDryRunGithub((l) => lines.push(l));
  await github.rest.issues.createComment({ ...REPO, issue_number: 1, body: "report" });
  assert.deepEqual(lines, [`[dry-run] createComment ${JSON.stringify({ ...REPO, issue_number: 1 })}`, "report"]);
  assert.deepEqual(await github.paginate(), []);
  assert.deepEqual(repoOf({ repo: REPO }), REPO);
  assert.deepEqual(repoOf(undefined, { GITHUB_REPOSITORY: "a/b" }), { owner: "a", repo: "b" });
  assert.throws(() => repoOf(undefined, {}), /Repository is unknown/);
});

test("workflow: minimal permissions, pinned official actions, no user values in expressions", async () => {
  const yaml = await readFile(new URL("../../.github/workflows/validate-issue.yml", import.meta.url), "utf8");
  assert.match(yaml, /^permissions: \{\}$/m);
  assert.match(yaml, /^ {4}permissions:\n {6}contents: read\n {6}issues: write$/m);
  assert.match(yaml, /types: \[opened, edited, reopened\]/);
  assert.match(yaml, /timeout-minutes: 5/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /run: npm ci --ignore-scripts/);
  assert.match(yaml, /node-version: 22/);
  assert.match(yaml, /ref: Source_Code/);

  const uses = [...yaml.matchAll(/uses: (.+)$/gm)].map((m) => m[1]);
  assert.equal(uses.length, 3);
  for (const line of uses) assert.match(line, /^actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line);

  // The only expression is the Issue number in the concurrency group; Issue text never appears.
  const expressions = [...yaml.matchAll(/\$\{\{[^}]*\}\}/g)].map((m) => m[0]);
  assert.deepEqual(expressions, ["${{ github.event.issue.number }}"]);
  assert.match(yaml, /^ {6}group: validate-issue-\$\{\{ github\.event\.issue\.number \}\}$/m);
  assert.doesNotMatch(yaml, /github\.event\.(issue\.(title|body|user)|comment)/);
  assert.match(yaml, /await import\(`\$\{process\.env\.GITHUB_WORKSPACE\}\/scripts\/validate-issue\.mjs`\)/);
});
