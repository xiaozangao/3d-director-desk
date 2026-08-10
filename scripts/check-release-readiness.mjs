import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getReleaseBlockers(inventory) {
  if (!inventory || !Array.isArray(inventory.assets)) {
    throw new Error("资产清单缺少 assets 数组");
  }

  return inventory.assets
    .filter((asset) => asset?.redistributionStatus !== "approved-for-redistribution")
    .map((asset) => `${asset?.path ?? "unknown"}: ${asset?.redistributionStatus ?? "missing-status"}`);
}

async function main() {
  const inventoryPath = resolve(process.cwd(), "docs/release/asset-inventory.json");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const blockers = getReleaseBlockers(inventory);

  if (blockers.length > 0) {
    throw new Error([
      "候选发布已阻断：以下资产尚未取得可再分发批准：",
      ...blockers.map((blocker) => `- ${blocker}`),
      "完成许可证核验并更新 asset-inventory.json 后才能解除门禁。",
    ].join("\n"));
  }

  console.log(`✓ ${inventory.assets.length} 项资产范围均已批准再分发`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
