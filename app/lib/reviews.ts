export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30] as const;

export function defaultReviewPlanTemplates(now = new Date().toISOString()) {
  return [{
    id: "review-template-ebbinghaus",
    name: "艾宾浩斯计划",
    intervalsDays: [...EBBINGHAUS_INTERVALS],
    enabled: true,
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  }];
}

export function normalizeReviewIntervals(value: string | number[]) {
  const values = Array.isArray(value) ? value : value.split(/[，,、\s]+/).map(Number);
  return [...new Set(values.filter((item) => Number.isInteger(item) && item > 0 && item <= 365))].sort((a, b) => a - b);
}

export function addReviewDays(baseDate: string, intervalDays: number) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + intervalDays);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
