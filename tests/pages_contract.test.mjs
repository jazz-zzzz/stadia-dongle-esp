import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("GitHub Pages publishes the standalone USB configuration page", async () => {
  const workflow = await source("../.github/workflows/release.yml");
  const installer = await source("../docs/index.html");
  assert.match(workflow, /run:\s+npm test/);
  assert.match(workflow, /cp main\/index\.html docs\/config\.html/);
  assert.match(
    workflow,
    /cp main\/webhid_transport\.js docs\/webhid_transport\.js/,
  );
  assert.match(installer, /href="config\.html"/);
});

test("Pages deployment is guarded once and remains testable on feature branches", async () => {
  const workflow = await source("../.github/workflows/release.yml");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /- 'codex\/\*\*'/);

  const deployHeader = workflow.match(
    /  deploy-pages:[\s\S]*?    runs-on: ubuntu-latest/,
  );
  assert.ok(deployHeader, "deploy-pages job is present");
  assert.equal(
    [...deployHeader[0].matchAll(/^    if:/gm)].length,
    1,
    "deploy-pages has one job-level condition",
  );
  assert.match(deployHeader[0], /always\(\)/);
  assert.match(deployHeader[0], /refs\/heads\/main/);
  assert.match(deployHeader[0], /refs\/tags\//);
  assert.match(
    workflow,
    /Download freshly built firmware[\s\S]*?needs\.build-firmware\.result == 'success'/,
  );
});
test("the USB configuration page has no external runtime dependency", async () => {

  const index = await source("../main/index.html");
  const component = await source("../main/CMakeLists.txt");
  assert.match(index, /from "\.\/webhid_transport\.js"/);
  assert.doesNotMatch(index, /<script[^>]+src=["']https?:/i);
  assert.match(
    component,
    /EMBED_TXTFILES\s+"index\.html"\s+"webhid_transport\.js"/,
  );
});
