# Learnings

## [LRN-20260813-004] correction

**Logged**: 2026-08-13T16:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Hourglass realism requires clean physical geometry; decorative curved reflections and smooth water-like piles undermine the sand metaphor.

### Details
The lower glass reflection and quadratic pile silhouette read as an unexplained curved shape. The sand pile should use straight repose-angle slopes, while airborne material should be made of many small low-opacity grains instead of large haze circles.

### Suggested Action
Keep the lower glass free of decorative internal curves, render the settled pile with straight slopes, and reserve subtle fine-grain drift for the falling impact area.

### Metadata
- Source: user_feedback
- Related Files: app/components/StudyApp.tsx
- Tags: focus, hourglass, canvas, realism
- Pattern-Key: ui.hourglass_physical_geometry
- Recurrence-Count: 1
- First-Seen: 2026-08-13
- Last-Seen: 2026-08-13

### Resolution
- **Resolved**: 2026-08-13T16:30:00+08:00
- **Notes**: Removed the lower curved reflection, replaced the curved pile with straight slopes, and reduced airborne grain size.

---

## [LRN-20260816-001] correction

**Logged**: 2026-08-16T12:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
时长输入的 `min` 与 `step` 必须共享合法基准，常用固定时长优先使用产品内选择器，避免把浏览器校验术语暴露给用户。

### Details
`min="1" step="5"` 只接受 1、6、11……，导致默认 50 分钟也被浏览器判为无效并提示“最近有效值为 46 和 51”。同一轮反馈还再次说明：参考图中的圆点卡是结构约束，不能用边框长轨道或弱对比圆点近似替代。

### Resolution
专注与休息设置改为常用时长选择器，旧数据进入设置时归一到最近常用值；倒计时输入改为 `min="5" step="5"`。备考进度卡去掉上下轨道，恢复固定尺寸圆点、月份竖分隔和三列底部数据。

### Metadata
- Source: user_feedback
- Related Files: app/components/StudyApp.tsx, app/globals.css, tests/rendered-html.test.mjs
- Tags: validation, duration, design-reference, progress-matrix
- Pattern-Key: forms.duration_step_alignment
- Recurrence-Count: 1
- First-Seen: 2026-08-16
- Last-Seen: 2026-08-16

---

## 2026-08-13 — 明确任务完成入口，避免多个页面职责混乱

- 日历的“今日任务列表”是日常完成和打卡的唯一主要入口；仪表盘只做快速预览，周视图只做查看。
- 普通任务使用可撤销的勾选框，不显示进度条；量化任务不显示勾选框，以“每日最低完成量”作为当天打卡阈值。
- 科目任务列表与日任务列表应共享任务标题、科目、阶段、内容、标签、时长、截止日期等信息表达；只有科目计划保留“＋下级”。
- 复习计划属于任务设置，通过设置页维护可复用模板，完成源任务后再生成复习任务，避免在任务行堆叠临时配置入口。

---

## 2026-08-13 · 任务树布局与计时显示

- 任务树同时包含拖拽把手、展开控件、标题和进度控件时，CSS grid 必须显式声明四列；三列声明会把标题推到右侧。
- 计时器在一小时以内使用 MM:SS，超过一小时再显示 HH:MM:SS，减少沉浸页视觉噪声。
- 用户明确不要加权任务进度时，汇总进度应改成直观的任务完成率，不再保留“按预计时长汇总”的文案。

## [LRN-20260813-003] correction

**Logged**: 2026-08-13T12:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Calendar period and presentation are independent controls, and calendar tasks are primary completion controls.

### Details
Day and week each require both task-list and timeline views. Month requires a standard month grid and a month timeline. One-time tasks complete with a check control, while quantity tasks expose their increment/decrement progress directly in the calendar. Subject tab clicks only switch subjects; editing remains a separate action. Subject target dates may be deadline-only or a start/end range.

### Suggested Action
Keep calendar mode and layout as separate state, reuse one completion component across calendar layouts, and test task/status/schedule updates from each entry point.

### Metadata
- Source: user_feedback
- Related Files: app/components/StudyApp.tsx, app/types/domain.ts, app/globals.css
- Tags: calendar, completion, data-linkage, subjects
- Pattern-Key: product.calendar-mode-vs-layout
- Recurrence-Count: 1
- First-Seen: 2026-08-13
- Last-Seen: 2026-08-13

### Resolution
- **Resolved**: 2026-08-13T12:45:00+08:00
- **Notes**: Added independent period/layout controls, calendar completion controls for both task modes, a standard month grid, separate subject switching/editing, and optional subject start dates.

---

## [LRN-20260813-002] correction

**Logged**: 2026-08-13T10:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Confirmed progress, focus, dialog, and scheduling visuals are product rules rather than optional decoration.

### Details
Quantity progress fills the whole task row instead of nesting a second progress card. Focus completion uses one continuous rectangular bar rather than square cells. Task scheduling uses a connected plan-date-to-deadline calendar with circular day cells and a selected-day count. All dialogs remain app-styled rather than browser prompt/confirm UI.

### Suggested Action
Keep these as reusable components and regression assertions across the task tree, dashboard, calendar, and focus views.

### Metadata
- Source: user_feedback
- Related Files: app/components/StudyApp.tsx, app/globals.css
- Tags: interaction, visual-language, regression
- Pattern-Key: product.confirmed-interaction-rules
- Recurrence-Count: 1
- First-Seen: 2026-08-13
- Last-Seen: 2026-08-13

---

## [LRN-20260812-001] correction

**Logged**: 2026-08-12T20:22:00+08:00
**Priority**: critical
**Status**: resolved
**Area**: frontend

### Summary
不能把自行收缩范围后的核心流程 MVP 表述为用户完整产品已经开发完成。

### Details
用户提供了含 87 个文字主题和 20 张 UI 参考图的 XMind，并要求先重构、再阶段式开发。实现时只覆盖了目标、科目、任务、计时和基础复盘，却弱化了用户明确要求的 UI 参考、日夜主题、完整日历、数据统计、导入、计时提醒等能力，随后又使用“第一版已完成/开发完成”的措辞，造成范围认知严重不一致。

第二次反馈进一步确认，视觉问题不只是“配色没有调好”，而是错误地混用了不同角色的参考图：图 15/16 是日间/夜间的主要配色依据，图 13/14 只参考布局，图 07 是反例，图 08 只参考收纳交互，图 17—20 明确忽略。后续必须先为每张参考图标注角色，再建立主题 token，并逐屏截图对照验收。

### Suggested Action
每个阶段交付前建立“原始需求—确认范围—已实现—未实现”的可追溯矩阵。只有矩阵中完整产品范围全部验收后才能称为“开发完成”；MVP 必须明确称为阶段版本，并在发布前展示未实现清单。视觉实现前必须逐张检查用户提供的参考图并确认视觉方向。

### Resolution
本轮按图 15/16 重建明暗主题 token，按图 08/09 把科目、阶段、学习内容和父子任务收为统一任务树，按图 10 实现计时进度驱动的动态沙漏，并通过本地页面截图逐屏验收。后续仍需维护完整差异清单，不把尚未实现的智能导入与 OCR 表述为已完成。

**Resolved**: 2026-08-12T23:05:00+08:00

### Metadata
- Source: user_feedback
- Related Files: app/components/StudyApp.tsx, app/globals.css, docs/data-model-v1.md
- Tags: scope, ui, requirements, acceptance
- Pattern-Key: product.scope_completion_claim
- Recurrence-Count: 2
- First-Seen: 2026-08-12
- Last-Seen: 2026-08-12

---

## [LRN-20260813-001] correction

**Logged**: 2026-08-13T00:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: ui-requirements

### Summary
任务层级、量化进度与专注计时的视觉隐喻必须严格区分，不能用额外虚拟目录或同一种动画替代用户指定的交互。

### Details
用户明确要求：任务树直接用展开和缩进表达父子关系，不增加“直接属于科目”等虚拟层级；量化任务使用可加减的填充式可视化；倒计时使用真实沙粒沙漏，正计时使用每秒翻动的极简翻页时钟；今日专注量按每小时一格、15 分钟四分之一格表示。此前实现混用了水滴感沙漏、通用进度条和额外目录，虽然数据逻辑可用，但偏离了用户给出的视觉与层级要求。

### Suggested Action
涉及参考图时，先把每张图拆成“必须保留的交互语义”和“只作风格参考的装饰”，逐项建立验收点。层级结构不得为了技术分组制造用户看不见的概念；不同计时模式应使用不同且一眼可辨的视觉组件。

### Resolution
已删除任务树虚拟层，重做量化任务步进卡、分组式任务编辑器、沙粒沙漏、正计时翻页时钟和按四分之一小时点亮的今日专注方格。

### Metadata
- Source: user_feedback
- Related Files: app/components/StudyApp.tsx, app/globals.css
- Tags: task-tree, quantity-progress, focus-timer, visual-metaphor
- Pattern-Key: ui.reference_semantics
- Recurrence-Count: 1
- First-Seen: 2026-08-13
- Last-Seen: 2026-08-13

---

## [LRN-20260812-002] correction

**Logged**: 2026-08-12T23:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: requirements

### Summary
不能把用户要求“分析的概念”或“未来可能的 AI 能力”误报为 XMind 当前必须实现的功能。

### Details
用户的长产品设计任务要求分析错题、模拟考试、里程碑，并区分后续 AI 能力；这些是设计审查范围，不等于已经确定的当前开发范围。XMind 本身没有要求独立错题、模拟考试、里程碑模块，也没有要求当前实现 AI 自动拆解与重新规划。此前把它们写进“XMind 尚未完成要求”造成了错误的需求归因。

### Suggested Action
需求核对表固定区分三种来源：XMind 明确要求、用户后续确认、仅供分析或未来讨论。只有前两类可以进入当前验收范围；第三类必须标记为候选，未经用户确认不得写成遗漏或缺陷。

### Resolution
已修正功能请求记录和交付口径；本轮重新建立逐项需求矩阵，并从 XMind 当前遗漏清单中删除错题、模拟考试、里程碑和 AI 重新规划。
**Resolved**: 2026-08-12T23:30:00+08:00

### Metadata
- Source: user_feedback
- Related Files: .learnings/FEATURE_REQUESTS.md, docs/data-model-v1.md
- Tags: requirements, scope, provenance, correction
- Pattern-Key: requirements.analysis_vs_implementation
- Recurrence-Count: 1
- First-Seen: 2026-08-12
- Last-Seen: 2026-08-12

---
## 2026-08-13 — 视觉参考必须转化为明确交互约束

- 用户给出的参考图不是“相似即可”的装饰意见，而是对组件形态、信息密度和交互层级的明确约束。
- 专注页的方块只用于展示已完成时长；目标时长应使用小时/分钟设置，不应重复做一组静态方块。
- 量化任务应是紧凑的任务卡式步进控件，不能退化成长条进度条；深色模式下必须用主题前景色，避免进度填充后文字失去对比度。
- 浏览器原生 `prompt`、`confirm` 和展开的原生 `select` 会破坏统一视觉，产品级界面应使用系统内弹窗与自定义选择器。
- 计时开始后的“沉浸”意味着隐藏导航、标题和统计等无关内容，只保留计时视觉、当前任务和必要控制。

## 2026-08-13 — 悬浮窗必须区分网页可控区与浏览器安全区

- Document Picture-in-Picture 的来源网址栏由浏览器强制显示，网页不能隐藏、覆盖或伪装。
- 可以优化的是网址栏下方的内容：缩短默认高度、把画质和尺寸控制压成图标、确保时间在最小窗口仍完整显示。
- 对这类浏览器限制应直接解释清楚，同时给出不削弱安全边界的最佳实现，避免承诺无法完成的“去网址栏”。

## 2026-08-13 — 任务分类不是可执行任务

- 科目、阶段、任务分类和任务必须在数据语义与界面操作上分开；“马原 / 思修 / 史纲”等可作为分类节点，不应出现完成按钮、预计时长或打卡状态。
- 分类应提供独立的添加入口，既有误建任务需要可控的“转为任务分类”迁移操作，不能靠名称猜测并自动改数据。
- 任务的低频结构操作（复制、添加下级、转为分类）应收进右键菜单，常驻区域只保留完成或量化打卡等高频执行操作。
- 量化任务的“今日达标”与长期累计完成度是两套状态，必须用按日期的独立打卡记录保存，不能用任务全局完成状态替代。
# 2026-08-13 — Separate visual hierarchy from executable hierarchy

When a planning product has non-executable category nodes and executable task nodes, the category UI should not reuse the task's completion affordances or high-salience subject accent. Use a calmer container style, explicit category label, and a dedicated drag target; keep check-in controls exclusive to tasks.

## [LRN-20260814-001] correction

**Logged**: 2026-08-14T09:00:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: frontend

### Summary
层级任务拖拽不能只验证“拖进某任务成为下级”，还必须覆盖同级前后排序、跨层级移动和控件点击冲突。

### Details
用户反馈嵌套任务拖到同级任务前后时失败。当前整行可拖动，容易与编辑、完成和数量步进按钮冲突；排序逻辑位于页面组件内部，缺少针对同级、跨级、循环引用和原层级顺序归一化的单元测试。

### Suggested Action
仅让明确的拖动手柄启动拖拽；把任务移动整理为纯数据函数；每次移动同时归一化来源和目标层级排序，并用自动测试覆盖同级前后、跨级和非法循环。

### Resolution
已将移动逻辑提取为 `moveTaskInHierarchy`，拖拽改为仅由手柄启动，并新增同级前后移动、跨层级移动、子树分类同步和循环引用拒绝测试。

### Metadata
- Source: user_feedback
- Related Files: app/components/StudyApp.tsx, app/lib/tasks.ts, tests/domain-logic.test.mjs
- Tags: task-tree, drag-drop, hierarchy, sorting
- Pattern-Key: task_tree.drag_reorder_integrity
- Recurrence-Count: 1
- First-Seen: 2026-08-14
- Last-Seen: 2026-08-14

---
