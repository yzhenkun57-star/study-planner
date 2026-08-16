export type Goal = {
  id: "current-goal";
  name: string;
  targetStartDate?: string;
  examDate: string;
  school?: string;
  major?: string;
  targetScore?: number;
  createdAt: string;
  updatedAt: string;
};

export type Subject = {
  id: string;
  name: string;
  color: string;
  targetScore?: number;
  targetStartDate?: string;
  targetDate?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Stage = {
  id: string;
  subjectId: string;
  name: string;
  startDate?: string;
  endDate?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ContentNode = {
  id: string;
  subjectId: string;
  parentId?: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskCompletionMode = "check" | "quantity";
export type TaskStatus = "active" | "completed" | "cancelled" | "archived";
export type MasteryLevel = "not_yet" | "developing" | "mastered";

export type Task = {
  id: string;
  title: string;
  subjectId: string;
  parentTaskId?: string;
  stageId?: string;
  contentNodeId?: string;
  completionMode: TaskCompletionMode;
  status: TaskStatus;
  estimatedMinutes?: number;
  deadline?: string;
  autoRollover: boolean;
  includeInProgress: boolean;
  progressStart?: number;
  progressCurrent?: number;
  progressTarget?: number;
  progressUnit?: string;
  progressStep?: number;
  dailyMinimum?: number;
  reviewPlanTemplateId?: string;
  repeatedFromTaskId?: string;
  sortOrder?: number;
  mastery?: MasteryLevel;
  note?: string;
  important?: boolean;
  tags?: string[];
  completedAt?: string;
  deletedAt?: string;
  statusBeforeDelete?: "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

export type ReviewPlanTemplate = {
  id: string;
  name: string;
  intervalsDays: number[];
  enabled: boolean;
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RepeatRule = {
  id: string;
  taskId: string;
  frequency: "daily" | "weekly" | "interval";
  intervalDays?: number;
  weekdays?: number[];
  endsOn?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewPlan = {
  id: string;
  sourceTaskId: string;
  mode: "ebbinghaus" | "custom";
  baseDate: string;
  intervalsDays: number[];
  createdTaskIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type TaskSchedule = {
  id: string;
  taskId: string;
  plannedDate: string;
  originalPlannedDate: string;
  timeMode?: "none" | "point" | "range";
  plannedStartMinute?: number;
  plannedDurationMinutes?: number;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
  rolloverCount: number;
  totalDelayedDays: number;
  createdAt: string;
  updatedAt: string;
};

export type AppMeta = {
  id: "app-meta";
  schemaVersion: number;
  onboardingComplete: boolean;
  workspaceMode?: "exam" | "life";
  lastBackupAt?: string;
  theme?: "light" | "dark";
  sidebarCollapsed?: boolean;
  completedTaskPlacement?: "inline" | "separate";
  focusSettings?: {
    focusMinutes: number;
    restMinutes: number;
    countupReminderMinutes: number;
    pauseReminderMinutes?: number;
    soundEnabled: boolean;
    hourglassQuality?: "balanced" | "high";
  };
  studyTargets?: {
    weeklyMinutes?: number;
    monthlyMinutes?: number;
  };
  activeTimer?: {
    subjectId: string;
    taskId?: string;
    kind?: "focus" | "rest";
    sessionStartedAt?: string;
    startedAt: string;
    mode?: "countup" | "countdown";
    targetMinutes?: number;
    accumulatedSeconds?: number;
    pausedAt?: string;
  };
  updatedAt: string;
};

export type StudySession = {
  id: string;
  subjectId: string;
  taskId?: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  createdAt: string;
  updatedAt: string;
};

export type DailyTarget = {
  id: string;
  date: string;
  targetMinutes: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskCheckin = {
  id: string;
  taskId: string;
  date: string;
  quantity: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReviewPeriod = "daily" | "weekly";
export type ReviewVarianceReason = "高估时间" | "临时任务" | "状态不佳" | "任务难度超预期";

export type StudyReview = {
  id: string;
  period: ReviewPeriod;
  periodStart: string;
  periodEnd: string;
  subjectId?: string;
  plannedMinutes: number;
  actualMinutes: number;
  completedTasks: number;
  totalTasks: number;
  varianceReasons: ReviewVarianceReason[];
  note?: string;
  nextAction?: string;
  createdAt: string;
  updatedAt: string;
};

export type AbilitySheetKind = "exam" | "workbook" | "custom";
export type AbilityVisualization = "trend" | "bars" | "progress" | "breakdown" | "distribution";

export type AbilityCustomColumn = {
  id: string;
  label: string;
  type: "text" | "number";
};

export type AbilityDataSheet = {
  id: string;
  subjectId: string;
  name: string;
  kind: AbilitySheetKind;
  hierarchyLabels: string[];
  customColumns: AbilityCustomColumn[];
  valueLabel: string;
  totalLabel: string;
  enabledVisualizations: AbilityVisualization[];
  defaultVisualization: AbilityVisualization;
  createdAt: string;
  updatedAt: string;
};

export type ExamRecord = {
  id: string;
  subjectId: string;
  sheetId?: string;
  recordKind?: AbilitySheetKind;
  title: string;
  paperType: "mock" | "past";
  examDate: string;
  score: number;
  fullScore: number;
  hierarchyValues?: string[];
  customValues?: Record<string, string>;
  durationMinutes?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSnapshot = {
  meta: AppMeta;
  goal: Goal | null;
  subjects: Subject[];
  stages: Stage[];
  contentNodes: ContentNode[];
  tasks: Task[];
  taskSchedules: TaskSchedule[];
  repeatRules: RepeatRule[];
  reviewPlans: ReviewPlan[];
  reviewPlanTemplates: ReviewPlanTemplate[];
  studySessions: StudySession[];
  dailyTargets: DailyTarget[];
  taskCheckins: TaskCheckin[];
  studyReviews: StudyReview[];
  abilitySheets: AbilityDataSheet[];
  examRecords: ExamRecord[];
};

export type AppExportV1 = {
  format: "yantu-backup";
  version: 1;
  exportedAt: string;
  data: AppSnapshot;
};
