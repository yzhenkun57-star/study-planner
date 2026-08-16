# Feature Requests

## [FEAT-20260814-002] adjustable-progress-scale-and-task-tree-filters

**Logged**: 2026-08-14T10:20:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability
考研进度矩阵可切换每点代表一天或一周；统计合并计划与实际；日时间轴双击进入时长调整；科目任务树增加今日、未安排和逾期筛选。

### User Context
用户需要在宏观动力、真实执行和任务整理之间快速切换，同时避免时间轴调整手柄长期占用视觉空间。

### Complexity Estimate
medium

### Suggested Implementation
矩阵按选择的时间单位动态生成点阵；周复盘合并为横向计划完成进度；日时间轴使用显式编辑态；任务树在阶段筛选旁增加独立的日程状态筛选。

### Resolution
Implemented day/week matrix density controls, a merged horizontal planned-versus-actual review metric, explicit double-click timeline resizing, and task-tree schedule filters with visible result counts and reset behavior.

### Metadata
- Frequency: first_time
- Related Features: dashboard, analytics, calendar, subject-task-tree

---

## [FEAT-20260814-001] dashboard-progress-flip-and-trash-tools

**Logged**: 2026-08-14T09:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability
仪表盘中可点击修改考试日期和院校专业；今日执行卡可翻转为备考天数矩阵；最近删除支持搜索、科目筛选和批量恢复。

### User Context
用户希望首页同时提供每日执行与长期备考动力，并减少误删恢复时的查找成本。

### Complexity Estimate
medium

### Suggested Implementation
使用统一应用弹窗编辑考研目标；按备考日期范围生成单日矩阵并与今日执行卡做可访问的翻转切换；在最近删除中增加本地过滤、选择和批量恢复。

### Resolution
已实现院校专业与考试日期快捷编辑、今日执行/年度进度矩阵翻转卡，以及最近删除的搜索、科目筛选、当前结果全选和批量恢复。

### Metadata
- Frequency: first_time
- Related Features: dashboard, goal, settings, task-recovery

---

## [FEAT-20260813-002] macro-roadmap-and-task-review

**Logged**: 2026-08-13T16:10:00+08:00
**Priority**: high
**Status**: completed
**Area**: frontend

### Requested Capability
Show all subject study stages on one exam-date roadmap, complete and copy tasks inside the subject tree, and create Ebbinghaus or custom review schedules.

### User Context
The learner needs both a macro view of the remaining preparation period and fast execution controls without leaving the subject task tree.

### Complexity Estimate
complex

### Suggested Implementation
Use subject lanes on a shared date axis, persist review-plan metadata, and generate normal scheduled review tasks so calendar, completion, rollover, and statistics continue using the existing task model.

### Metadata
- Frequency: first_time
- Related Features: subjects, stages, calendar, task-completion

---

## [FEAT-20260813-001] advanced-calendar-and-focus-controls

**Logged**: 2026-08-13T10:00:00+08:00
**Priority**: high
**Status**: completed
**Area**: frontend

### Requested Capability
Connected task date ranges, time-point/time-range reminders, half-hour timeline drag/resize, two-level calendar navigation, and an always-on-top focus timer window.

### User Context
The system should support realistic daily study scheduling and keep a compact timer visible while the user works in other browser tabs or desktop applications.

### Complexity Estimate
complex

### Suggested Implementation
Extend local schedule records with start time, duration, and reminder settings; use a custom date-range calendar and timeline interactions; progressively enhance supported desktop Chromium browsers with Document Picture-in-Picture.

### Progress
已实现日期范围、时间点/时间段、半小时拖拽缩放、日周月双视图、日历筛选与打卡撤销、冲突建议、月历展开抽屉、悬浮计时及可选 WebGL 沙粒画质。浏览器安全网址栏无法由网页删除，已压缩悬浮窗内部布局。

### Metadata
- Frequency: first_time
- Related Features: task-scheduling, calendar, focus-timer

---

## [FEAT-20260812-001] complete-xmind-product-scope

**Logged**: 2026-08-12T20:22:00+08:00
**Priority**: critical
**Status**: in_progress
**Area**: frontend

### Requested Capability
按 XMind 的完整产品愿景继续实现，而非停在核心流程 MVP；UI 需要重新贴合 20 张参考图所体现的视觉方向。

### User Context
用户期望的是可长期使用的考研目标任务系统，包含日夜主题、今日/周/月日历、层级任务、完整统计、计时提醒和导入等，而不是普通卡片式 Todo 应用。

### Complexity Estimate
complex

### Suggested Implementation
先完成当前版本与 XMind 的差异审计和视觉方向稿；按 UI 基础、日历/任务、专注、统计、导入和设置六个批次逐项实现，每批独立验收并保留 IndexedDB 数据迁移。

### Progress
已完成 UI 基础、日历/任务层级、专注动态沙漏、基础统计、Markdown 导入和分类设置；XMind 当前范围内仍未实现 API 智能导入和图片 OCR。正式云同步按用户确认仅保留空壳。错题、模拟考试、里程碑和 AI 重新规划只在后续产品分析问题中出现，不能列为 XMind 当前开发遗漏。

### Metadata
- Frequency: first_time
- Related Features: current-mvp, calendar, analytics, themes, import

---
# 2026-08-15 — Prep range and analytics clarity

- The preparation start date is user-owned data and must drive both exam progress and the day/week matrix; partial weeks are intentionally excluded from weekly dot counts.
- Analytics should prioritize duration readability: rounded month heatmap cells, weekday/time-band summaries, and configurable score distribution visuals.
- Public deployment must be explicit about the difference between “public URL” and guaranteed reachability from every regional network.

---
# 2026-08-13 — Task-list completion placement

- Users need a global choice between keeping completed tasks in their original hierarchy and moving them into a separate completed section.
- This preference must affect both the subject task tree and the primary daily check-in list, while preserving the ability to reopen a completed task.

# 2026-08-13 — Categories must be real drag targets

- Task categories are organizational containers, not completable tasks.
- Dragging a task onto a category must update its category association, preserve its descendants, and visibly confirm the target before drop.

# 2026-08-15 — Compact exam progress matrix

- The exam progress card should remain a single continuous dot line with subtle month separators; month-by-month grid cards and duplicate empty-state CTAs add visual noise.
- Keep the configurable preparation start date as the source for the dot range, and exclude a trailing partial week from weekly counts.
