import type { AbilityDataSheet, AppExportV1, AppMeta, AppSnapshot, ContentNode, DailyTarget, ExamRecord, Goal, RepeatRule, ReviewPlan, ReviewPlanTemplate, Stage, StudyReview, StudySession, Subject, Task, TaskCheckin, TaskSchedule } from "../types/domain";

function defaultReviewPlanTemplates(now = new Date().toISOString()): ReviewPlanTemplate[] {
  return [{ id: "review-template-ebbinghaus", name: "艾宾浩斯计划", intervalsDays: [1, 2, 4, 7, 15, 30], enabled: true, builtIn: true, createdAt: now, updatedAt: now }];
}

const DB_NAME = "yantu-study-planner";
      // 1: goal/subjects, 2: tasks/schedules, 3: sessions/targets,
      // 4: stages/content nodes, 5: repeat rules, 6: review plans, 7: review templates, 8: daily task check-ins, 9: study reviews, 10: exam records, 11: ability data sheets.
// Always bump this when a new object store or index is introduced.
const DB_VERSION = 11;
const META = "meta";
const GOALS = "goals";
const SUBJECTS = "subjects";
const STAGES = "stages";
const CONTENT_NODES = "contentNodes";
const TASKS = "tasks";
const TASK_SCHEDULES = "taskSchedules";
const STUDY_SESSIONS = "studySessions";
const DAILY_TARGETS = "dailyTargets";
const REPEAT_RULES = "repeatRules";
const REVIEW_PLANS = "reviewPlans";
const REVIEW_PLAN_TEMPLATES = "reviewPlanTemplates";
const TASK_CHECKINS = "taskCheckins";
const STUDY_REVIEWS = "studyReviews";
const ABILITY_SHEETS = "abilitySheets";
const EXAM_RECORDS = "examRecords";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("浏览器数据读取失败"));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("浏览器数据保存失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("浏览器数据保存已取消"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(GOALS)) db.createObjectStore(GOALS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SUBJECTS)) {
        const subjects = db.createObjectStore(SUBJECTS, { keyPath: "id" });
        subjects.createIndex("sortOrder", "sortOrder");
      }
      if (!db.objectStoreNames.contains(STAGES)) {
        const stages = db.createObjectStore(STAGES, { keyPath: "id" });
        stages.createIndex("subjectId", "subjectId");
      }
      if (!db.objectStoreNames.contains(CONTENT_NODES)) {
        const nodes = db.createObjectStore(CONTENT_NODES, { keyPath: "id" });
        nodes.createIndex("subjectId", "subjectId");
        nodes.createIndex("parentId", "parentId");
      }
      if (!db.objectStoreNames.contains(TASKS)) {
        const tasks = db.createObjectStore(TASKS, { keyPath: "id" });
        tasks.createIndex("subjectId", "subjectId");
        tasks.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains(TASK_SCHEDULES)) {
        const schedules = db.createObjectStore(TASK_SCHEDULES, { keyPath: "id" });
        schedules.createIndex("taskId", "taskId", { unique: true });
        schedules.createIndex("plannedDate", "plannedDate");
      }
      if (!db.objectStoreNames.contains(REPEAT_RULES)) {
        const repeats = db.createObjectStore(REPEAT_RULES, { keyPath: "id" });
        repeats.createIndex("taskId", "taskId", { unique: true });
      }
      if (!db.objectStoreNames.contains(REVIEW_PLANS)) {
        const reviews = db.createObjectStore(REVIEW_PLANS, { keyPath: "id" });
        reviews.createIndex("sourceTaskId", "sourceTaskId");
      }
      if (!db.objectStoreNames.contains(REVIEW_PLAN_TEMPLATES)) db.createObjectStore(REVIEW_PLAN_TEMPLATES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TASK_CHECKINS)) {
        const checkins = db.createObjectStore(TASK_CHECKINS, { keyPath: "id" });
        checkins.createIndex("taskId", "taskId");
        checkins.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains(STUDY_SESSIONS)) {
        const sessions = db.createObjectStore(STUDY_SESSIONS, { keyPath: "id" });
        sessions.createIndex("subjectId", "subjectId");
        sessions.createIndex("startedAt", "startedAt");
      }
      if (!db.objectStoreNames.contains(DAILY_TARGETS)) {
        const targets = db.createObjectStore(DAILY_TARGETS, { keyPath: "id" });
        targets.createIndex("date", "date", { unique: true });
      }
      if (!db.objectStoreNames.contains(STUDY_REVIEWS)) {
        const reviews = db.createObjectStore(STUDY_REVIEWS, { keyPath: "id" });
        reviews.createIndex("periodStart", "periodStart");
        reviews.createIndex("subjectId", "subjectId");
      }
      if (!db.objectStoreNames.contains(EXAM_RECORDS)) {
        const records = db.createObjectStore(EXAM_RECORDS, { keyPath: "id" });
        records.createIndex("subjectId", "subjectId");
        records.createIndex("examDate", "examDate");
      }
      if (!db.objectStoreNames.contains(ABILITY_SHEETS)) {
        const sheets = db.createObjectStore(ABILITY_SHEETS, { keyPath: "id" });
        sheets.createIndex("subjectId", "subjectId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开浏览器本地数据库"));
  });
}

export function emptySnapshot(): AppSnapshot {
  return {
    meta: {
      id: "app-meta",
      schemaVersion: DB_VERSION,
      onboardingComplete: false,
      updatedAt: new Date().toISOString(),
    },
    goal: null,
    subjects: [],
    stages: [],
    contentNodes: [],
    tasks: [],
    taskSchedules: [],
    repeatRules: [],
    reviewPlans: [],
    reviewPlanTemplates: defaultReviewPlanTemplates(),
    studySessions: [],
    dailyTargets: [],
    taskCheckins: [],
    studyReviews: [],
    abilitySheets: [],
    examRecords: [],
  };
}

export async function loadSnapshot(): Promise<AppSnapshot> {
  const db = await openDb();
  try {
    const tx = db.transaction([META, GOALS, SUBJECTS, STAGES, CONTENT_NODES, TASKS, TASK_SCHEDULES, REPEAT_RULES, REVIEW_PLANS, REVIEW_PLAN_TEMPLATES, STUDY_SESSIONS, DAILY_TARGETS, TASK_CHECKINS, STUDY_REVIEWS, ABILITY_SHEETS, EXAM_RECORDS], "readonly");
    const [meta, goal, subjects, stages, contentNodes, tasks, taskSchedules, repeatRules, reviewPlans, reviewPlanTemplates, studySessions, dailyTargets, taskCheckins, studyReviews, abilitySheets, examRecords] = await Promise.all([
      requestResult(tx.objectStore(META).get("app-meta")) as Promise<AppMeta | undefined>,
      requestResult(tx.objectStore(GOALS).get("current-goal")) as Promise<Goal | undefined>,
      requestResult(tx.objectStore(SUBJECTS).getAll()) as Promise<Subject[]>,
      requestResult(tx.objectStore(STAGES).getAll()) as Promise<Stage[]>,
      requestResult(tx.objectStore(CONTENT_NODES).getAll()) as Promise<ContentNode[]>,
      requestResult(tx.objectStore(TASKS).getAll()) as Promise<Task[]>,
      requestResult(tx.objectStore(TASK_SCHEDULES).getAll()) as Promise<TaskSchedule[]>,
      requestResult(tx.objectStore(REPEAT_RULES).getAll()) as Promise<RepeatRule[]>,
      requestResult(tx.objectStore(REVIEW_PLANS).getAll()) as Promise<ReviewPlan[]>,
      requestResult(tx.objectStore(REVIEW_PLAN_TEMPLATES).getAll()) as Promise<ReviewPlanTemplate[]>,
      requestResult(tx.objectStore(STUDY_SESSIONS).getAll()) as Promise<StudySession[]>,
      requestResult(tx.objectStore(DAILY_TARGETS).getAll()) as Promise<DailyTarget[]>,
      requestResult(tx.objectStore(TASK_CHECKINS).getAll()) as Promise<TaskCheckin[]>,
      requestResult(tx.objectStore(STUDY_REVIEWS).getAll()) as Promise<StudyReview[]>,
      requestResult(tx.objectStore(ABILITY_SHEETS).getAll()) as Promise<AbilityDataSheet[]>,
      requestResult(tx.objectStore(EXAM_RECORDS).getAll()) as Promise<ExamRecord[]>,
    ]);
    await txDone(tx);
    return {
      meta: meta ? { ...meta, schemaVersion: DB_VERSION } : emptySnapshot().meta,
      goal: goal ?? null,
      subjects: subjects.sort((a, b) => a.sortOrder - b.sortOrder),
      stages: stages.sort((a, b) => a.sortOrder - b.sortOrder),
      contentNodes: contentNodes.sort((a, b) => a.sortOrder - b.sortOrder),
      tasks: tasks.map((task) => task.completionMode === "quantity" && task.status === "completed" && (task.progressCurrent ?? task.progressStart ?? 0) < (task.progressTarget ?? 0)
        ? { ...task, status: "active" as const, completedAt: undefined }
        : task),
      taskSchedules,
      repeatRules,
      reviewPlans,
      reviewPlanTemplates: reviewPlanTemplates.length ? reviewPlanTemplates : defaultReviewPlanTemplates(),
      studySessions,
      dailyTargets,
      taskCheckins,
      studyReviews,
      abilitySheets,
      examRecords,
    };
  } finally {
    db.close();
  }
}

export async function saveSnapshot(snapshot: AppSnapshot): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([META, GOALS, SUBJECTS, STAGES, CONTENT_NODES, TASKS, TASK_SCHEDULES, REPEAT_RULES, REVIEW_PLANS, REVIEW_PLAN_TEMPLATES, STUDY_SESSIONS, DAILY_TARGETS, TASK_CHECKINS, STUDY_REVIEWS, ABILITY_SHEETS, EXAM_RECORDS], "readwrite");
    tx.objectStore(META).put(snapshot.meta);
    tx.objectStore(GOALS).clear();
    if (snapshot.goal) tx.objectStore(GOALS).put(snapshot.goal);
    const subjectsStore = tx.objectStore(SUBJECTS);
    subjectsStore.clear();
    for (const subject of snapshot.subjects) subjectsStore.put(subject);
    const stagesStore = tx.objectStore(STAGES);
    stagesStore.clear();
    for (const stage of snapshot.stages) stagesStore.put(stage);
    const contentStore = tx.objectStore(CONTENT_NODES);
    contentStore.clear();
    for (const node of snapshot.contentNodes) contentStore.put(node);
    const tasksStore = tx.objectStore(TASKS);
    tasksStore.clear();
    for (const task of snapshot.tasks) tasksStore.put(task);
    const schedulesStore = tx.objectStore(TASK_SCHEDULES);
    schedulesStore.clear();
    for (const schedule of snapshot.taskSchedules) schedulesStore.put(schedule);
    const repeatsStore = tx.objectStore(REPEAT_RULES);
    repeatsStore.clear();
    for (const rule of snapshot.repeatRules) repeatsStore.put(rule);
    const reviewPlansStore = tx.objectStore(REVIEW_PLANS);
    reviewPlansStore.clear();
    for (const plan of snapshot.reviewPlans) reviewPlansStore.put(plan);
    const reviewTemplatesStore = tx.objectStore(REVIEW_PLAN_TEMPLATES);
    reviewTemplatesStore.clear();
    for (const template of snapshot.reviewPlanTemplates) reviewTemplatesStore.put(template);
    const sessionsStore = tx.objectStore(STUDY_SESSIONS);
    sessionsStore.clear();
    for (const session of snapshot.studySessions) sessionsStore.put(session);
    const targetsStore = tx.objectStore(DAILY_TARGETS);
    targetsStore.clear();
    for (const target of snapshot.dailyTargets) targetsStore.put(target);
    const checkinsStore = tx.objectStore(TASK_CHECKINS);
    checkinsStore.clear();
    for (const checkin of snapshot.taskCheckins) checkinsStore.put(checkin);
    const studyReviewsStore = tx.objectStore(STUDY_REVIEWS);
    studyReviewsStore.clear();
    for (const review of snapshot.studyReviews) studyReviewsStore.put(review);
    const abilitySheetsStore = tx.objectStore(ABILITY_SHEETS);
    abilitySheetsStore.clear();
    for (const sheet of snapshot.abilitySheets) abilitySheetsStore.put(sheet);
    const examRecordsStore = tx.objectStore(EXAM_RECORDS);
    examRecordsStore.clear();
    for (const record of snapshot.examRecords) examRecordsStore.put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export function makeBackup(snapshot: AppSnapshot): AppExportV1 {
  return { format: "yantu-backup", version: 1, exportedAt: new Date().toISOString(), data: snapshot };
}

export function validateBackup(value: unknown): AppExportV1 {
  if (!value || typeof value !== "object") throw new Error("备份文件内容无效");
  const backup = value as Partial<AppExportV1>;
  if (backup.format !== "yantu-backup" || backup.version !== 1 || !backup.data) {
    throw new Error("这不是受支持的考研系统备份文件");
  }
  const data = backup.data as AppSnapshot;
  if (!data.meta || !Array.isArray(data.subjects)) throw new Error("备份文件缺少必要数据");
  if (data.goal && (!data.goal.name || !data.goal.examDate)) throw new Error("备份中的考研目标不完整");
  return {
    ...(backup as AppExportV1),
    data: {
      ...data,
      stages: Array.isArray(data.stages) ? data.stages : [],
      contentNodes: Array.isArray(data.contentNodes) ? data.contentNodes : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      taskSchedules: Array.isArray(data.taskSchedules) ? data.taskSchedules : [],
      repeatRules: Array.isArray(data.repeatRules) ? data.repeatRules : [],
      reviewPlans: Array.isArray(data.reviewPlans) ? data.reviewPlans : [],
      reviewPlanTemplates: Array.isArray(data.reviewPlanTemplates) && data.reviewPlanTemplates.length ? data.reviewPlanTemplates : defaultReviewPlanTemplates(),
      studySessions: Array.isArray(data.studySessions) ? data.studySessions : [],
      dailyTargets: Array.isArray(data.dailyTargets) ? data.dailyTargets : [],
      taskCheckins: Array.isArray(data.taskCheckins) ? data.taskCheckins : [],
      studyReviews: Array.isArray(data.studyReviews) ? data.studyReviews : [],
      abilitySheets: Array.isArray(data.abilitySheets) ? data.abilitySheets : [],
      examRecords: Array.isArray(data.examRecords) ? data.examRecords : [],
    },
  };
}
