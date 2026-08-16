import type { AppSnapshot } from "../types/domain";

export type DataHealthIssue = {
  id: string;
  severity: "error" | "warning";
  title: string;
  detail: string;
};

function isValidDate(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime()));
}

export function analyzeDataHealth(snapshot: AppSnapshot): DataHealthIssue[] {
  const issues: DataHealthIssue[] = [];
  const subjects = new Map(snapshot.subjects.map((subject) => [subject.id, subject]));
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const nodes = new Map(snapshot.contentNodes.map((node) => [node.id, node]));
  const scheduleCount = new Map<string, number>();
  const add = (id: string, severity: DataHealthIssue["severity"], title: string, detail: string) => issues.push({ id, severity, title, detail });

  for (const subject of snapshot.subjects) {
    if (subject.targetStartDate && !isValidDate(subject.targetStartDate)) add(`subject-start-${subject.id}`, "error", "科目起始日期无效", subject.name);
    if (subject.targetDate && !isValidDate(subject.targetDate)) add(`subject-end-${subject.id}`, "error", "科目目标日期无效", subject.name);
    if (subject.targetStartDate && subject.targetDate && subject.targetStartDate > subject.targetDate) add(`subject-range-${subject.id}`, "error", "科目日期范围颠倒", `${subject.name}的起始日期晚于截止日期`);
  }

  for (const stage of snapshot.stages) {
    if (!subjects.has(stage.subjectId)) add(`stage-subject-${stage.id}`, "error", "学习阶段缺少科目", stage.name);
    if (stage.startDate && stage.endDate && stage.startDate > stage.endDate) add(`stage-range-${stage.id}`, "error", "阶段日期范围颠倒", stage.name);
  }

  for (const task of snapshot.tasks) {
    if (!subjects.has(task.subjectId)) add(`task-subject-${task.id}`, "error", "任务缺少科目", task.title);
    if (task.parentTaskId) {
      const parent = tasks.get(task.parentTaskId);
      if (!parent) add(`task-parent-${task.id}`, "error", "任务的上级不存在", task.title);
      else if (parent.subjectId !== task.subjectId) add(`task-parent-subject-${task.id}`, "error", "父子任务跨越了科目", `${task.title} → ${parent.title}`);
      const visited = new Set([task.id]);
      let cursor = parent;
      while (cursor?.parentTaskId) {
        if (visited.has(cursor.id)) { add(`task-cycle-${task.id}`, "error", "任务层级形成循环", task.title); break; }
        visited.add(cursor.id);
        cursor = tasks.get(cursor.parentTaskId);
      }
    }
    if (task.stageId) {
      const stage = stages.get(task.stageId);
      if (!stage || stage.subjectId !== task.subjectId) add(`task-stage-${task.id}`, "warning", "任务的阶段关联无效", task.title);
    }
    if (task.contentNodeId) {
      const node = nodes.get(task.contentNodeId);
      if (!node || node.subjectId !== task.subjectId) add(`task-node-${task.id}`, "warning", "任务的学习内容关联无效", task.title);
    }
    if (task.deadline && !isValidDate(task.deadline)) add(`task-deadline-${task.id}`, "error", "任务截止日期无效", task.title);
  }

  for (const schedule of snapshot.taskSchedules) {
    scheduleCount.set(schedule.taskId, (scheduleCount.get(schedule.taskId) ?? 0) + 1);
    const task = tasks.get(schedule.taskId);
    if (!task) add(`schedule-task-${schedule.id}`, "error", "日程指向了不存在的任务", schedule.plannedDate || schedule.id);
    if (!isValidDate(schedule.plannedDate)) add(`schedule-date-${schedule.id}`, "error", "计划日期无效", task?.title ?? schedule.id);
    if (task?.deadline && isValidDate(schedule.plannedDate) && schedule.plannedDate > task.deadline) add(`schedule-deadline-${schedule.id}`, "warning", "计划日期晚于截止日期", task.title);
    if (schedule.plannedStartMinute !== undefined && (schedule.plannedStartMinute < 0 || schedule.plannedStartMinute > 1439)) add(`schedule-time-${schedule.id}`, "error", "任务时间点超出一天", task?.title ?? schedule.id);
  }
  for (const [taskId, count] of scheduleCount) if (count > 1) add(`schedule-duplicate-${taskId}`, "warning", "任务存在重复日程", `${tasks.get(taskId)?.title ?? taskId}共有 ${count} 条安排`);

  for (const rule of snapshot.repeatRules) if (!tasks.has(rule.taskId)) add(`repeat-task-${rule.id}`, "error", "重复规则缺少任务", rule.id);
  for (const plan of snapshot.reviewPlans ?? []) {
    if (!tasks.has(plan.sourceTaskId)) add(`review-source-${plan.id}`, "error", "复习计划的原任务不存在", plan.id);
    for (const taskId of plan.createdTaskIds) if (!tasks.has(taskId)) add(`review-task-${plan.id}-${taskId}`, "warning", "复习计划中有任务已被删除", taskId);
  }
  for (const session of snapshot.studySessions) if (!subjects.has(session.subjectId)) add(`session-subject-${session.id}`, "warning", "专注记录缺少科目", session.startedAt.slice(0, 10));
  for (const review of snapshot.studyReviews ?? []) {
    if (review.subjectId && !subjects.has(review.subjectId)) add(`study-review-subject-${review.id}`, "warning", "复盘记录缺少科目", review.periodStart);
    if (!isValidDate(review.periodStart) || !isValidDate(review.periodEnd) || review.periodStart > review.periodEnd) add(`study-review-range-${review.id}`, "error", "复盘日期范围无效", `${review.periodStart} 至 ${review.periodEnd}`);
  }
  for (const record of snapshot.examRecords ?? []) {
    if (!subjects.has(record.subjectId)) add(`exam-record-subject-${record.id}`, "error", "试卷成绩缺少科目", record.title);
    if (!isValidDate(record.examDate)) add(`exam-record-date-${record.id}`, "error", "试卷日期无效", record.title);
    if (!Number.isFinite(record.score) || !Number.isFinite(record.fullScore) || record.fullScore <= 0 || record.score < 0 || record.score > record.fullScore) add(`exam-record-score-${record.id}`, "error", "试卷分数无效", record.title);
    if (record.sheetId && !(snapshot.abilitySheets ?? []).some((sheet) => sheet.id === record.sheetId && sheet.subjectId === record.subjectId)) add(`exam-record-sheet-${record.id}`, "warning", "能力记录的数据表不存在", record.title);
  }
  for (const sheet of snapshot.abilitySheets ?? []) if (!subjects.has(sheet.subjectId)) add(`ability-sheet-subject-${sheet.id}`, "error", "能力数据表缺少科目", sheet.name);

  return issues;
}
