import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { assertBuildBudget, collectBuildBudget } from "../check-build-budget.mjs";

async function createBuildFixture(files) {
  const root = await mkdtemp(join(tmpdir(), "director-build-budget-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await Promise.all(Object.entries(files).map(async ([path, contents]) => {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }));
  return root;
}

it("accepts a split main entry within configured budgets", async () => {
  const root = await createBuildFixture({
    "assets/main-demo.js": "console.log('main')",
    "assets/three.module-demo.js": "three",
    "assets/gaussianSplatExperiment-demo.js": "gaussian",
  });

  const report = await collectBuildBudget(root);

  expect(() => assertBuildBudget(report, {
    mainEntryBytes: 100,
    threeSharedBytes: 100,
    gaussianExperimentBytes: 100,
    javascriptTotalBytes: 300,
    distTotalBytes: 300,
  })).not.toThrow();
});

it("rejects an oversized main entry", async () => {
  const root = await createBuildFixture({
    "assets/main-demo.js": "x".repeat(101),
    "assets/three.module-demo.js": "three",
    "assets/gaussianSplatExperiment-demo.js": "gaussian",
  });
  const report = await collectBuildBudget(root);

  expect(() => assertBuildBudget(report, {
    mainEntryBytes: 100,
    threeSharedBytes: 100,
    gaussianExperimentBytes: 100,
    javascriptTotalBytes: 300,
    distTotalBytes: 300,
  })).toThrow("主入口 JavaScript");
});

it("rejects a main entry that statically references the optional Gaussian experiment", async () => {
  const root = await createBuildFixture({
    "assets/main-demo.js": "import './gaussianSplatExperiment-demo.js'",
    "assets/three.module-demo.js": "three",
    "assets/gaussianSplatExperiment-demo.js": "gaussian",
  });
  const report = await collectBuildBudget(root);

  expect(() => assertBuildBudget(report, {
    mainEntryBytes: 100,
    threeSharedBytes: 100,
    gaussianExperimentBytes: 100,
    javascriptTotalBytes: 300,
    distTotalBytes: 300,
  })).toThrow("主入口不得加载高斯实验");
});
