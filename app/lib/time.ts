import type { AppMeta } from "../types/domain";

type ActiveTimer = NonNullable<AppMeta["activeTimer"]>;

export function formatMinutes(minutes?: number) {
  if (minutes === undefined) return "未估时";
  if (minutes <= 0) return "0 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

/**
 * Compact timer copy: countdowns under one hour stay readable as MM:SS.
 * The hour field appears only once it is actually needed.
 */
export function formatTimerDisplay(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const rest = safeSeconds % 60;
  return hours > 0
    ? [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, rest].map((value) => String(value).padStart(2, "0")).join(":");
}

export function activeTimerElapsedSeconds(active: ActiveTimer, now: number) {
  const runningSeconds = active.pausedAt
    ? 0
    : Math.max(0, (now - new Date(active.startedAt).getTime()) / 1000);
  return Math.max(0, Math.floor((active.accumulatedSeconds ?? 0) + runningSeconds));
}

export function activeTimerDisplaySeconds(active: ActiveTimer, now: number) {
  const elapsed = activeTimerElapsedSeconds(active, now);
  return active.mode === "countdown"
    ? Math.max(0, (active.targetMinutes ?? 0) * 60 - elapsed)
    : elapsed;
}

export function activeTimerSessionMinutes(active: ActiveTimer, now: number) {
  const elapsed = activeTimerElapsedSeconds(active, now);
  const billableSeconds = active.mode === "countdown"
    ? Math.min(elapsed, Math.max(1, active.targetMinutes ?? 1) * 60)
    : elapsed;
  return Math.max(1, Math.round(billableSeconds / 60));
}

export function timerCycle(elapsedSeconds: number, intervalSeconds: number) {
  if (elapsedSeconds <= 0 || intervalSeconds <= 0) return 0;
  return Math.floor(elapsedSeconds / intervalSeconds);
}
