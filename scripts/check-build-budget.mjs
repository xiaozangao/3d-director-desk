import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BUILD_BUDGETS = Object.freeze({
  mainEntryBytes: 192 * 1024,
  threeSharedBytes: 800 * 1024,
  gaussianExperimentBytes: Math.round(5.25 * 1024 * 1024),
  javascriptTotalBytes: 7 * 1024 * 1024,
  distTotalBytes: 96 * 1024 * 1024,
});

async function collectFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(root, absolutePath);
    if (!entry.isFile()) return [];
    const metadata = await stat(absolutePath);
    return [{
      absolutePath,
      path: relative(root, absolutePath).replaceAll("\\", "/"),
      bytes: metadata.size,
    }];
  }));
  return nestedFiles.flat();
}

function requireSingleFile(files, label, pattern) {
  const matches = files.filter((file) => pattern.test(file.path));
  if (matches.length !== 1) {
    throw new Error(`${label} 构建文件数量应为 1，实际为 ${matches.length}`);
  }
  return matches[0];
}

export async function collectBuildBudget(root = resolve(process.cwd(), "dist")) {
  const files = await collectFiles(root);
  const mainEntry = requireSingleFile(files, "主入口", /^assets\/main-[^/]+\.js$/);
  const threeShared = requireSingleFile(files, "Three.js 共享块", /^assets\/three\.module-[^/]+\.js$/);
  const gaussianExperiment = requireSingleFile(
    files,
    "高斯实验",
    /^assets\/gaussianSplatExperiment-[^/]+\.js$/
  );
  const mainSource = await readFile(mainEntry.absolutePath, "utf8");

  return {
    mainEntry,
    threeShared,
    gaussianExperiment,
    javascriptTotalBytes: files
      .filter((file) => file.path.endsWith(".js"))
      .reduce((total, file) => total + file.bytes, 0),
    distTotalBytes: files.reduce((total, file) => total + file.bytes, 0),
    mainReferencesGaussianExperiment: mainSource.includes("gaussianSplatExperiment"),
  };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function assertBuildBudget(report, budgets = DEFAULT_BUILD_BUDGETS) {
  const checks = [
    ["主入口 JavaScript", report.mainEntry.bytes, budgets.mainEntryBytes],
    ["Three.js 共享块", report.threeShared.bytes, budgets.threeSharedBytes],
    ["高斯实验 JavaScript", report.gaussianExperiment.bytes, budgets.gaussianExperimentBytes],
    ["全部 JavaScript", report.javascriptTotalBytes, budgets.javascriptTotalBytes],
    ["dist 总体积", report.distTotalBytes, budgets.distTotalBytes],
  ];
  const failures = checks
    .filter(([, actual, maximum]) => actual > maximum)
    .map(([label, actual, maximum]) => `${label} ${formatBytes(actual)} 超过预算 ${formatBytes(maximum)}`);

  if (report.mainReferencesGaussianExperiment) {
    failures.push("主入口不得加载高斯实验；该实验必须保持独立入口");
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));
  return checks.map(([label, actual, maximum]) => ({ label, actual, maximum }));
}

async function main() {
  const report = await collectBuildBudget();
  const checks = assertBuildBudget(report);
  for (const check of checks) {
    console.log(`✓ ${check.label}: ${formatBytes(check.actual)} / ${formatBytes(check.maximum)}`);
  }
  console.log("✓ 主入口未静态加载高斯实验");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
