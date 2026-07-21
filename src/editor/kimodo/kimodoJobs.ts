import type { KimodoJob, KimodoJobStatus } from "./kimodoApi";

const TERMINAL_JOB_STATUSES = new Set<KimodoJobStatus>(["succeeded", "failed", "canceled"]);

export const KIMODO_STAGE_LABELS: Record<KimodoJobStatus, string> = {
  queued: "等待中",
  loading: "准备模型",
  generating: "生成动作",
  postprocessing: "动作修正",
  exporting: "导出 BVH",
  succeeded: "已完成",
  failed: "生成失败",
  canceled: "已取消",
};

export function isKimodoJobTerminal(job: Pick<KimodoJob, "status">) {
  return TERMINAL_JOB_STATUSES.has(job.status);
}
export function mergeKimodoJobs(current: KimodoJob[], incoming: KimodoJob[]) {
  const jobs = new Map(current.map((job) => [job.id, job]));
  incoming.forEach((job) => jobs.set(job.id, job));
  return [...jobs.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);
}
