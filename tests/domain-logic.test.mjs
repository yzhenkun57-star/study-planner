import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScript(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: url.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("Markdown import preserves subject, optional stage, content and indented task hierarchy", async () => {
  const { parseMarkdownPlan } = await importTypeScript("../app/lib/markdown-plan.ts");
  const parsed = parseMarkdownPlan(`# 数学一
## [阶段] 基础阶段
### 高等数学
- [ ] 反常积分课程 | 60分钟 | 2026-08-15
  - [x] 完成课后题 | 1.5小时
`);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.subjects[0].name, "数学一");
  assert.equal(parsed.stages[0].name, "基础阶段");
  assert.equal(parsed.nodes[0].name, "高等数学");
  assert.equal(parsed.tasks[0].estimatedMinutes, 60);
  assert.equal(parsed.tasks[0].plannedDate, "2026-08-15");
  assert.equal(parsed.tasks[1].estimatedMinutes, 90);
  assert.equal(parsed.tasks[1].parentTaskKey, parsed.tasks[0].key);
  assert.equal(parsed.tasks[1].completed, true);
});

test("Markdown import reports missing subject and unsupported lines without writing data", async () => {
  const { parseMarkdownPlan } = await importTypeScript("../app/lib/markdown-plan.ts");
  const parsed = parseMarkdownPlan(`## 高等数学
不是任务
- [ ] 做题
`);
  assert.ok(parsed.issues.some((issue) => issue.includes("缺少一级科目标题")));
  assert.equal(parsed.tasks.length, 0);
});

test("time formatting distinguishes zero from an unknown estimate", async () => {
  const { formatMinutes, formatTimerDisplay } = await importTypeScript("../app/lib/time.ts");
  assert.equal(formatMinutes(), "未估时");
  assert.equal(formatMinutes(0), "0 分钟");
  assert.equal(formatMinutes(90), "1 小时 30 分");
  assert.equal(formatTimerDisplay(8 * 60 + 5), "08:05");
  assert.equal(formatTimerDisplay(60 * 60 + 5), "01:00:05");
});

test("countdown sessions never record time beyond their target", async () => {
  const { activeTimerDisplaySeconds, activeTimerSessionMinutes } = await importTypeScript("../app/lib/time.ts");
  const active = { subjectId: "math", startedAt: "2026-08-12T12:00:00.000Z", mode: "countdown", targetMinutes: 50, accumulatedSeconds: 0 };
  const afterSixtyMinutes = new Date("2026-08-12T13:00:00.000Z").getTime();
  assert.equal(activeTimerDisplaySeconds(active, afterSixtyMinutes), 0);
  assert.equal(activeTimerSessionMinutes(active, afterSixtyMinutes), 50);
});

test("paused timer uses accumulated time and reminder cycles survive skipped seconds", async () => {
  const { activeTimerElapsedSeconds, timerCycle } = await importTypeScript("../app/lib/time.ts");
  const active = { subjectId: "english", startedAt: "2026-08-12T12:00:00.000Z", pausedAt: "2026-08-12T12:10:00.000Z", accumulatedSeconds: 601 };
  assert.equal(activeTimerElapsedSeconds(active, Date.now()), 601);
  assert.equal(timerCycle(1801, 1800), 1);
  assert.equal(timerCycle(3599, 1800), 1);
  assert.equal(timerCycle(3600, 1800), 2);
});

test("a task cannot choose itself or any descendant as its parent", async () => {
  const { possibleTaskParents } = await importTypeScript("../app/lib/tasks.ts");
  const base = { subjectId: "math", status: "active" };
  const tasks = [
    { ...base, id: "root", title: "根任务" },
    { ...base, id: "child", title: "子任务", parentTaskId: "root" },
    { ...base, id: "grandchild", title: "孙任务", parentTaskId: "child" },
    { ...base, id: "sibling", title: "同级任务" },
  ];
  assert.deepEqual(possibleTaskParents(tasks, tasks[0], "math").map((task) => task.id), ["sibling"]);
});

test("nested tasks can reorder before and after siblings without losing their hierarchy", async () => {
  const { moveTaskInHierarchy } = await importTypeScript("../app/lib/tasks.ts");
  const createdAt = "2026-08-01T08:00:00.000Z";
  const now = "2026-08-14T08:00:00.000Z";
  const snapshot = {
    meta: { updatedAt: createdAt },
    tasks: [
      { id: "root", title: "高等数学", subjectId: "math", status: "active", contentNodeId: "calculus", sortOrder: 0, createdAt },
      { id: "a", title: "极限", subjectId: "math", status: "active", parentTaskId: "root", contentNodeId: "calculus", sortOrder: 0, createdAt },
      { id: "b", title: "导数", subjectId: "math", status: "active", parentTaskId: "root", contentNodeId: "calculus", sortOrder: 1, createdAt },
      { id: "c", title: "积分", subjectId: "math", status: "active", parentTaskId: "root", contentNodeId: "calculus", sortOrder: 2, createdAt },
    ],
  };
  const movedBefore = moveTaskInHierarchy(snapshot, "c", "root", "a", now);
  const order = movedBefore.tasks.filter((task) => task.parentTaskId === "root").sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.id);
  assert.deepEqual(order, ["c", "a", "b"]);

  const movedAfter = moveTaskInHierarchy(movedBefore, "c", "root", undefined, now);
  const afterOrder = movedAfter.tasks.filter((task) => task.parentTaskId === "root").sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.id);
  assert.deepEqual(afterOrder, ["a", "b", "c"]);
});

test("cross-level moves propagate category to descendants and reject hierarchy cycles", async () => {
  const { moveTaskInHierarchy } = await importTypeScript("../app/lib/tasks.ts");
  const createdAt = "2026-08-01T08:00:00.000Z";
  const snapshot = {
    meta: { updatedAt: createdAt },
    tasks: [
      { id: "root-a", subjectId: "math", status: "active", contentNodeId: "node-a", sortOrder: 0, createdAt },
      { id: "child", subjectId: "math", status: "active", parentTaskId: "root-a", contentNodeId: "node-a", sortOrder: 0, createdAt },
      { id: "grandchild", subjectId: "math", status: "active", parentTaskId: "child", contentNodeId: "node-a", sortOrder: 0, createdAt },
      { id: "root-b", subjectId: "math", status: "active", contentNodeId: "node-b", sortOrder: 1, createdAt },
    ],
  };
  const moved = moveTaskInHierarchy(snapshot, "child", "root-b", undefined, "2026-08-14T08:00:00.000Z");
  assert.equal(moved.tasks.find((task) => task.id === "child").parentTaskId, "root-b");
  assert.equal(moved.tasks.find((task) => task.id === "child").contentNodeId, "node-b");
  assert.equal(moved.tasks.find((task) => task.id === "grandchild").contentNodeId, "node-b");
  assert.equal(moveTaskInHierarchy(snapshot, "root-a", "grandchild", undefined, "later"), snapshot);
});

test("moving after the last top-level task switches category without reordering other categories", async () => {
  const { moveTaskInHierarchy } = await importTypeScript("../app/lib/tasks.ts");
  const createdAt = "2026-08-01T08:00:00.000Z";
  const snapshot = {
    meta: {},
    tasks: [
      { id: "a1", subjectId: "math", status: "active", contentNodeId: "node-a", sortOrder: 0, createdAt },
      { id: "a2", subjectId: "math", status: "active", contentNodeId: "node-a", sortOrder: 1, createdAt },
      { id: "b1", subjectId: "math", status: "active", contentNodeId: "node-b", sortOrder: 0, createdAt },
    ],
  };
  const moved = moveTaskInHierarchy(snapshot, "a2", undefined, undefined, "now", "node-b");
  assert.equal(moved.tasks.find((task) => task.id === "a2").contentNodeId, "node-b");
  assert.deepEqual(moved.tasks.filter((task) => task.contentNodeId === "node-b").sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.id), ["b1", "a2"]);
  assert.equal(moved.tasks.find((task) => task.id === "a1").sortOrder, 0);
});

test("deleting a task unlinks children, schedules, repeats, timer and sessions without losing study time", async () => {
  const { deleteTaskFromSnapshot } = await importTypeScript("../app/lib/tasks.ts");
  const now = "2026-08-12T20:00:00.000Z";
  const snapshot = {
    meta: { activeTimer: { subjectId: "math", taskId: "parent", startedAt: now } },
    tasks: [{ id: "parent" }, { id: "child", parentTaskId: "parent" }],
    taskSchedules: [{ taskId: "parent" }, { taskId: "child" }],
    repeatRules: [{ taskId: "parent" }],
    studySessions: [{ id: "session", taskId: "parent", subjectId: "math", durationMinutes: 60 }],
  };
  const next = deleteTaskFromSnapshot(snapshot, "parent", now);
  assert.deepEqual(next.tasks, [{ id: "child", parentTaskId: undefined, updatedAt: now }]);
  assert.deepEqual(next.taskSchedules, [{ taskId: "child" }]);
  assert.deepEqual(next.repeatRules, []);
  assert.deepEqual(next.taskCheckins, []);
  assert.equal(next.studySessions[0].durationMinutes, 60);
  assert.equal(next.studySessions[0].taskId, undefined);
  assert.equal(next.meta.activeTimer.taskId, undefined);
});

test("recently deleted tasks keep their records, restore cleanly and expire after 30 days", async () => {
  const { moveTaskToTrash, purgeExpiredDeletedTasks, restoreTaskFromTrash } = await importTypeScript("../app/lib/tasks.ts");
  const deletedAt = "2026-08-01T08:00:00.000Z";
  const snapshot = {
    meta: { activeTimer: { subjectId: "math", taskId: "task", startedAt: deletedAt } },
    tasks: [{ id: "task", subjectId: "math", status: "active", updatedAt: deletedAt }],
    taskSchedules: [{ id: "schedule", taskId: "task" }], repeatRules: [], reviewPlans: [],
    taskCheckins: [{ id: "checkin", taskId: "task", date: "2026-08-01", quantity: 10 }],
    studySessions: [{ id: "session", taskId: "task", subjectId: "math", durationMinutes: 20 }],
  };
  const trashed = moveTaskToTrash(snapshot, "task", deletedAt);
  assert.equal(trashed.tasks[0].status, "archived");
  assert.equal(trashed.tasks[0].statusBeforeDelete, "active");
  assert.equal(trashed.taskSchedules.length, 1);
  assert.equal(trashed.taskCheckins.length, 1);
  assert.equal(trashed.meta.activeTimer.taskId, undefined);

  const restored = restoreTaskFromTrash(trashed, "task", "2026-08-02T08:00:00.000Z");
  assert.equal(restored.tasks[0].status, "active");
  assert.equal(restored.tasks[0].deletedAt, undefined);
  assert.equal(restored.taskCheckins.length, 1);

  assert.equal(purgeExpiredDeletedTasks(trashed, "2026-08-30T07:59:59.000Z").tasks.length, 1);
  const expired = purgeExpiredDeletedTasks(trashed, "2026-09-01T08:00:01.000Z");
  assert.equal(expired.tasks.length, 0);
  assert.equal(expired.taskSchedules.length, 0);
  assert.equal(expired.taskCheckins.length, 0);
  assert.equal(expired.studySessions[0].durationMinutes, 20);
  assert.equal(expired.studySessions[0].taskId, undefined);
});

test("deleting an unused subject also removes its orphan-prone structure and archived tasks", async () => {
  const { deleteUnusedSubjectFromSnapshot } = await importTypeScript("../app/lib/tasks.ts");
  const snapshot = {
    meta: {},
    subjects: [{ id: "math", sortOrder: 0 }, { id: "english", sortOrder: 1 }],
    stages: [{ id: "stage", subjectId: "math" }],
    contentNodes: [{ id: "node", subjectId: "math" }],
    tasks: [{ id: "old", subjectId: "math", status: "archived" }, { id: "keep", subjectId: "english", status: "active" }],
    taskSchedules: [{ taskId: "old" }, { taskId: "keep" }],
    repeatRules: [{ taskId: "old" }],
    studyReviews: [{ id: "review-math", subjectId: "math" }, { id: "review-all" }],
    abilitySheets: [{ id: "sheet-math", subjectId: "math" }, { id: "sheet-english", subjectId: "english" }],
    examRecords: [{ id: "exam-math", subjectId: "math" }, { id: "exam-english", subjectId: "english" }],
  };
  const next = deleteUnusedSubjectFromSnapshot(snapshot, "math", "now");
  assert.deepEqual(next.subjects, [{ id: "english", sortOrder: 0 }]);
  assert.deepEqual(next.stages, []);
  assert.deepEqual(next.contentNodes, []);
  assert.deepEqual(next.tasks, [{ id: "keep", subjectId: "english", status: "active" }]);
  assert.deepEqual(next.taskSchedules, [{ taskId: "keep" }]);
  assert.deepEqual(next.repeatRules, []);
  assert.deepEqual(next.taskCheckins, []);
  assert.deepEqual(next.studyReviews, [{ id: "review-all" }]);
  assert.deepEqual(next.abilitySheets, [{ id: "sheet-english", subjectId: "english" }]);
  assert.deepEqual(next.examRecords, [{ id: "exam-english", subjectId: "english" }]);
});

test("backup validation fills missing collections and rejects an unsupported file", async () => {
  const { validateBackup } = await importTypeScript("../app/lib/storage.ts");
  const backup = validateBackup({
    format: "yantu-backup",
    version: 1,
    exportedAt: "2026-08-12T20:00:00.000Z",
    data: { meta: {}, goal: null, subjects: [] },
  });
  assert.deepEqual(backup.data.tasks, []);
  assert.deepEqual(backup.data.repeatRules, []);
  assert.deepEqual(backup.data.reviewPlans, []);
  assert.deepEqual(backup.data.taskCheckins, []);
  assert.deepEqual(backup.data.studyReviews, []);
  assert.deepEqual(backup.data.abilitySheets, []);
  assert.deepEqual(backup.data.examRecords, []);
  assert.equal(backup.data.reviewPlanTemplates.length, 1);
  assert.equal(backup.data.reviewPlanTemplates[0].name, "艾宾浩斯计划");
  assert.deepEqual(backup.data.reviewPlanTemplates[0].intervalsDays, [1, 2, 4, 7, 15, 30]);
  assert.throws(() => validateBackup({ format: "other", version: 1, data: {} }), /不是受支持/);
});

test("review schedules normalize intervals and preserve local calendar dates", async () => {
  const { addReviewDays, defaultReviewPlanTemplates, EBBINGHAUS_INTERVALS, normalizeReviewIntervals } = await importTypeScript("../app/lib/reviews.ts");
  assert.deepEqual(normalizeReviewIntervals("7, 1，3, 3, 0, 366"), [1, 3, 7]);
  assert.deepEqual([...EBBINGHAUS_INTERVALS], [1, 2, 4, 7, 15, 30]);
  assert.deepEqual(defaultReviewPlanTemplates("2026-08-13T00:00:00.000Z")[0].intervalsDays, [1, 2, 4, 7, 15, 30]);
  assert.equal(addReviewDays("2026-08-30", 2), "2026-09-01");
});

test("data health check finds broken hierarchy, duplicate schedules and abnormal dates", async () => {
  const { analyzeDataHealth } = await importTypeScript("../app/lib/data-health.ts");
  const snapshot = {
    meta: {}, goal: null,
    subjects: [{ id: "math", name: "数学", targetStartDate: "2026-09-01", targetDate: "2026-08-01" }],
    stages: [], contentNodes: [],
    tasks: [{ id: "task", title: "真题", subjectId: "math", parentTaskId: "missing", deadline: "2026-08-10" }],
    taskSchedules: [
      { id: "s1", taskId: "task", plannedDate: "2026-08-12" },
      { id: "s2", taskId: "task", plannedDate: "2026-08-13" },
    ],
    repeatRules: [{ id: "r1", taskId: "missing" }], studySessions: [], dailyTargets: [],
  };
  const issues = analyzeDataHealth(snapshot);
  assert.ok(issues.some((issue) => issue.title === "科目日期范围颠倒"));
  assert.ok(issues.some((issue) => issue.title === "任务的上级不存在"));
  assert.ok(issues.some((issue) => issue.title === "任务存在重复日程"));
  assert.ok(issues.some((issue) => issue.title === "计划日期晚于截止日期"));
  assert.ok(issues.some((issue) => issue.title === "重复规则缺少任务"));
});
