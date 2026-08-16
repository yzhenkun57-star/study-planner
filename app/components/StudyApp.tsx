"use client";

import { ChangeEvent, FormEvent, Fragment, useEffect, useRef, useState } from "react";
import { emptySnapshot, loadSnapshot, makeBackup, saveSnapshot, validateBackup } from "../lib/storage";
import { parseMarkdownPlan, type ParsedMarkdownPlan } from "../lib/markdown-plan";
import { deleteTaskFromSnapshot, deleteUnusedSubjectFromSnapshot, moveTaskInHierarchy, moveTaskToTrash, possibleTaskParents, purgeExpiredDeletedTasks, restoreTaskFromTrash } from "../lib/tasks";
import { activeTimerDisplaySeconds, activeTimerElapsedSeconds, activeTimerSessionMinutes, formatMinutes, formatTimerDisplay, timerCycle } from "../lib/time";
import { analyzeDataHealth } from "../lib/data-health";
import { addReviewDays, normalizeReviewIntervals } from "../lib/reviews";
import { ReviewCenter } from "./ReviewCenter";
import { ScoreAnalytics } from "./ScoreAnalytics";
import type { AppSnapshot, ContentNode, Goal, MasteryLevel, RepeatRule, ReviewPlanTemplate, Stage, StudySession, Subject, Task, TaskCheckin, TaskCompletionMode, TaskSchedule } from "../types/domain";

type View = "dashboard" | "calendar" | "subjects" | "import" | "focus" | "review" | "analytics" | "settings";
type DraftSubject = Pick<Subject, "id" | "name" | "color" | "targetScore" | "targetStartDate" | "targetDate">;
type TaskDefaults = { date?: string; subjectId?: string; parentTaskId?: string; stageId?: string; contentNodeId?: string };
type AppPrompt = { title: string; message?: string; value: string; inputLabel: string; confirmLabel?: string; onConfirm: (value: string) => void | Promise<void> };
type AppConfirm = { title: string; message: string; confirmLabel?: string; tone?: "default" | "danger"; onConfirm: () => void | Promise<void> };

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "仪表盘", icon: "◫" },
  { id: "calendar", label: "日历", icon: "▦" },
  { id: "subjects", label: "科目", icon: "▤" },
  { id: "focus", label: "专注", icon: "⌛" },
  { id: "review", label: "复盘", icon: "↻" },
  { id: "analytics", label: "统计", icon: "◔" },
  { id: "settings", label: "设置", icon: "·" },
];

const SUBJECT_COLORS = ["#7c5cff", "#4f87ff", "#ff6f79", "#f0a53b", "#27b879", "#5a9cae"];
const DEFAULT_SUBJECTS: DraftSubject[] = [
  { id: cryptoId(), name: "数学一", color: SUBJECT_COLORS[0], targetScore: 120 },
  { id: cryptoId(), name: "英语一", color: SUBJECT_COLORS[1], targetScore: 70 },
  { id: cryptoId(), name: "政治", color: SUBJECT_COLORS[2], targetScore: 70 },
  { id: cryptoId(), name: "专业课", color: SUBJECT_COLORS[3], targetScore: 120 },
];
const LIFE_SUBJECTS: DraftSubject[] = [
  { id: cryptoId(), name: "健康", color: SUBJECT_COLORS[4] },
  { id: cryptoId(), name: "阅读", color: SUBJECT_COLORS[0] },
  { id: cryptoId(), name: "技能", color: SUBJECT_COLORS[1] },
  { id: cryptoId(), name: "生活", color: SUBJECT_COLORS[3] },
];

function cryptoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localDate(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function daysUntil(date: string) {
  const today = new Date(`${localDate(new Date())}T00:00:00`);
  const target = new Date(`${date}T00:00:00`);
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
}

function examProgress(goal: Goal) {
  const start = goal.targetStartDate ? new Date(`${goal.targetStartDate}T00:00:00`).getTime() : new Date(goal.createdAt).getTime();
  const target = new Date(`${goal.examDate}T00:00:00`).getTime();
  const now = Date.now();
  if (target <= start) return 100;
  return Math.max(0, Math.min(100, ((now - start) / (target - start)) * 100));
}

function buildSubjects(drafts: DraftSubject[]): Subject[] {
  const now = new Date().toISOString();
  return drafts.map((draft, index) => ({
    ...draft,
    name: draft.name.trim(),
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  }));
}

function dayDifference(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function inclusiveDayCount(from?: string, to?: string) {
  if (!from) return 0;
  return dayDifference(from, to || from) + 1;
}

function timeToMinute(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Math.max(0, Math.min(1439, (hours || 0) * 60 + (minutes || 0)));
}

function minuteToTime(value?: number) {
  const safe = Math.max(0, Math.min(1439, value ?? 9 * 60));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function formatHeatmapHours(minutes: number) {
  return minutes > 0 ? `${(minutes / 60).toFixed(1)}h` : "—";
}

function closestMinute(value: number | undefined, options: number[], fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return options.reduce((best, option) => Math.abs(option - Number(value)) < Math.abs(best - Number(value)) ? option : best, options[0]);
}

function normalizedFocusSettings(settings?: AppSnapshot["meta"]["focusSettings"]): NonNullable<AppSnapshot["meta"]["focusSettings"]> {
  return {
    focusMinutes: closestMinute(settings?.focusMinutes, [25, 40, 45, 50, 60, 90], 50),
    restMinutes: closestMinute(settings?.restMinutes, [5, 10, 15, 20, 30], 10),
    pauseReminderMinutes: closestMinute(settings?.pauseReminderMinutes, [5, 10, 15, 20], 5),
    countupReminderMinutes: closestMinute(settings?.countupReminderMinutes, [15, 30, 45, 60, 90], 30),
    soundEnabled: settings?.soundEnabled ?? true,
    hourglassQuality: settings?.hourglassQuality ?? "balanced",
  };
}

function applyAutoRollovers(snapshot: AppSnapshot): AppSnapshot {
  const today = localDate(new Date());
  let changed = false;
  const taskMap = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const taskSchedules = snapshot.taskSchedules.map((schedule) => {
    const task = taskMap.get(schedule.taskId);
    if (!task || task.status !== "active" || !task.autoRollover || schedule.plannedDate >= today) return schedule;
    changed = true;
    return {
      ...schedule,
      plannedDate: today,
      rolloverCount: schedule.rolloverCount + 1,
      totalDelayedDays: schedule.totalDelayedDays + dayDifference(schedule.plannedDate, today),
      updatedAt: new Date().toISOString(),
    };
  });
  return changed ? { ...snapshot, taskSchedules, meta: { ...snapshot.meta, updatedAt: new Date().toISOString() } } : snapshot;
}

export function StudyApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [error, setError] = useState("");
  const [taskDialog, setTaskDialog] = useState<TaskDefaults | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [timerDialog, setTimerDialog] = useState<{ taskId?: string; subjectId?: string } | null>(null);
  const [completionDialog, setCompletionDialog] = useState<Task | null>(null);
  const [planAdjustment, setPlanAdjustment] = useState<{ taskIds: string[]; targetDate: string } | null>(null);
  const [appPrompt, setAppPrompt] = useState<AppPrompt | null>(null);
  const [appConfirm, setAppConfirm] = useState<AppConfirm | null>(null);
  const [dailyTargetDialog, setDailyTargetDialog] = useState(false);
  const [goalDialog, setGoalDialog] = useState<"exam" | "school" | null>(null);
  const [completionUndo, setCompletionUndo] = useState<{ task: Task; generatedTaskIds: string[]; reviewPlanId?: string } | null>(null);
  const [timerNow, setTimerNow] = useState(0);

  useEffect(() => {
    loadSnapshot().then(async (loaded) => {
      const purged = purgeExpiredDeletedTasks(loaded, new Date().toISOString());
      const normalized = applyAutoRollovers(purged);
      setSnapshot(normalized);
      if (normalized !== loaded) await saveSnapshot(normalized);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "本地数据读取失败");
      setSnapshot(emptySnapshot());
    });
  }, []);

  useEffect(() => {
    if (!snapshot?.meta.activeTimer) return;
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [snapshot?.meta.activeTimer]);

  useEffect(() => {
    if (!completionUndo) return;
    const timeout = window.setTimeout(() => setCompletionUndo(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [completionUndo]);

  const persist = async (next: AppSnapshot) => {
    setSnapshot(next);
    try {
      await saveSnapshot(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "数据保存失败");
      throw cause;
    }
  };

  const createTask = async (input: TaskDraft) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const taskId = cryptoId();
    const task: Task = {
      id: taskId,
      title: input.title.trim(),
      subjectId: input.subjectId,
      parentTaskId: input.parentTaskId || undefined,
      stageId: input.stageId || undefined,
      contentNodeId: input.contentNodeId || undefined,
      completionMode: input.completionMode,
      status: "active",
      estimatedMinutes: input.estimatedMinutes || undefined,
      deadline: input.deadline || undefined,
      autoRollover: input.autoRollover,
      note: input.note.trim() || undefined,
      important: input.important,
      tags: input.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      includeInProgress: true,
      progressStart: input.completionMode === "quantity" ? input.progressStart : undefined,
      progressCurrent: input.completionMode === "quantity" ? input.progressStart : undefined,
      progressTarget: input.completionMode === "quantity" ? input.progressTarget : undefined,
      progressUnit: input.completionMode === "quantity" ? input.progressUnit.trim() : undefined,
      progressStep: input.completionMode === "quantity" ? input.progressStep : undefined,
      dailyMinimum: input.completionMode === "quantity" ? input.dailyMinimum : undefined,
      reviewPlanTemplateId: input.reviewPlanTemplateId || undefined,
      sortOrder: snapshot.tasks.filter((item) => item.subjectId === input.subjectId && (item.parentTaskId ?? "") === (input.parentTaskId || "")).length,
      createdAt: now,
      updatedAt: now,
    };
    const schedule: TaskSchedule | null = input.plannedDate ? {
      id: cryptoId(),
      taskId,
      plannedDate: input.plannedDate,
      originalPlannedDate: input.plannedDate,
      timeMode: input.timeMode,
      plannedStartMinute: input.timeMode === "none" ? undefined : timeToMinute(input.startTime),
      plannedDurationMinutes: input.timeMode === "range" ? Math.max(30, timeToMinute(input.endTime) - timeToMinute(input.startTime)) : undefined,
      reminderEnabled: input.timeMode !== "none" && input.reminderEnabled,
      reminderMinutesBefore: input.reminderEnabled ? input.reminderMinutesBefore : undefined,
      rolloverCount: 0,
      totalDelayedDays: 0,
      createdAt: now,
      updatedAt: now,
    } : null;
    const repeatRule: RepeatRule | null = input.repeatFrequency === "none" ? null : {
      id: cryptoId(), taskId, frequency: input.repeatFrequency, intervalDays: input.repeatFrequency === "interval" ? input.repeatIntervalDays : undefined, weekdays: input.repeatFrequency === "weekly" ? input.repeatWeekdays : undefined, endsOn: input.repeatEndsOn || undefined, createdAt: now, updatedAt: now,
    };
    await persist({
      ...snapshot,
      tasks: [...snapshot.tasks, task],
      taskSchedules: schedule ? [...snapshot.taskSchedules, schedule] : snapshot.taskSchedules,
      repeatRules: repeatRule ? [...snapshot.repeatRules, repeatRule] : snapshot.repeatRules,
      meta: { ...snapshot.meta, updatedAt: now },
    });
    setTaskDialog(null);
  };

  const saveTaskEdits = async (taskId: string, input: TaskDraft) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const tasks = snapshot.tasks.map((task) => task.id === taskId ? {
      ...task,
      title: input.title.trim(), subjectId: input.subjectId, parentTaskId: input.parentTaskId || undefined, stageId: input.stageId || undefined,
      contentNodeId: input.contentNodeId || undefined, completionMode: input.completionMode,
      estimatedMinutes: input.estimatedMinutes || undefined, deadline: input.deadline || undefined,
      autoRollover: input.autoRollover,
      note: input.note.trim() || undefined, important: input.important,
      tags: input.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      progressStart: input.completionMode === "quantity" ? input.progressStart : undefined,
      progressCurrent: input.completionMode === "quantity" ? Math.max(input.progressStart, Math.min(input.progressTarget, task.progressCurrent ?? input.progressStart)) : undefined,
      progressTarget: input.completionMode === "quantity" ? input.progressTarget : undefined,
      progressUnit: input.completionMode === "quantity" ? input.progressUnit.trim() : undefined,
      progressStep: input.completionMode === "quantity" ? input.progressStep : undefined,
      dailyMinimum: input.completionMode === "quantity" ? input.dailyMinimum : undefined,
      reviewPlanTemplateId: input.reviewPlanTemplateId || undefined,
      updatedAt: now,
    } : task);
    const existingSchedule = snapshot.taskSchedules.find((schedule) => schedule.taskId === taskId);
    let taskSchedules = snapshot.taskSchedules;
    if (!input.plannedDate) taskSchedules = taskSchedules.filter((schedule) => schedule.taskId !== taskId);
    else if (existingSchedule) taskSchedules = taskSchedules.map((schedule) => schedule.taskId === taskId ? { ...schedule, plannedDate: input.plannedDate, timeMode: input.timeMode, plannedStartMinute: input.timeMode === "none" ? undefined : timeToMinute(input.startTime), plannedDurationMinutes: input.timeMode === "range" ? Math.max(30, timeToMinute(input.endTime) - timeToMinute(input.startTime)) : undefined, reminderEnabled: input.timeMode !== "none" && input.reminderEnabled, reminderMinutesBefore: input.reminderEnabled ? input.reminderMinutesBefore : undefined, updatedAt: now } : schedule);
    else taskSchedules = [...taskSchedules, { id: cryptoId(), taskId, plannedDate: input.plannedDate, originalPlannedDate: input.plannedDate, timeMode: input.timeMode, plannedStartMinute: input.timeMode === "none" ? undefined : timeToMinute(input.startTime), plannedDurationMinutes: input.timeMode === "range" ? Math.max(30, timeToMinute(input.endTime) - timeToMinute(input.startTime)) : undefined, reminderEnabled: input.timeMode !== "none" && input.reminderEnabled, reminderMinutesBefore: input.reminderEnabled ? input.reminderMinutesBefore : undefined, rolloverCount: 0, totalDelayedDays: 0, createdAt: now, updatedAt: now }];
    const existingRule = snapshot.repeatRules.find((rule) => rule.taskId === taskId);
    let repeatRules = snapshot.repeatRules;
    if (input.repeatFrequency === "none") repeatRules = repeatRules.filter((rule) => rule.taskId !== taskId);
    else {
      const nextRule: RepeatRule = { id: existingRule?.id ?? cryptoId(), taskId, frequency: input.repeatFrequency, intervalDays: input.repeatFrequency === "interval" ? input.repeatIntervalDays : undefined, weekdays: input.repeatFrequency === "weekly" ? input.repeatWeekdays : undefined, endsOn: input.repeatEndsOn || undefined, createdAt: existingRule?.createdAt ?? now, updatedAt: now };
      repeatRules = existingRule ? repeatRules.map((rule) => rule.taskId === taskId ? nextRule : rule) : [...repeatRules, nextRule];
    }
    await persist({ ...snapshot, tasks, taskSchedules, repeatRules, meta: { ...snapshot.meta, updatedAt: now } });
    setEditingTask(null);
  };

  const deleteTask = async (taskId: string) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    await persist(moveTaskToTrash(snapshot, taskId, now));
    setEditingTask(null);
  };

  const updateTaskCheckin = async (task: Task, date: string, quantity: number) => {
    if (!snapshot || task.completionMode !== "quantity") return;
    const now = new Date().toISOString();
    const currentTask = snapshot.tasks.find((item) => item.id === task.id) ?? task;
    const minimum = Math.max(.01, currentTask.dailyMinimum ?? 1);
    const previous = snapshot.taskCheckins.find((item) => item.taskId === task.id && item.date === date);
    const normalized = Math.max(0, quantity);
    const checkin: TaskCheckin = previous
      ? { ...previous, quantity: normalized, completed: normalized >= minimum, updatedAt: now }
      : { id: cryptoId(), taskId: task.id, date, quantity: normalized, completed: normalized >= minimum, createdAt: now, updatedAt: now };
    const progressStart = currentTask.progressStart ?? 0;
    const progressTarget = currentTask.progressTarget ?? progressStart;
    const currentProgress = currentTask.progressCurrent ?? progressStart;
    const nextProgress = Math.min(progressTarget, Math.max(progressStart, currentProgress + normalized - (previous?.quantity ?? 0)));
    await persist({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => item.id === task.id ? { ...item, progressCurrent: nextProgress, updatedAt: now } : item),
      taskCheckins: previous ? snapshot.taskCheckins.map((item) => item.id === previous.id ? checkin : item) : [...snapshot.taskCheckins, checkin],
      meta: { ...snapshot.meta, updatedAt: now },
    });
  };

  const completeTaskWithRepeat = async (task: Task, quick = false) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const originalTask = snapshot.tasks.find((item) => item.id === task.id);
    if (!originalTask || originalTask.status !== "active") return;
    const rule = snapshot.repeatRules.find((item) => item.taskId === task.id);
    const currentSchedule = snapshot.taskSchedules.find((item) => item.taskId === task.id);
    const generatedTaskIds: string[] = [];
    const completedProgress = task.completionMode === "quantity" && task.dailyMinimum
      ? task.progressCurrent
      : task.completionMode === "quantity" ? task.progressTarget : task.progressCurrent;
    let nextTasks = snapshot.tasks.map((item) => item.id === task.id ? { ...item, status: "completed" as const, completedAt: now, progressCurrent: completedProgress, updatedAt: now } : item);
    let nextSchedules = snapshot.taskSchedules;
    let nextRules = snapshot.repeatRules;
    let nextReviewPlans = snapshot.reviewPlans;
    if (rule && currentSchedule) {
      const nextDate = new Date(`${currentSchedule.plannedDate}T00:00:00`);
      if (rule.frequency === "daily") nextDate.setDate(nextDate.getDate() + 1);
      if (rule.frequency === "interval") nextDate.setDate(nextDate.getDate() + Math.max(1, rule.intervalDays ?? 1));
      if (rule.frequency === "weekly") {
        const allowed = rule.weekdays?.length ? rule.weekdays : [nextDate.getDay()];
        do { nextDate.setDate(nextDate.getDate() + 1); } while (!allowed.includes(nextDate.getDay()));
      }
      const nextDateString = localDate(nextDate);
      if (!rule.endsOn || nextDateString <= rule.endsOn) {
        const nextId = cryptoId();
        generatedTaskIds.push(nextId);
        const nextTask: Task = { ...task, id: nextId, repeatedFromTaskId: task.id, status: "active", completedAt: undefined, progressCurrent: task.completionMode === "quantity" ? task.progressStart : task.progressCurrent, createdAt: now, updatedAt: now };
        nextTasks = [...nextTasks, nextTask];
        nextSchedules = [...nextSchedules, { id: cryptoId(), taskId: nextId, plannedDate: nextDateString, originalPlannedDate: nextDateString, timeMode: currentSchedule.timeMode, plannedStartMinute: currentSchedule.plannedStartMinute, plannedDurationMinutes: currentSchedule.plannedDurationMinutes, reminderEnabled: currentSchedule.reminderEnabled, reminderMinutesBefore: currentSchedule.reminderMinutesBefore, rolloverCount: 0, totalDelayedDays: 0, createdAt: now, updatedAt: now }];
        nextRules = [...nextRules, { ...rule, id: cryptoId(), taskId: nextId, createdAt: now, updatedAt: now }];
      }
    }
    const reviewTemplate = snapshot.reviewPlanTemplates.find((template) => template.id === task.reviewPlanTemplateId && template.enabled);
    let reviewPlanId: string | undefined;
    if (reviewTemplate && !snapshot.reviewPlans.some((plan) => plan.sourceTaskId === task.id)) {
      reviewPlanId = cryptoId();
      const baseDate = currentSchedule?.plannedDate ?? localDate(new Date());
      const reviewTaskIds: string[] = [];
      reviewTemplate.intervalsDays.forEach((days, index) => {
        const reviewTaskId = cryptoId();
        const plannedDate = addReviewDays(baseDate, days);
        reviewTaskIds.push(reviewTaskId);
        generatedTaskIds.push(reviewTaskId);
        nextTasks.push({ ...task, id: reviewTaskId, title: `复习 · ${task.title}（第 ${index + 1} 次）`, completionMode: "check", status: "active", reviewPlanTemplateId: undefined, repeatedFromTaskId: undefined, progressStart: undefined, progressCurrent: undefined, progressTarget: undefined, progressUnit: undefined, progressStep: undefined, dailyMinimum: undefined, deadline: plannedDate, estimatedMinutes: Math.min(task.estimatedMinutes ?? 30, 45), completedAt: undefined, sortOrder: snapshot.tasks.length + index, createdAt: now, updatedAt: now });
        nextSchedules.push({ id: cryptoId(), taskId: reviewTaskId, plannedDate, originalPlannedDate: plannedDate, timeMode: "none", rolloverCount: 0, totalDelayedDays: 0, createdAt: now, updatedAt: now });
      });
      nextReviewPlans = [...nextReviewPlans, { id: reviewPlanId, sourceTaskId: task.id, mode: reviewTemplate.builtIn ? "ebbinghaus" : "custom", baseDate, intervalsDays: reviewTemplate.intervalsDays, createdTaskIds: reviewTaskIds, createdAt: now, updatedAt: now }];
    }
    await persist({ ...snapshot, tasks: nextTasks, taskSchedules: nextSchedules, repeatRules: nextRules, reviewPlans: nextReviewPlans, meta: { ...snapshot.meta, updatedAt: now } });
    setCompletionUndo({ task: originalTask, generatedTaskIds, reviewPlanId });
    if (!quick) setCompletionDialog(task);
  };

  const toggleTaskCompletion = async (task: Task, quick = true) => {
    if (!snapshot) return;
    if (task.status !== "completed") return completeTaskWithRepeat(task, quick);
    const now = new Date().toISOString();
    const plan = snapshot.reviewPlans.find((item) => item.sourceTaskId === task.id);
    const generatedIds = new Set([
      ...snapshot.tasks.filter((item) => item.repeatedFromTaskId === task.id && item.status === "active").map((item) => item.id),
      ...(plan?.createdTaskIds ?? []),
    ]);
    await persist({
      ...snapshot,
      tasks: snapshot.tasks.map((item): Task => item.id === task.id ? { ...item, status: "active", completedAt: undefined, updatedAt: now } : item).filter((item) => !generatedIds.has(item.id)),
      taskSchedules: snapshot.taskSchedules.filter((item) => !generatedIds.has(item.taskId)),
      repeatRules: snapshot.repeatRules.filter((item) => !generatedIds.has(item.taskId)),
      reviewPlans: snapshot.reviewPlans.filter((item) => item.id !== plan?.id),
      meta: { ...snapshot.meta, updatedAt: now },
    });
  };

  const undoLastCompletion = async () => {
    if (!snapshot || !completionUndo) return;
    const now = new Date().toISOString();
    const restoredTask = { ...completionUndo.task, updatedAt: now };
    const hasOriginal = snapshot.tasks.some((task) => task.id === restoredTask.id);
    const tasks = (hasOriginal ? snapshot.tasks.map((task) => task.id === restoredTask.id ? restoredTask : task) : [...snapshot.tasks, restoredTask])
      .filter((task) => !completionUndo.generatedTaskIds.includes(task.id));
    await persist({
      ...snapshot,
      tasks,
      taskSchedules: snapshot.taskSchedules.filter((schedule) => !completionUndo.generatedTaskIds.includes(schedule.taskId)),
      repeatRules: snapshot.repeatRules.filter((rule) => !completionUndo.generatedTaskIds.includes(rule.taskId)),
      reviewPlans: snapshot.reviewPlans.filter((plan) => plan.id !== completionUndo.reviewPlanId),
      meta: { ...snapshot.meta, updatedAt: now },
    });
    if (completionDialog?.id === restoredTask.id) setCompletionDialog(null);
    setCompletionUndo(null);
  };

  const saveCompletionFeedback = async (taskId: string, actualMinutes?: number, mastery?: MasteryLevel) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    let sessions = snapshot.studySessions;
    if (actualMinutes && actualMinutes > 0) sessions = [...sessions, { id: cryptoId(), subjectId: snapshot.tasks.find((task) => task.id === taskId)?.subjectId ?? "", taskId, startedAt: now, endedAt: now, durationMinutes: actualMinutes, createdAt: now, updatedAt: now }];
    await persist({ ...snapshot, studySessions: sessions, tasks: snapshot.tasks.map((task) => task.id === taskId ? { ...task, mastery, updatedAt: now } : task), meta: { ...snapshot.meta, updatedAt: now } });
    setCompletionDialog(null);
  };

  const rescheduleTask = async (taskId: string, plannedDate: string, schedulePatch: Partial<TaskSchedule> = {}) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const existing = snapshot.taskSchedules.find((schedule) => schedule.taskId === taskId);
    const taskSchedules = existing
      ? snapshot.taskSchedules.map((schedule) => schedule.taskId === taskId ? { ...schedule, ...schedulePatch, plannedDate, updatedAt: now } : schedule)
      : [...snapshot.taskSchedules, { id: cryptoId(), taskId, plannedDate, originalPlannedDate: plannedDate, rolloverCount: 0, totalDelayedDays: 0, createdAt: now, updatedAt: now, ...schedulePatch }];
    await persist({ ...snapshot, taskSchedules, meta: { ...snapshot.meta, updatedAt: now } });
  };

  const applyPlanAdjustment = async () => {
    if (!snapshot || !planAdjustment) return;
    const now = new Date().toISOString();
    const taskIds = new Set(planAdjustment.taskIds);
    const existingIds = new Set(snapshot.taskSchedules.map((schedule) => schedule.taskId));
    const taskSchedules = snapshot.taskSchedules.map((schedule) => taskIds.has(schedule.taskId) ? { ...schedule, plannedDate: planAdjustment.targetDate, updatedAt: now } : schedule);
    for (const taskId of planAdjustment.taskIds) if (!existingIds.has(taskId)) taskSchedules.push({ id: cryptoId(), taskId, plannedDate: planAdjustment.targetDate, originalPlannedDate: planAdjustment.targetDate, rolloverCount: 0, totalDelayedDays: 0, createdAt: now, updatedAt: now });
    await persist({ ...snapshot, taskSchedules, meta: { ...snapshot.meta, updatedAt: now } });
    setPlanAdjustment(null);
  };

  const setDailyTarget = async (targetMinutes: number) => {
    if (!snapshot) return;
    const today = localDate(new Date());
    const now = new Date().toISOString();
    const existing = snapshot.dailyTargets.find((target) => target.date === today);
    const dailyTargets = existing
      ? snapshot.dailyTargets.map((target) => target.date === today ? { ...target, targetMinutes, updatedAt: now } : target)
      : [...snapshot.dailyTargets, { id: cryptoId(), date: today, targetMinutes, createdAt: now, updatedAt: now }];
    await persist({ ...snapshot, dailyTargets, meta: { ...snapshot.meta, updatedAt: now } });
  };

  const setTheme = async (theme: "light" | "dark") => {
    if (!snapshot) return;
    await persist({ ...snapshot, meta: { ...snapshot.meta, theme, updatedAt: new Date().toISOString() } });
  };

  const setSidebarCollapsed = async (collapsed: boolean) => {
    if (!snapshot) return;
    await persist({ ...snapshot, meta: { ...snapshot.meta, sidebarCollapsed: collapsed, updatedAt: new Date().toISOString() } });
  };

  const moveTask = async (taskId: string, newParentTaskId?: string, beforeTaskId?: string, contentNodeId?: string) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const next = moveTaskInHierarchy(snapshot, taskId, newParentTaskId, beforeTaskId, now, contentNodeId);
    if (next !== snapshot) await persist(next);
  };

  const startTimer = async (subjectId: string, taskId?: string, mode: "countup" | "countdown" = "countup", targetMinutes?: number) => {
    if (!snapshot || snapshot.meta.activeTimer) return;
    const now = new Date().toISOString();
    await persist({ ...snapshot, meta: { ...snapshot.meta, activeTimer: { subjectId, taskId, kind: "focus", sessionStartedAt: now, startedAt: now, mode, targetMinutes: mode === "countdown" ? targetMinutes : undefined, accumulatedSeconds: 0 }, updatedAt: now } });
    setTimerNow(Date.now());
    setTimerDialog(null);
  };

  const stopTimer = async (startRest = false) => {
    if (!snapshot?.meta.activeTimer) return;
    const active = snapshot.meta.activeTimer;
    const endedAt = new Date().toISOString();
    if (active.kind === "rest") {
      await persist({ ...snapshot, meta: { ...snapshot.meta, activeTimer: undefined, updatedAt: endedAt } });
      return;
    }
    const durationMinutes = activeTimerSessionMinutes(active, new Date(endedAt).getTime());
    const session: StudySession = { id: cryptoId(), subjectId: active.subjectId, taskId: active.taskId, startedAt: active.sessionStartedAt ?? active.startedAt, endedAt, durationMinutes, createdAt: endedAt, updatedAt: endedAt };
    const restMinutes = Math.max(1, snapshot.meta.focusSettings?.restMinutes ?? 10);
    const restTimer = startRest ? { subjectId: active.subjectId, kind: "rest" as const, sessionStartedAt: endedAt, startedAt: endedAt, mode: "countdown" as const, targetMinutes: restMinutes, accumulatedSeconds: 0 } : undefined;
    await persist({ ...snapshot, studySessions: [...snapshot.studySessions, session], meta: { ...snapshot.meta, activeTimer: restTimer, updatedAt: endedAt } });
    if (restTimer) setTimerNow(Date.now());
  };

  const cancelTimer = async () => {
    if (!snapshot?.meta.activeTimer) return;
    const now = new Date().toISOString();
    await persist({ ...snapshot, meta: { ...snapshot.meta, activeTimer: undefined, updatedAt: now } });
  };

  const pauseTimer = async () => {
    if (!snapshot?.meta.activeTimer || snapshot.meta.activeTimer.pausedAt) return;
    const now = new Date().toISOString();
    const active = snapshot.meta.activeTimer;
    const elapsed = Math.max(0, (new Date(now).getTime() - new Date(active.startedAt).getTime()) / 1000);
    await persist({ ...snapshot, meta: { ...snapshot.meta, activeTimer: { ...active, accumulatedSeconds: (active.accumulatedSeconds ?? 0) + elapsed, pausedAt: now }, updatedAt: now } });
  };

  const resumeTimer = async () => {
    if (!snapshot?.meta.activeTimer?.pausedAt) return;
    const now = new Date().toISOString();
    await persist({ ...snapshot, meta: { ...snapshot.meta, activeTimer: { ...snapshot.meta.activeTimer, startedAt: now, pausedAt: undefined }, updatedAt: now } });
    setTimerNow(Date.now());
  };

  const resetTimer = async () => {
    if (!snapshot?.meta.activeTimer) return;
    const now = new Date().toISOString();
    await persist({ ...snapshot, meta: { ...snapshot.meta, activeTimer: { ...snapshot.meta.activeTimer, sessionStartedAt: now, startedAt: now, accumulatedSeconds: 0, pausedAt: undefined }, updatedAt: now } });
    setTimerNow(Date.now());
  };

  if (!snapshot) {
    return <div className="loading-screen"><div><div className="loading-mark" /><div>正在读取你的本地学习空间…</div></div></div>;
  }

  if (!snapshot.meta.onboardingComplete || !snapshot.goal) {
    return <Onboarding snapshot={snapshot} persist={persist} error={error} />;
  }

  return (
    <div className="app-shell" data-theme={snapshot.meta.theme ?? "light"} data-sidebar={snapshot.meta.sidebarCollapsed ? "collapsed" : "open"} data-focus-active={snapshot.meta.activeTimer && view === "focus" ? "true" : "false"}>
      <Sidebar goal={snapshot.goal} mode={snapshot.meta.workspaceMode ?? "exam"} view={view} setView={setView} collapsed={Boolean(snapshot.meta.sidebarCollapsed)} setCollapsed={setSidebarCollapsed} />
      <main className="main">
        {error && <div className="notice" role="alert">{error}</div>}
        {view === "dashboard" && <Dashboard snapshot={snapshot} persist={persist} openTask={() => setTaskDialog({ date: localDate(new Date()) })} openEdit={setEditingTask} openDailyTarget={() => setDailyTargetDialog(true)} editGoal={setGoalDialog} goTo={setView} />}
        {view === "calendar" && <CalendarWorkspace snapshot={snapshot} persist={persist} openTask={(date) => setTaskDialog({ date })} openEdit={setEditingTask} completeTask={(task) => toggleTaskCompletion(task, true)} rescheduleTask={rescheduleTask} previewAdjustment={(taskIds, targetDate) => setPlanAdjustment({ taskIds, targetDate })} />}
        {view === "subjects" && <Subjects snapshot={snapshot} persist={persist} openTask={setTaskDialog} openEdit={setEditingTask} openImport={() => setView("import")} moveTask={moveTask} completeTask={(task) => toggleTaskCompletion(task, true)} notify={(title, message) => setAppConfirm({ title, message, confirmLabel: "知道了", onConfirm: () => undefined })} ask={setAppPrompt} confirm={setAppConfirm} />}
        {view === "import" && <MarkdownImport snapshot={snapshot} persist={persist} confirm={setAppConfirm} onBack={() => setView("subjects")} />}
        {view === "focus" && <Focus snapshot={snapshot} now={timerNow} openTimer={(taskId, subjectId) => setTimerDialog({ taskId, subjectId })} onStop={stopTimer} onCancel={cancelTimer} onPause={pauseTimer} onResume={resumeTimer} onReset={resetTimer} openDailyTarget={() => setDailyTargetDialog(true)} confirm={setAppConfirm} goTo={setView} />}
        {view === "review" && <ReviewCenter snapshot={snapshot} persist={persist} />}
        {view === "analytics" && <Analytics snapshot={snapshot} persist={persist} />}
        {view === "settings" && <Settings snapshot={snapshot} persist={persist} setTheme={setTheme} confirm={setAppConfirm} />}
      </main>
      <MobileNav mode={snapshot.meta.workspaceMode ?? "exam"} view={view} setView={setView} />
      {snapshot.meta.activeTimer && <TimerAudioNotifier snapshot={snapshot} now={timerNow} />}
      <TaskScheduleNotifier snapshot={snapshot} />
      {taskDialog && <TaskDialog snapshot={snapshot} defaults={taskDialog} onClose={() => setTaskDialog(null)} onSubmit={createTask} />}
      {editingTask && <TaskDialog snapshot={snapshot} task={editingTask} defaults={{}} onClose={() => setEditingTask(null)} onSubmit={(draft) => saveTaskEdits(editingTask.id, draft)} onUpdateCheckin={updateTaskCheckin} onDelete={async () => setAppConfirm({ title: `删除“${editingTask.title}”？`, message: "任务会移入最近删除并保留30天，日程、打卡记录和原有层级都会保留，期间可以恢复。", confirmLabel: "移入最近删除", tone: "danger", onConfirm: () => deleteTask(editingTask.id) })} />}
      {timerDialog && <TimerDialog snapshot={snapshot} defaults={timerDialog} onClose={() => setTimerDialog(null)} onStart={startTimer} />}
      {snapshot.meta.activeTimer && view !== "focus" && <ActiveTimerBar snapshot={snapshot} now={timerNow} onStop={stopTimer} />}
      {completionDialog && <CompletionDialog task={completionDialog} onClose={() => setCompletionDialog(null)} onSave={saveCompletionFeedback} />}
      {planAdjustment && <PlanAdjustmentDialog snapshot={snapshot} adjustment={planAdjustment} onClose={() => setPlanAdjustment(null)} onConfirm={applyPlanAdjustment} />}
      {appPrompt && <AppPromptDialog prompt={appPrompt} onClose={() => setAppPrompt(null)} />}
      {appConfirm && <AppConfirmDialog confirm={appConfirm} onClose={() => setAppConfirm(null)} />}
      {dailyTargetDialog && <DailyTargetDialog initialMinutes={snapshot.dailyTargets.find((target) => target.date === localDate(new Date()))?.targetMinutes ?? 300} onClose={() => setDailyTargetDialog(false)} onSave={async (minutes) => { await setDailyTarget(minutes); setDailyTargetDialog(false); }} />}
      {goalDialog && <GoalQuickEditDialog goal={snapshot.goal} mode={goalDialog} workspaceMode={snapshot.meta.workspaceMode ?? "exam"} onClose={() => setGoalDialog(null)} onSave={async (patch) => { const now = new Date().toISOString(); await persist({ ...snapshot, goal: { ...snapshot.goal!, ...patch, updatedAt: now }, meta: { ...snapshot.meta, updatedAt: now } }); setGoalDialog(null); }} />}
      {completionUndo && <div className="checkin-undo" role="status"><span><strong>已打卡</strong>{completionUndo.task.title}</span><button onClick={undoLastCompletion}>撤销</button></div>}
    </div>
  );
}

function Onboarding({ snapshot, persist, error }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void>; error: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<"exam" | "life">("exam");
  const [name, setName] = useState("2027 考研");
  const [targetStartDate, setTargetStartDate] = useState(localDate(new Date()));
  const [examDate, setExamDate] = useState("2026-12-20");
  const [school, setSchool] = useState("");
  const [major, setMajor] = useState("");
  const [targetScore, setTargetScore] = useState("400");
  const [subjects, setSubjects] = useState<DraftSubject[]>(DEFAULT_SUBJECTS);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const nextStep = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setFormError(`请给当前${mode === "exam" ? "考研" : "生活"}目标起一个名字`);
    if (!examDate || daysUntil(examDate) <= 0) return setFormError(`${mode === "exam" ? "考试" : "目标"}日期需要晚于今天`);
    if (targetStartDate && targetStartDate > examDate) return setFormError(`开始时间不能晚于${mode === "exam" ? "考试" : "目标"}日期`);
    setFormError("");
    setStep(2);
  };

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    const validSubjects = subjects.filter((subject) => subject.name.trim());
    if (!validSubjects.length) return setFormError(`请至少保留一个${mode === "exam" ? "考试科目" : "生活领域"}`);
    const now = new Date().toISOString();
    const goal: Goal = {
      id: "current-goal",
      name: name.trim(),
      targetStartDate: targetStartDate || undefined,
      examDate,
      school: mode === "exam" ? school.trim() || undefined : undefined,
      major: mode === "exam" ? major.trim() || undefined : undefined,
      targetScore: mode === "exam" && targetScore ? Number(targetScore) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    setSaving(true);
    try {
      await persist({
        ...snapshot,
        goal,
        subjects: buildSubjects(validSubjects),
        meta: { ...snapshot.meta, workspaceMode: mode, onboardingComplete: true, updatedAt: now },
      });
    } finally {
      setSaving(false);
    }
  };

  const updateSubject = (id: string, patch: Partial<DraftSubject>) => {
    setSubjects((current) => current.map((subject) => subject.id === id ? { ...subject, ...patch } : subject));
  };

  return (
    <div className="onboarding">
      <section className="onboarding-story">
        <Brand />
        <div className="story-copy">
          <div className="eyebrow">从目标走到今天</div>
          <h1>把漫长备考，变成今天能完成的事。</h1>
          <p>考研系统围绕真实备考节奏组织目标、科目、任务和执行反馈。先建立方向，接下来我们会一步步把它变成每日计划。</p>
          <div className="story-path" aria-hidden="true">
            <span><i />确定当前考研目标</span>
            <span><i />建立你的考试科目</span>
            <span><i />开始安排第一个学习任务</span>
          </div>
        </div>
      </section>
      <section className="onboarding-form">
        <div className="form-shell">
          <div className="stepper" aria-label={`设置进度，第 ${step} 步，共 2 步`}>
            <span className={`step-dot ${step >= 1 ? "active" : ""}`}>1</span><span>当前目标</span>
            <span className="step-line" />
            <span className={`step-dot ${step >= 2 ? "active" : ""}`}>2</span><span>考试科目</span>
          </div>
          {step === 1 ? (
            <form onSubmit={nextStep}>
              <h2>先确定终点</h2>
              <p className="form-lead">默认用于考研备考；如果这次只想管理生活习惯，也可以沿用同一套目标、任务、日历与专注功能。</p>
              <div className="workspace-mode-picker" role="group" aria-label="选择目标类型">
                <button type="button" className={mode === "exam" ? "active" : ""} onClick={() => { setMode("exam"); setName("2027 考研"); setSubjects(DEFAULT_SUBJECTS.map((item) => ({ ...item, id: cryptoId() }))); }}><strong>考研备考</strong><span>科目、阶段、考试日期与分数</span><i>默认</i></button>
                <button type="button" className={mode === "life" ? "active" : ""} onClick={() => { setMode("life"); setName("我的生活目标"); setSubjects(LIFE_SUBJECTS.map((item) => ({ ...item, id: cryptoId() }))); }}><strong>非备考</strong><span>生活领域、习惯、目标日期与执行</span></button>
              </div>
              <div className="form-grid">
                <div className="field full"><label htmlFor="goal-name">目标名称 *</label><input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "exam" ? "例如：2027 考研" : "例如：坚持运动与阅读"} /></div>
                <div className="field"><label htmlFor="target-start-date">{mode === "exam" ? "备考" : "目标"}开始时间</label><input id="target-start-date" type="date" max={examDate || undefined} value={targetStartDate} onChange={(e) => setTargetStartDate(e.target.value)} /></div>
                <div className="field"><label htmlFor="exam-date">{mode === "exam" ? "考试日期" : "目标日期"} *</label><input id="exam-date" type="date" min={localDate(new Date())} value={examDate} onChange={(e) => setExamDate(e.target.value)} /></div>
                {mode === "exam" && <><div className="field"><label htmlFor="target-score">目标总分</label><input id="target-score" type="number" min="0" max="500" value={targetScore} onChange={(e) => setTargetScore(e.target.value)} placeholder="400" /></div><div className="field"><label htmlFor="school">目标院校</label><input id="school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="例如：深圳大学" /></div><div className="field"><label htmlFor="major">目标专业</label><input id="major" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="例如：机械工程" /></div></>}
              </div>
              {(formError || error) && <div className="form-error" role="alert">{formError || error}</div>}
              <div className="form-actions"><button className="btn btn-primary" type="submit">下一步：设置科目</button></div>
            </form>
          ) : (
            <form onSubmit={finish}>
              <h2>建立{mode === "exam" ? "考试科目" : "生活领域"}</h2>
              <p className="form-lead">下面只是常见组合。你可以修改名称和颜色，也可以随时增加或删除。</p>
              <div className="subject-builder">
                {subjects.map((subject) => (
                  <div className="subject-row" key={subject.id}>
                    <input className="color-input" aria-label={`${subject.name || "科目"}颜色`} type="color" value={subject.color} onChange={(e) => updateSubject(subject.id, { color: e.target.value })} />
                    <input aria-label={mode === "exam" ? "科目名称" : "领域名称"} type="text" value={subject.name} onChange={(e) => updateSubject(subject.id, { name: e.target.value })} placeholder={mode === "exam" ? "科目名称" : "领域名称"} />
                    <button className="icon-btn" type="button" aria-label={`删除${subject.name || "科目"}`} onClick={() => setSubjects((current) => current.filter((item) => item.id !== subject.id))}>×</button>
                  </div>
                ))}
                <button className="btn btn-quiet btn-small add-subject" type="button" onClick={() => setSubjects((current) => [...current, { id: cryptoId(), name: "", color: SUBJECT_COLORS[current.length % SUBJECT_COLORS.length] }])}>＋ 添加{mode === "exam" ? "科目" : "领域"}</button>
              </div>
              {(formError || error) && <div className="form-error" role="alert">{formError || error}</div>}
              <div className="form-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>返回</button>
                <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "正在建立目标空间…" : `完成并进入${mode === "exam" ? "考研系统" : "生活目标"}`}</button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function Brand() {
  return <div className="wordmark"><span className="wordmark-mark">考</span><span>考研系统</span></div>;
}

function modeNav(mode: "exam" | "life") { return NAV.map((item) => item.id === "subjects" && mode === "life" ? { ...item, label: "领域" } : item); }

function Sidebar({ goal, mode, view, setView, collapsed, setCollapsed }: { goal: Goal; mode: "exam" | "life"; view: View; setView: (view: View) => void; collapsed: boolean; setCollapsed: (collapsed: boolean) => Promise<void> }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand-row"><Brand /><button className="sidebar-collapse" aria-label={collapsed ? "展开边栏" : "收起边栏"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "›" : "‹"}</button></div>
      <nav className="side-nav" aria-label="主导航">
        {modeNav(mode).map((item) => <NavButton key={item.id} item={item} active={view === item.id} setView={setView} />)}
      </nav>
      <div className="side-footer">
        <div className="side-goal">{goal.name}<br />{mode === "exam" ? ([goal.school, goal.major].filter(Boolean).join(" · ") || "当前考研目标") : "当前生活目标"}</div>
        <div className="side-countdown">{daysUntil(goal.examDate)} 天</div>
      </div>
    </aside>
  );
}

function MobileNav({ mode, view, setView }: { mode: "exam" | "life"; view: View; setView: (view: View) => void }) {
  return <nav className="mobile-nav" aria-label="移动端主导航">{modeNav(mode).map((item) => <NavButton key={item.id} item={item} active={view === item.id} setView={setView} />)}</nav>;
}

function NavButton({ item, active, setView }: { item: (typeof NAV)[number]; active: boolean; setView: (view: View) => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>;
}

function taskProgress(task: Task) {
  if (task.completionMode !== "quantity") return task.status === "completed" ? 100 : 0;
  const start = task.progressStart ?? 0;
  const target = task.progressTarget ?? 0;
  const current = task.progressCurrent ?? start;
  if (target <= start) return 0;
  return Math.max(0, Math.min(100, ((current - start) / (target - start)) * 100));
}

function averageTaskProgress(tasks: Task[]) {
  const included = tasks.filter((task) => task.status === "active" || task.status === "completed");
  if (!included.length) return null;
  return Math.round(included.reduce((sum, task) => sum + taskProgress(task), 0) / included.length);
}

let timerAudioContext: AudioContext | null = null;

function getTimerAudioContext() {
  const AudioContextType = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextType) return null;
  timerAudioContext ??= new AudioContextType();
  return timerAudioContext;
}

function prepareTimerAudio() {
  const context = getTimerAudioContext();
  if (context?.state === "suspended") context.resume().catch(() => undefined);
}

function playTimerTone(kind: "sand" | "reminder" | "complete") {
  const context = getTimerAudioContext();
  if (!context) return;
  if (context.state === "suspended") context.resume().catch(() => undefined);
  const frequencies = kind === "complete" ? [523, 659, 784] : kind === "reminder" ? [440, 660] : [1050];
  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * (kind === "sand" ? 0 : .16);
    const duration = kind === "sand" ? .018 : .12;
    oscillator.type = kind === "sand" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(kind === "sand" ? .012 : .055, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  });
}

function Dashboard({ snapshot, persist, openTask, openEdit, openDailyTarget, editGoal, goTo }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void>; openTask: () => void; openEdit: (task: Task) => void; openDailyTarget: () => void; editGoal: (mode: "exam" | "school") => void; goTo: (view: View) => void }) {
  const [overviewSide, setOverviewSide] = useState<"today" | "progress">("today");
  const goal = snapshot.goal!;
  const lifeMode = snapshot.meta.workspaceMode === "life";
  const today = localDate(new Date());
  const todayLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const schedules = new Map(snapshot.taskSchedules.map((schedule) => [schedule.taskId, schedule]));
  const active = snapshot.tasks.filter((task) => task.status === "active");
  const reviewCandidates = snapshot.tasks.filter((task) => task.status === "completed" && task.mastery === "not_yet");
  const todayTasks = active.filter((task) => schedules.get(task.id)?.plannedDate === today).sort((a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)));
  const overdueTasks = active.filter((task) => {
    const schedule = schedules.get(task.id);
    return schedule && schedule.plannedDate < today && !task.autoRollover;
  });
  const completedToday = snapshot.tasks.filter((task) => task.status === "completed" && task.completedAt?.slice(0, 10) === today);
  const expectedMinutes = todayTasks.reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0);
  const actualMinutes = snapshot.studySessions.filter((session) => session.startedAt.slice(0, 10) === today).reduce((total, session) => total + session.durationMinutes, 0);
  const dailyTarget = snapshot.dailyTargets.find((target) => target.date === today)?.targetMinutes;
  const completedPlannedToday = completedToday.filter((task) => schedules.get(task.id)?.plannedDate === today);
  const plannedTodayCount = todayTasks.length + completedPlannedToday.length;
  const todayCompletionRate = plannedTodayCount ? Math.round(completedPlannedToday.length / plannedTodayCount * 100) : 0;
  const focusTargetRate = dailyTarget ? Math.min(100, Math.round(actualMinutes / dailyTarget * 100)) : 0;
  const targetScore = goal.targetScore ?? snapshot.subjects.reduce((sum, subject) => sum + (subject.targetScore ?? 0), 0);
  const nextDeadlines = active.filter((task) => task.deadline && task.deadline >= today).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "")).slice(0, 3);
  const rolloverTasks = active.filter((task) => (schedules.get(task.id)?.rolloverCount ?? 0) > 0);
  return (
    <>
      <header className="page-head dashboard-head">
        <div><h1>{lifeMode ? "今天的生活安排" : "今天的备考安排"}</h1></div>
        <div className="head-actions"><span className="page-date">{todayLabel}</span><button className="btn btn-quiet btn-small" onClick={() => goTo("calendar")}>打开计划日历</button><button className="btn btn-primary btn-small" onClick={openTask}>＋ 新建任务</button></div>
      </header>
      <div className="dashboard-overview">
        <section className="card countdown-card">
          <div className="countdown-card-head"><div><span>{lifeMode ? "当前生活目标" : "当前考研目标"}</span><h2>{goal.name}</h2>{lifeMode ? <p className="goal-inline-static">用领域、任务和专注记录推动目标</p> : <button className="goal-inline-edit" onClick={() => editGoal("school")} title="修改目标院校与专业">{[goal.school, goal.major].filter(Boolean).join(" · ") || "院校与专业尚未填写"}<i>修改</i></button>}</div>{!lifeMode && <div className="score-pill"><strong>{targetScore || "—"}</strong><span>目标总分</span></div>}</div>
          <button className="countdown-main countdown-edit" onClick={() => editGoal("exam")} title={lifeMode ? "修改目标日期" : "修改考试日期"}><strong>{daysUntil(goal.examDate)}</strong><div><b>DAY</b><span>距离{lifeMode ? "目标日" : "考试"}还有 · 点击修改</span></div></button>
          <div className="score-breakdown" aria-label={lifeMode ? "生活领域" : "各科目标分数"}>{snapshot.subjects.map((subject) => <span key={subject.id}><i style={{ background: subject.color }} />{subject.name}{!lifeMode && ` ${subject.targetScore ?? "—"}`}</span>)}</div>
          <div className="countdown-progress"><div><span>{lifeMode ? "目标周期" : "备考时间"}</span><strong>{Math.round(examProgress(goal))}%</strong></div><div className="progress-rail"><div className="progress-fill" style={{ width: `${examProgress(goal)}%` }} /></div><small>{lifeMode ? "目标日期" : "考试日期"} {goal.examDate}</small></div>
        </section>
        <section className={`card execution-board overview-flip ${overviewSide === "progress" ? "is-flipped" : ""}`}>
          <div className="overview-flip-inner">
            <div className="overview-face overview-today"><div className="board-heading"><div><span>今日执行</span><h2>用进度看清今天</h2></div><div className="board-actions"><button className="overview-switch" onClick={() => setOverviewSide("progress")}>备考进度 ↻</button><button className="focus-entry" onClick={() => goTo("focus")}><i />开始专注</button></div></div><div className="execution-metrics"><div className="fill-metric" style={{ "--metric-progress": `${todayCompletionRate}%` } as React.CSSProperties}><span>任务完成率</span><strong>{plannedTodayCount ? `${completedPlannedToday.length}/${plannedTodayCount}` : "0/0"}</strong><small>{todayCompletionRate}%</small></div><div className="fill-metric focus-progress-metric today-learning-metric" style={{ "--metric-progress": `${focusTargetRate}%` } as React.CSSProperties}><span>今日学习时长</span><strong>{formatMinutes(actualMinutes)} <i>/ {dailyTarget ? formatMinutes(dailyTarget) : "未设目标"}</i></strong><small>{dailyTarget ? `目标完成 ${focusTargetRate}%` : "设置目标后显示完成度"}</small><button onClick={openDailyTarget}>{dailyTarget ? "调整目标" : "设置目标"}</button></div></div><div className="board-foot"><span>今日安排预计 {formatMinutes(expectedMinutes)}</span></div></div>
            <ExamProgressMatrix goal={goal} mode={lifeMode ? "life" : "exam"} onBack={() => setOverviewSide("today")} />
          </div>
        </section>
      </div>
      <div className="dashboard-workspace">
        <section className="section today-work">
          <div className="section-title"><div><span className="section-eyebrow">按优先级执行</span><h2>今日任务</h2></div><span className="page-date">{todayTasks.length} 项待完成</span></div>
          {todayTasks.length ? <div className="dashboard-preview-list">{todayTasks.slice(0, 5).map((task) => <DashboardTaskPreview key={task.id} task={task} subject={snapshot.subjects.find((subject) => subject.id === task.subjectId)} onOpen={() => openEdit(task)} />)}<button className="dashboard-open-today" onClick={() => goTo("calendar")}>到今日任务列表打卡 →</button></div> : <div className="card empty-today"><div className="empty-icon">今</div><div><h3>今天还没有安排任务</h3><p>新建一个今天可以完成的学习行动，或从日历把已有任务安排到今天。</p></div><button className="btn btn-primary btn-small" onClick={openTask}>新建任务</button></div>}
        </section>
        <aside className="dashboard-aside">
          <section className="card aside-card"><div className="aside-head"><h2>最近截止</h2><button onClick={() => goTo("calendar")}>日历</button></div>{nextDeadlines.length ? <div className="deadline-list">{nextDeadlines.map((task) => <button key={task.id} onClick={() => openEdit(task)}><span style={{ background: snapshot.subjects.find((subject) => subject.id === task.subjectId)?.color }} /><div><strong>{task.title}</strong><small>{task.deadline} · {snapshot.subjects.find((subject) => subject.id === task.subjectId)?.name}</small></div></button>)}</div> : <p className="empty-copy">暂时没有临近截止任务。</p>}</section>
          <section className={`card aside-card risk-card ${overdueTasks.length || rolloverTasks.length ? "has-risk" : ""}`}><div className="aside-head"><h2>计划状态</h2><span>{overdueTasks.length || rolloverTasks.length ? "需处理" : "正常"}</span></div><div className="risk-numbers"><div><strong>{overdueTasks.length}</strong><span>逾期任务</span></div><div><strong>{rolloverTasks.length}</strong><span>顺延任务</span></div></div>{overdueTasks.length > 0 && <button className="risk-action" onClick={() => goTo("calendar")}>查看并调整计划 →</button>}</section>
        </aside>
      </div>
      <ExamRoadmap snapshot={snapshot} goToSubjects={() => goTo("subjects")} onUpdateStage={async (stage, startDate, endDate) => { const now = new Date().toISOString(); await persist({ ...snapshot, stages: snapshot.stages.map((item) => item.id === stage.id ? { ...item, startDate, endDate, updatedAt: now } : item), meta: { ...snapshot.meta, updatedAt: now } }); }} />
      {overdueTasks.length > 0 && <section className="section overdue-section"><div className="section-title"><h2>逾期待处理</h2><span className="page-date">{overdueTasks.length} 个</span></div><div className="dashboard-preview-list">{overdueTasks.map((task) => <DashboardTaskPreview key={task.id} task={task} subject={snapshot.subjects.find((subject) => subject.id === task.subjectId)} onOpen={() => openEdit(task)} />)}</div></section>}
      {reviewCandidates.length > 0 && <section className="section card review-candidates"><div><span className="section-eyebrow">完成反馈联动</span><h2>{reviewCandidates.length} 个任务需要复习</h2><p>这些任务被标记为“需再学”。系统只给出候选，不会自动创建新任务。</p></div><div>{reviewCandidates.slice(0, 4).map((task) => <button key={task.id} onClick={() => openEdit(task)}><span style={{ background: snapshot.subjects.find((subject) => subject.id === task.subjectId)?.color }} /><strong>{task.title}</strong></button>)}</div><button className="btn btn-quiet btn-small" onClick={() => goTo("subjects")}>到科目页处理</button></section>}
      {completedToday.length > 0 && <details className="section completed-section"><summary>今日完成 · {completedToday.length} 个任务</summary><div className="dashboard-preview-list">{completedToday.map((task) => <DashboardTaskPreview key={task.id} task={task} subject={snapshot.subjects.find((subject) => subject.id === task.subjectId)} onOpen={() => openEdit(task)} />)}</div></details>}
    </>
  );
}

function DashboardTaskPreview({ task, subject, onOpen }: { task: Task; subject?: Subject; onOpen: () => void }) {
  return <button className={`dashboard-task-preview ${task.status === "completed" ? "is-completed" : ""}`} onClick={onOpen}><i style={{ background: subject?.color }} /><div><strong>{task.title}</strong><span>{subject?.name ?? "未知科目"} · {formatMinutes(task.estimatedMinutes)}{task.important ? " · 重要" : ""}</span></div><b>{task.completionMode === "quantity" ? `${task.progressCurrent ?? task.progressStart ?? 0}/${task.progressTarget ?? 0} ${task.progressUnit ?? ""}` : "查看"}</b></button>;
}

function ExamProgressMatrix({ goal, mode, onBack }: { goal: Goal; mode: "exam" | "life"; onBack: () => void }) {
  const [unit, setUnit] = useState<"day" | "week">("week");
  const today = localDate(new Date());
  const rangeStart = goal.targetStartDate ?? goal.createdAt.slice(0, 10);
  const totalDays = Math.max(1, dayDifference(rangeStart, goal.examDate) + 1);
  const elapsedDays = today < rangeStart ? 0 : Math.min(totalDays, dayDifference(rangeStart, today) + 1);
  const remaining = Math.max(0, dayDifference(today, goal.examDate));
  const totalWeeks = Math.floor(totalDays / 7);
  const remainingWeeks = Math.floor(Math.max(0, totalDays - elapsedDays) / 7);
  const dotCount = unit === "day" ? totalDays : totalWeeks;
  const progress = totalDays ? Math.min(100, Math.max(0, elapsedDays / totalDays * 100)) : 0;
  const label = mode === "life" ? "目标进度" : "备考进度";
  const firstMonth = new Date(`${rangeStart.slice(0, 7)}-01T00:00:00`);
  const lastMonth = new Date(`${goal.examDate.slice(0, 7)}-01T00:00:00`);
  const monthGroups: { key: string; label: string; year: number; month: number; days: number }[] = [];
  for (const pointer = new Date(firstMonth); pointer <= lastMonth; pointer.setMonth(pointer.getMonth() + 1)) {
    monthGroups.push({ key: `${pointer.getFullYear()}-${String(pointer.getMonth() + 1).padStart(2, "0")}`, label: `${pointer.getMonth() + 1}月`, year: pointer.getFullYear(), month: pointer.getMonth(), days: new Date(pointer.getFullYear(), pointer.getMonth() + 1, 0).getDate() });
  }
  const rangeState = (startDate: string, endDate: string) => {
    if (endDate < rangeStart || startDate > goal.examDate) return "outside";
    const clippedStart = startDate < rangeStart ? rangeStart : startDate;
    const clippedEnd = endDate > goal.examDate ? goal.examDate : endDate;
    if (today >= clippedStart && today <= clippedEnd) return "current";
    return clippedEnd < today ? "elapsed" : "remaining";
  };
  return <div className={`overview-face overview-progress matrix-${unit}`} aria-label={`${label}可视化`}>
    <div className="matrix-head">
      <div><span>{new Date(`${rangeStart}T00:00:00`).getFullYear()}</span><b>{label}</b></div>
      <div className="matrix-actions">
        <div className="matrix-unit-switch" aria-label="进度圆点单位"><button type="button" className={unit === "day" ? "active" : ""} onClick={() => setUnit("day")}>天</button><button type="button" className={unit === "week" ? "active" : ""} onClick={() => setUnit("week")}>周</button></div>
        <button type="button" className="overview-switch" onClick={onBack}>今日执行 ↻</button>
      </div>
    </div>
    <div className={`matrix-dot-timeline matrix-dot-timeline-${unit}`}>
      {unit === "week" && (dotCount > 0 ? <div className="matrix-dot-track month-week-track" aria-label={`${label}：${totalWeeks}周`}>
        <div className="matrix-dot-grid month-week-grid">{monthGroups.map((group) => <div className="month-week-group" key={group.key}><span>{group.label}</span><div>{Array.from({ length: 4 }, (_, index) => {
          const segmentStart = localDate(new Date(group.year, group.month, index * 7 + 1));
          const segmentEnd = localDate(new Date(group.year, group.month, index === 3 ? group.days : (index + 1) * 7));
          const state = rangeState(segmentStart, segmentEnd);
          return <i className={state} title={`${group.label}第${index + 1}周`} key={index} />;
        })}</div></div>)}</div>
      </div> : <div className="matrix-empty compact">当前周期不足一个完整周，不计入周进度。</div>)}
      {unit === "day" && <div className="matrix-dot-track month-day-track" aria-label={`${label}：${totalDays}天`}>
        <div className="month-day-rows">{monthGroups.map((group) => <div className="month-day-row" key={group.key}><span>{group.label}</span><div style={{ "--month-days": group.days } as React.CSSProperties}>{Array.from({ length: group.days }, (_, index) => {
          const date = localDate(new Date(group.year, group.month, index + 1));
          const state = rangeState(date, date);
          return <i className={`${state} week-tone-${Math.min(4, Math.floor(index / 7))}`} title={`${date.slice(5).replace("-", "月")}日`} key={date} />;
        })}</div></div>)}</div>
      </div>}
    </div>
    <div className="matrix-stats"><span><strong>{progress.toFixed(2)}%</strong> 进度<small>一个圆点代表一{unit === "day" ? "天" : "周"}</small></span><span><strong>{remaining}</strong> 天剩余</span><span><strong>{remainingWeeks}</strong> 周剩余</span></div>
  </div>;
}

function ExamRoadmap({ snapshot, goToSubjects, onUpdateStage }: { snapshot: AppSnapshot; goToSubjects: () => void; onUpdateStage: (stage: Stage, startDate: string, endDate: string) => Promise<void> }) {
  const goal = snapshot.goal!;
  const lifeMode = snapshot.meta.workspaceMode === "life";
  const today = localDate(new Date());
  const datedStages = snapshot.stages.filter((stage) => stage.startDate || stage.endDate);
  const stageRanges = datedStages.map((stage) => {
    const subject = snapshot.subjects.find((item) => item.id === stage.subjectId);
    return { stage, subject, start: stage.startDate ?? stage.endDate!, end: stage.endDate ?? stage.startDate! };
  });
  const currentStages = stageRanges.filter(({ start, end }) => start <= today && end >= today);
  const nextStage = stageRanges.filter(({ start }) => start > today).sort((a, b) => a.start.localeCompare(b.start))[0];
  const candidates = [goal.createdAt.slice(0, 10), today, ...snapshot.subjects.map((subject) => subject.targetStartDate), ...datedStages.map((stage) => stage.startDate)].filter(Boolean) as string[];
  const startDate = candidates.sort()[0] || today;
  const endDate = goal.examDate > startDate ? goal.examDate : startDate;
  const totalDays = Math.max(1, dayDifference(startDate, endDate));
  const position = (date?: string) => Math.max(0, Math.min(100, dayDifference(startDate, date || startDate) / totalDays * 100));
  const tickCount = 6;
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const date = new Date(`${startDate}T00:00:00`);
    date.setDate(date.getDate() + Math.round(totalDays * index / (tickCount - 1)));
    return { left: index / (tickCount - 1) * 100, label: `${date.getMonth() + 1}月` };
  });
  const shiftDate = (date: string, days: number) => { const value = new Date(`${date}T00:00:00`); value.setDate(value.getDate() + days); return localDate(value); };
  const startStageDrag = (event: React.PointerEvent<HTMLElement>, stage: Stage, rangeStart: string, rangeEnd: string, mode: "move" | "start" | "end") => {
    event.preventDefault(); event.stopPropagation();
    const stageElement = event.currentTarget.closest(".roadmap-stage") as HTMLElement | null;
    const track = stageElement?.parentElement;
    if (!stageElement || !track) return;
    const trackWidth = track.getBoundingClientRect().width;
    const startX = event.clientX;
    const duration = Math.max(0, dayDifference(rangeStart, rangeEnd));
    let nextStart = rangeStart; let nextEnd = rangeEnd;
    const move = (pointer: PointerEvent) => {
      const deltaDays = Math.round((pointer.clientX - startX) / Math.max(1, trackWidth) * totalDays);
      if (mode === "move") {
        nextStart = shiftDate(rangeStart, deltaDays); nextEnd = shiftDate(rangeEnd, deltaDays);
        if (nextStart < startDate) { nextStart = startDate; nextEnd = shiftDate(startDate, duration); }
        if (nextEnd > endDate) { nextEnd = endDate; nextStart = shiftDate(endDate, -duration); }
      } else if (mode === "start") nextStart = [startDate, shiftDate(rangeStart, deltaDays), nextEnd].sort()[1];
      else nextEnd = [nextStart, shiftDate(rangeEnd, deltaDays), endDate].sort()[1];
      const previewLeft = position(nextStart); const previewWidth = Math.max(2.5, position(nextEnd) - previewLeft);
      stageElement.style.left = `${previewLeft}%`; stageElement.style.width = `${previewWidth}%`;
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); onUpdateStage(stage, nextStart, nextEnd); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
  };
  return <section className="section card exam-roadmap" aria-label={lifeMode ? "到目标日的宏观时间轴" : "到考研考试日的宏观时间轴"}>
    <div className="section-title exam-roadmap-head"><div><span className="section-eyebrow">从现在到{lifeMode ? "目标日" : "考试日"}</span><h2>{lifeMode ? "我的目标宏观视图" : "我的考研宏观视图"}</h2><p>按{lifeMode ? "领域" : "科目"}查看自定义阶段安排，未设置日期的阶段会留在待安排区。</p><div className="roadmap-status-summary">{currentStages.length > 0 ? <span><b>当前</b>{currentStages.slice(0, 2).map(({ stage, subject }) => `${subject?.name ?? (lifeMode ? "领域" : "科目")} · ${stage.name}`).join("、")}{currentStages.length > 2 ? ` 等 ${currentStages.length} 个阶段` : ""}</span> : <span><b>当前</b>暂无正在进行的阶段</span>}{nextStage && <span><b>下一阶段</b>{nextStage.subject?.name ?? (lifeMode ? "领域" : "科目")} · {nextStage.stage.name} · {nextStage.start.slice(5)}</span>}</div></div><button className="btn btn-quiet btn-small" onClick={goToSubjects}>管理阶段</button></div>
    <div className="roadmap-scroll"><div className="roadmap-canvas">
      <div className="roadmap-axis"><span>{startDate}</span><div>{ticks.map((tick) => <i key={`${tick.left}`} style={{ left: `${tick.left}%` }}><b />{tick.label}</i>)}</div><span>{lifeMode ? "目标日" : "考试日"} {endDate}</span></div>
      <div className="roadmap-today" style={{ left: `calc(118px + (100% - 192px) * ${position(today) / 100})` }}><i />今天</div>
      {snapshot.subjects.map((subject) => {
        const stages = snapshot.stages.filter((stage) => stage.subjectId === subject.id).sort((a, b) => (a.startDate ?? a.endDate ?? "9999").localeCompare(b.startDate ?? b.endDate ?? "9999"));
        const dated = stages.filter((stage) => stage.startDate || stage.endDate);
        const undated = stages.filter((stage) => !stage.startDate && !stage.endDate);
        return <div className="roadmap-lane" key={subject.id} style={{ "--lane-color": subject.color } as React.CSSProperties}><div className="roadmap-subject"><i />{subject.name}</div><div className="roadmap-track">{dated.map((stage, index) => { const start = stage.startDate ?? stage.endDate!; const nextStage = dated[index + 1]; const end = stage.endDate ?? nextStage?.startDate ?? subject.targetDate ?? endDate; const left = position(start); const width = Math.max(2.5, position(end) - left); return <div className="roadmap-stage is-adjustable" key={stage.id} style={{ left: `${left}%`, width: `${width}%` }} title={`${stage.name}：${start} 至 ${end}；拖动可移动，拖两侧可调日期`} onPointerDown={(event) => startStageDrag(event, stage, start, end, "move")}><button aria-label={`调整${stage.name}开始日期`} onPointerDown={(event) => startStageDrag(event, stage, start, end, "start")} /><strong>{stage.name}</strong><span>{start.slice(5)} → {end.slice(5)}</span><button aria-label={`调整${stage.name}结束日期`} onPointerDown={(event) => startStageDrag(event, stage, start, end, "end")} /></div>; })}{!dated.length && <span className="roadmap-empty-lane">尚未安排阶段日期</span>}</div><div className="roadmap-undated">{undated.map((stage) => <span key={stage.id}>{stage.name} · 待安排</span>)}</div></div>;
      })}
      <div className="roadmap-exam-marker"><i />{lifeMode ? "目标日" : "考研初试"}</div>
    </div></div>
  </section>;
}

function TaskTreeQuickActions({ task, onComplete }: { task: Task; onComplete: () => void }) {
  return <div className="task-tree-quick-actions" aria-label={`${task.title}快捷操作`}>{task.completionMode === "check" && <button type="button" className={`task-complete-button ${task.status === "completed" ? "is-completed" : ""}`} onClick={onComplete}>{task.status === "completed" ? "✓ 已完成" : "○ 完成"}</button>}</div>;
}

function Subjects({ snapshot, persist, openTask, openEdit, openImport, moveTask, completeTask, notify, ask, confirm }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void>; openTask: (defaults: TaskDefaults) => void; openEdit: (task: Task) => void; openImport: () => void; moveTask: (taskId: string, parentTaskId?: string, beforeTaskId?: string, contentNodeId?: string) => Promise<void>; completeTask: (task: Task) => Promise<void>; notify: (title: string, message: string) => void; ask: (prompt: AppPrompt) => void; confirm: (confirm: AppConfirm) => void }) {
  const lifeMode = snapshot.meta.workspaceMode === "life";
  const [name, setName] = useState("");
  const [color, setColor] = useState(SUBJECT_COLORS[snapshot.subjects.length % SUBJECT_COLORS.length]);
  const [targetScore, setTargetScore] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState(snapshot.subjects[0]?.id ?? "");
  const [stageName, setStageName] = useState("");
  const [stageStart, setStageStart] = useState("");
  const [stageEnd, setStageEnd] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [parentId, setParentId] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "today" | "unscheduled" | "overdue">("all");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(snapshot.contentNodes.map((node) => node.id)));
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set(snapshot.tasks.map((task) => task.id)));
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [dragTarget, setDragTarget] = useState<{ taskId: string; placement: "before" | "inside" | "after" } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [categoryDropTarget, setCategoryDropTarget] = useState<string | null>(null);
  const [taskMenu, setTaskMenu] = useState<{ task: Task; x: number; y: number } | null>(null);
  const today = localDate(new Date());

  useEffect(() => {
    if (!taskMenu) return;
    const close = () => setTaskMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, [taskMenu]);

  const addSubject = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const subject: Subject = { id: cryptoId(), name: name.trim(), color, targetScore: targetScore ? Number(targetScore) : undefined, sortOrder: snapshot.subjects.length, createdAt: now, updatedAt: now };
    setSaving(true);
    try {
      await persist({ ...snapshot, subjects: [...snapshot.subjects, subject], meta: { ...snapshot.meta, updatedAt: now } });
      setName("");
      setTargetScore("");
      setColor(SUBJECT_COLORS[(snapshot.subjects.length + 1) % SUBJECT_COLORS.length]);
    } finally { setSaving(false); }
  };

  const removeSubject = async (subject: Subject) => {
    if (snapshot.tasks.some((task) => task.subjectId === subject.id && task.status !== "archived")) {
      notify("暂时不能删除科目", `“${subject.name}”下仍有任务，请先处理任务后再删除科目。`);
      return;
    }
    if (snapshot.studySessions.some((session) => session.subjectId === subject.id)) {
      notify("暂时不能删除科目", `“${subject.name}”已有专注记录。为避免统计丢失，当前不能删除这个科目。`);
      return;
    }
    if (snapshot.meta.activeTimer?.subjectId === subject.id) {
      notify("科目正在计时", `“${subject.name}”正在计时，请先结束或放弃本次计时。`);
      return;
    }
    confirm({ title: `删除“${subject.name}”？`, message: "该科目的阶段、学习内容和历史归档任务也会删除，此操作不可撤销。", confirmLabel: "确认删除", tone: "danger", onConfirm: async () => { const now = new Date().toISOString(); await persist(deleteUnusedSubjectFromSnapshot(snapshot, subject.id, now)); } });
  };

  const addStage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSubjectId || !stageName.trim()) return;
    const now = new Date().toISOString();
    const siblings = snapshot.stages.filter((stage) => stage.subjectId === selectedSubjectId);
    const stage: Stage = { id: cryptoId(), subjectId: selectedSubjectId, name: stageName.trim(), startDate: stageStart || undefined, endDate: stageEnd || undefined, sortOrder: siblings.length, createdAt: now, updatedAt: now };
    await persist({ ...snapshot, stages: [...snapshot.stages, stage], meta: { ...snapshot.meta, updatedAt: now } });
    setStageName(""); setStageStart(""); setStageEnd("");
  };

  const removeStage = async (stage: Stage) => {
    confirm({ title: `删除阶段“${stage.name}”？`, message: "关联任务会保留，只解除阶段关联。", confirmLabel: "确认删除", tone: "danger", onConfirm: async () => { const now = new Date().toISOString(); await persist({ ...snapshot, stages: snapshot.stages.filter((item) => item.id !== stage.id), tasks: snapshot.tasks.map((task) => task.stageId === stage.id ? { ...task, stageId: undefined, updatedAt: now } : task), meta: { ...snapshot.meta, updatedAt: now } }); } });
  };

  const addNode = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSubjectId || !nodeName.trim()) return;
    const now = new Date().toISOString();
    const siblings = snapshot.contentNodes.filter((node) => node.subjectId === selectedSubjectId && (node.parentId ?? "") === parentId);
    const node: ContentNode = { id: cryptoId(), subjectId: selectedSubjectId, parentId: parentId || undefined, name: nodeName.trim(), sortOrder: siblings.length, createdAt: now, updatedAt: now };
    await persist({ ...snapshot, contentNodes: [...snapshot.contentNodes, node], meta: { ...snapshot.meta, updatedAt: now } });
    setNodeName("");
  };

  const quickAddCategory = () => ask({
    title: "添加任务分类",
    message: "分类只用于整理任务，本身不能完成或打卡。",
    inputLabel: "分类名称",
    value: "",
    confirmLabel: "添加分类",
    onConfirm: async (value) => {
      if (!selectedSubjectId || !value.trim()) return;
      const now = new Date().toISOString();
      const siblings = snapshot.contentNodes.filter((node) => node.subjectId === selectedSubjectId && !node.parentId);
      const node: ContentNode = { id: cryptoId(), subjectId: selectedSubjectId, name: value.trim(), sortOrder: siblings.length, createdAt: now, updatedAt: now };
      await persist({ ...snapshot, contentNodes: [...snapshot.contentNodes, node], meta: { ...snapshot.meta, updatedAt: now } });
    },
  });

  const addChildNode = async (parentNodeId: string) => {
    ask({ title: "添加下级任务分类", inputLabel: "分类名称", value: "", message: "例如：积分", confirmLabel: "添加", onConfirm: async (value) => { if (!value.trim()) return; const now = new Date().toISOString(); const siblings = snapshot.contentNodes.filter((node) => node.subjectId === selectedSubjectId && node.parentId === parentNodeId); const node: ContentNode = { id: cryptoId(), subjectId: selectedSubjectId, parentId: parentNodeId, name: value.trim(), sortOrder: siblings.length, createdAt: now, updatedAt: now }; setExpandedNodes((current) => new Set(current).add(parentNodeId)); await persist({ ...snapshot, contentNodes: [...snapshot.contentNodes, node], meta: { ...snapshot.meta, updatedAt: now } }); } });
  };

  const descendantsOf = (nodeId: string): string[] => {
    const children = snapshot.contentNodes.filter((node) => node.parentId === nodeId).flatMap((node) => [node.id, ...descendantsOf(node.id)]);
    return children;
  };

  const removeNode = async (node: ContentNode) => {
    confirm({ title: `删除任务分类“${node.name}”及其下级分类？`, message: "分类下的任务会保留，只解除任务分类关联。", confirmLabel: "确认删除", tone: "danger", onConfirm: async () => { const removed = new Set([node.id, ...descendantsOf(node.id)]); const now = new Date().toISOString(); await persist({ ...snapshot, contentNodes: snapshot.contentNodes.filter((item) => !removed.has(item.id)), tasks: snapshot.tasks.map((task) => task.contentNodeId && removed.has(task.contentNodeId) ? { ...task, contentNodeId: undefined, updatedAt: now } : task), meta: { ...snapshot.meta, updatedAt: now } }); } });
  };

  const selectedSubject = snapshot.subjects.find((subject) => subject.id === selectedSubjectId);
  const subjectNodes = snapshot.contentNodes.filter((node) => node.subjectId === selectedSubjectId);
  const subjectStages = snapshot.stages.filter((stage) => stage.subjectId === selectedSubjectId);
  const allSubjectTasks = snapshot.tasks.filter((task) => task.subjectId === selectedSubjectId && task.status !== "archived");
  const scheduleByTask = new Map(snapshot.taskSchedules.map((schedule) => [schedule.taskId, schedule]));
  const scheduleMatches = (task: Task) => {
    const plannedDate = scheduleByTask.get(task.id)?.plannedDate;
    if (scheduleFilter === "today") return plannedDate === today;
    if (scheduleFilter === "unscheduled") return !plannedDate;
    if (scheduleFilter === "overdue") return task.status === "active" && Boolean(plannedDate && plannedDate < today && !task.autoRollover);
    return true;
  };
  const selectedTasks = allSubjectTasks.filter((task) => (stageFilter === "all" || (stageFilter === "none" ? !task.stageId : task.stageId === stageFilter)) && scheduleMatches(task));
  const completedTasks = selectedTasks.filter((task) => task.status === "completed");
  const treeTasks = snapshot.meta.completedTaskPlacement === "separate" ? selectedTasks.filter((task) => task.status !== "completed") : selectedTasks;
  const stageDefault = stageFilter !== "all" && stageFilter !== "none" ? stageFilter : undefined;
  const nodeProgress = (nodeId: string) => {
    const childIds = descendantsOf(nodeId);
    return averageTaskProgress(selectedTasks.filter((task) => task.contentNodeId === nodeId || (task.contentNodeId && childIds.includes(task.contentNodeId))));
  };
  const toggleNode = (nodeId: string) => setExpandedNodes((current) => { const next = new Set(current); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next; });
  const taskDescendants = (taskId: string, pool: Task[] = treeTasks): Task[] => pool.filter((task) => task.parentTaskId === taskId).flatMap((task) => [task, ...taskDescendants(task.id, pool)]);
  const moveTaskToCategory = async (taskId: string, contentNodeId?: string) => {
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task || task.subjectId !== selectedSubjectId) return;
    const childIds = new Set([taskId, ...taskDescendants(taskId, snapshot.tasks).map((item) => item.id)]);
    const siblings = snapshot.tasks.filter((item) => item.subjectId === task.subjectId && item.contentNodeId === contentNodeId && !item.parentTaskId && !childIds.has(item.id));
    const now = new Date().toISOString();
    await persist({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => childIds.has(item.id) ? { ...item, contentNodeId, parentTaskId: item.id === taskId ? undefined : item.parentTaskId, sortOrder: item.id === taskId ? siblings.length : item.sortOrder, updatedAt: now } : item),
      meta: { ...snapshot.meta, updatedAt: now },
    });
    if (contentNodeId) setExpandedNodes((current) => new Set(current).add(contentNodeId));
  };
  const changeTreeQuantity = async (task: Task, delta: number) => {
    const start = task.progressStart ?? 0;
    const target = task.progressTarget ?? start;
    const current = task.progressCurrent ?? start;
    const nextValue = Math.min(target, Math.max(start, current + delta));
    const minimum = task.dailyMinimum ?? target - start;
    const previousCheckin = snapshot.taskCheckins.find((item) => item.taskId === task.id && item.date === today);
    const nextDailyQuantity = Math.max(0, (previousCheckin?.quantity ?? 0) + delta);
    const reachedMinimum = nextDailyQuantity >= minimum;
    const now = new Date().toISOString();
    const checkin: TaskCheckin = previousCheckin
      ? { ...previousCheckin, quantity: nextDailyQuantity, completed: reachedMinimum, updatedAt: now }
      : { id: cryptoId(), taskId: task.id, date: today, quantity: nextDailyQuantity, completed: reachedMinimum, createdAt: now, updatedAt: now };
    await persist({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => item.id === task.id ? {
        ...item,
        progressCurrent: nextValue,
        updatedAt: now,
      } : item),
      taskCheckins: previousCheckin ? snapshot.taskCheckins.map((item) => item.id === checkin.id ? checkin : item) : [...snapshot.taskCheckins, checkin],
      meta: { ...snapshot.meta, updatedAt: now },
    });
  };
  const copyTask = async (task: Task) => {
    const now = new Date().toISOString();
    const copyId = cryptoId();
    const siblingCount = snapshot.tasks.filter((item) => item.subjectId === task.subjectId && (item.parentTaskId ?? "") === (task.parentTaskId ?? "")).length;
    const copiedTask: Task = { ...task, id: copyId, title: `${task.title}（副本）`, status: "active", completedAt: undefined, mastery: undefined, progressCurrent: task.completionMode === "quantity" ? task.progressStart : undefined, sortOrder: siblingCount, createdAt: now, updatedAt: now };
    const sourceSchedule = snapshot.taskSchedules.find((item) => item.taskId === task.id);
    const copiedSchedule = sourceSchedule ? { ...sourceSchedule, id: cryptoId(), taskId: copyId, rolloverCount: 0, totalDelayedDays: 0, createdAt: now, updatedAt: now } : null;
    await persist({ ...snapshot, tasks: [...snapshot.tasks, copiedTask], taskSchedules: copiedSchedule ? [...snapshot.taskSchedules, copiedSchedule] : snapshot.taskSchedules, meta: { ...snapshot.meta, updatedAt: now } });
    notify("任务已复制", "已生成独立副本，未复制下级任务和重复规则。你可以继续编辑副本。");
  };
  const convertTaskToCategory = (task: Task) => {
    confirm({
      title: `将“${task.title}”转为任务分类？`,
      message: "它将不再是可完成任务；原有下级任务会自动归入这个分类。已有专注记录仍会保留，但不再关联该任务。",
      confirmLabel: "转为分类",
      onConfirm: async () => {
        const now = new Date().toISOString();
        const childIds = new Set(snapshot.tasks.filter((item) => item.parentTaskId === task.id).map((item) => item.id));
        const siblings = snapshot.contentNodes.filter((node) => node.subjectId === task.subjectId && (node.parentId ?? "") === (task.contentNodeId ?? ""));
        const node: ContentNode = { id: cryptoId(), subjectId: task.subjectId, parentId: task.contentNodeId, name: task.title, sortOrder: siblings.length, createdAt: now, updatedAt: now };
        const removed = deleteTaskFromSnapshot(snapshot, task.id, now);
        await persist({ ...removed, contentNodes: [...removed.contentNodes, node], tasks: removed.tasks.map((item) => childIds.has(item.id) ? { ...item, contentNodeId: node.id, updatedAt: now } : item), meta: { ...removed.meta, updatedAt: now } });
      },
    });
  };
  const moveAfterTask = (draggedId: string, target: Task) => {
    const siblings = treeTasks
      .filter((task) => task.id !== draggedId && (task.parentTaskId ?? "") === (target.parentTaskId ?? "") && (task.contentNodeId ?? "") === (target.contentNodeId ?? ""))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const targetIndex = siblings.findIndex((task) => task.id === target.id);
    return moveTask(draggedId, target.parentTaskId, siblings[targetIndex + 1]?.id, target.contentNodeId);
  };
  const renderTaskTree = (tasks: Task[], parentTaskId?: string, pool: Task[] = treeTasks): React.ReactNode => tasks
    .filter((task) => parentTaskId ? task.parentTaskId === parentTaskId : !task.parentTaskId || !pool.some((item) => item.id === task.parentTaskId))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((task) => {
    const children = pool.filter((item) => item.parentTaskId === task.id);
    const descendants = taskDescendants(task.id, pool);
    const progress = children.length ? averageTaskProgress([task, ...descendants]) ?? taskProgress(task) : taskProgress(task);
    const expanded = expandedTasks.has(task.id);
    const quantityCurrent = task.progressCurrent ?? task.progressStart ?? 0;
    const quantityStart = task.progressStart ?? 0;
    const quantityTarget = task.progressTarget ?? quantityStart;
    const quantityStep = Math.max(0.01, task.progressStep ?? 1);
    const checkin = snapshot.taskCheckins.find((item) => item.taskId === task.id && item.date === today);
    const dailyMinimum = task.dailyMinimum ?? quantityTarget - quantityStart;
    return <div className="task-tree-branch" key={task.id}>
      <div className={`task-drop-zone task-drop-before ${draggingTaskId && dragTarget?.taskId === task.id && dragTarget.placement === "before" ? "is-active" : ""}`} aria-label={`将任务排在${task.title}之前`} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); if (draggingTaskId) setDragTarget({ taskId: task.id, placement: "before" }); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedId = event.dataTransfer.getData("text/task-id"); setDragTarget(null); setDraggingTaskId(null); if (draggedId && draggedId !== task.id) moveTask(draggedId, task.parentTaskId, task.id); }}><span>排在此任务之前</span></div>
      <div draggable className={`task-tree-row ${task.status === "completed" ? "is-completed" : ""} ${task.completionMode === "quantity" ? "is-quantity" : ""} ${checkin?.completed ? "is-daily-complete" : ""} ${draggingTaskId && dragTarget?.taskId === task.id && dragTarget.placement === "inside" ? "is-drop-parent" : ""}`} style={{ "--quantity-progress": `${progress}%`, "--quantity-color": selectedSubject?.color, "--subject-color": selectedSubject?.color } as React.CSSProperties} onDragStart={(event) => { event.dataTransfer.setData("text/task-id", task.id); event.dataTransfer.effectAllowed = "move"; setDraggingTaskId(task.id); event.currentTarget.classList.add("is-dragging"); }} onDragEnd={(event) => { event.currentTarget.classList.remove("is-dragging"); setDragTarget(null); setDraggingTaskId(null); setCategoryDropTarget(null); }} onDragEnter={(event) => { event.preventDefault(); if (draggingTaskId && draggingTaskId !== task.id && event.dataTransfer.types.includes("text/task-id")) setDragTarget({ taskId: task.id, placement: "inside" }); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragTarget(null); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); setDragTarget(null); setDraggingTaskId(null); const draggedId = event.dataTransfer.getData("text/task-id"); if (draggedId && draggedId !== task.id) moveTask(draggedId, task.id); }} onContextMenu={(event) => { event.preventDefault(); setTaskMenu({ task, x: event.clientX, y: event.clientY }); }} title="按住任务任意空白区域即可拖动；拖到任务上成为下级，拖到上下边缘调整同级顺序">
        <span className="task-drag-handle" aria-hidden="true">⋮⋮</span>
        {children.length ? <button className={`tree-toggle ${expanded ? "is-open" : ""}`} aria-label={`${expanded ? "收起" : "展开"}${task.title}`} onClick={() => setExpandedTasks((current) => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}>›</button> : <span className="tree-toggle-spacer" />}
        <button className="task-tree-main" onClick={() => openEdit(task)}><strong>{task.title}</strong><span>{children.length ? `${children.length} 个下级任务` : task.status === "completed" ? "已完成" : formatMinutes(task.estimatedMinutes)}</span></button>
        {task.completionMode === "quantity" ? <div className="quantity-tree-actions"><div className="quantity-stepper" aria-label={`${task.title}数量进度`}>
          <span className="quantity-card-label">累计 {quantityCurrent - quantityStart} / {quantityTarget - quantityStart} {task.progressUnit}</span>
          <button type="button" aria-label={`减少${task.title}进度${quantityStep}`} disabled={quantityCurrent <= quantityStart || (checkin?.quantity ?? 0) <= 0} onClick={() => changeTreeQuantity(task, -quantityStep)}>−</button>
          <strong>{quantityCurrent}<span> / {quantityTarget} {task.progressUnit}</span></strong>
          <button type="button" aria-label={`增加${task.title}进度${quantityStep}`} disabled={quantityCurrent >= quantityTarget} onClick={() => changeTreeQuantity(task, quantityStep)}>＋</button>
          <small>今日 {checkin?.quantity ?? 0}/{dailyMinimum} {task.progressUnit}{checkin?.completed ? " · 已达标" : ""}</small></div><TaskTreeQuickActions task={task} onComplete={() => completeTask(task)} /></div> : <div className="task-tree-progress"><TaskTreeQuickActions task={task} onComplete={() => completeTask(task)} /></div>}
      </div>
      <div className={`task-drop-zone task-drop-after ${draggingTaskId && dragTarget?.taskId === task.id && dragTarget.placement === "after" ? "is-active" : ""}`} aria-label={`将任务排在${task.title}之后`} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); if (draggingTaskId) setDragTarget({ taskId: task.id, placement: "after" }); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedId = event.dataTransfer.getData("text/task-id"); setDragTarget(null); setDraggingTaskId(null); if (draggedId && draggedId !== task.id) moveAfterTask(draggedId, task); }}><span>排在此任务之后</span></div>
      {children.length > 0 && expanded && <div className="task-tree-children">{renderTaskTree(children, task.id, pool)}</div>}
    </div>;
  });

  const renderContentTree = (parent?: string): React.ReactNode => subjectNodes.filter((node) => node.parentId === parent).map((node) => {
    const children = subjectNodes.filter((item) => item.parentId === node.id);
    const directTasks = treeTasks.filter((task) => task.contentNodeId === node.id);
    const roots = directTasks.filter((task) => !task.parentTaskId || !treeTasks.some((item) => item.id === task.parentTaskId));
    const expanded = expandedNodes.has(node.id);
    const progress = nodeProgress(node.id);
    const expandable = children.length > 0 || roots.length > 0;
    return <div className={`content-tree-branch task-category-branch ${categoryDropTarget === node.id ? "is-task-drop-target" : ""}`} key={node.id}><div className="content-tree-row task-category-row" onDragEnter={(event) => { if (event.dataTransfer.types.includes("text/task-id")) { event.preventDefault(); event.stopPropagation(); setCategoryDropTarget(node.id); } }} onDragOver={(event) => { if (event.dataTransfer.types.includes("text/task-id")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCategoryDropTarget(null); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedId = event.dataTransfer.getData("text/task-id"); setCategoryDropTarget(null); if (draggedId) moveTaskToCategory(draggedId, node.id); }}><button className="tree-toggle" disabled={!expandable} aria-label={`${expanded ? "收起" : "展开"}${node.name}`} onClick={() => expandable && toggleNode(node.id)}>{expandable ? (expanded ? "−" : "+") : "·"}</button><div className="content-tree-title"><span className="category-kicker">分类</span><strong>{node.name}</strong><span>{directTasks.length} 个任务 · {children.length} 个下级分类</span></div><div className="content-tree-progress"><div className="progress-rail"><div className="progress-fill" style={{ width: `${progress ?? 0}%`, background: selectedSubject?.color }} /></div><b>{progress === null ? "—" : `${progress}%`}</b></div><div className="content-tree-actions"><button onClick={() => openTask({ subjectId: selectedSubjectId, stageId: stageDefault, contentNodeId: node.id })}>＋ 任务</button><button onClick={() => addChildNode(node.id)}>＋ 下级分类</button><button className="danger-text" onClick={() => removeNode(node)}>删除</button></div></div>{expandable && expanded && <div className="content-tree-children">{roots.length > 0 && <div className="task-tree">{renderTaskTree(roots)}</div>}{renderContentTree(node.id)}</div>}</div>;
  });

  const subjectProgress = averageTaskProgress(allSubjectTasks);
  const unclassifiedRoots = treeTasks.filter((task) => (!task.contentNodeId || !subjectNodes.some((node) => node.id === task.contentNodeId)) && (!task.parentTaskId || !treeTasks.some((item) => item.id === task.parentTaskId)));

  return (
    <>
      <header className="page-head"><div><h1>{lifeMode ? "目标任务树" : "学习任务树"}</h1></div></header>
      <div className="subject-tabs" role="tablist" aria-label="切换科目">{snapshot.subjects.map((subject) => <button role="tab" aria-selected={selectedSubjectId === subject.id} className={selectedSubjectId === subject.id ? "active" : ""} style={{ "--subject-color": subject.color } as React.CSSProperties} key={subject.id} onClick={() => { setSelectedSubjectId(subject.id); setStageFilter("all"); setScheduleFilter("all"); setParentId(""); }}><i />{subject.name}</button>)}</div>
      {selectedSubject ? <section className="card subject-plan-card" style={{ "--subject-color": selectedSubject.color } as React.CSSProperties}>
        <div className="subject-goal-row"><div className="subject-progress-ring" style={{ "--ring-progress": `${subjectProgress ?? 0}%` } as React.CSSProperties}><strong>{subjectProgress ?? 0}%</strong><span>总进度</span></div><button className="subject-goal-title subject-edit-entry" onClick={() => setEditingSubject(selectedSubject)}><span>当前{lifeMode ? "领域" : "科目"}目标 · 点击修改</span><h2>{selectedSubject.name}</h2><p>{subjectStages.length ? `${subjectStages.length} 个可选阶段` : "未使用阶段"} · {subjectNodes.length} 个任务分类 · {allSubjectTasks.length} 个任务</p></button>{!lifeMode && <div className="subject-goal-stat"><span>目标分数</span><strong>{selectedSubject.targetScore ?? "—"}</strong></div>}<div className="subject-goal-stat"><span>{selectedSubject.targetDate ? `距离${lifeMode ? "领域" : "科目"}目标` : `距离${lifeMode ? "目标日" : "考试"}`}</span><strong>{daysUntil(selectedSubject.targetDate || snapshot.goal!.examDate)} 天</strong>{selectedSubject.targetStartDate && <small>{selectedSubject.targetStartDate.slice(5).replace("-", "/")} 开始</small>}</div><div className="subject-primary-actions"><button className="btn btn-primary btn-small" onClick={() => openTask({ subjectId: selectedSubjectId, stageId: stageDefault })}>＋ 新建任务</button><button className="btn btn-quiet btn-small" onClick={quickAddCategory}>＋ 任务分类</button><button className="btn btn-quiet btn-small" onClick={openImport}>批量导入</button></div></div>
        <div className="subject-total-progress"><div className="progress-rail"><div className="progress-fill" style={{ width: `${subjectProgress ?? 0}%`, background: selectedSubject.color }} /></div><span>整体完成率</span></div>
        <div className="task-tree-filterbar"><div className="stage-filter"><span>学习阶段（可选）</span><button className={stageFilter === "all" ? "active" : ""} onClick={() => setStageFilter("all")}>全部任务</button>{subjectStages.map((stage) => <button className={stageFilter === stage.id ? "active" : ""} key={stage.id} onClick={() => setStageFilter(stage.id)}>{stage.name}</button>)}<button className={stageFilter === "none" ? "active" : ""} onClick={() => setStageFilter("none")}>未分阶段</button></div><div className="schedule-quick-filter" aria-label="按任务安排筛选"><button className={scheduleFilter === "all" ? "active" : ""} onClick={() => setScheduleFilter("all")}>全部安排</button><button className={scheduleFilter === "today" ? "active" : ""} onClick={() => setScheduleFilter("today")}>仅显示今日</button><button className={scheduleFilter === "unscheduled" ? "active" : ""} onClick={() => setScheduleFilter("unscheduled")}>未安排</button><button className={scheduleFilter === "overdue" ? "active danger" : ""} onClick={() => setScheduleFilter("overdue")}>已逾期</button></div></div>
        {(stageFilter !== "all" || scheduleFilter !== "all") && <div className="task-filter-summary"><span>当前筛选显示 {selectedTasks.length} 个任务</span><button onClick={() => { setStageFilter("all"); setScheduleFilter("all"); }}>清除筛选</button></div>}
        <div className="learning-tree">{renderContentTree(undefined)}{unclassifiedRoots.length > 0 && <div className="task-tree task-tree-root">{renderTaskTree(unclassifiedRoots)}</div>}<div className="task-root-drop" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const draggedId = event.dataTransfer.getData("text/task-id"); if (draggedId) moveTaskToCategory(draggedId, undefined); }}>拖到这里移到科目顶层</div>{snapshot.meta.completedTaskPlacement === "separate" && completedTasks.length > 0 && <details className="subject-completed-list"><summary>已完成任务 · {completedTasks.length}</summary><div className="task-tree">{renderTaskTree(completedTasks, undefined, completedTasks)}</div></details>}</div>
      </section> : <div className="card empty-today"><div className="empty-icon">科</div><div><h3>还没有科目</h3><p>在下方“编辑科目与层级”中添加第一门考试科目。</p></div></div>}
      <details className="section card structure-editor">
        <summary><div><strong>编辑科目与分类</strong><span>添加科目、可选阶段和任务分类；日常执行时可以保持收起</span></div><b>展开设置</b></summary>
        <div className="structure-editor-grid">
          <form className="structure-card" onSubmit={addSubject}><h3>添加科目</h3><div className="compact-form subject-compact-form"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="科目名称" /><input type="number" min="0" max="300" value={targetScore} onChange={(e) => setTargetScore(e.target.value)} placeholder="目标分数" /><input className="color-input" type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="科目颜色" /><button className="btn btn-primary btn-small" disabled={saving || !name.trim()}>{saving ? "保存中…" : "添加"}</button></div>{selectedSubject && <button className="text-button danger-text" type="button" onClick={() => removeSubject(selectedSubject)}>删除当前科目</button>}</form>
          <section className="structure-card"><h3>学习阶段 <span>可选</span></h3><form className="compact-form" onSubmit={addStage}><input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="例如：基础阶段" /><input type="date" value={stageStart} onChange={(e) => setStageStart(e.target.value)} aria-label="阶段开始日期" /><input type="date" value={stageEnd} min={stageStart || undefined} onChange={(e) => setStageEnd(e.target.value)} aria-label="阶段结束日期" /><button className="btn btn-primary btn-small">添加</button></form><div className="stage-list">{subjectStages.map((stage) => <div key={stage.id}><strong>{stage.name}</strong><span>{stage.startDate || "未设日期"}{stage.endDate ? ` → ${stage.endDate}` : ""}</span><button className="text-button danger-text" onClick={() => removeStage(stage)}>删除</button></div>)}</div></section>
          <section className="structure-card"><h3>添加任务分类 <span>任意层级</span></h3><p className="structure-hint">分类只负责整理任务，本身不能被完成或打卡。</p><form className="compact-form content-form" onSubmit={addNode}><input value={nodeName} onChange={(e) => setNodeName(e.target.value)} placeholder="例如：高等数学" /><select aria-label="上级任务分类" value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">放在科目根目录</option>{subjectNodes.map((node) => <option value={node.id} key={node.id}>{node.name}</option>)}</select><button className="btn btn-primary btn-small">添加分类</button></form></section>
        </div>
      </details>
      {taskMenu && <div className="task-context-menu" role="menu" tabIndex={-1} style={{ left: Math.min(taskMenu.x, window.innerWidth - 206), top: Math.min(taskMenu.y, window.innerHeight - 278) }} onKeyDown={(event) => event.key === "Escape" && setTaskMenu(null)}><span>任务操作</span><button role="menuitem" onClick={() => { openEdit(taskMenu.task); setTaskMenu(null); }}>编辑任务</button><button role="menuitem" onClick={() => { copyTask(taskMenu.task); setTaskMenu(null); }}>复制任务</button><button role="menuitem" onClick={() => { openTask({ subjectId: selectedSubjectId, parentTaskId: taskMenu.task.id, stageId: taskMenu.task.stageId ?? stageDefault, contentNodeId: taskMenu.task.contentNodeId }); setTaskMenu(null); }}>添加下级任务</button><button role="menuitem" onClick={() => { convertTaskToCategory(taskMenu.task); setTaskMenu(null); }}>转为任务分类</button><button className="danger" role="menuitem" onClick={() => { const task = taskMenu.task; setTaskMenu(null); confirm({ title: `删除“${task.title}”？`, message: "任务会移入最近删除并保留30天，期间可以恢复。", confirmLabel: "移入最近删除", tone: "danger", onConfirm: async () => { await persist(moveTaskToTrash(snapshot, task.id, new Date().toISOString())); } }); }}>删除任务</button></div>}
      {editingSubject && <SubjectDialog subject={editingSubject} onClose={() => setEditingSubject(null)} onSave={async (patch) => { const now = new Date().toISOString(); await persist({ ...snapshot, subjects: snapshot.subjects.map((subject) => subject.id === editingSubject.id ? { ...subject, ...patch, updatedAt: now } : subject), meta: { ...snapshot.meta, updatedAt: now } }); setEditingSubject(null); }} />}
    </>
  );
}

function SubjectDialog({ subject, onClose, onSave }: { subject: Subject; onClose: () => void; onSave: (patch: Partial<Subject>) => Promise<void> }) {
  const [name, setName] = useState(subject.name);
  const [color, setColor] = useState(subject.color);
  const [targetScore, setTargetScore] = useState(subject.targetScore?.toString() ?? "");
  const [useTargetDate, setUseTargetDate] = useState(Boolean(subject.targetDate));
  const [useTargetStartDate, setUseTargetStartDate] = useState(Boolean(subject.targetStartDate));
  const [targetStartDate, setTargetStartDate] = useState(subject.targetStartDate ?? localDate(new Date()));
  const [targetDate, setTargetDate] = useState(subject.targetDate ?? localDate(new Date()));
  const [saving, setSaving] = useState(false);
  return <div className="dialog-backdrop app-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="app-dialog subject-dialog" onSubmit={async (event) => { event.preventDefault(); if (!name.trim()) return; if (useTargetDate && useTargetStartDate && targetStartDate > targetDate) return; setSaving(true); try { await onSave({ name: name.trim(), color, targetScore: targetScore ? Number(targetScore) : undefined, targetStartDate: useTargetDate && useTargetStartDate ? targetStartDate : undefined, targetDate: useTargetDate ? targetDate : undefined }); } finally { setSaving(false); } }}><button className="dialog-close" type="button" aria-label="关闭" onClick={onClose}>×</button><span className="app-dialog-kicker">科目设置</span><h2>修改 {subject.name}</h2><div className="form-grid"><div className="field full"><label htmlFor="subject-edit-name">科目名称</label><input id="subject-edit-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="field"><label htmlFor="subject-edit-score">目标分数</label><input id="subject-edit-score" type="number" min="0" value={targetScore} onChange={(event) => setTargetScore(event.target.value)} /></div><div className="field"><label htmlFor="subject-edit-color">科目标识色</label><input id="subject-edit-color" className="color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></div><label className="editor-toggle full subject-date-switch"><input type="checkbox" checked={useTargetDate} onChange={(event) => setUseTargetDate(event.target.checked)} /><span />为该科目单独设置目标日期</label>{useTargetDate && <><label className="editor-toggle full subject-date-switch secondary-toggle"><input type="checkbox" checked={useTargetStartDate} onChange={(event) => setUseTargetStartDate(event.target.checked)} /><span />同时设置起始日期</label><div className={`subject-date-fields full ${useTargetStartDate ? "has-start" : "deadline-only"}`}>{useTargetStartDate && <div className="field"><label htmlFor="subject-target-start-date">起始日期</label><input id="subject-target-start-date" type="date" max={targetDate || undefined} value={targetStartDate} onChange={(event) => setTargetStartDate(event.target.value)} /></div>}<div className="field"><label htmlFor="subject-target-date">截止日期</label><input id="subject-target-date" type="date" min={useTargetStartDate ? targetStartDate : undefined} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></div></div>{useTargetStartDate && targetStartDate > targetDate && <div className="form-error full">起始日期不能晚于截止日期</div>}</>}</div><div className="app-dialog-actions"><button className="btn btn-secondary" type="button" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={saving || !name.trim() || Boolean(useTargetDate && useTargetStartDate && targetStartDate > targetDate)}>{saving ? "保存中…" : "保存科目"}</button></div></form></div>;
}

const MARKDOWN_EXAMPLE = `# 数学一
## [阶段] 基础阶段
### 高等数学
#### 积分
- [ ] 完成反常积分课程 | 90分钟 | 2026-08-15
  - [ ] 整理课程笔记 | 30分钟
  - [ ] 完成基础习题 | 60分钟

# 英语一
## 阅读理解
- [ ] 精读 2010 年 Text 1 | 50分钟`;

function MarkdownImport({ snapshot, persist, confirm, onBack }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void>; confirm: (confirm: AppConfirm) => void; onBack: () => void }) {
  const [source, setSource] = useState(MARKDOWN_EXAMPLE);
  const [parsed, setParsed] = useState<ParsedMarkdownPlan | null>(null);
  const [mode, setMode] = useState<"append" | "initialize">(snapshot.tasks.length ? "append" : "initialize");
  const [message, setMessage] = useState("");
  const preview = () => { setParsed(parseMarkdownPlan(source)); setMessage(""); };
  const applyImport = async () => {
    if (!parsed || parsed.issues.length || !parsed.tasks.length) return;
    if (mode === "initialize" && snapshot.meta.activeTimer) {
      setMessage("请先结束或放弃当前计时，再执行初始化导入。");
      return;
    }
    if (mode === "initialize" && (snapshot.tasks.length || snapshot.contentNodes.length)) {
      confirm({ title: "确认初始化导入？", message: "现有阶段、任务分类和任务会被替换；计时记录、目标信息和已有专注记录的科目仍会保留。", confirmLabel: "继续导入", tone: "danger", onConfirm: () => applyParsedImport() });
      return;
    }
    await applyParsedImport();
  };
  const applyParsedImport = async () => {
    if (!parsed || parsed.issues.length) return;
    const now = new Date().toISOString();
    const baseSubjects = mode === "initialize" ? [] : [...snapshot.subjects];
    const subjectIds = new Map<string, string>();
    for (const item of parsed.subjects) {
      const existing = (mode === "initialize" ? snapshot.subjects : baseSubjects).find((subject) => subject.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (existing) {
        subjectIds.set(item.key, existing.id);
        if (mode === "initialize" && !baseSubjects.some((subject) => subject.id === existing.id)) baseSubjects.push({ ...existing, sortOrder: baseSubjects.length, updatedAt: now });
      }
      else {
        const id = cryptoId(); subjectIds.set(item.key, id);
        baseSubjects.push({ id, name: item.name, color: SUBJECT_COLORS[baseSubjects.length % SUBJECT_COLORS.length], sortOrder: baseSubjects.length, createdAt: now, updatedAt: now });
      }
    }
    if (mode === "initialize") {
      const historicalSubjectIds = new Set(snapshot.studySessions.map((session) => session.subjectId));
      for (const subject of snapshot.subjects) {
        if (historicalSubjectIds.has(subject.id) && !baseSubjects.some((item) => item.id === subject.id)) baseSubjects.push({ ...subject, sortOrder: baseSubjects.length, updatedAt: now });
      }
    }
    const stages = mode === "initialize" ? [] as Stage[] : [...snapshot.stages];
    const stageIds = new Map<string, string>();
    for (const item of parsed.stages) {
      const subjectId = subjectIds.get(item.subjectKey)!;
      const existing = stages.find((stage) => stage.subjectId === subjectId && stage.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (existing) stageIds.set(item.key, existing.id);
      else { const id = cryptoId(); stageIds.set(item.key, id); stages.push({ id, subjectId, name: item.name, sortOrder: stages.filter((stage) => stage.subjectId === subjectId).length, createdAt: now, updatedAt: now }); }
    }
    const nodes = mode === "initialize" ? [] as ContentNode[] : [...snapshot.contentNodes];
    const nodeIds = new Map<string, string>();
    for (const item of parsed.nodes) {
      const subjectId = subjectIds.get(item.subjectKey)!;
      const parentId = item.parentKey ? nodeIds.get(item.parentKey) : undefined;
      const existing = nodes.find((node) => node.subjectId === subjectId && node.parentId === parentId && node.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (existing) nodeIds.set(item.key, existing.id);
      else { const id = cryptoId(); nodeIds.set(item.key, id); nodes.push({ id, subjectId, parentId, name: item.name, sortOrder: nodes.filter((node) => node.subjectId === subjectId && node.parentId === parentId).length, createdAt: now, updatedAt: now }); }
    }
    const tasks = mode === "initialize" ? [] as Task[] : [...snapshot.tasks];
    const schedules = mode === "initialize" ? [] as TaskSchedule[] : [...snapshot.taskSchedules];
    const taskIds = new Map<string, string>();
    for (const item of parsed.tasks) {
      const id = cryptoId(); taskIds.set(item.key, id);
      const subjectId = subjectIds.get(item.subjectKey)!;
      tasks.push({ id, title: item.title, subjectId, parentTaskId: item.parentTaskKey ? taskIds.get(item.parentTaskKey) : undefined, stageId: item.stageKey ? stageIds.get(item.stageKey) : undefined, contentNodeId: item.contentKey ? nodeIds.get(item.contentKey) : undefined, completionMode: "check", status: item.completed ? "completed" : "active", estimatedMinutes: item.estimatedMinutes, autoRollover: false, includeInProgress: true, completedAt: item.completed ? now : undefined, createdAt: now, updatedAt: now });
      if (item.plannedDate) schedules.push({ id: cryptoId(), taskId: id, plannedDate: item.plannedDate, originalPlannedDate: item.plannedDate, rolloverCount: 0, totalDelayedDays: 0, createdAt: now, updatedAt: now });
    }
    const studySessions = mode === "initialize" ? snapshot.studySessions.map((session) => ({ ...session, taskId: undefined, updatedAt: now })) : snapshot.studySessions;
    const importedSubjectIds = new Set(baseSubjects.map((subject) => subject.id));
    await persist({ ...snapshot, subjects: baseSubjects, stages, contentNodes: nodes, tasks, taskSchedules: schedules, repeatRules: mode === "initialize" ? [] : snapshot.repeatRules, reviewPlans: mode === "initialize" ? [] : snapshot.reviewPlans, taskCheckins: mode === "initialize" ? [] : snapshot.taskCheckins, studyReviews: mode === "initialize" ? snapshot.studyReviews.filter((review) => !review.subjectId || importedSubjectIds.has(review.subjectId)) : snapshot.studyReviews, abilitySheets: mode === "initialize" ? snapshot.abilitySheets.filter((sheet) => importedSubjectIds.has(sheet.subjectId)) : snapshot.abilitySheets, examRecords: mode === "initialize" ? snapshot.examRecords.filter((record) => importedSubjectIds.has(record.subjectId)) : snapshot.examRecords, studySessions, meta: { ...snapshot.meta, updatedAt: now } });
    setMessage(`已${mode === "initialize" ? "初始化" : "追加"}导入 ${parsed.subjects.length} 个科目、${parsed.nodes.length} 个任务分类、${parsed.tasks.length} 个任务。`);
    setParsed(null);
  };
  return <><header className="page-head"><div><div className="page-kicker">科目 · 批量录入</div><h1>批量导入</h1></div><div className="head-actions"><button className="btn btn-quiet" onClick={onBack}>返回科目</button><div className="page-date">先解析预览，确认后才写入本地数据</div></div></header><div className="import-layout"><section className="card import-editor"><div className="import-toolbar"><div className="segmented"><button className={mode === "append" ? "active" : ""} onClick={() => setMode("append")}>追加导入</button><button className={mode === "initialize" ? "active" : ""} onClick={() => setMode("initialize")}>初始化导入</button></div><button className="btn btn-primary btn-small" onClick={preview}>解析并预览</button></div><textarea aria-label="Markdown 学习计划" value={source} onChange={(event) => { setSource(event.target.value); setParsed(null); }} /><div className="import-help"><strong>格式规则</strong><span># 一级标题是科目；“## [阶段] 名称”是可选阶段；其他标题是任务分类；缩进任务会成为子任务。</span><code>- [ ] 任务名称 | 60分钟 | 2026-08-15</code></div></section><section className="card import-preview"><h2>导入预览</h2>{!parsed ? <p className="empty-copy">修改左侧 Markdown 后，点击“解析并预览”。系统不会在预览阶段写入数据。</p> : <><div className="import-counts"><div><strong>{parsed.subjects.length}</strong><span>科目</span></div><div><strong>{parsed.nodes.length}</strong><span>任务分类</span></div><div><strong>{parsed.tasks.length}</strong><span>任务</span></div></div>{parsed.issues.length > 0 ? <div className="import-issues"><strong>需要修正</strong>{parsed.issues.map((issue) => <span key={issue}>{issue}</span>)}</div> : <><div className="import-tree-preview">{parsed.subjects.map((subject) => <div key={subject.key}><strong>{subject.name}</strong><span>{parsed.tasks.filter((task) => task.subjectKey === subject.key).length} 个任务</span></div>)}</div><button className="btn btn-primary import-confirm" onClick={applyImport}>确认{mode === "initialize" ? "初始化" : "追加"}导入</button></>}</>}{message && <div className="success-note" role="status">{message}</div>}</section></div></>;
}

function Settings({ snapshot, persist, setTheme, confirm }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void>; setTheme: (theme: "light" | "dark") => Promise<void>; confirm: (confirm: AppConfirm) => void }) {
  const goal = snapshot.goal!;
  const lifeMode = snapshot.meta.workspaceMode === "life";
  const [draft, setDraft] = useState(goal);
  const [focusSettings, setFocusSettings] = useState<NonNullable<AppSnapshot["meta"]["focusSettings"]>>(() => normalizedFocusSettings(snapshot.meta.focusSettings));
  const [studyTargets, setStudyTargets] = useState(snapshot.meta.studyTargets ?? { weeklyMinutes: 2100, monthlyMinutes: 9000 });
  const [completedTaskPlacement, setCompletedTaskPlacement] = useState<"inline" | "separate">(snapshot.meta.completedTaskPlacement ?? "inline");
  const [message, setMessage] = useState("");
  const [reviewTemplateName, setReviewTemplateName] = useState("");
  const [reviewTemplateIntervals, setReviewTemplateIntervals] = useState("1, 2, 4, 7, 15, 30");
  const [trashQuery, setTrashQuery] = useState("");
  const [trashSubject, setTrashSubject] = useState("all");
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(new Set());
  const [trashReferenceTime] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const healthIssues = analyzeDataHealth(snapshot);
  const recentlyDeleted = snapshot.tasks.filter((task) => task.status === "archived" && task.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  const filteredDeleted = recentlyDeleted.filter((task) => (trashSubject === "all" || task.subjectId === trashSubject) && (!trashQuery.trim() || `${task.title} ${task.note ?? ""}`.toLowerCase().includes(trashQuery.trim().toLowerCase())));
  const daysRemaining = (deletedAt?: string) => Math.max(0, 30 - Math.floor((trashReferenceTime - new Date(deletedAt ?? 0).getTime()) / 86400000));

  const updateGoal = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.targetStartDate && draft.targetStartDate > draft.examDate) {
      setMessage("备考开始时间不能晚于考试日期");
      return;
    }
    const nextGoal = { ...draft, updatedAt: new Date().toISOString() };
    await persist({ ...snapshot, goal: nextGoal, meta: { ...snapshot.meta, updatedAt: nextGoal.updatedAt } });
    setMessage(`当前${lifeMode ? "生活" : "考研"}目标已保存`);
  };
  const updateStudySettings = async (event: FormEvent) => {
    event.preventDefault();
    const now = new Date().toISOString();
    await persist({ ...snapshot, meta: { ...snapshot.meta, focusSettings, studyTargets, completedTaskPlacement, updatedAt: now } });
    setMessage("学习与任务列表设置已保存");
  };
  const addReviewTemplate = async (event: FormEvent) => {
    event.preventDefault();
    const intervalsDays = normalizeReviewIntervals(reviewTemplateIntervals);
    if (!reviewTemplateName.trim() || !intervalsDays.length) return setMessage("请填写复习计划名称和有效间隔天数");
    const now = new Date().toISOString();
    const template: ReviewPlanTemplate = { id: cryptoId(), name: reviewTemplateName.trim(), intervalsDays, enabled: true, createdAt: now, updatedAt: now };
    await persist({ ...snapshot, reviewPlanTemplates: [...snapshot.reviewPlanTemplates, template], meta: { ...snapshot.meta, updatedAt: now } });
    setReviewTemplateName("");
    setMessage("复习计划模板已新增");
  };
  const updateReviewTemplate = async (template: ReviewPlanTemplate, patch: Partial<ReviewPlanTemplate>) => {
    const now = new Date().toISOString();
    await persist({ ...snapshot, reviewPlanTemplates: snapshot.reviewPlanTemplates.map((item) => item.id === template.id ? { ...item, ...patch, updatedAt: now } : item), meta: { ...snapshot.meta, updatedAt: now } });
  };
  const restoreDeletedTasks = async (taskIds: string[]) => {
    if (!taskIds.length) return;
    const now = new Date().toISOString();
    const ids = new Set(taskIds);
    const tasks: Task[] = snapshot.tasks.map((task) => ids.has(task.id) ? { ...task, status: task.statusBeforeDelete ?? "active", deletedAt: undefined, statusBeforeDelete: undefined, updatedAt: now } : task);
    await persist({ ...snapshot, tasks, meta: { ...snapshot.meta, updatedAt: now } });
    setSelectedTrashIds(new Set());
    setMessage(`已恢复 ${taskIds.length} 个任务`);
  };

  const exportData = async () => {
    const exportedAt = new Date().toISOString();
    const backedUp: AppSnapshot = { ...snapshot, meta: { ...snapshot.meta, lastBackupAt: exportedAt, updatedAt: exportedAt } };
    await persist(backedUp);
    const blob = new Blob([JSON.stringify(makeBackup(backedUp), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `考研系统备份-${localDate(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("备份已导出，请妥善保存文件");
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup = validateBackup(JSON.parse(await file.text()));
      confirm({ title: "确认恢复备份？", message: "恢复后会覆盖当前浏览器中的全部考研数据。", confirmLabel: "确认恢复", tone: "danger", onConfirm: async () => { await persist(backup.data); setDraft(backup.data.goal ?? goal); setMessage("备份恢复完成"); } });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "备份恢复失败");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <>
      <header className="page-head"><div><div className="page-kicker">系统设置</div><h1>设置</h1></div><div className="page-date">数据只保存在当前浏览器</div></header>
      <div className="settings-grid">
        <section className="card settings-card"><h2>外观</h2><p>日间模式强调清晰和高效；夜间模式使用黑绿底色与薄荷绿强调，适合夜间学习。</p><div className="theme-picker"><button className={(snapshot.meta.theme ?? "light") === "light" ? "selected" : ""} onClick={() => setTheme("light")}><span className="theme-preview light-preview" /><strong>日间</strong></button><button className={snapshot.meta.theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}><span className="theme-preview dark-preview" /><strong>夜间</strong></button></div></section>
        <section className="card settings-card"><h2>空间用途</h2><p>考研备考是默认模式；非备考模式保留所有功能，只把科目、考试日等名称换成生活目标语义。</p><div className="segmented workspace-setting"><button type="button" className={!lifeMode ? "active" : ""} onClick={async () => { const now = new Date().toISOString(); await persist({ ...snapshot, meta: { ...snapshot.meta, workspaceMode: "exam", updatedAt: now } }); }}><strong>考研备考</strong><span>科目 · 阶段 · 考试日期</span></button><button type="button" className={lifeMode ? "active" : ""} onClick={async () => { const now = new Date().toISOString(); await persist({ ...snapshot, meta: { ...snapshot.meta, workspaceMode: "life", updatedAt: now } }); }}><strong>非备考</strong><span>领域 · 习惯 · 目标日期</span></button></div></section>
        <form className="card settings-card focus-settings-card" onSubmit={updateStudySettings}><h2>专注节奏</h2><p>直接选择常用时长，不再使用容易出现浏览器“有效值”提示的数字框。</p><div className="focus-rhythm-grid"><div className="field"><span className="field-label">每轮专注</span><AppSelect id="focus-minutes" label="默认专注时长" value={String(focusSettings.focusMinutes)} options={[25, 40, 45, 50, 60, 90].map((value) => ({ value: String(value), label: `${value} 分钟` }))} onChange={(value) => setFocusSettings({ ...focusSettings, focusMinutes: Number(value) })} /></div><div className="field"><span className="field-label">每轮休息</span><AppSelect id="rest-minutes" label="默认休息时长" value={String(focusSettings.restMinutes)} options={[5, 10, 15, 20, 30].map((value) => ({ value: String(value), label: `${value} 分钟` }))} onChange={(value) => setFocusSettings({ ...focusSettings, restMinutes: Number(value) })} /></div><div className="field"><span className="field-label">暂停多久后提醒</span><AppSelect id="pause-reminder-minutes" label="暂停提醒时长" value={String(focusSettings.pauseReminderMinutes ?? 5)} options={[5, 10, 15, 20].map((value) => ({ value: String(value), label: `${value} 分钟` }))} onChange={(value) => setFocusSettings({ ...focusSettings, pauseReminderMinutes: Number(value) })} /></div><div className="field"><span className="field-label">正计时阶段提醒</span><AppSelect id="reminder-minutes" label="正计时提醒间隔" value={String(focusSettings.countupReminderMinutes)} options={[15, 30, 45, 60, 90].map((value) => ({ value: String(value), label: `每 ${value} 分钟` }))} onChange={(value) => setFocusSettings({ ...focusSettings, countupReminderMinutes: Number(value) })} /></div></div><details className="focus-advanced"><summary>更多专注设置</summary><div className="form-grid"><div className="field"><span className="field-label">沙漏画质</span><AppSelect id="hourglass-quality" label="沙漏画质" value={focusSettings.hourglassQuality ?? "balanced"} options={[{ value: "balanced", label: "均衡 · 省电" }, { value: "high", label: "高拟真 · WebGL 沙粒" }]} onChange={(value) => setFocusSettings({ ...focusSettings, hourglassQuality: value as "balanced" | "high" })} /></div><div className="field checkbox-field"><label><input type="checkbox" checked={focusSettings.soundEnabled} onChange={(event) => setFocusSettings({ ...focusSettings, soundEnabled: event.target.checked })} /> 开启倒计时结束和阶段提醒音</label></div><div className="field"><label htmlFor="weekly-target">每周学习目标（分钟）</label><input id="weekly-target" type="number" min="0" step="30" value={studyTargets.weeklyMinutes ?? ""} onChange={(event) => setStudyTargets({ ...studyTargets, weeklyMinutes: event.target.value ? Number(event.target.value) : undefined })} /></div><div className="field"><label htmlFor="monthly-target">每月学习目标（分钟）</label><input id="monthly-target" type="number" min="0" step="60" value={studyTargets.monthlyMinutes ?? ""} onChange={(event) => setStudyTargets({ ...studyTargets, monthlyMinutes: event.target.value ? Number(event.target.value) : undefined })} /></div></div></details><div className="completed-placement-setting"><span className="field-label">已完成任务的位置</span><div className="segmented task-placement-switch"><button type="button" className={completedTaskPlacement === "inline" ? "active" : ""} onClick={() => setCompletedTaskPlacement("inline")}><strong>保留原位置</strong><span>保持原来的任务层级</span></button><button type="button" className={completedTaskPlacement === "separate" ? "active" : ""} onClick={() => setCompletedTaskPlacement("separate")}><strong>移到已完成列表</strong><span>主列表只保留待完成任务</span></button></div></div><div className="form-actions"><button className="btn btn-primary" type="submit">保存专注与任务设置</button></div></form>
        <section className="card settings-card review-template-settings"><h2>复习计划模板</h2><p>在这里统一维护计划；新建或编辑任务时可直接选择。任务完成后才生成后续复习任务。</p><div className="review-template-list">{snapshot.reviewPlanTemplates.map((template) => <div key={template.id}><label><input value={template.name} onChange={(event) => updateReviewTemplate(template, { name: event.target.value })} /><small>间隔天数</small><input value={template.intervalsDays.join(", ")} onChange={(event) => { const intervalsDays = normalizeReviewIntervals(event.target.value); if (intervalsDays.length) updateReviewTemplate(template, { intervalsDays }); }} /></label><button type="button" className={`apple-switch ${template.enabled ? "is-on" : ""}`} aria-label={`${template.enabled ? "停用" : "启用"}${template.name}`} onClick={() => updateReviewTemplate(template, { enabled: !template.enabled })}><i /></button>{!template.builtIn && <button type="button" className="text-button danger-text" onClick={() => confirm({ title: `删除“${template.name}”？`, message: "已关联到任务的模板选择会被清空，已生成的复习任务不会删除。", confirmLabel: "删除", tone: "danger", onConfirm: async () => { const now = new Date().toISOString(); await persist({ ...snapshot, reviewPlanTemplates: snapshot.reviewPlanTemplates.filter((item) => item.id !== template.id), tasks: snapshot.tasks.map((task) => task.reviewPlanTemplateId === template.id ? { ...task, reviewPlanTemplateId: undefined, updatedAt: now } : task), meta: { ...snapshot.meta, updatedAt: now } }); } })}>删除</button>}</div>)}</div><form className="review-template-add" onSubmit={addReviewTemplate}><div className="field"><label htmlFor="review-template-name">模板名称</label><input id="review-template-name" value={reviewTemplateName} onChange={(event) => setReviewTemplateName(event.target.value)} placeholder="例如：真题错题复习" /></div><div className="field"><label htmlFor="review-template-intervals">间隔天数</label><input id="review-template-intervals" value={reviewTemplateIntervals} onChange={(event) => setReviewTemplateIntervals(event.target.value)} placeholder="1, 3, 7, 14" /></div><button className="btn btn-primary" type="submit">新增模板</button></form></section>
        <form className="card settings-card" onSubmit={updateGoal}>
          <h2>当前{lifeMode ? "生活" : "考研"}目标</h2><p>修改{lifeMode ? "目标" : "考试"}日期不会自动移动未来任务，系统会先显示影响，再由你确认调整。</p>
          <div className="form-grid">
            <div className="field full"><label htmlFor="setting-name">目标名称</label><input id="setting-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="setting-start-date">{lifeMode ? "目标" : "备考"}开始时间</label><input id="setting-start-date" type="date" max={draft.examDate || undefined} value={draft.targetStartDate ?? ""} onChange={(e) => setDraft({ ...draft, targetStartDate: e.target.value || undefined })} /></div>
            <div className="field"><label htmlFor="setting-date">{lifeMode ? "目标" : "考试"}日期</label><input id="setting-date" type="date" min={draft.targetStartDate || undefined} value={draft.examDate} onChange={(e) => setDraft({ ...draft, examDate: e.target.value })} /></div>
            {!lifeMode && <><div className="field"><label htmlFor="setting-score">目标总分</label><input id="setting-score" type="number" min="0" max="500" value={draft.targetScore ?? ""} onChange={(e) => setDraft({ ...draft, targetScore: e.target.value ? Number(e.target.value) : undefined })} /></div><div className="field"><label htmlFor="setting-school">目标院校</label><input id="setting-school" value={draft.school ?? ""} onChange={(e) => setDraft({ ...draft, school: e.target.value || undefined })} /></div><div className="field"><label htmlFor="setting-major">目标专业</label><input id="setting-major" value={draft.major ?? ""} onChange={(e) => setDraft({ ...draft, major: e.target.value || undefined })} /></div></>}
          </div>
          <div className="form-actions"><button className="btn btn-primary" type="submit">保存目标</button></div>
        </form>
        <section className="card settings-card recent-trash-card"><div className="settings-section-head"><div><h2>最近删除</h2><p>删除的任务保留30天，日程、打卡历史和层级关系都会一起保留。</p></div><strong>{recentlyDeleted.length}</strong></div>{recentlyDeleted.length ? <><div className="trash-toolbar"><input aria-label="搜索最近删除" value={trashQuery} onChange={(event) => setTrashQuery(event.target.value)} placeholder="搜索任务名称或备注" /><select aria-label="按科目筛选最近删除" value={trashSubject} onChange={(event) => setTrashSubject(event.target.value)}><option value="all">全部科目</option>{snapshot.subjects.map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select><button disabled={!selectedTrashIds.size} onClick={() => restoreDeletedTasks([...selectedTrashIds])}>恢复已选 {selectedTrashIds.size || ""}</button><button disabled={!filteredDeleted.length} onClick={() => setSelectedTrashIds(new Set(filteredDeleted.map((task) => task.id)))}>全选当前</button></div><div className="recent-trash-list">{filteredDeleted.map((task) => { const subject = snapshot.subjects.find((item) => item.id === task.subjectId); return <div className={selectedTrashIds.has(task.id) ? "is-selected" : ""} key={task.id}><input aria-label={`选择${task.title}`} type="checkbox" checked={selectedTrashIds.has(task.id)} onChange={(event) => setSelectedTrashIds((current) => { const next = new Set(current); if (event.target.checked) next.add(task.id); else next.delete(task.id); return next; })} /><i style={{ background: subject?.color }} /><div><strong>{task.title}</strong><span>{subject?.name ?? "原科目已删除"} · 还可恢复 {daysRemaining(task.deletedAt)} 天</span></div><button onClick={async () => { await persist(restoreTaskFromTrash(snapshot, task.id, new Date().toISOString())); setSelectedTrashIds((current) => { const next = new Set(current); next.delete(task.id); return next; }); setMessage(`已恢复“${task.title}”`); }}>恢复</button><button className="danger-text" onClick={() => confirm({ title: `永久删除“${task.title}”？`, message: "日程、重复规则和打卡记录都会一并删除，此操作不可撤销。", confirmLabel: "永久删除", tone: "danger", onConfirm: async () => { await persist(deleteTaskFromSnapshot(snapshot, task.id, new Date().toISOString())); setMessage(`已永久删除“${task.title}”`); } })}>彻底删除</button></div>; })}</div>{!filteredDeleted.length && <div className="data-health-empty recent-trash-empty"><span>⌕</span><div><strong>没有符合条件的任务</strong><small>换个关键词或科目筛选试试。</small></div></div>}</> : <div className="data-health-empty recent-trash-empty"><span>✓</span><div><strong>最近删除为空</strong><small>误删的任务会在这里保留30天。</small></div></div>}</section>
        <section className="card settings-card">
          <h2>本地数据与备份</h2><p>数据会保存到当前浏览器的 IndexedDB，并同步写入 localStorage 保险副本。重新打开本网站会自动恢复；更换域名、电脑、浏览器或清除网站数据前，请先导出备份。</p>
          <div className="data-actions"><button className="btn btn-primary" onClick={exportData}>导出 JSON 备份</button><button className="btn btn-quiet" onClick={() => fileRef.current?.click()}>从备份恢复</button><input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={importData} /></div>
          {snapshot.meta.lastBackupAt && <div className="metric-note">最近导出：{new Date(snapshot.meta.lastBackupAt).toLocaleString("zh-CN")}</div>}
        </section>
        <section className="card settings-card data-health-card"><div className="data-health-head"><div><h2>数据健康检查</h2><p>检查任务层级、日程、重复规则和日期联动。这里只提示问题，不会自动修改。</p></div><strong className={healthIssues.length ? "has-issues" : "is-healthy"}>{healthIssues.length ? `${healthIssues.length} 项` : "健康"}</strong></div>{healthIssues.length ? <div className="data-health-list">{healthIssues.slice(0, 8).map((issue) => <div className={issue.severity} key={issue.id}><i>{issue.severity === "error" ? "!" : "·"}</i><span><strong>{issue.title}</strong><small>{issue.detail}</small></span></div>)}{healthIssues.length > 8 && <small>另有 {healthIssues.length - 8} 项，请先导出备份后再逐项处理。</small>}</div> : <div className="data-health-empty"><span>✓</span><div><strong>当前数据关联正常</strong><small>未发现孤立任务、重复日程或异常日期。</small></div></div>}</section>
        <section className="card settings-card"><h2>云同步</h2><p>为未来多设备使用保留的位置。当前版本不要求账号，也不会上传任何学习数据。</p><div className="notice">云同步暂未开放。正式面向其他用户推广前，将单独设计账号、隐私和数据冲突处理。</div></section>
        {message && <div className="success-note" role="status">{message}</div>}
      </div>
    </>
  );
}

function CalendarWorkspace({ snapshot, persist, openTask, openEdit, completeTask, rescheduleTask, previewAdjustment }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void>; openTask: (date?: string) => void; openEdit: (task: Task) => void; completeTask: (task: Task) => Promise<void>; rescheduleTask: (taskId: string, date: string, patch?: Partial<TaskSchedule>) => Promise<void>; previewAdjustment: (taskIds: string[], targetDate: string) => void }) {
  const [mode, setMode] = useState<"today" | "week" | "month">("today");
  const [layout, setLayout] = useState<"list" | "timeline">("list");
  const [cursor, setCursor] = useState(() => new Date());
  const [resizing, setResizing] = useState<{ taskId: string; duration: number } | null>(null);
  const [resizeEditingTaskId, setResizeEditingTaskId] = useState<string | null>(null);
  const resizeEditingRef = useRef<string | null>(null);
  const timelineOpenTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timelineOpenTimerRef.current !== null) window.clearTimeout(timelineOpenTimerRef.current);
  }, []);
  const [dragPreviewMinute, setDragPreviewMinute] = useState<number | null>(null);
  const [celebratingTaskId, setCelebratingTaskId] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [taskFilter, setTaskFilter] = useState<"all" | "active" | "quantity">("all");
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const start = new Date(cursor);
  start.setHours(0, 0, 0, 0);
  const dates = Array.from({ length: mode === "today" ? 1 : 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return localDate(date); });
  const weekRangeLabel = mode === "week" ? `${dates[0].slice(5).replace("-", "/")} — ${dates.at(-1)?.slice(5).replace("-", "/")}` : "";
  const schedules = new Map(snapshot.taskSchedules.map((schedule) => [schedule.taskId, schedule]));
  const visibleTasks = snapshot.tasks.filter((task) => (task.status === "active" || task.status === "completed")
    && (subjectFilter === "all" || task.subjectId === subjectFilter)
    && (taskFilter === "all" || (taskFilter === "active" ? task.status === "active" : task.completionMode === "quantity")));
  const active = visibleTasks.filter((task) => task.status === "active");
  const today = localDate(new Date());
  const overdue = active.filter((task) => { const schedule = schedules.get(task.id); return schedule && schedule.plannedDate < today && !task.autoRollover; });
  const shift = (amount: number) => { const next = new Date(cursor); next.setDate(next.getDate() + (mode === "month" ? 0 : amount * (mode === "week" ? 7 : 1))); if (mode === "month") next.setMonth(next.getMonth() + amount); setCursor(next); };
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const monthDates = Array.from({ length: daysInMonth }, (_, index) => new Date(cursor.getFullYear(), cursor.getMonth(), index + 1));
  const monthGridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - ((new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7));
  const monthGridDates = Array.from({ length: 42 }, (_, index) => { const date = new Date(monthGridStart); date.setDate(monthGridStart.getDate() + index); return date; });
  const timelineHours = Array.from({ length: 19 }, (_, index) => index + 6);
  const timelineTasksAll = visibleTasks
    .filter((task) => schedules.get(task.id)?.plannedDate === dates[0])
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const timelineTasks = snapshot.meta.completedTaskPlacement === "separate" ? timelineTasksAll.filter((task) => task.status !== "completed") : timelineTasksAll;
  const completedTimelineTasks = timelineTasksAll.filter((task) => task.status === "completed");
  const positionedTasks = timelineTasks.map((task, index) => {
    const schedule = schedules.get(task.id);
    const duration = resizing?.taskId === task.id ? resizing.duration : Math.max(30, schedule?.plannedDurationMinutes ?? task.estimatedMinutes ?? 60);
    const startMinute = schedule?.plannedStartMinute ?? 7 * 60 + timelineTasks.slice(0, index).reduce((sum, item) => sum + Math.max(30, schedules.get(item.id)?.plannedDurationMinutes ?? item.estimatedMinutes ?? 60), 0);
    return { task, startMinute, duration };
  });
  const findTimelineConflicts = (date: string) => {
    const timed = visibleTasks
      .filter((task) => schedules.get(task.id)?.plannedDate === date && schedules.get(task.id)?.plannedStartMinute !== undefined)
      .map((task) => ({ task, startMinute: schedules.get(task.id)!.plannedStartMinute!, duration: Math.max(30, schedules.get(task.id)?.plannedDurationMinutes ?? task.estimatedMinutes ?? 60) }))
      .sort((a, b) => a.startMinute - b.startMinute);
    const conflicts: { first: typeof timed[number]; second: typeof timed[number]; suggestedStart: number }[] = [];
    for (let index = 0; index < timed.length; index += 1) for (let compared = index + 1; compared < timed.length; compared += 1) {
      if (timed[compared].startMinute >= timed[index].startMinute + timed[index].duration) break;
      conflicts.push({ first: timed[index], second: timed[compared], suggestedStart: Math.min(1410, Math.ceil((timed[index].startMinute + timed[index].duration) / 30) * 30) });
    }
    return conflicts;
  };
  const timelineConflicts = mode === "today" ? findTimelineConflicts(dates[0]) : [];
  const conflictTaskIds = new Set(timelineConflicts.flatMap((conflict) => [conflict.first.task.id, conflict.second.task.id]));
  const clockText = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const todayCheckin = (taskId: string) => snapshot.taskCheckins.find((item) => item.taskId === taskId && item.date === today);
  const updateCalendarQuantity = async (task: Task, delta: number) => {
    const startValue = task.progressStart ?? 0;
    const targetValue = task.progressTarget ?? startValue;
    const currentValue = task.progressCurrent ?? startValue;
    const nextValue = Math.max(startValue, Math.min(targetValue, currentValue + delta));
    const minimum = task.dailyMinimum ?? targetValue - startValue;
    const previousCheckin = todayCheckin(task.id);
    const nextDailyQuantity = Math.max(0, (previousCheckin?.quantity ?? 0) + delta);
    const reachedMinimum = nextDailyQuantity >= minimum;
    const now = new Date().toISOString();
    const checkin: TaskCheckin = previousCheckin
      ? { ...previousCheckin, quantity: nextDailyQuantity, completed: reachedMinimum, updatedAt: now }
      : { id: cryptoId(), taskId: task.id, date: today, quantity: nextDailyQuantity, completed: reachedMinimum, createdAt: now, updatedAt: now };
    if (reachedMinimum && !previousCheckin?.completed) {
      setCelebratingTaskId(task.id); window.setTimeout(() => setCelebratingTaskId(null), 900);
    }
    await persist({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => item.id === task.id ? { ...item, progressCurrent: nextValue, updatedAt: now } : item),
      taskCheckins: previousCheckin ? snapshot.taskCheckins.map((item) => item.id === checkin.id ? checkin : item) : [...snapshot.taskCheckins, checkin],
      meta: { ...snapshot.meta, updatedAt: now },
    });
  };
  const renderCalendarTask = (task: Task, compact = false, interactive = true) => {
    const subject = snapshot.subjects.find((item) => item.id === task.subjectId);
    const currentValue = task.progressCurrent ?? task.progressStart ?? 0;
    const startValue = task.progressStart ?? 0;
    const targetValue = task.progressTarget ?? startValue;
    const step = Math.max(.01, task.progressStep ?? 1);
    const progress = taskProgress(task);
    const stage = snapshot.stages.find((item) => item.id === task.stageId);
    const content = snapshot.contentNodes.find((item) => item.id === task.contentNodeId);
    const schedule = schedules.get(task.id);
    const checkin = todayCheckin(task.id);
    const dailyMinimum = task.dailyMinimum ?? targetValue - startValue;
    return <article className={`calendar-task-item unified-task-row ${task.status === "completed" ? "is-completed" : ""} ${task.completionMode === "quantity" ? "is-quantity" : "is-check"} ${compact ? "is-compact" : ""} ${interactive ? "is-interactive" : "is-readonly"} ${celebratingTaskId === task.id ? "is-celebrating" : ""}`} style={{ "--subject-color": subject?.color ?? "#6fa182", "--task-progress": `${progress}%` } as React.CSSProperties} key={task.id}>
      {interactive && task.completionMode === "check" && <button className="calendar-task-check" aria-label={task.status === "completed" ? `取消完成${task.title}` : `完成${task.title}`} onClick={() => { if (task.status !== "completed") { setCelebratingTaskId(task.id); window.setTimeout(() => setCelebratingTaskId(null), 900); } completeTask(task); }}>{task.status === "completed" ? "✓" : ""}</button>}
      {interactive && task.completionMode === "quantity" && <button className="calendar-task-minus" aria-label={`减少${task.title}${step}`} disabled={currentValue <= startValue || (checkin?.quantity ?? 0) <= 0} onClick={() => updateCalendarQuantity(task, -step)}>−</button>}
      <button className="calendar-task-copy" onClick={() => openEdit(task)}><strong>{task.title}</strong><span className="task-meta-tags"><i style={{ background: subject?.color }} />{subject?.name ?? "未知科目"}{task.important && <em>重要</em>}{stage && <em>{stage.name}</em>}{content && <em>{content.name}</em>}{task.tags?.map((tag) => <em key={tag}>{tag}</em>)}{schedule?.plannedStartMinute !== undefined && <em>{minuteToTime(schedule.plannedStartMinute)}</em>}{task.deadline && <em>截止 {task.deadline.slice(5)}</em>}</span><small>{task.completionMode === "quantity" ? `累计 ${currentValue - startValue}/${targetValue - startValue} ${task.progressUnit ?? ""} · 今日 ${checkin?.quantity ?? 0}/${dailyMinimum} ${task.progressUnit ?? ""}${checkin?.completed ? " · 今日已达标" : ""}` : task.status === "completed" ? "已完成 · 再点勾选可取消" : formatMinutes(task.estimatedMinutes)}</small></button>
      {interactive && task.completionMode === "quantity" && <button className="calendar-task-plus" aria-label={`增加${task.title}${step}`} disabled={currentValue >= targetValue} onClick={() => updateCalendarQuantity(task, step)}>＋</button>}
      {!interactive && <span className="readonly-task-state">{task.completionMode === "quantity" ? `${progress}%${checkin?.completed ? " · 今日达标" : ""}` : task.status === "completed" ? "已完成" : "待完成"}</span>}
    </article>;
  };
  const renderWeekDay = (date: string) => {
    const tasks = visibleTasks.filter((task) => schedules.get(task.id)?.plannedDate === date);
    const minutes = tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
    return <article className={`card day-column ${date === localDate(new Date()) ? "today-column" : ""}`} key={date}>
      <div className="day-head"><span>{new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T00:00:00`))}</span><strong>{date.slice(5).replace("-", "/")}</strong><small>{formatMinutes(minutes)}</small></div>
      <div className="day-tasks">{tasks.map((task) => renderCalendarTask(task, true, false))}{!tasks.length && <button className="day-empty add-day-task" onClick={() => openTask(date)}>＋ 安排任务</button>}</div>
    </article>;
  };
  const insightDates = mode === "week" ? dates : monthDates.map(localDate);
  const insightTaskEntries = insightDates.flatMap((date) => visibleTasks.filter((task) => schedules.get(task.id)?.plannedDate === date).map((task) => ({ task, date })));
  const entryCompleted = ({ task, date }: { task: Task; date: string }) => task.status === "completed" || (task.completionMode === "quantity" && snapshot.taskCheckins.some((checkin) => checkin.taskId === task.id && checkin.date === date && checkin.completed));
  const insightCompleted = insightTaskEntries.filter(entryCompleted).length;
  const insightRate = insightTaskEntries.length ? Math.round(insightCompleted / insightTaskEntries.length * 100) : 0;
  const subjectInsights = snapshot.subjects.map((subject) => {
    const entries = insightTaskEntries.filter(({ task }) => task.subjectId === subject.id);
    const completed = entries.filter(entryCompleted).length;
    return { subject, total: entries.length, completed, rate: entries.length ? Math.round(completed / entries.length * 100) : 0 };
  }).filter((item) => item.total > 0).sort((a, b) => b.total - a.total).slice(0, 3);
  const overviewGroups = mode === "week"
    ? insightDates.map((date) => ({ label: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T00:00:00`)), dates: [date] }))
    : Array.from({ length: Math.ceil(daysInMonth / 7) }, (_, index) => ({ label: `第${index + 1}周`, dates: insightDates.slice(index * 7, Math.min(daysInMonth, (index + 1) * 7)) }));
  const overviewStats = overviewGroups.map((group) => {
    const entries = insightTaskEntries.filter((entry) => group.dates.includes(entry.date));
    const completed = entries.filter(entryCompleted).length;
    return { label: group.label, total: entries.length, completed, rate: entries.length ? Math.round(completed / entries.length * 100) : 0 };
  });
  const periodInsight = mode !== "today" && <aside className="card calendar-period-insight"><section className="period-goals"><header><div><span>{mode === "week" ? "本周" : "本月"}目标</span><strong>{insightCompleted}/{insightTaskEntries.length} 推进</strong></div><b>{insightRate}%</b></header><div>{subjectInsights.length ? subjectInsights.map(({ subject, total, completed, rate }) => <article style={{ "--subject-color": subject.color } as React.CSSProperties} key={subject.id}><div><span>{subject.name}</span><strong>{completed}/{total} 个任务</strong></div><div className="period-goal-rail"><i style={{ width: `${rate}%` }} /></div></article>) : <p>当前周期还没有安排任务。</p>}</div></section><section className="period-overview"><header><span>{mode === "week" ? "本周" : "本月"}概览</span><strong>{insightCompleted}/{insightTaskEntries.length} 完成</strong></header><div className="period-overview-bars">{overviewStats.map((item) => <div key={item.label}><b><i style={{ height: `${Math.max(item.total ? 8 : 2, item.rate)}%` }} /></b><span>{item.label}</span><small>{item.completed}/{item.total}</small></div>)}</div></section></aside>;
  return (
    <>
      <div className={`calendar-workspace calendar-${mode}-${layout}`}>
      <header className="page-head"><div><div className="page-kicker">计划与执行</div><h1>{mode === "month" ? `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月` : mode === "today" ? "今日计划" : "周计划"}</h1></div><div className="calendar-actions"><div className="segmented calendar-mode-switch"><button className={mode === "today" ? "active" : ""} onClick={() => { setMode("today"); setCursor(new Date()); }}>日</button><button className={mode === "week" ? "active" : ""} onClick={() => { const date = new Date(); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); setCursor(date); setMode("week"); }}>周</button><button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>月</button></div><div className="segmented calendar-layout-switch">{mode === "month" ? <><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")}>月历</button><button className={layout === "timeline" ? "active" : ""} onClick={() => setLayout("timeline")}>时间轴</button></> : <><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")}>任务列表</button><button className={layout === "timeline" ? "active" : ""} onClick={() => setLayout("timeline")}>时间轴</button></>}</div><div className="calendar-unit-nav"><button className="icon-btn calendar-arrow" aria-label={`上一个${mode === "today" ? "日" : mode === "week" ? "周" : "月"}`} onClick={() => shift(-1)}>‹</button><button className="icon-btn calendar-arrow" aria-label={`下一个${mode === "today" ? "日" : mode === "week" ? "周" : "月"}`} onClick={() => shift(1)}>›</button></div><button className="btn btn-primary" onClick={() => openTask(mode === "today" ? localDate(cursor) : undefined)}>＋ 新建任务</button></div></header>
      <nav className="calendar-filterbar" aria-label="筛选日历任务"><div><span>科目</span><button className={subjectFilter === "all" ? "active" : ""} onClick={() => setSubjectFilter("all")}>全部</button>{snapshot.subjects.map((subject) => <button className={subjectFilter === subject.id ? "active" : ""} style={{ "--filter-color": subject.color } as React.CSSProperties} key={subject.id} onClick={() => setSubjectFilter(subject.id)}><i />{subject.name}</button>)}</div><div><span>任务</span><button className={taskFilter === "all" ? "active" : ""} onClick={() => setTaskFilter("all")}>全部</button><button className={taskFilter === "active" ? "active" : ""} onClick={() => setTaskFilter("active")}>未完成</button><button className={taskFilter === "quantity" ? "active" : ""} onClick={() => setTaskFilter("quantity")}>量化任务</button></div></nav>
      {mode === "today" && overdue.length > 0 && <section className="card overdue-workbench"><div><strong>{overdue.length} 个逾期任务需要决定</strong><span>系统不会擅自移动。可以先预览把它们统一安排到今天。</span></div><button className="btn btn-danger btn-small" onClick={() => previewAdjustment(overdue.map((task) => task.id), today)}>预览调整</button></section>}
      {mode === "today" && layout === "timeline" && timelineConflicts.length > 0 && <section className="card timeline-conflicts"><header><div><strong>{timelineConflicts.length} 处时间冲突</strong><span>只给出错开建议，不会自动改动你的安排。</span></div></header>{timelineConflicts.map((conflict) => <div key={`${conflict.first.task.id}-${conflict.second.task.id}`}><span><b>{conflict.first.task.title}</b> 与 <b>{conflict.second.task.title}</b> 重叠</span><button onClick={() => rescheduleTask(conflict.second.task.id, dates[0], { timeMode: "range", plannedStartMinute: conflict.suggestedStart, plannedDurationMinutes: conflict.second.duration })}>改到 {clockText(conflict.suggestedStart)}</button></div>)}</section>}
      <div className={`calendar-view-frame ${mode === "today" ? "is-single" : "has-insights"}`}><div className="calendar-primary-view">
      {mode === "today" && layout === "list" && <section className="calendar-day-list"><div className="calendar-list-heading"><div><strong>{dates[0].slice(5).replace("-", " 月 ")} 日</strong><span>{new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date(`${dates[0]}T00:00:00`))} · {timelineTasksAll.length} 个任务</span></div><button onClick={() => openTask(dates[0])}>＋ 安排任务</button></div><div>{timelineTasks.map((task) => renderCalendarTask(task))}{!timelineTasks.length && !completedTimelineTasks.length && <button className="calendar-list-empty" onClick={() => openTask(dates[0])}>这一天还没有安排任务，点击添加</button>}{snapshot.meta.completedTaskPlacement === "separate" && completedTimelineTasks.length > 0 && <details className="calendar-completed-list"><summary>已完成 · {completedTimelineTasks.length}</summary><div>{completedTimelineTasks.map((task) => renderCalendarTask(task))}</div></details>}</div></section>}
      {mode === "week" && layout === "timeline" && <section className="week-timeline-list">{dates.map((date) => { const tasks = visibleTasks.filter((task) => schedules.get(task.id)?.plannedDate === date).sort((a, b) => (schedules.get(a.id)?.plannedStartMinute ?? 1440) - (schedules.get(b.id)?.plannedStartMinute ?? 1440)); return <article className={date === today ? "is-today" : ""} key={date}><div className="week-timeline-day"><strong>{Number(date.slice(-2))}</strong><span>{new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T00:00:00`))}</span></div><div className="week-timeline-rail">{tasks.map((task) => { const schedule = schedules.get(task.id); return <div className="week-time-task" style={{ "--subject-color": snapshot.subjects.find((subject) => subject.id === task.subjectId)?.color ?? "#6fa182" } as React.CSSProperties} key={task.id}><time>{schedule?.plannedStartMinute === undefined ? "全天" : minuteToTime(schedule.plannedStartMinute)}</time>{renderCalendarTask(task, true, false)}</div>; })}{!tasks.length && <button className="week-timeline-empty" onClick={() => openTask(date)}>＋ 安排任务</button>}</div></article>; })}</section>}
      {mode === "month" && layout === "list" && <section className="card month-calendar"><div className="month-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div><div className="month-grid">{monthGridDates.map((date) => { const dateString = localDate(date); const tasks = visibleTasks.filter((task) => schedules.get(task.id)?.plannedDate === dateString); return <article className={`month-cell ${date.getMonth() !== cursor.getMonth() ? "outside" : ""} ${dateString === today ? "today-cell" : ""}`} key={dateString}><button className="month-date-button" onClick={() => openTask(dateString)}><strong>{date.getDate()}</strong></button><div>{tasks.slice(0, 4).map((task) => <button className={`${task.status === "completed" ? "done" : ""} ${task.completionMode === "quantity" ? "quantity" : "check"}`} style={{ "--subject-color": snapshot.subjects.find((subject) => subject.id === task.subjectId)?.color ?? "#999", "--task-progress": `${taskProgress(task)}%` } as React.CSSProperties} key={task.id} title="查看任务" onClick={() => openEdit(task)}><b>{task.completionMode === "check" ? (task.status === "completed" ? "✓" : "○") : `${taskProgress(task)}%`}</b><span>{task.title}</span></button>)}{tasks.length > 4 && <button className="month-more" onClick={() => setExpandedDate(dateString)}>展开全部 {tasks.length} 项</button>}</div></article>; })}</div></section>}
      {mode === "today" && layout === "timeline" && <section className="card day-timeline"><div className="timeline-date-head"><div><strong>{dates[0].slice(5).replace("-", " 月 ")} 日</strong><span>{new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date(`${dates[0]}T00:00:00`))} · 双击任务进入时长调整</span></div><button onClick={() => openTask(dates[0])}>＋ 安排任务</button></div><div className="timeline-canvas" onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragPreviewMinute(null); }} onDragOver={(event) => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); const rawMinute = 360 + ((event.clientY - bounds.top) / 54) * 60; setDragPreviewMinute(Math.max(360, Math.min(1410, Math.round(rawMinute / 30) * 30))); }} onDrop={(event) => { event.preventDefault(); const taskId = event.dataTransfer.getData("text/task-id"); const plannedStartMinute = dragPreviewMinute; setDragPreviewMinute(null); if (!taskId || plannedStartMinute === null) return; rescheduleTask(taskId, dates[0], { timeMode: "range", plannedStartMinute, plannedDurationMinutes: schedules.get(taskId)?.plannedDurationMinutes ?? 60 }); }}><div className={`timeline-period morning ${dragPreviewMinute !== null && dragPreviewMinute < 720 ? "is-drop-target" : ""}`}><span>上午</span></div><div className={`timeline-period afternoon ${dragPreviewMinute !== null && dragPreviewMinute >= 720 && dragPreviewMinute < 1080 ? "is-drop-target" : ""}`}><span>下午</span></div><div className={`timeline-period evening ${dragPreviewMinute !== null && dragPreviewMinute >= 1080 ? "is-drop-target" : ""}`}><span>晚上</span></div>{timelineHours.map((hour) => <Fragment key={hour}><div className="timeline-hour-line" style={{ top: `${(hour - 6) * 54}px` }}><span>{String(hour).padStart(2, "0")}:00</span></div>{hour < 24 && <div className="timeline-half-line" style={{ top: `${(hour - 6) * 54 + 27}px` }} />}</Fragment>)}{dragPreviewMinute !== null && <div className="timeline-drop-marker" style={{ top: `${(dragPreviewMinute - 360) / 60 * 54}px` }}><span>{clockText(dragPreviewMinute)}</span></div>}{positionedTasks.map(({ task, startMinute, duration }) => { const color = snapshot.subjects.find((subject) => subject.id === task.subjectId)?.color ?? "#6fa182"; const isResizeEditing = resizeEditingTaskId === task.id; return <article draggable={!isResizeEditing} className={`day-timeline-task ${task.status === "completed" ? "is-completed" : ""} ${conflictTaskIds.has(task.id) ? "has-conflict" : ""} ${isResizeEditing ? "is-resize-editing" : ""}`} style={{ "--subject-color": color, top: `${Math.max(0, (startMinute - 360) / 60 * 54)}px`, height: `${Math.max(44, duration / 60 * 54 - 4)}px` } as React.CSSProperties} key={task.id} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); if (timelineOpenTimerRef.current !== null) window.clearTimeout(timelineOpenTimerRef.current); resizeEditingRef.current = task.id; setResizeEditingTaskId(task.id); }} onDragEnd={() => setDragPreviewMinute(null)} onDragStart={(event) => { if (isResizeEditing) { event.preventDefault(); return; } event.dataTransfer.setData("text/task-id", task.id); event.dataTransfer.effectAllowed = "move"; }}><button onClick={() => { if (timelineOpenTimerRef.current !== null) window.clearTimeout(timelineOpenTimerRef.current); timelineOpenTimerRef.current = window.setTimeout(() => { if (resizeEditingRef.current !== task.id) openEdit(task); timelineOpenTimerRef.current = null; }, 230); }}><strong>{task.title}</strong><span>{clockText(startMinute)} – {clockText(startMinute + duration)} · {formatMinutes(duration)}</span></button>{isResizeEditing && <div className="timeline-duration-editor" aria-label={`调整${task.title}时长`}><button onClick={(event) => { event.stopPropagation(); const nextDuration = Math.max(30, duration - 30); setResizing({ taskId: task.id, duration: nextDuration }); rescheduleTask(task.id, dates[0], { timeMode: "range", plannedStartMinute: startMinute, plannedDurationMinutes: nextDuration }).finally(() => setResizing(null)); }}>−</button><strong>{formatMinutes(duration)}</strong><button onClick={(event) => { event.stopPropagation(); const nextDuration = duration + 30; setResizing({ taskId: task.id, duration: nextDuration }); rescheduleTask(task.id, dates[0], { timeMode: "range", plannedStartMinute: startMinute, plannedDurationMinutes: nextDuration }).finally(() => setResizing(null)); }}>＋</button><button className="done" onClick={(event) => { event.stopPropagation(); resizeEditingRef.current = null; setResizeEditingTaskId(null); }}>完成</button></div>}</article>; })}{!positionedTasks.length && <button className="timeline-empty" onClick={() => openTask(dates[0])}>今天还没有安排任务</button>}</div></section>}
      {mode === "week" && <><div className="week-grid-nav"><button aria-label="上一周" onClick={() => shift(-1)}>‹</button><strong>{weekRangeLabel}</strong><button aria-label="下一周" onClick={() => shift(1)}>›</button></div><section className="week-grid">{dates.map(renderWeekDay)}</section></>}
      {mode === "month" && <section className="card month-axis"><div className="month-axis-badge"><strong>{cursor.getMonth() + 1}月</strong><span>{cursor.getFullYear()}</span></div><div className="month-axis-line" />{monthDates.map((date, index) => { const dateString = localDate(date); const tasks = visibleTasks.filter((task) => schedules.get(task.id)?.plannedDate === dateString); return <article className={`month-axis-day ${index % 2 ? "right" : "left"} ${dateString === today ? "is-today" : ""} ${!tasks.length ? "is-empty" : ""}`} key={dateString}><button className="month-axis-date" onClick={() => openTask(dateString)}><strong>{date.getDate()}</strong><span>{new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date)}</span></button><div className="month-axis-tasks">{tasks.map((task) => <button className={task.status === "completed" ? "done" : ""} style={{ "--subject-color": snapshot.subjects.find((subject) => subject.id === task.subjectId)?.color ?? "#999" } as React.CSSProperties} key={task.id} onClick={() => openEdit(task)}><i /><span>{task.title}</span><small>{formatMinutes(task.estimatedMinutes)}</small></button>)}{!tasks.length && <button className="month-axis-add" onClick={() => openTask(dateString)}>＋</button>}</div></article>; })}</section>}
      </div>{periodInsight}</div>
      {expandedDate && <div className="calendar-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setExpandedDate(null)}><aside className="calendar-day-drawer" role="dialog" aria-modal="true" aria-label={`${expandedDate}的全部任务`}><header><div><span>当天全部任务</span><h2>{expandedDate.slice(5).replace("-", " 月 ")} 日</h2></div><button aria-label="关闭" onClick={() => setExpandedDate(null)}>×</button></header><div>{visibleTasks.filter((task) => schedules.get(task.id)?.plannedDate === expandedDate).map((task) => renderCalendarTask(task))}</div><button className="btn btn-primary" onClick={() => openTask(expandedDate)}>＋ 安排任务</button></aside></div>}
      </div>
    </>
  );
}

function Analytics({ snapshot, persist }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void> }) {
  const [section, setSection] = useState<"hub" | "execution" | "scores">("hub");
  const totalMinutes = snapshot.studySessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const latestScore = [...snapshot.examRecords].sort((a, b) => b.examDate.localeCompare(a.examDate))[0];
  if (section === "execution") return <div className="analytics-section-view"><button className="analytics-back" onClick={() => setSection("hub")}>‹ 返回统计入口</button><ExecutionAnalytics snapshot={snapshot} /></div>;
  if (section === "scores") return <ScoreAnalytics snapshot={snapshot} persist={persist} onBack={() => setSection("hub")} />;
  return <><header className="page-head"><div><div className="page-kicker">学习数据</div><h1>统计</h1></div></header><div className="analytics-entry-grid"><button className="card analytics-entry-card execution" onClick={() => setSection("execution")}><div><span>EXECUTION</span><h2>专注与执行统计</h2><p>查看真实学习时长、任务完成、科目投入和顺延情况。</p></div><div className="analytics-entry-value"><strong>{formatMinutes(totalMinutes)}</strong><span>累计学习</span></div><i>进入 →</i></button><button className="card analytics-entry-card scores" onClick={() => setSection("scores")}><div><span>ABILITY</span><h2>分数能力统计</h2><p>记录每一次真题与模拟考，通过趋势判断真实提分情况。</p></div><div className="analytics-entry-value"><strong>{latestScore ? `${latestScore.score}/${latestScore.fullScore}` : "尚未记录"}</strong><span>{latestScore ? "最近成绩" : "添加第一份试卷"}</span></div><i>进入 →</i></button></div></>;
}

function ExecutionAnalytics({ snapshot }: { snapshot: AppSnapshot }) {
  const [range, setRange] = useState<"today" | "week" | "month" | "all">("week");
  const end = new Date();
  const start = new Date(end);
  if (range === "today") start.setHours(0, 0, 0, 0);
  if (range === "week") start.setDate(end.getDate() - 6);
  if (range === "month") start.setDate(1);
  if (range === "all") start.setFullYear(2000, 0, 1);
  const startDate = localDate(start);
  const sessions = snapshot.studySessions.filter((session) => session.startedAt.slice(0, 10) >= startDate);
  const completed = snapshot.tasks.filter((task) => task.status === "completed" && task.completedAt && task.completedAt.slice(0, 10) >= startDate);
  const planned = snapshot.taskSchedules.filter((schedule) => schedule.plannedDate >= startDate && schedule.plannedDate <= localDate(end));
  const totalMinutes = sessions.reduce((total, session) => total + session.durationMinutes, 0);
  const bySubject = snapshot.subjects.map((subject) => ({ subject, minutes: sessions.filter((session) => session.subjectId === subject.id).reduce((sum, session) => sum + session.durationMinutes, 0) })).filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const rollover = snapshot.taskSchedules.filter((schedule) => schedule.rolloverCount > 0).sort((a, b) => b.rolloverCount - a.rolloverCount);
  const weeklyTarget = snapshot.meta.studyTargets?.weeklyMinutes;
  const monthlyTarget = snapshot.meta.studyTargets?.monthlyMinutes;
  const todayTarget = snapshot.dailyTargets.find((target) => target.date === localDate(end))?.targetMinutes;
  const rangeTarget = range === "today" ? todayTarget : range === "week" ? weeklyTarget : range === "month" ? monthlyTarget : undefined;
  const targetRate = rangeTarget ? Math.min(100, Math.round(totalMinutes / rangeTarget * 100)) : null;
  const pie = bySubject.length ? `conic-gradient(${bySubject.map(({ subject, minutes }, index) => { const before = bySubject.slice(0, index).reduce((sum, item) => sum + item.minutes, 0) / totalMinutes * 100; const after = before + minutes / totalMinutes * 100; return `${subject.color} ${before}% ${after}%`; }).join(",")})` : "var(--line)";
  const chartStart = new Date(range === "all" ? end : start);
  if (range === "all") chartStart.setDate(end.getDate() - 29);
  const chartDayCount = Math.max(1, Math.min(31, dayDifference(localDate(chartStart), localDate(end)) + 1));
  const trend = Array.from({ length: chartDayCount }, (_, index) => { const date = new Date(chartStart); date.setDate(chartStart.getDate() + index); const key = localDate(date); return { date: key, minutes: snapshot.studySessions.filter((session) => session.startedAt.slice(0, 10) === key).reduce((sum, session) => sum + session.durationMinutes, 0) }; });
  const chartMax = Math.max(60, ...trend.map((item) => item.minutes));
  const chartPoints = trend.map((item, index) => ({ ...item, x: trend.length === 1 ? 500 : 40 + index / (trend.length - 1) * 920, y: 220 - item.minutes / chartMax * 180 }));
  const trendPath = chartPoints.reduce((path, point, index) => { if (!index) return `M ${point.x} ${point.y}`; const previous = chartPoints[index - 1]; const middle = (previous.x + point.x) / 2; return `${path} C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`; }, "");
  const areaPath = chartPoints.length ? `${trendPath} L ${chartPoints[chartPoints.length - 1].x} 230 L ${chartPoints[0].x} 230 Z` : "";
  const activeDays = Math.max(1, trend.filter((item) => item.minutes > 0).length);
  const averageMinutes = Math.round(totalMinutes / activeDays);
  const weekEndDate = localDate(end);
  const weekStartValue = new Date(end); weekStartValue.setDate(end.getDate() - 6);
  const weekStartDate = localDate(weekStartValue);
  const weekSchedules = snapshot.taskSchedules.filter((schedule) => schedule.plannedDate >= weekStartDate && schedule.plannedDate <= weekEndDate);
  const weekTaskIds = new Set(weekSchedules.map((schedule) => schedule.taskId));
  const weekTasks = snapshot.tasks.filter((task) => weekTaskIds.has(task.id) && task.status !== "archived");
  const weekSessions = snapshot.studySessions.filter((session) => session.startedAt.slice(0, 10) >= weekStartDate && session.startedAt.slice(0, 10) <= weekEndDate);
  const subjectLag = snapshot.subjects.map((subject) => { const plannedMinutes = weekTasks.filter((task) => task.subjectId === subject.id).reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0); const actualMinutes = weekSessions.filter((session) => session.subjectId === subject.id).reduce((sum, session) => sum + session.durationMinutes, 0); return { subject, plannedMinutes, actualMinutes, lag: Math.max(0, plannedMinutes - actualMinutes) }; }).filter((item) => item.plannedMinutes > 0).sort((a, b) => b.lag - a.lag)[0];
  const monthStart = new Date(end.getFullYear(), end.getMonth(), 1);
  const monthLeading = (monthStart.getDay() + 6) % 7;
  const monthMinutes = new Map<string, number>();
  snapshot.studySessions.forEach((session) => monthMinutes.set(session.startedAt.slice(0, 10), (monthMinutes.get(session.startedAt.slice(0, 10)) ?? 0) + session.durationMinutes));
  const heatmapCells = Array.from({ length: 42 }, (_, index) => { const date = new Date(end.getFullYear(), end.getMonth(), index - monthLeading + 1); const key = localDate(date); return { date, key, outside: date.getMonth() !== end.getMonth(), minutes: monthMinutes.get(key) ?? 0 }; });
  const weekdayMinutes = Array.from({ length: 7 }, (_, index) => ({ label: ["一", "二", "三", "四", "五", "六", "日"][index], minutes: sessions.filter((session) => { const day = new Date(session.startedAt).getDay(); return (day + 6) % 7 === index; }).reduce((sum, session) => sum + session.durationMinutes, 0) }));
  const weekdayMax = Math.max(60, ...weekdayMinutes.map((item) => item.minutes));
  const focusBands = [{ label: "上午", range: [6, 12] }, { label: "下午", range: [12, 18] }, { label: "晚上", range: [18, 24] }, { label: "深夜", range: [0, 6] }].map((band) => ({ ...band, minutes: sessions.filter((session) => { const hour = new Date(session.startedAt).getHours(); return hour >= band.range[0] && hour < band.range[1]; }).reduce((sum, session) => sum + session.durationMinutes, 0) }));
  const focusBandMax = Math.max(60, ...focusBands.map((item) => item.minutes));
  const completedPlanned = completed.filter((task) => planned.some((schedule) => schedule.taskId === task.id)).length;
  const completionRate = planned.length ? Math.round(completedPlanned / planned.length * 100) : 0;
  const weeklyReview = <section className={`card lagging-subject-progress ${subjectLag?.lag ? "has-lag" : ""}`}><div><span>本周落后科目进度</span><h2>{subjectLag ? subjectLag.subject.name : "暂无落后科目"}</h2><small>{subjectLag?.lag ? `实际 ${formatMinutes(subjectLag.actualMinutes)} / 计划 ${formatMinutes(subjectLag.plannedMinutes)}，还差 ${formatMinutes(subjectLag.lag)}` : "本周各科投入正常"}</small></div><div className="lagging-progress-rail"><i style={{ width: `${subjectLag?.plannedMinutes ? Math.min(100, Math.round(subjectLag.actualMinutes / subjectLag.plannedMinutes * 100)) : 100}%`, background: subjectLag?.subject.color }} /></div></section>;
  return <><header className="page-head"><div><div className="page-kicker">学习数据</div><h1>专注与执行统计</h1></div><div className="segmented"><button className={range === "today" ? "active" : ""} onClick={() => setRange("today")}>今日</button><button className={range === "week" ? "active" : ""} onClick={() => setRange("week")}>本周</button><button className={range === "month" ? "active" : ""} onClick={() => setRange("month")}>本月</button><button className={range === "all" ? "active" : ""} onClick={() => setRange("all")}>总计</button></div></header>{weeklyReview}<div className="review-metrics analytics-overview"><section className="card metric-card analytics-progress-card" style={{ "--metric-progress": `${targetRate ?? 0}%` } as React.CSSProperties}><div className="metric-progress-fill" /><div><div className="metric-label">实际学习</div><div className="metric-value">{formatMinutes(totalMinutes)}</div><div className="metric-note">{rangeTarget ? `目标 ${formatMinutes(rangeTarget)} · ${targetRate}%` : `${sessions.length} 次专注记录`}</div></div><div className="metric-progress-copy"><strong>{sessions.length}</strong><span>次专注</span></div></section><section className="card metric-card analytics-progress-card completion-progress-card" style={{ "--metric-progress": `${completionRate}%` } as React.CSSProperties}><div className="metric-progress-fill" /><div><div className="metric-label">计划完成率</div><div className="metric-value">{planned.length ? `${completionRate}%` : "—"}</div><div className="metric-note">本范围安排 {planned.length} 个，完成 {completedPlanned} 个</div></div><div className="metric-progress-copy"><strong>{completedPlanned}/{planned.length}</strong><span>任务</span></div></section></div><div className="review-grid analytics-main-grid"><section className="card review-card subject-pie-card"><h2>科目投入分布</h2>{bySubject.length ? <><div className="study-pie-layout"><div className="study-pie" style={{ background: pie }} aria-label={`科目学习时长饼图，总计${formatMinutes(totalMinutes)}`} /> <div className="study-pie-labels">{bySubject.map(({ subject, minutes }) => <div key={subject.id} style={{ "--slice-color": subject.color } as React.CSSProperties}><i /><span><strong>{subject.name}</strong><small>{formatMinutes(minutes)}</small></span><b>{Math.round(minutes / totalMinutes * 100)}%</b></div>)}</div></div><div className="pie-total"><span>总计 <strong>{formatMinutes(totalMinutes)}</strong></span><span>学习日均 <strong>{formatMinutes(averageMinutes)}</strong></span></div></> : <div className="empty-copy">还没有学习记录。从专注页开始一次计时后，这里会显示真实投入。</div>}</section><section className="card review-card"><h2>顺延提醒</h2>{rollover.length ? <div className="rollover-list">{rollover.slice(0, 6).map((schedule) => { const task = snapshot.tasks.find((item) => item.id === schedule.taskId); return <div key={schedule.id}><strong>{task?.title ?? "已归档任务"}</strong><span>顺延 {schedule.rolloverCount} 次 · 累计 {schedule.totalDelayedDays} 天</span></div>; })}</div> : <div className="empty-copy">目前没有顺延任务。</div>}</section></div><section className="card review-card study-trend-card"><div className="study-trend-head"><div><h2>学习时长趋势</h2><p>每天的真实专注记录，横向查看投入变化。</p></div><strong>{formatMinutes(averageMinutes)}<span>学习日均</span></strong></div><div className="study-trend-chart"><svg viewBox="0 0 1000 260" preserveAspectRatio="none" role="img" aria-label="学习时长趋势图"><defs><linearGradient id="studyAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity=".34"/><stop offset="100%" stopColor="var(--brand)" stopOpacity=".02"/></linearGradient></defs>{[40,100,160,220].map((y) => <line key={y} x1="40" y1={y} x2="960" y2={y} className="chart-grid-line" />)}<path d={areaPath} className="trend-area"/><path d={trendPath} className="trend-line"/>{chartPoints.map((point, index) => <g key={point.date}><circle cx={point.x} cy={point.y} r="4"/><title>{point.date} · {formatMinutes(point.minutes)}</title>{(index === 0 || index === chartPoints.length - 1 || point.minutes === chartMax) && <text x={point.x} y={Math.max(20, point.y - 10)} textAnchor={index === 0 ? "start" : index === chartPoints.length - 1 ? "end" : "middle"}>{point.minutes ? formatMinutes(point.minutes) : "0 分钟"}</text>}</g>)}</svg><div className="trend-axis-labels"><span>{chartPoints[0]?.date.slice(5)}</span><span>{chartPoints[Math.floor(chartPoints.length / 2)]?.date.slice(5)}</span><span>{chartPoints[chartPoints.length - 1]?.date.slice(5)}</span></div></div></section><section className="card review-card heatmap-card"><div><h2>{monthStart.getFullYear()}年{monthStart.getMonth() + 1}月专注热力图</h2><p className="empty-copy">每个圆角卡片显示当天实际专注时长。</p></div><div className="heatmap-month-grid"><div className="heatmap-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div><div className="heatmap">{heatmapCells.map(({ date, key, outside, minutes }) => <div className={`heatmap-cell ${outside ? "outside" : ""} level-${Math.min(4, Math.ceil(minutes / 90))}`} title={`${key} · ${formatMinutes(minutes)}`} key={key}><span>{outside ? "" : formatHeatmapHours(minutes)}</span><small>{outside ? "" : date.getDate()}</small></div>)}</div></div></section><div className="execution-extra-grid"><section className="card review-card execution-weekday-card"><div className="analytics-module-head"><div><span>执行节奏</span><h2>一周学习分布</h2></div><small>当前筛选范围</small></div><div className="weekday-bars">{weekdayMinutes.map((item) => <div key={item.label}><span>{item.label}</span><div><i style={{ height: `${item.minutes ? Math.max(8, item.minutes / weekdayMax * 100) : 3}%` }} /></div><small>{formatMinutes(item.minutes)}</small></div>)}</div></section><section className="card review-card execution-band-card"><div className="analytics-module-head"><div><span>时间偏好</span><h2>专注时段</h2></div><small>按开始时间统计</small></div><div className="focus-band-list">{focusBands.map((band) => <div key={band.label}><span>{band.label}</span><div><i style={{ width: `${band.minutes ? Math.max(4, band.minutes / focusBandMax * 100) : 0}%` }} /></div><strong>{formatMinutes(band.minutes)}</strong></div>)}</div><p className="module-note">可据此把高难度科目放在你最稳定的时段。</p></section></div></>;
}

function PlanAdjustmentDialog({ snapshot, adjustment, onClose, onConfirm }: { snapshot: AppSnapshot; adjustment: { taskIds: string[]; targetDate: string }; onClose: () => void; onConfirm: () => Promise<void> }) {
  const tasks = adjustment.taskIds.map((id) => snapshot.tasks.find((task) => task.id === id)).filter((task): task is Task => Boolean(task));
  const schedules = new Map(snapshot.taskSchedules.map((schedule) => [schedule.taskId, schedule]));
  const [saving, setSaving] = useState(false);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="task-dialog adjustment-dialog" role="dialog" aria-modal="true" aria-labelledby="adjustment-title"><header><div><div className="page-kicker">计划调整预览</div><h2 id="adjustment-title">确认后才会移动任务</h2></div><button className="dialog-close" aria-label="关闭" onClick={onClose}>×</button></header><p className="form-lead">系统不会自动改动后续计划。下面 {tasks.length} 个任务将从原日期移动到 {adjustment.targetDate}。</p><div className="adjustment-list">{tasks.map((task) => <div key={task.id}><span style={{ background: snapshot.subjects.find((subject) => subject.id === task.subjectId)?.color }} /><div><strong>{task.title}</strong><small>{schedules.get(task.id)?.plannedDate ?? "未安排"} → {adjustment.targetDate}</small></div></div>)}</div><div className="form-actions"><button className="btn btn-secondary" onClick={onClose}>暂不调整</button><button className="btn btn-primary" disabled={saving} onClick={async () => { setSaving(true); try { await onConfirm(); } finally { setSaving(false); } }}>{saving ? "正在调整…" : "确认调整"}</button></div></section></div>;
}

type TaskDraft = {
  title: string;
  subjectId: string;
  parentTaskId: string;
  stageId: string;
  contentNodeId: string;
  completionMode: TaskCompletionMode;
  plannedDate: string;
  deadline: string;
  timeMode: "none" | "point" | "range";
  startTime: string;
  endTime: string;
  reminderEnabled: boolean;
  reminderMinutesBefore: number;
  estimatedMinutes: number;
  autoRollover: boolean;
  note: string;
  important: boolean;
  tags: string;
  progressStart: number;
  progressTarget: number;
  progressUnit: string;
  progressStep: number;
  dailyMinimum: number;
  reviewPlanTemplateId: string;
  repeatFrequency: "none" | "daily" | "weekly" | "interval";
  repeatIntervalDays: number;
  repeatWeekdays: number[];
  repeatEndsOn: string;
};

function DateRangeCalendar({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const [month, setMonth] = useState(() => {
    const seed = start ? new Date(`${start}T00:00:00`) : new Date();
    return new Date(seed.getFullYear(), seed.getMonth(), 1);
  });
  const monthStartOffset = (month.getDay() + 6) % 7;
  const gridStart = new Date(month);
  gridStart.setDate(1 - monthStartOffset);
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date; });
  const choose = (date: string) => {
    if (!start || end) return onChange(date, "");
    if (date < start) return onChange(date, "");
    onChange(start, date);
  };
  const shiftMonth = (amount: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  return <div className="date-range-picker">
    <div className="date-range-summary"><div><span>计划日期</span><strong>{start || "点击日期选择"}</strong></div><i>→</i><div><span>截止日期</span><strong>{end || "可不设置"}</strong></div><b>{start ? `已选择 ${inclusiveDayCount(start, end)} 天` : "未安排"}</b></div>
    <div className="date-range-toolbar"><button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>‹</button><strong>{month.getFullYear()} 年 {month.getMonth() + 1} 月</strong><button type="button" aria-label="下个月" onClick={() => shiftMonth(1)}>›</button></div>
    <div className="date-range-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="date-range-days">{days.map((date) => { const value = localDate(date); const inRange = Boolean(start && value >= start && value <= (end || start)); const endpoint = value === start || value === end; return <button type="button" key={value} className={`${date.getMonth() === month.getMonth() ? "" : "outside"} ${inRange ? "in-range" : ""} ${endpoint ? "endpoint" : ""}`} aria-pressed={inRange} onClick={() => choose(value)}><span>{date.getDate()}</span></button>; })}</div>
    <div className="date-range-foot"><span>{!start ? "先选计划日期，再选截止日期" : !end ? "继续选择截止日期，或只保留计划日期" : `${start} 至 ${end}`}</span>{start && <button type="button" onClick={() => onChange("", "")}>清除日期</button>}</div>
  </div>;
}

function AppSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <div className={`app-select ${open ? "is-open" : ""}`} id={id}><button type="button" className="app-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span>{selected?.label ?? "请选择"}</span><i>⌄</i></button>{open && <div className="app-select-menu" role="listbox" aria-label={label}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <i>✓</i>}</button>)}</div>}</div>;
}

function AppConfirmDialog({ confirm, onClose }: { confirm: AppConfirm; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  return <div className="dialog-backdrop app-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title"><button className="dialog-close" aria-label="关闭" onClick={onClose}>×</button><span className={`app-dialog-symbol ${confirm.tone === "danger" ? "danger" : ""}`}>{confirm.tone === "danger" ? "!" : "i"}</span><h2 id="app-confirm-title">{confirm.title}</h2><p>{confirm.message}</p><div className="app-dialog-actions"><button className="btn btn-secondary" onClick={onClose}>取消</button><button className={`btn ${confirm.tone === "danger" ? "btn-danger" : "btn-primary"}`} disabled={saving} onClick={async () => { setSaving(true); try { await confirm.onConfirm(); onClose(); } finally { setSaving(false); } }}>{saving ? "处理中…" : confirm.confirmLabel ?? "确认"}</button></div></section></div>;
}

function AppPromptDialog({ prompt, onClose }: { prompt: AppPrompt; onClose: () => void }) {
  const [value, setValue] = useState(prompt.value);
  const [saving, setSaving] = useState(false);
  return <div className="dialog-backdrop app-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="app-dialog app-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="app-prompt-title"><button className="dialog-close" aria-label="关闭" onClick={onClose}>×</button><h2 id="app-prompt-title">{prompt.title}</h2>{prompt.message && <p>{prompt.message}</p>}<div className="field"><label htmlFor="app-prompt-input">{prompt.inputLabel}</label><input id="app-prompt-input" value={value} onChange={(event) => setValue(event.target.value)} /></div><div className="app-dialog-actions"><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={!value.trim() || saving} onClick={async () => { setSaving(true); try { await prompt.onConfirm(value); onClose(); } finally { setSaving(false); } }}>{saving ? "处理中…" : prompt.confirmLabel ?? "确认"}</button></div></section></div>;
}

function DailyTargetDialog({ initialMinutes, onClose, onSave }: { initialMinutes: number; onClose: () => void; onSave: (minutes: number) => Promise<void> }) {
  const [hours, setHours] = useState(Math.floor(initialMinutes / 60));
  const [minutes, setMinutes] = useState(initialMinutes % 60);
  const [saving, setSaving] = useState(false);
  const total = hours * 60 + minutes;
  return <div className="dialog-backdrop app-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="app-dialog duration-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-target-title"><button className="dialog-close" aria-label="关闭" onClick={onClose}>×</button><span className="app-dialog-kicker">今日计划</span><h2 id="daily-target-title">设置目标专注时长</h2><p>分别选择小时和分钟，随时可以再次调整。</p><div className="duration-inputs"><label><span>小时</span><input type="number" min="0" max="23" value={hours} onChange={(event) => setHours(Math.max(0, Math.min(23, Number(event.target.value))))} /></label><b>:</b><label><span>分钟</span><input type="number" min="0" max="59" step="5" value={minutes} onChange={(event) => setMinutes(Math.max(0, Math.min(59, Number(event.target.value))))} /></label></div><div className="duration-quick">{[60, 180, 300, 480].map((amount) => <button type="button" key={amount} onClick={() => { setHours(Math.floor(amount / 60)); setMinutes(amount % 60); }}>{formatMinutes(amount)}</button>)}</div><div className="app-dialog-actions"><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={total <= 0 || saving} onClick={async () => { setSaving(true); try { await onSave(total); } finally { setSaving(false); } }}>{saving ? "保存中…" : `保存 ${formatMinutes(total)}`}</button></div></section></div>;
}

function GoalQuickEditDialog({ goal, mode, workspaceMode, onClose, onSave }: { goal: Goal; mode: "exam" | "school"; workspaceMode: "exam" | "life"; onClose: () => void; onSave: (patch: Partial<Goal>) => Promise<void> }) {
  const [examDate, setExamDate] = useState(goal.examDate);
  const [targetStartDate, setTargetStartDate] = useState(goal.targetStartDate ?? "");
  const [school, setSchool] = useState(goal.school ?? "");
  const [major, setMajor] = useState(goal.major ?? "");
  const [saving, setSaving] = useState(false);
  const lifeMode = workspaceMode === "life";
  return <div className="dialog-backdrop app-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="app-dialog goal-quick-dialog" onSubmit={async (event) => { event.preventDefault(); if (mode === "exam" && targetStartDate && targetStartDate > examDate) return; setSaving(true); try { await onSave(mode === "exam" ? { examDate, targetStartDate: targetStartDate || undefined } : { school: school.trim() || undefined, major: major.trim() || undefined }); } finally { setSaving(false); } }}><button className="dialog-close" type="button" aria-label="关闭" onClick={onClose}>×</button><span className="app-dialog-kicker">当前{lifeMode ? "生活" : "考研"}目标</span><h2>{mode === "exam" ? `修改${lifeMode ? "目标" : "考试"}日期` : "修改院校与专业"}</h2>{mode === "exam" ? <div className="form-grid"><div className="field"><label htmlFor="quick-start-date">{lifeMode ? "目标" : "备考"}开始时间</label><input id="quick-start-date" type="date" max={examDate || undefined} value={targetStartDate} onChange={(event) => setTargetStartDate(event.target.value)} /></div><div className="field"><label htmlFor="quick-exam-date">{lifeMode ? "目标" : "考试"}日期</label><input id="quick-exam-date" type="date" min={targetStartDate || localDate(new Date())} value={examDate} onChange={(event) => setExamDate(event.target.value)} /></div>{targetStartDate && targetStartDate > examDate && <div className="form-error full">开始时间不能晚于{lifeMode ? "目标" : "考试"}日期</div>}</div> : <div className="form-grid"><div className="field"><label htmlFor="quick-school">目标院校</label><input id="quick-school" value={school} onChange={(event) => setSchool(event.target.value)} placeholder="例如：深圳大学" /></div><div className="field"><label htmlFor="quick-major">目标专业</label><input id="quick-major" value={major} onChange={(event) => setMajor(event.target.value)} placeholder="例如：机械工程" /></div></div>}<div className="app-dialog-actions"><button className="btn btn-secondary" type="button" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={saving || (mode === "exam" && (!examDate || Boolean(targetStartDate && targetStartDate > examDate)))}>{saving ? "保存中…" : "保存修改"}</button></div></form></div>;
}

function QuantityCheckinCalendar({ task, checkins, onUpdate }: { task: Task; checkins: TaskCheckin[]; onUpdate: (task: Task, date: string, quantity: number) => Promise<void> }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [editing, setEditing] = useState<{ date: string; quantity: number } | null>(null);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const today = localDate(new Date());
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - leading + 1);
    return { date, key: localDate(date), outside: date.getMonth() !== month };
  });
  const checkinMap = new Map(checkins.map((checkin) => [checkin.date, checkin]));
  const minimum = task.dailyMinimum ?? 1;
  const createdDate = task.createdAt.slice(0, 10);
  const changeMonth = (amount: number) => { const next = new Date(cursor); next.setMonth(next.getMonth() + amount); setCursor(next); };
  return <div className="quantity-checkin-calendar"><header><div><strong>打卡月历</strong><span>点击过去日期可补录或修改，最低 {minimum} {task.progressUnit ?? ""}</span></div><nav><button type="button" aria-label="上个月" onClick={() => changeMonth(-1)}>‹</button><b>{year} 年 {month + 1} 月</b><button type="button" aria-label="下个月" onClick={() => changeMonth(1)}>›</button></nav></header><div className="checkin-month-weekdays">{["一","二","三","四","五","六","日"].map((day) => <span key={day}>{day}</span>)}</div><div className="checkin-month-grid">{cells.map(({ key, date, outside }) => { const checkin = checkinMap.get(key); const isFuture = key > today; const beforeCreation = key < createdDate; const state = checkin?.completed ? "complete" : checkin && checkin.quantity > 0 ? "partial" : key < today && !outside && !beforeCreation ? "missed" : "empty"; return <button type="button" disabled={outside || isFuture || beforeCreation} className={`${outside || beforeCreation ? "outside" : ""} ${state} ${key === today ? "today" : ""}`} key={key} title={checkin ? `${key} · ${checkin.quantity} ${task.progressUnit ?? ""}` : beforeCreation ? `${key} · 任务尚未创建` : key} onClick={() => !outside && !isFuture && !beforeCreation && setEditing({ date: key, quantity: checkin?.quantity ?? 0 })}><span>{date.getDate()}</span>{!outside && !beforeCreation && <i />}{checkin && <small>{checkin.quantity}</small>}</button>; })}</div><div className="checkin-legend"><span><i className="complete" />已达标</span><span><i className="partial" />未达标</span><span><i className="missed" />未打卡</span></div>{editing && <div className="checkin-backfill"><div><span>{editing.date}</span><strong>补录完成量</strong></div><div><button type="button" onClick={() => setEditing({ ...editing, quantity: Math.max(0, editing.quantity - (task.progressStep ?? 1)) })}>−</button><input aria-label={`${editing.date}完成量`} type="number" min="0" step="any" value={editing.quantity} onChange={(event) => setEditing({ ...editing, quantity: Math.max(0, Number(event.target.value)) })} /><span>{task.progressUnit}</span><button type="button" onClick={() => setEditing({ ...editing, quantity: editing.quantity + (task.progressStep ?? 1) })}>＋</button></div><div><button type="button" onClick={() => setEditing(null)}>取消</button><button className="primary" type="button" onClick={async () => { await onUpdate(task, editing.date, editing.quantity); setEditing(null); }}>保存补录</button></div></div>}</div>;
}

function TaskDialog({ snapshot, task, defaults, onClose, onSubmit, onDelete, onUpdateCheckin }: { snapshot: AppSnapshot; task?: Task; defaults: TaskDefaults; onClose: () => void; onSubmit: (draft: TaskDraft) => Promise<void>; onDelete?: () => Promise<void>; onUpdateCheckin?: (task: Task, date: string, quantity: number) => Promise<void> }) {
  const existingSchedule = task ? snapshot.taskSchedules.find((schedule) => schedule.taskId === task.id) : undefined;
  const existingRule = task ? snapshot.repeatRules.find((rule) => rule.taskId === task.id) : undefined;
  const [draft, setDraft] = useState<TaskDraft>({
    title: task?.title ?? "", subjectId: task?.subjectId ?? defaults.subjectId ?? snapshot.subjects[0]?.id ?? "", parentTaskId: task?.parentTaskId ?? defaults.parentTaskId ?? "",
    stageId: task?.stageId ?? defaults.stageId ?? "", contentNodeId: task?.contentNodeId ?? defaults.contentNodeId ?? "", completionMode: task?.completionMode ?? "check",
    plannedDate: existingSchedule?.plannedDate ?? defaults.date ?? "", deadline: task?.deadline ?? "", estimatedMinutes: task?.estimatedMinutes ?? 60,
    timeMode: existingSchedule?.timeMode ?? "none", startTime: minuteToTime(existingSchedule?.plannedStartMinute), endTime: minuteToTime((existingSchedule?.plannedStartMinute ?? 9 * 60) + (existingSchedule?.plannedDurationMinutes ?? 60)), reminderEnabled: existingSchedule?.reminderEnabled ?? false, reminderMinutesBefore: existingSchedule?.reminderMinutesBefore ?? 10,
    autoRollover: task?.autoRollover ?? false, note: task?.note ?? "", important: task?.important ?? false, tags: task?.tags?.join("，") ?? "", progressStart: task?.progressStart ?? 0, progressTarget: task?.progressTarget ?? 100,
    progressUnit: task?.progressUnit ?? "页", progressStep: task?.progressStep ?? 1, dailyMinimum: task?.dailyMinimum ?? 1, reviewPlanTemplateId: task?.reviewPlanTemplateId ?? "", repeatFrequency: existingRule?.frequency ?? "none", repeatIntervalDays: existingRule?.intervalDays ?? 2,
    repeatWeekdays: existingRule?.weekdays ?? [1, 2, 3, 4, 5], repeatEndsOn: existingRule?.endsOn ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return setError("请填写任务名称");
    if (!draft.subjectId) return setError("请先选择所属科目");
    if (draft.completionMode === "quantity" && (draft.progressTarget <= draft.progressStart || !draft.progressUnit.trim())) return setError("数量任务的终点必须大于起点，并填写单位");
    if (draft.completionMode === "quantity" && (draft.dailyMinimum <= 0 || draft.dailyMinimum > draft.progressTarget - draft.progressStart)) return setError("每日最低完成量需大于 0，且不能超过总量");
    if (draft.repeatFrequency !== "none" && !draft.plannedDate) return setError("重复任务需要先设置计划日期");
    if (draft.repeatFrequency === "weekly" && !draft.repeatWeekdays.length) return setError("每周重复至少选择一天");
    if (draft.deadline && draft.deadline < draft.plannedDate) return setError("截止日期不能早于计划日期");
    if (draft.timeMode !== "none" && !draft.plannedDate) return setError("指定任务时间前，请先选择计划日期");
    if (draft.timeMode === "range" && timeToMinute(draft.endTime) <= timeToMinute(draft.startTime)) return setError("结束时间必须晚于开始时间");
    setSaving(true);
    try { await onSubmit(draft); } finally { setSaving(false); }
  };
  const subjectStages = snapshot.stages.filter((stage) => stage.subjectId === draft.subjectId);
  const subjectNodes = snapshot.contentNodes.filter((node) => node.subjectId === draft.subjectId);
  const possibleParents = possibleTaskParents(snapshot.tasks, task, draft.subjectId);
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const toggleWeekday = (day: number) => setDraft({ ...draft, repeatWeekdays: draft.repeatWeekdays.includes(day) ? draft.repeatWeekdays.filter((item) => item !== day) : [...draft.repeatWeekdays, day].sort() });
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="task-dialog task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title">
        <form onSubmit={submit}>
          <header className="task-editor-toolbar">
            <button className="editor-round-action editor-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
            <div><div className="page-kicker">学习行动</div><h2 id="task-dialog-title">{task ? "编辑任务" : "新建任务"}</h2></div>
            <button className="editor-round-action editor-save" type="submit" aria-label={task ? "保存任务修改" : "创建任务"} disabled={saving}>{saving ? "…" : "✓"}</button>
          </header>

          <section className="task-editor-identity">
            <label htmlFor="task-title">任务名称 *</label>
            <input id="task-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例如：完成反常积分基础课程" />
            <label htmlFor="task-note">备注</label>
            <textarea id="task-note" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="资料、完成标准或提醒（可选）" />
          </section>

          <div className="task-kind-switch" role="group" aria-label="任务完成方式">
            <button className={draft.completionMode === "check" ? "active" : ""} type="button" aria-pressed={draft.completionMode === "check"} onClick={() => setDraft({ ...draft, completionMode: "check" })}>普通任务</button>
            <button className={draft.completionMode === "quantity" ? "active" : ""} type="button" aria-pressed={draft.completionMode === "quantity"} onClick={() => setDraft({ ...draft, completionMode: "quantity" })}>量化任务</button>
          </div>

          <section className="task-editor-card">
            <header><div><span className="editor-section-icon">日</span><strong>日期与时间</strong></div><small>日期范围连续显示，时间可留空</small></header>
            <DateRangeCalendar start={draft.plannedDate} end={draft.deadline} onChange={(plannedDate, deadline) => setDraft({ ...draft, plannedDate, deadline })} />
            <div className="time-arrangement">
              <div className="time-mode-switch" role="group" aria-label="任务时间方式">{([['none','不指定'],['point','时间点'],['range','时间段']] as const).map(([value, label]) => <button type="button" className={draft.timeMode === value ? "active" : ""} aria-pressed={draft.timeMode === value} key={value} onClick={() => setDraft({ ...draft, timeMode: value, reminderEnabled: value === "none" ? false : draft.reminderEnabled })}>{label}</button>)}</div>
              {draft.timeMode !== "none" && <div className="time-fields"><div className="field"><label htmlFor="task-start-time">{draft.timeMode === "range" ? "开始时间" : "任务时间"}</label><input id="task-start-time" type="time" step="1800" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} /></div>{draft.timeMode === "range" && <div className="field"><label htmlFor="task-end-time">结束时间</label><input id="task-end-time" type="time" step="1800" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} /></div>}<label className="editor-toggle reminder-toggle"><input type="checkbox" checked={draft.reminderEnabled} onChange={(e) => { if (e.target.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => undefined); setDraft({ ...draft, reminderEnabled: e.target.checked }); }} /><span />提醒</label>{draft.reminderEnabled && <div className="field"><span className="field-label">提前提醒</span><AppSelect id="task-reminder" label="提前提醒" value={String(draft.reminderMinutesBefore)} options={[{ value: "0", label: "准时" }, { value: "5", label: "提前 5 分钟" }, { value: "10", label: "提前 10 分钟" }, { value: "15", label: "提前 15 分钟" }, { value: "30", label: "提前 30 分钟" }]} onChange={(value) => setDraft({ ...draft, reminderMinutesBefore: Number(value) })} /></div>}</div>}
            </div>
            <div className="form-grid compact-editor-grid schedule-secondary">
              <div className="field"><label htmlFor="task-estimate">预计时长（分钟）</label><input id="task-estimate" type="number" min="0" step="5" value={draft.estimatedMinutes} onChange={(e) => setDraft({ ...draft, estimatedMinutes: Number(e.target.value) })} /></div>
              <label className="editor-toggle"><input type="checkbox" checked={draft.autoRollover} onChange={(e) => setDraft({ ...draft, autoRollover: e.target.checked })} /><span />未完成时自动顺延</label>
            </div>
          </section>

          {draft.completionMode === "quantity" && <section className="task-editor-card quantity-editor-card">
            <header><div><span className="editor-section-icon">量</span><strong>量化进度</strong></div><small>自定义起点、终点和单位</small></header>
            <div className="form-grid quantity-fields">
              <div className="field"><label htmlFor="progress-start">起点</label><input id="progress-start" type="number" value={draft.progressStart} onChange={(e) => setDraft({ ...draft, progressStart: Number(e.target.value) })} /></div>
              <div className="field"><label htmlFor="progress-target">目标值</label><input id="progress-target" type="number" value={draft.progressTarget} onChange={(e) => setDraft({ ...draft, progressTarget: Number(e.target.value) })} /></div>
              <div className="field"><label htmlFor="progress-unit">单位</label><input id="progress-unit" value={draft.progressUnit} onChange={(e) => setDraft({ ...draft, progressUnit: e.target.value })} placeholder="页、道、次、个…" /></div>
              <div className="field"><label htmlFor="progress-step">每次加减</label><input id="progress-step" type="number" min="0.01" step="any" value={draft.progressStep} onChange={(e) => setDraft({ ...draft, progressStep: Math.max(0.01, Number(e.target.value)) })} /></div>
              <div className="field full"><label htmlFor="daily-minimum">每日最低完成量</label><input id="daily-minimum" type="number" min="0.01" step="any" value={draft.dailyMinimum} onChange={(e) => setDraft({ ...draft, dailyMinimum: Math.max(0.01, Number(e.target.value)) })} /><small>当天累计达到此数量，即完成本次打卡。</small></div>
            </div>
            <div className="quantity-preview"><span style={{ width: `${Math.max(0, Math.min(100, ((task?.progressCurrent ?? draft.progressStart) - draft.progressStart) / Math.max(1, draft.progressTarget - draft.progressStart) * 100))}%` }} /><strong>{task?.progressCurrent ?? draft.progressStart} / {draft.progressTarget} {draft.progressUnit}</strong></div>
            {task && onUpdateCheckin && <QuantityCheckinCalendar task={task} checkins={snapshot.taskCheckins.filter((checkin) => checkin.taskId === task.id)} onUpdate={onUpdateCheckin} />}
          </section>}

          <section className="task-editor-card">
            <header><div><span className="editor-section-icon">属</span><strong>所属位置</strong></div><small>科目必选，其余层级都可留空</small></header>
            <div className="form-grid compact-editor-grid">
              <div className="field"><span className="field-label">备考科目 *</span><AppSelect id="task-subject" label="备考科目" value={draft.subjectId} options={snapshot.subjects.map((subject) => ({ value: subject.id, label: subject.name }))} onChange={(value) => setDraft({ ...draft, subjectId: value, parentTaskId: "", stageId: "", contentNodeId: "" })} /></div>
              <div className="field"><span className="field-label">上级任务（可选）</span><AppSelect id="task-parent" label="上级任务" value={draft.parentTaskId} options={[{ value: "", label: "没有上级任务" }, ...possibleParents.map((item) => ({ value: item.id, label: item.title }))]} onChange={(value) => setDraft({ ...draft, parentTaskId: value })} /></div>
              <div className="field"><span className="field-label">任务分类（可选）</span><AppSelect id="task-content" label="任务分类" value={draft.contentNodeId} options={[{ value: "", label: "不归入任务分类" }, ...subjectNodes.map((node) => ({ value: node.id, label: node.name }))]} onChange={(value) => setDraft({ ...draft, contentNodeId: value })} /></div>
              <div className="field"><span className="field-label">学习阶段（可选）</span><AppSelect id="task-stage" label="学习阶段" value={draft.stageId} options={[{ value: "", label: "不关联阶段" }, ...subjectStages.map((stage) => ({ value: stage.id, label: stage.name }))]} onChange={(value) => setDraft({ ...draft, stageId: value })} /></div>
            </div>
          </section>

          <details className="task-editor-card editor-advanced">
            <summary><div><span className="editor-section-icon">…</span><strong>重复、标签与优先级</strong></div><small>按需展开</small></summary>
            <div className="form-grid compact-editor-grid advanced-grid">
              <div className="field"><span className="field-label">重复安排</span><AppSelect id="task-repeat" label="重复安排" value={draft.repeatFrequency} options={[{ value: "none", label: "不重复" }, { value: "daily", label: "每天" }, { value: "weekly", label: "每周指定日期" }, { value: "interval", label: "每隔几天" }]} onChange={(value) => setDraft({ ...draft, repeatFrequency: value as TaskDraft["repeatFrequency"] })} /></div>
              {draft.repeatFrequency === "interval" && <div className="field"><label htmlFor="repeat-interval">间隔天数</label><input id="repeat-interval" type="number" min="1" value={draft.repeatIntervalDays} onChange={(e) => setDraft({ ...draft, repeatIntervalDays: Math.max(1, Number(e.target.value)) })} /></div>}
              {draft.repeatFrequency === "weekly" && <div className="field full"><span className="field-label" id="weekday-label">重复日期</span><div className="weekday-picker" role="group" aria-labelledby="weekday-label">{weekdays.map((label, day) => <button className={draft.repeatWeekdays.includes(day) ? "selected" : ""} key={day} type="button" aria-pressed={draft.repeatWeekdays.includes(day)} onClick={() => toggleWeekday(day)}>周{label}</button>)}</div></div>}
              {draft.repeatFrequency !== "none" && <div className="field"><label htmlFor="repeat-end">结束日期（可选）</label><input id="repeat-end" type="date" min={draft.plannedDate || undefined} value={draft.repeatEndsOn} onChange={(e) => setDraft({ ...draft, repeatEndsOn: e.target.value })} /></div>}
              <div className="field full"><label htmlFor="task-tags">标签</label><input id="task-tags" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="用逗号分隔，例如：真题，薄弱项" /></div>
              <div className="field full"><span className="field-label">复习计划</span><AppSelect id="task-review-template" label="复习计划" value={draft.reviewPlanTemplateId} options={[{ value: "", label: "不使用复习计划" }, ...snapshot.reviewPlanTemplates.filter((template) => template.enabled).map((template) => ({ value: template.id, label: `${template.name} · ${template.intervalsDays.join("/")} 天` }))]} onChange={(value) => setDraft({ ...draft, reviewPlanTemplateId: value })} /><small>任务完成后，系统会按所选模板生成后续复习任务。</small></div>
              <label className="editor-toggle"><input type="checkbox" checked={draft.important} onChange={(e) => setDraft({ ...draft, important: e.target.checked })} /><span />标记为重要任务</label>
            </div>
          </details>

          {error && <div className="form-error" role="alert">{error}</div>}
          <footer className="task-editor-footer">{onDelete ? <button className="text-button danger-text" type="button" onClick={onDelete}>删除任务</button> : <span />}<span>可点击右上角 ✓ 保存</span></footer>
        </form>
      </section>
    </div>
  );
}

function TimerDialog({ snapshot, defaults, onClose, onStart }: { snapshot: AppSnapshot; defaults: { taskId?: string; subjectId?: string }; onClose: () => void; onStart: (subjectId: string, taskId?: string, mode?: "countup" | "countdown", targetMinutes?: number) => Promise<void> }) {
  const [subjectId, setSubjectId] = useState(defaults.subjectId ?? snapshot.subjects[0]?.id ?? "");
  const [taskId, setTaskId] = useState(defaults.taskId ?? "");
  const [mode, setMode] = useState<"countup" | "countdown">("countup");
  const [targetMinutes, setTargetMinutes] = useState(snapshot.meta.focusSettings?.focusMinutes ?? 50);
  const tasks = snapshot.tasks.filter((task) => task.status === "active" && task.subjectId === subjectId);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="task-dialog timer-dialog" role="dialog" aria-modal="true" aria-labelledby="timer-dialog-title"><header><div><div className="page-kicker">专注记录</div><h2 id="timer-dialog-title">开始一次专注</h2></div><button className="dialog-close" aria-label="关闭" onClick={onClose}>×</button></header><p className="form-lead">开始后自动进入沉浸页面，并保持屏幕唤醒；结束后保存为真实学习记录。</p><div className="field"><span className="field-label">{snapshot.meta.workspaceMode === "life" ? "专注领域" : "备考科目"} *</span><AppSelect id="timer-subject" label={snapshot.meta.workspaceMode === "life" ? "专注领域" : "备考科目"} value={subjectId} options={snapshot.subjects.map((subject) => ({ value: subject.id, label: subject.name }))} onChange={(value) => { setSubjectId(value); setTaskId(""); }} /></div><div className="field"><span className="field-label">关联任务（可选）</span><AppSelect id="timer-task" label="关联任务" value={taskId} options={[{ value: "", label: snapshot.meta.workspaceMode === "life" ? "仅记录到领域" : "仅记录到科目" }, ...tasks.map((task) => ({ value: task.id, label: task.title }))]} onChange={setTaskId} /></div><div className="timer-mode-switch" role="group" aria-label="计时方式"><button type="button" className={mode === "countup" ? "active" : ""} aria-pressed={mode === "countup"} onClick={() => setMode("countup")}><strong>正计时</strong><span>极简翻页时钟</span></button><button type="button" className={mode === "countdown" ? "active" : ""} aria-pressed={mode === "countdown"} onClick={() => setMode("countdown")}><strong>倒计时</strong><span>真实沙粒沙漏</span></button></div>{mode === "countdown" && <div className="field"><label htmlFor="timer-target">本轮专注时长（分钟）</label><input id="timer-target" type="number" min="5" step="5" value={targetMinutes} onChange={(e) => setTargetMinutes(Math.max(5, Number(e.target.value) || 5))} /></div>}<div className="form-actions"><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={!subjectId} onClick={() => { if (snapshot.meta.focusSettings?.soundEnabled) prepareTimerAudio(); if (document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => undefined); onStart(subjectId, taskId || undefined, mode, targetMinutes); }}>{mode === "countdown" ? `开始 ${targetMinutes} 分钟倒计时` : "开始正计时"}</button></div></section></div>;
}

function ActiveTimerBar({ snapshot, now, onStop }: { snapshot: AppSnapshot; now: number; onStop: (startRest?: boolean) => Promise<void> }) {
  const active = snapshot.meta.activeTimer!;
  const shownSeconds = activeTimerDisplaySeconds(active, now);
  const display = formatTimerDisplay(shownSeconds);
  const subject = snapshot.subjects.find((item) => item.id === active.subjectId);
  const task = snapshot.tasks.find((item) => item.id === active.taskId);
  const isRest = active.kind === "rest";
  return <div className={`active-timer ${active.mode === "countdown" && shownSeconds === 0 ? "timer-finished" : ""}`} role="timer"><div className="timer-pulse" /><div><strong>{display}</strong><span>{isRest ? (shownSeconds === 0 ? "休息结束" : "休息倒计时") : active.mode === "countdown" ? (shownSeconds === 0 ? "倒计时已结束" : "倒计时") : "正计时"} · {subject?.name}{isRest ? " · 暂时放松" : task ? ` · ${task.title}` : " · 自由专注"}</span></div><button className="btn btn-primary btn-small" onClick={() => onStop()}>{isRest ? "结束休息" : "结束并保存"}</button></div>;
}

function WebGLSandLayer({ progress, running }: { progress: number; running: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { alpha: true, antialias: true });
    if (!canvas || !gl) return;
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertex, `attribute vec2 p;attribute float s;void main(){gl_Position=vec4(p,0.,1.);gl_PointSize=s;}`);
    gl.compileShader(vertex);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragment, `precision mediump float;void main(){vec2 c=gl_PointCoord-.5;float d=dot(c,c);if(d>.25)discard;gl_FragColor=vec4(0.93,0.81,0.48,(1.-d*4.)*.82);}`);
    gl.compileShader(fragment);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.useProgram(program);
    const count = 420;
    const seed = Array.from({ length: count }, (_, index) => ({ a: (index * 0.61803398875) % 1, b: (index * 0.754877666) % 1, size: 1.1 + (index % 5) * .38 }));
    const buffer = gl.createBuffer();
    let frame = 0;
    const draw = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(bounds.width * dpr)); canvas.height = Math.max(1, Math.round(bounds.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const points: number[] = [];
      const remaining = 1 - Math.max(0, Math.min(1, progress));
      for (const grain of seed) {
        const inStream = grain.a > .78;
        let x: number; let y: number;
        if (inStream) {
          const travel = running ? (grain.b + time / 1300) % 1 : grain.b;
          x = (grain.a - .89) * .018;
          y = .04 - travel * (.88 - progress * .34);
        } else if (grain.a < remaining * .78) {
          const normalized = grain.a / Math.max(.01, remaining * .78);
          const width = .53 * (1 - normalized * .74);
          x = (grain.b * 2 - 1) * width;
          y = .68 - normalized * .58 + Math.sin(grain.b * 31) * .008;
        } else {
          const normalized = (grain.a - remaining * .78) / Math.max(.01, 1 - remaining * .78);
          const width = .55 * normalized;
          x = (grain.b * 2 - 1) * width;
          y = -.72 + normalized * Math.max(.06, progress * .58) + Math.sin(grain.b * 29) * .008;
        }
        points.push(x, y, grain.size * dpr);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
      const position = gl.getAttribLocation(program, "p"); const size = gl.getAttribLocation(program, "s");
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 12, 0);
      gl.enableVertexAttribArray(size); gl.vertexAttribPointer(size, 1, gl.FLOAT, false, 12, 8);
      gl.drawArrays(gl.POINTS, 0, count);
      if (running) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const resize = new ResizeObserver(() => { if (!running) frame = requestAnimationFrame(draw); }); resize.observe(canvas);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); };
  }, [progress, running]);
  return <canvas ref={canvasRef} className="webgl-sand-layer" aria-hidden="true" />;
}

function RealisticHourglass({ progress, running, label, quality = "balanced" }: { progress: number; running: boolean; label: string; quality?: "balanced" | "high" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const safeProgress = Math.max(0, Math.min(1, progress));
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const draw = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(bounds.width * dpr) || canvas.height !== Math.round(bounds.height * dpr)) {
        canvas.width = Math.round(bounds.width * dpr);
        canvas.height = Math.round(bounds.height * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx || !bounds.width || !bounds.height) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, bounds.width, bounds.height);
      ctx.save();
      ctx.scale(bounds.width / 320, bounds.height / 400);

      const topGlass = () => {
        ctx.beginPath(); ctx.moveTo(72, 58); ctx.bezierCurveTo(76, 116, 104, 153, 154, 194); ctx.bezierCurveTo(158, 197, 162, 197, 166, 194); ctx.bezierCurveTo(216, 153, 244, 116, 248, 58); ctx.closePath();
      };
      const bottomGlass = () => {
        ctx.beginPath(); ctx.moveTo(154, 202); ctx.bezierCurveTo(104, 245, 76, 283, 72, 342); ctx.lineTo(248, 342); ctx.bezierCurveTo(244, 283, 216, 245, 166, 202); ctx.bezierCurveTo(162, 199, 158, 199, 154, 202); ctx.closePath();
      };
      const metal = ctx.createLinearGradient(0, 0, 320, 0);
      metal.addColorStop(0, "#10251a"); metal.addColorStop(.25, "#5c7465"); metal.addColorStop(.5, "#b2c2b8"); metal.addColorStop(.7, "#425a4c"); metal.addColorStop(1, "#09150f");
      ctx.shadowColor = "rgba(0,0,0,.52)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 9;
      for (const y of [35, 351]) { ctx.fillStyle = metal; ctx.beginPath(); ctx.roundRect(38, y, 244, 24, 7); ctx.fill(); ctx.strokeStyle = "rgba(203,231,215,.36)"; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.shadowBlur = 0;
      for (const x of [48, 263]) { ctx.fillStyle = metal; ctx.beginPath(); ctx.roundRect(x, 54, 9, 302, 4); ctx.fill(); }

      const glass = ctx.createLinearGradient(70, 0, 250, 0);
      glass.addColorStop(0, "rgba(132,190,161,.08)"); glass.addColorStop(.28, "rgba(235,255,245,.18)"); glass.addColorStop(.48, "rgba(250,255,252,.04)"); glass.addColorStop(.76, "rgba(196,239,216,.2)"); glass.addColorStop(1, "rgba(96,150,123,.08)");
      ctx.fillStyle = glass; topGlass(); ctx.fill(); bottomGlass(); ctx.fill();

      const sand = ctx.createLinearGradient(80, 0, 240, 0);
      sand.addColorStop(0, "#9f8141"); sand.addColorStop(.27, "#e0c87d"); sand.addColorStop(.52, "#f1dea0"); sand.addColorStop(.78, "#c9a85e"); sand.addColorStop(1, "#8c6c32");
      const remaining = 1 - safeProgress;
      const sandSurface = 60 + safeProgress * 134;
      ctx.save(); topGlass(); ctx.clip(); ctx.fillStyle = sand; ctx.fillRect(66, sandSurface, 188, 138); ctx.fillStyle = "rgba(255,239,181,.28)"; ctx.beginPath(); ctx.ellipse(160, sandSurface, Math.max(8, 82 * remaining), 3.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

      const pileHeight = 5 + safeProgress * 128;
      const pileApex = 340 - pileHeight;
      ctx.save(); bottomGlass(); ctx.clip(); ctx.fillStyle = sand; ctx.beginPath(); ctx.moveTo(160, pileApex); ctx.lineTo(79, 340); ctx.lineTo(241, 340); ctx.closePath(); ctx.fill(); ctx.fillStyle = "rgba(255,237,178,.2)"; ctx.beginPath(); ctx.moveTo(160, pileApex + 2); ctx.lineTo(82, 340); ctx.lineTo(112, 340); ctx.closePath(); ctx.fill(); ctx.restore();

      ctx.fillStyle = "rgba(91,63,18,.2)";
      for (let index = 0; index < 164; index += 1) {
        const x = 78 + ((index * 47) % 164); const y = 65 + ((index * 31) % 126);
        if (y > sandSurface) { ctx.beginPath(); ctx.arc(x, y, .24 + (index % 4) * .08, 0, Math.PI * 2); ctx.fill(); }
      }
      if (running && remaining > 0 && safeProgress < 1) {
       ctx.strokeStyle = "rgba(246,224,157,.5)"; ctx.lineWidth = .65; ctx.beginPath(); ctx.moveTo(160, 195); ctx.lineTo(160, Math.max(213, pileApex)); ctx.stroke();
         ctx.save(); bottomGlass(); ctx.clip();
         for (let haze = 0; haze < 54; haze += 1) { const drift = Math.sin(time / 420 + haze * 1.7) * (1.2 + haze % 3); const hx = 160 + drift + ((haze * 17) % 9 - 4); const hy = Math.min(337, pileApex + 6 + ((time / 18 + haze * 11) % 26)); ctx.fillStyle = `rgba(239,216,147,${0.025 + (haze % 5) * 0.009})`; ctx.beginPath(); ctx.arc(hx, hy, .45 + (haze % 4) * .18, 0, Math.PI * 2); ctx.fill(); }
         ctx.restore();
        for (let index = 0; index < 72; index += 1) {
          const travel = ((time / 7 + index * 19) % 130) / 130;
          const y = 199 + travel * Math.max(12, pileApex - 202);
          const x = 160 + Math.sin(index * 7.1 + time / 160) * (.38 + (index % 4) * .12);
          ctx.fillStyle = index % 3 ? "rgba(239,216,147,.9)" : "rgba(180,143,67,.82)"; ctx.beginPath(); ctx.arc(x, y, .22 + (index % 3) * .08, 0, Math.PI * 2); ctx.fill();
        }
        ctx.save(); bottomGlass(); ctx.clip(); ctx.fillStyle = "rgba(255,235,172,.2)"; for (let index = 0; index < 45; index += 1) { const angle = index * 2.399; const radius = 3 + (index % 15) * 2.2; const x = 160 + Math.cos(angle) * radius; const y = Math.min(339, pileApex + 4 + Math.sin(angle) * radius * .42); ctx.beginPath(); ctx.arc(x, y, .22 + (index % 3) * .07, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
      }

      ctx.fillStyle = "rgba(178,137,54,.25)";
      for (let index = 0; index < 118; index += 1) {
        const ratio = index / 117;
        const halfWidth = Math.max(3, 80 * ratio);
        const x = 160 + ((((index * 73) % 101) / 100) * 2 - 1) * halfWidth;
        const y = Math.min(339, pileApex + ratio * Math.max(1, 339 - pileApex));
        ctx.beginPath(); ctx.arc(x, y, .2 + (index % 3) * .08, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = "rgba(225,250,237,.38)"; ctx.lineWidth = 2; topGlass(); ctx.stroke(); bottomGlass(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(89, 70); ctx.bezierCurveTo(95, 118, 113, 150, 146, 180); ctx.stroke();
      ctx.restore();
      if (running) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const resize = new ResizeObserver(() => { if (!running) frame = requestAnimationFrame(draw); });
    resize.observe(canvas);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [running, safeProgress]);
  return <div className={`hourglass-render-stack is-${quality}`} role="img" aria-label={label}><canvas ref={canvasRef} className="realistic-hourglass" aria-hidden="true" />{quality === "high" && <WebGLSandLayer progress={safeProgress} running={running} />}</div>;
}

function FlipClock({ seconds, label }: { seconds: number; label: string }) {
  const values = (seconds >= 3600 ? [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60] : [Math.floor(seconds / 60), seconds % 60]).map((value) => String(value).padStart(2, "0"));
  return <div className="flip-clock" role="timer" aria-label={label}>{values.map((group, groupIndex) => <Fragment key={groupIndex}>{groupIndex > 0 && <span className="flip-colon">:</span>}{group.split("").map((digit, digitIndex) => <span className="flip-digit" key={`${groupIndex}-${digitIndex}-${digit}`}><i>{digit}</i></span>)}</Fragment>)}</div>;
}

function FocusProgressBar({ actualMinutes, targetMinutes }: { actualMinutes: number; targetMinutes: number }) {
  const progress = targetMinutes ? Math.min(100, Math.round(actualMinutes / targetMinutes * 100)) : 0;
  return <div className="focus-progress-card" style={{ "--focus-progress": `${progress}%` } as React.CSSProperties}><div className="focus-progress-fill" /><div className="focus-progress-copy"><span>今日专注进度</span><strong>{formatMinutes(Math.round(actualMinutes))}</strong><small>{targetMinutes ? `目标 ${formatMinutes(targetMinutes)} · ${progress}%` : "设置目标后显示完成度"}</small></div></div>;
}

function TaskScheduleNotifier({ snapshot }: { snapshot: AppSnapshot }) {
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    const check = () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const now = new Date();
      const today = localDate(now);
      const minute = now.getHours() * 60 + now.getMinutes();
      for (const schedule of snapshot.taskSchedules) {
        if (!schedule.reminderEnabled || schedule.plannedDate !== today || schedule.plannedStartMinute === undefined) continue;
        const remindAt = schedule.plannedStartMinute - (schedule.reminderMinutesBefore ?? 0);
        const key = `${schedule.id}:${today}:${remindAt}`;
        if (minute !== remindAt || notified.current.has(key)) continue;
        notified.current.add(key);
        const task = snapshot.tasks.find((item) => item.id === schedule.taskId);
        if (task?.status === "active") new Notification("考研系统 · 学习提醒", { body: `${minuteToTime(schedule.plannedStartMinute)} ${task.title}` });
      }
    };
    check();
    const interval = window.setInterval(check, 30_000);
    return () => window.clearInterval(interval);
  }, [snapshot.taskSchedules, snapshot.tasks]);
  return null;
}

function TimerAudioNotifier({ snapshot, now }: { snapshot: AppSnapshot; now: number }) {
  const lastComplete = useRef("");
  const lastReminder = useRef("");
  const lastSand = useRef("");
  const lastPause = useRef("");
  const active = snapshot.meta.activeTimer!;
  const elapsed = activeTimerElapsedSeconds(active, now);
  const shownSeconds = activeTimerDisplaySeconds(active, now);
  const reminderSeconds = Math.max(60, (snapshot.meta.focusSettings?.countupReminderMinutes ?? 30) * 60);
  useEffect(() => {
    if (!snapshot.meta.focusSettings?.soundEnabled) return;
    if (active.pausedAt) {
      const pauseSeconds = Math.max(0, (now - new Date(active.pausedAt).getTime()) / 1000);
      const pauseInterval = Math.max(60, (snapshot.meta.focusSettings?.pauseReminderMinutes ?? 5) * 60);
      const pauseCycle = timerCycle(pauseSeconds, pauseInterval);
      const pauseKey = `${active.pausedAt}:pause:${pauseCycle}`;
      if (pauseCycle > 0 && lastPause.current !== pauseKey) { lastPause.current = pauseKey; playTimerTone("reminder"); }
      return;
    }
    const completeKey = `${active.startedAt}:complete`;
    if (active.mode === "countdown" && shownSeconds === 0 && lastComplete.current !== completeKey) {
      lastComplete.current = completeKey;
      playTimerTone("complete");
      return;
    }
    const reminderCycle = active.mode !== "countdown" ? timerCycle(elapsed, reminderSeconds) : 0;
    if (reminderCycle > 0) {
      const reminderKey = `${active.startedAt}:reminder:${reminderCycle}`;
      if (lastReminder.current !== reminderKey) {
        lastReminder.current = reminderKey;
        playTimerTone("reminder");
        return;
      }
    }
    const sandCycle = timerCycle(elapsed, 8);
    if (sandCycle > 0) {
      const sandKey = `${active.startedAt}:sand:${sandCycle}`;
      if (lastSand.current !== sandKey) {
        lastSand.current = sandKey;
        playTimerTone("sand");
      }
    }
  }, [active, elapsed, now, reminderSeconds, shownSeconds, snapshot.meta.focusSettings?.pauseReminderMinutes, snapshot.meta.focusSettings?.soundEnabled]);
  return null;
}

function Focus({ snapshot, now, openTimer, onStop, onCancel, onPause, onResume, onReset, openDailyTarget, confirm, goTo }: { snapshot: AppSnapshot; now: number; openTimer: (taskId: string, subjectId: string) => void; onStop: (startRest?: boolean) => Promise<void>; onCancel: () => Promise<void>; onPause: () => Promise<void>; onResume: () => Promise<void>; onReset: () => Promise<void>; openDailyTarget: () => void; confirm: (confirm: AppConfirm) => void; goTo: (view: View) => void }) {
  const active = snapshot.meta.activeTimer;
  const elapsed = active ? activeTimerElapsedSeconds(active, now) : 0;
  const shownSeconds = active ? activeTimerDisplaySeconds(active, now) : 0;
  const display = formatTimerDisplay(shownSeconds);
  const subject = snapshot.subjects.find((item) => item.id === active?.subjectId);
  const task = snapshot.tasks.find((item) => item.id === active?.taskId);
  const isRest = active?.kind === "rest";
  const hourglassProgress = active?.mode === "countdown" ? Math.min(1, elapsed / Math.max(1, (active.targetMinutes ?? 1) * 60)) : 0;
  const today = localDate(new Date());
  const recordedMinutes = snapshot.studySessions.filter((session) => session.startedAt.slice(0, 10) === today).reduce((total, session) => total + session.durationMinutes, 0);
  const liveMinutes = active?.kind !== "rest" && active?.sessionStartedAt?.slice(0, 10) === today ? elapsed / 60 : 0;
  const actualMinutes = recordedMinutes + liveMinutes;
  const targetMinutes = snapshot.dailyTargets.find((target) => target.date === today)?.targetMinutes ?? 0;
  const countdownVisual = active?.mode === "countdown";
  const [floatingFallback, setFloatingFallback] = useState(false);
  const [floatingOpacity, setFloatingOpacity] = useState(1);
  const [floatingPosition, setFloatingPosition] = useState({ x: 24, y: 24 });
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    const acquire = () => nav.wakeLock?.request("screen").then((lock) => { wakeLock.current = lock; }).catch(() => undefined);
    acquire();
    const onVisibility = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); wakeLock.current?.release().catch(() => undefined); wakeLock.current = null; };
  }, [active]);
  const leaveFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); };
  const finish = async (startRest = false) => { await onStop(startRest); if (!startRest) leaveFullscreen(); };
  const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen().catch(() => undefined) : document.documentElement.requestFullscreen().catch(() => undefined);
  const openFloatingTimer = async () => {
    if (!active) return;
    type PiPWindow = Window & { resizeBy: (x: number, y: number) => void };
    type DocumentPiP = { requestWindow: (options: { width: number; height: number }) => Promise<PiPWindow>; window?: PiPWindow | null };
    const api = (window as Window & { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
    if (!api) { setFloatingFallback(true); return; }
    let pip: PiPWindow;
    try { pip = await api.requestWindow({ width: 288, height: 142 }); } catch { setFloatingFallback(true); return; }
    const doc = pip.document;
    doc.title = "考研系统专注计时";
    doc.body.innerHTML = `<main class="pip-timer"><div class="pip-tools"><button data-opacity="1" title="实色">●</button><button data-opacity=".72" title="半透明">◐</button><button data-resize="-1" title="缩小">−</button><button data-resize="1" title="放大">＋</button></div><div class="pip-copy"><span id="pip-subject"></span><strong id="pip-time"></strong><small id="pip-status"></small></div></main>`;
    const style = doc.createElement("style");
    style.textContent = `*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#050d08;color:#effaf2;font-family:ui-sans-serif,system-ui;transition:opacity .2s}.pip-timer{position:relative;height:100vh;display:grid;place-items:center;padding:8px;background:radial-gradient(circle at 50% 10%,#183d27,#06100a)}.pip-tools{position:absolute;z-index:2;top:5px;right:5px;display:flex;gap:3px}.pip-tools button{width:24px;height:22px;border:1px solid #2b4b38;border-radius:7px;background:#0a1b11;color:#9fbcaa;padding:0;font-size:11px;cursor:pointer}.pip-copy{display:grid;place-items:center;padding-top:7px}.pip-copy>span{color:#86d9a4;font-size:11px}.pip-copy>strong{font:800 clamp(29px,18vw,50px)/.95 Consolas,monospace;margin:6px 0 3px}.pip-copy>small{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a7b9ae;font-size:10px}`;
    doc.head.append(style);
    doc.querySelectorAll<HTMLButtonElement>("[data-opacity]").forEach((button) => button.addEventListener("click", () => { doc.body.style.opacity = button.dataset.opacity ?? "1"; }));
    doc.querySelectorAll<HTMLButtonElement>("[data-resize]").forEach((button) => button.addEventListener("click", () => { const direction = Number(button.dataset.resize); pip.resizeBy(direction * 40, direction * 22); }));
    const update = () => { const seconds = activeTimerDisplaySeconds(active, Date.now()); const text = formatTimerDisplay(seconds); const time = doc.getElementById("pip-time"); const name = doc.getElementById("pip-subject"); const status = doc.getElementById("pip-status"); if (time) time.textContent = text; if (name) name.textContent = subject?.name ?? "专注"; if (status) status.textContent = active.pausedAt ? "已暂停" : isRest ? "休息中" : task?.title ?? "专注中"; };
    update(); const interval = window.setInterval(update, 1000); pip.addEventListener("pagehide", () => window.clearInterval(interval), { once: true });
  };

  if (active) return <section className="focus-immersive"><div className="immersive-topbar"><div><span className="focus-subject-label">{isRest ? "休息" : subject?.name}</span><strong>{isRest ? "暂时放松" : task?.title ?? "自由专注"}</strong></div><div><button onClick={openFloatingTimer}>悬浮窗</button><button onClick={toggleFullscreen}>全屏</button><button onClick={() => goTo("dashboard")}>退出沉浸页</button></div></div><div className={`immersive-visual ${countdownVisual ? "is-hourglass" : "is-flip"}`}>{countdownVisual ? <><RealisticHourglass progress={hourglassProgress} running={!active.pausedAt && shownSeconds > 0} quality={snapshot.meta.focusSettings?.hourglassQuality ?? "balanced"} label={`真实沙粒沙漏，剩余 ${display}`} /><div className="focus-clock">{display}</div></> : <FlipClock seconds={shownSeconds} label={`正计时 ${display}`} />}</div><div className="focus-status">{active.pausedAt ? "已暂停" : countdownVisual && shownSeconds === 0 ? (isRest ? "休息结束" : "本轮完成") : "专注中"}</div><div className="focus-controls immersive-controls">{active.pausedAt ? <button className="btn btn-primary" onClick={onResume}>继续</button> : <button className="btn btn-primary" onClick={onPause}>暂停</button>}<button className="btn btn-quiet" onClick={onReset}>重置</button><button className="btn btn-quiet" onClick={() => confirm({ title: isRest ? "放弃本次休息？" : "放弃本次计时？", message: isRest ? "本次休息不会保留。" : "这次专注记录不会保存。", confirmLabel: "确认放弃", tone: "danger", onConfirm: async () => { await onCancel(); leaveFullscreen(); } })}>放弃</button>{isRest ? <button className="btn btn-danger" onClick={() => finish()}>结束休息</button> : <><button className="btn btn-quiet" onClick={() => finish(true)}>保存并休息</button><button className="btn btn-danger" onClick={() => finish()}>结束并保存</button></>}</div>{floatingFallback && <aside className="fallback-floating-timer" style={{ right: floatingPosition.x, top: floatingPosition.y, opacity: floatingOpacity }}><div className="floating-drag-handle" onPointerDown={(event) => { const startX = event.clientX; const startY = event.clientY; const base = floatingPosition; const move = (moveEvent: PointerEvent) => setFloatingPosition({ x: Math.max(0, base.x - (moveEvent.clientX - startX)), y: Math.max(0, base.y + moveEvent.clientY - startY) }); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true }); }}><span>拖动</span><button onClick={() => setFloatingOpacity(floatingOpacity === 1 ? .72 : 1)}>{floatingOpacity === 1 ? "半透明" : "实色"}</button><button onClick={() => setFloatingFallback(false)}>×</button></div><strong>{display}</strong><span>{subject?.name} · {active.pausedAt ? "已暂停" : isRest ? "休息中" : task?.title ?? "专注中"}</span></aside>}</section>;

  return <><header className="page-head"><div><div className="page-kicker">专注记录</div><h1>专注计时</h1></div><div className="head-actions"><span className="page-date">距离考试还有 {daysUntil(snapshot.goal!.examDate)} 天</span><button className="btn btn-quiet btn-small" onClick={() => goTo("analytics")}>查看我的数据</button></div></header><div className="focus-workspace"><aside className="focus-day-summary"><div className="focus-day-heading"><span>今天</span><strong>专注完成度</strong></div><FocusProgressBar actualMinutes={actualMinutes} targetMinutes={targetMinutes} /><button className="focus-target-action" onClick={openDailyTarget}>{targetMinutes ? "调整今日目标" : "设置今日目标"}</button></aside><section className="focus-stage"><div className="focus-empty"><FlipClock seconds={0} label="等待开始计时" /><h2>选择备考科目，开始本轮专注</h2><p>正计时使用极简翻页时钟；倒计时使用真实沙粒沙漏。</p><button className="btn btn-primary" disabled={!snapshot.subjects.length} onClick={() => openTimer("", snapshot.subjects[0]?.id ?? "")}>设置并开始</button></div></section></div></>;
}

function CompletionDialog({ task, onClose, onSave }: { task: Task; onClose: () => void; onSave: (taskId: string, actualMinutes?: number, mastery?: MasteryLevel) => Promise<void> }) {
  const [actualMinutes, setActualMinutes] = useState(0);
  const [mastery, setMastery] = useState<MasteryLevel | undefined>(task.mastery);
  const [saving, setSaving] = useState(false);
  const masteryOptions: { value: MasteryLevel; label: string; note: string }[] = [
    { value: "not_yet", label: "需再学", note: "还没掌握" },
    { value: "developing", label: "在进步", note: "基本理解" },
    { value: "mastered", label: "已掌握", note: "可以运用" },
  ];
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="task-dialog completion-dialog" role="dialog" aria-modal="true" aria-labelledby="completion-title"><header><div><div className="page-kicker">完成反馈</div><h2 id="completion-title">做得好，记录一下结果</h2></div><button className="dialog-close" aria-label="跳过反馈" onClick={onClose}>×</button></header><p className="form-lead">“{task.title}”已经完成。反馈可选，不会阻止一键完成。</p><div className="field"><label htmlFor="actual-minutes">实际用时（分钟）</label><input id="actual-minutes" type="number" min="0" step="5" value={actualMinutes || ""} onChange={(e) => setActualMinutes(Number(e.target.value))} placeholder="可留空" /></div><div className="field"><span className="field-label" id="mastery-label">掌握程度</span><div className="mastery-picker" role="group" aria-labelledby="mastery-label">{masteryOptions.map((option) => <button className={mastery === option.value ? "selected" : ""} type="button" aria-pressed={mastery === option.value} key={option.value} onClick={() => setMastery(option.value)}><strong>{option.label}</strong><span>{option.note}</span></button>)}</div></div><div className="form-actions"><button className="btn btn-secondary" type="button" onClick={onClose}>跳过</button><button className="btn btn-primary" disabled={saving} onClick={async () => { setSaving(true); try { await onSave(task.id, actualMinutes || undefined, mastery); } finally { setSaving(false); } }}>{saving ? "正在保存…" : "保存反馈"}</button></div></section></div>;
}
