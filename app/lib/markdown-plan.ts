export type ParsedPlanSubject = { key: string; name: string };
export type ParsedPlanStage = { key: string; subjectKey: string; name: string };
export type ParsedPlanNode = { key: string; subjectKey: string; parentKey?: string; name: string };
export type ParsedPlanTask = {
  key: string;
  title: string;
  subjectKey: string;
  stageKey?: string;
  contentKey?: string;
  parentTaskKey?: string;
  estimatedMinutes?: number;
  plannedDate?: string;
  completed: boolean;
};

export type ParsedMarkdownPlan = {
  subjects: ParsedPlanSubject[];
  stages: ParsedPlanStage[];
  nodes: ParsedPlanNode[];
  tasks: ParsedPlanTask[];
  issues: string[];
};

function key(prefix: string, line: number, name: string) {
  return `${prefix}-${line}-${name}`;
}

export function parseMarkdownPlan(source: string): ParsedMarkdownPlan {
  const result: ParsedMarkdownPlan = { subjects: [], stages: [], nodes: [], tasks: [], issues: [] };
  let currentSubject: ParsedPlanSubject | undefined;
  let currentStage: ParsedPlanStage | undefined;
  let currentContentKey: string | undefined;
  const headingStack: { level: number; key: string }[] = [];
  const taskStack: { indent: number; key: string }[] = [];

  source.replace(/\r\n?/g, "\n").split("\n").forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim()) return;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const name = heading[2].trim();
      taskStack.length = 0;
      if (level === 1) {
        const subjectName = name.replace(/^科目[：:]\s*/, "").trim();
        currentSubject = { key: key("subject", lineNumber, subjectName), name: subjectName };
        result.subjects.push(currentSubject);
        currentStage = undefined;
        currentContentKey = undefined;
        headingStack.length = 0;
        return;
      }
      if (!currentSubject) {
        result.issues.push(`第 ${lineNumber} 行：学习内容“${name}”前缺少一级科目标题`);
        return;
      }
      const stageMatch = name.match(/^(?:阶段[：:]|\[阶段\]\s*)(.+)$/);
      if (stageMatch) {
        const stageName = stageMatch[1].trim();
        currentStage = { key: key("stage", lineNumber, stageName), subjectKey: currentSubject.key, name: stageName };
        result.stages.push(currentStage);
        currentContentKey = undefined;
        headingStack.length = 0;
        return;
      }
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      const node: ParsedPlanNode = { key: key("node", lineNumber, name), subjectKey: currentSubject.key, parentKey: headingStack.at(-1)?.key, name };
      result.nodes.push(node);
      headingStack.push({ level, key: node.key });
      currentContentKey = node.key;
      return;
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(?:\[([ xX])\]\s*)?(.+?)\s*$/);
    if (!bullet) {
      if (!/^>/.test(line.trim())) result.issues.push(`第 ${lineNumber} 行：无法识别“${line.trim().slice(0, 30)}”`);
      return;
    }
    if (!currentSubject) {
      result.issues.push(`第 ${lineNumber} 行：任务前缺少一级科目标题`);
      return;
    }
    const indent = bullet[1].length;
    const parts = bullet[3].split("|").map((part) => part.trim()).filter(Boolean);
    const title = parts.shift() ?? "";
    if (!title) {
      result.issues.push(`第 ${lineNumber} 行：任务名称为空`);
      return;
    }
    let estimatedMinutes: number | undefined;
    let plannedDate: string | undefined;
    for (const part of parts) {
      const minutes = part.match(/^(\d+)\s*(?:分钟|分|min|m)$/i);
      const hours = part.match(/^(\d+(?:\.\d+)?)\s*(?:小时|时|h)$/i);
      if (minutes) estimatedMinutes = Number(minutes[1]);
      else if (hours) estimatedMinutes = Math.round(Number(hours[1]) * 60);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(part)) plannedDate = part;
    }
    while (taskStack.length && taskStack[taskStack.length - 1].indent >= indent) taskStack.pop();
    const task: ParsedPlanTask = {
      key: key("task", lineNumber, title), title, subjectKey: currentSubject.key, stageKey: currentStage?.key,
      contentKey: currentContentKey, parentTaskKey: taskStack.at(-1)?.key,
      estimatedMinutes, plannedDate, completed: bullet[2]?.toLowerCase() === "x",
    };
    result.tasks.push(task);
    taskStack.push({ indent, key: task.key });
  });

  if (!result.subjects.length) result.issues.push("没有找到一级科目标题，例如：# 数学一");
  if (!result.tasks.length) result.issues.push("没有找到任务条目，例如：- [ ] 看完第一讲 | 60分钟 | 2026-08-15");
  return result;
}
