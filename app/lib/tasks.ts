import type { AppSnapshot, Task } from "../types/domain";

export function descendantTaskIds(tasks: Task[], taskId: string) {
  const descendants = new Set<string>();
  const pending = [taskId];
  while (pending.length) {
    const parentId = pending.pop()!;
    for (const task of tasks) {
      if (task.parentTaskId !== parentId || descendants.has(task.id)) continue;
      descendants.add(task.id);
      pending.push(task.id);
    }
  }
  return descendants;
}

export function possibleTaskParents(tasks: Task[], task?: Task, subjectId?: string) {
  const excluded = task ? descendantTaskIds(tasks, task.id) : new Set<string>();
  if (task) excluded.add(task.id);
  return tasks.filter((item) => item.status === "active" && item.subjectId === subjectId && !excluded.has(item.id));
}

export function moveTaskInHierarchy(snapshot: AppSnapshot, taskId: string, newParentTaskId: string | undefined, beforeTaskId: string | undefined, now: string, requestedContentNodeId?: string): AppSnapshot {
  const moving = snapshot.tasks.find((task) => task.id === taskId);
  if (!moving || taskId === newParentTaskId || taskId === beforeTaskId) return snapshot;
  const descendants = descendantTaskIds(snapshot.tasks, taskId);
  if (newParentTaskId && descendants.has(newParentTaskId)) return snapshot;
  const newParent = newParentTaskId ? snapshot.tasks.find((task) => task.id === newParentTaskId) : undefined;
  if (newParentTaskId && (!newParent || newParent.subjectId !== moving.subjectId || newParent.status === "archived")) return snapshot;
  const beforeTask = beforeTaskId ? snapshot.tasks.find((task) => task.id === beforeTaskId) : undefined;
  if (beforeTaskId && (!beforeTask || beforeTask.subjectId !== moving.subjectId || beforeTask.status === "archived" || (beforeTask.parentTaskId ?? "") !== (newParentTaskId ?? ""))) return snapshot;

  const oldParentTaskId = moving.parentTaskId;
  const oldContentNodeId = moving.contentNodeId;
  const destinationContentNodeId = newParent?.contentNodeId ?? beforeTask?.contentNodeId ?? requestedContentNodeId ?? moving.contentNodeId;
  const subtreeIds = new Set([taskId, ...descendants]);
  let tasks = snapshot.tasks.map((task) => task.id === taskId
    ? { ...task, parentTaskId: newParentTaskId, contentNodeId: destinationContentNodeId, updatedAt: now }
    : subtreeIds.has(task.id) ? { ...task, contentNodeId: destinationContentNodeId, updatedAt: now } : task);

  const normalizeSiblings = (parentTaskId: string | undefined, contentNodeId: string | undefined, insertMoving: boolean) => {
    const siblings = tasks.filter((task) => task.subjectId === moving.subjectId && task.status !== "archived" && task.id !== taskId && (task.parentTaskId ?? "") === (parentTaskId ?? "") && (task.contentNodeId ?? "") === (contentNodeId ?? ""))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
    const ordered = siblings.map((task) => task.id);
    if (insertMoving) {
      const requestedIndex = beforeTaskId ? ordered.indexOf(beforeTaskId) : ordered.length;
      ordered.splice(requestedIndex < 0 ? ordered.length : requestedIndex, 0, taskId);
    }
    const order = new Map(ordered.map((id, index) => [id, index]));
    tasks = tasks.map((task) => order.has(task.id) ? { ...task, sortOrder: order.get(task.id), updatedAt: now } : task);
  };

  if ((oldParentTaskId ?? "") !== (newParentTaskId ?? "") || (oldContentNodeId ?? "") !== (destinationContentNodeId ?? "")) normalizeSiblings(oldParentTaskId, oldContentNodeId, false);
  normalizeSiblings(newParentTaskId, destinationContentNodeId, true);
  return { ...snapshot, tasks, meta: { ...snapshot.meta, updatedAt: now } };
}

export function deleteTaskFromSnapshot(snapshot: AppSnapshot, taskId: string, now: string): AppSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.filter((task) => task.id !== taskId).map((task) => task.parentTaskId === taskId ? { ...task, parentTaskId: undefined, updatedAt: now } : task),
    taskSchedules: snapshot.taskSchedules.filter((schedule) => schedule.taskId !== taskId),
    repeatRules: snapshot.repeatRules.filter((rule) => rule.taskId !== taskId),
    reviewPlans: (snapshot.reviewPlans ?? []).filter((plan) => plan.sourceTaskId !== taskId),
    taskCheckins: (snapshot.taskCheckins ?? []).filter((checkin) => checkin.taskId !== taskId),
    studySessions: snapshot.studySessions.map((session) => session.taskId === taskId ? { ...session, taskId: undefined, updatedAt: now } : session),
    meta: {
      ...snapshot.meta,
      activeTimer: snapshot.meta.activeTimer?.taskId === taskId ? { ...snapshot.meta.activeTimer, taskId: undefined } : snapshot.meta.activeTimer,
      updatedAt: now,
    },
  };
}

export function moveTaskToTrash(snapshot: AppSnapshot, taskId: string, now: string): AppSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => task.id === taskId ? {
      ...task,
      statusBeforeDelete: task.status === "archived" ? task.statusBeforeDelete ?? "active" : task.status,
      status: "archived",
      deletedAt: now,
      updatedAt: now,
    } : task),
    meta: {
      ...snapshot.meta,
      activeTimer: snapshot.meta.activeTimer?.taskId === taskId ? { ...snapshot.meta.activeTimer, taskId: undefined } : snapshot.meta.activeTimer,
      updatedAt: now,
    },
  };
}

export function restoreTaskFromTrash(snapshot: AppSnapshot, taskId: string, now: string): AppSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => task.id === taskId ? {
      ...task,
      status: task.statusBeforeDelete ?? "active",
      deletedAt: undefined,
      statusBeforeDelete: undefined,
      updatedAt: now,
    } : task),
    meta: { ...snapshot.meta, updatedAt: now },
  };
}

export function purgeExpiredDeletedTasks(snapshot: AppSnapshot, now: string, retentionDays = 30): AppSnapshot {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return snapshot.tasks
    .filter((task) => task.status === "archived" && task.deletedAt && new Date(task.deletedAt) < cutoff)
    .reduce((current, task) => deleteTaskFromSnapshot(current, task.id, now), snapshot);
}

export function deleteUnusedSubjectFromSnapshot(snapshot: AppSnapshot, subjectId: string, now: string): AppSnapshot {
  const removedTaskIds = new Set(snapshot.tasks.filter((task) => task.subjectId === subjectId).map((task) => task.id));
  return {
    ...snapshot,
    subjects: snapshot.subjects.filter((subject) => subject.id !== subjectId).map((subject, index) => ({ ...subject, sortOrder: index })),
    stages: snapshot.stages.filter((stage) => stage.subjectId !== subjectId),
    contentNodes: snapshot.contentNodes.filter((node) => node.subjectId !== subjectId),
    tasks: snapshot.tasks.filter((task) => task.subjectId !== subjectId),
    taskSchedules: snapshot.taskSchedules.filter((schedule) => !removedTaskIds.has(schedule.taskId)),
    repeatRules: snapshot.repeatRules.filter((rule) => !removedTaskIds.has(rule.taskId)),
    reviewPlans: (snapshot.reviewPlans ?? []).filter((plan) => !removedTaskIds.has(plan.sourceTaskId)),
    taskCheckins: (snapshot.taskCheckins ?? []).filter((checkin) => !removedTaskIds.has(checkin.taskId)),
    studyReviews: (snapshot.studyReviews ?? []).filter((review) => review.subjectId !== subjectId),
    abilitySheets: (snapshot.abilitySheets ?? []).filter((sheet) => sheet.subjectId !== subjectId),
    examRecords: (snapshot.examRecords ?? []).filter((record) => record.subjectId !== subjectId),
    meta: { ...snapshot.meta, updatedAt: now },
  };
}
