"use client";

import { FormEvent, useState } from "react";
import type {
  AbilityDataSheet,
  AbilitySheetKind,
  AbilityVisualization,
  AppSnapshot,
  ExamRecord,
} from "../types/domain";

const VISUALS: { id: AbilityVisualization; label: string; hint: string }[] = [
  { id: "trend", label: "趋势折线", hint: "观察多次记录的变化" },
  { id: "bars", label: "横向对比", hint: "快速比较每次表现" },
  { id: "progress", label: "综合进度", hint: "展示当前平均水平" },
  { id: "breakdown", label: "分类拆解", hint: "定位第一层级薄弱项" },
  { id: "distribution", label: "分数分布", hint: "查看成绩集中区间" },
];

type SheetDraft = {
  name: string;
  kind: AbilitySheetKind;
  hierarchyLabels: string;
  customColumns: string;
  valueLabel: string;
  totalLabel: string;
  enabledVisualizations: AbilityVisualization[];
  defaultVisualization: AbilityVisualization;
};

type RecordDraft = {
  title: string;
  examDate: string;
  score: string;
  fullScore: string;
  durationMinutes: string;
  note: string;
  hierarchyValues: string[];
  customValues: Record<string, string>;
};

function uid(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  const current = new Date();
  return new Date(current.getTime() - current.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function fullScoreFor(subjectName = "") {
  return /英语|政治/.test(subjectName) ? "100" : "150";
}

function createSheet(subjectId: string, kind: AbilitySheetKind, subjectName = "", id = uid("ability-sheet")): AbilityDataSheet {
  const now = new Date().toISOString();
  const base = {
    id,
    subjectId,
    kind,
    customColumns: [],
    enabledVisualizations: VISUALS.map((item) => item.id),
    defaultVisualization: "trend" as AbilityVisualization,
    createdAt: now,
    updatedAt: now,
  };
  if (kind === "workbook") {
    return { ...base, name: "习题册正确率", hierarchyLabels: ["习题册", "册次", "章节", "考点", "提醒"], valueLabel: "正确数", totalLabel: "总题数" };
  }
  if (kind === "custom") {
    return { ...base, name: "自定义能力表", hierarchyLabels: ["一级分类", "二级分类", "项目", "提醒"], valueLabel: "完成量", totalLabel: "目标量" };
  }
  return { ...base, name: `${subjectName || "科目"}试卷分数`, hierarchyLabels: ["年份", "试卷", "模块", "章节", "考点", "提醒"], valueLabel: "得分", totalLabel: "满分" };
}

function toSheetDraft(sheet: AbilityDataSheet): SheetDraft {
  return {
    name: sheet.name,
    kind: sheet.kind,
    hierarchyLabels: sheet.hierarchyLabels.join("，"),
    customColumns: sheet.customColumns.map((column) => `${column.label}${column.type === "number" ? "#" : ""}`).join("，"),
    valueLabel: sheet.valueLabel,
    totalLabel: sheet.totalLabel,
    enabledVisualizations: sheet.enabledVisualizations,
    defaultVisualization: sheet.defaultVisualization,
  };
}

function blankRecord(sheet: AbilityDataSheet, subjectName = ""): RecordDraft {
  return {
    title: "",
    examDate: today(),
    score: "",
    fullScore: sheet.kind === "exam" ? fullScoreFor(subjectName) : "",
    durationMinutes: "",
    note: "",
    hierarchyValues: sheet.hierarchyLabels.map(() => ""),
    customValues: Object.fromEntries(sheet.customColumns.map((column) => [column.id, ""])),
  };
}

function rate(record: ExamRecord) {
  return record.fullScore > 0 ? Math.max(0, Math.min(100, record.score / record.fullScore * 100)) : 0;
}

function pct(value: number) {
  return `${Math.round(value)}%`;
}

export function ScoreAnalytics({ snapshot, persist, onBack }: {
  snapshot: AppSnapshot;
  persist: (next: AppSnapshot) => Promise<void>;
  onBack: () => void;
}) {
  const [subjectId, setSubjectId] = useState(snapshot.subjects[0]?.id ?? "");
  const subject = snapshot.subjects.find((item) => item.id === subjectId);
  const savedSheets = snapshot.abilitySheets.filter((sheet) => sheet.subjectId === subjectId);
  const fallbackSheet = createSheet(subjectId, "exam", subject?.name, `ability-exam-${subjectId}`);
  const [selectedSheetId, setSelectedSheetId] = useState(savedSheets[0]?.id ?? fallbackSheet.id);
  const [draftSheet, setDraftSheet] = useState<AbilityDataSheet | null>(null);
  const selectedSheet = draftSheet?.id === selectedSheetId
    ? draftSheet
    : savedSheets.find((sheet) => sheet.id === selectedSheetId) ?? savedSheets[0] ?? fallbackSheet;
  const [activeVisual, setActiveVisual] = useState<AbilityVisualization>(selectedSheet.defaultVisualization);
  const [editingSheet, setEditingSheet] = useState(false);
  const [sheetDraft, setSheetDraft] = useState<SheetDraft>(() => toSheetDraft(selectedSheet));
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [recordDraft, setRecordDraft] = useState<RecordDraft>(() => blankRecord(selectedSheet, subject?.name));
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);

  const records = snapshot.examRecords
    .filter((record) => record.subjectId === subjectId && (record.sheetId === selectedSheet.id || (!record.sheetId && selectedSheet.id === fallbackSheet.id)))
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
  const totalValue = records.reduce((sum, record) => sum + record.score, 0);
  const totalPossible = records.reduce((sum, record) => sum + record.fullScore, 0);
  const average = totalPossible ? totalValue / totalPossible * 100 : 0;
  const latest = records.at(-1);
  const best = records.length ? records.reduce((winner, item) => rate(item) > rate(winner) ? item : winner) : undefined;
  const firstLevel = selectedSheet.hierarchyLabels[0] ?? "分类";
  const breakdown = Array.from(records.reduce((map, record) => {
    const key = record.hierarchyValues?.[0]?.trim() || "未分类";
    const item = map.get(key) ?? { score: 0, total: 0, count: 0 };
    item.score += record.score;
    item.total += record.fullScore;
    item.count += 1;
    map.set(key, item);
    return map;
  }, new Map<string, { score: number; total: number; count: number }>())).map(([name, item]) => ({
    name,
    count: item.count,
    value: item.total ? item.score / item.total * 100 : 0,
  })).sort((a, b) => a.value - b.value);

  const chooseSheet = (sheet: AbilityDataSheet) => {
    setSelectedSheetId(sheet.id);
    setDraftSheet(null);
    setSheetDraft(toSheetDraft(sheet));
    setActiveVisual(sheet.defaultVisualization);
    setRecordDraft(blankRecord(sheet, subject?.name));
    setEditingSheet(false);
    setShowRecordForm(false);
    setEditingRecordId(null);
  };

  const chooseSubject = (nextId: string) => {
    const nextSubject = snapshot.subjects.find((item) => item.id === nextId);
    const nextSheet = snapshot.abilitySheets.find((sheet) => sheet.subjectId === nextId) ?? createSheet(nextId, "exam", nextSubject?.name, `ability-exam-${nextId}`);
    setSubjectId(nextId);
    setSelectedSheetId(nextSheet.id);
    setDraftSheet(null);
    setSheetDraft(toSheetDraft(nextSheet));
    setActiveVisual(nextSheet.defaultVisualization);
    setRecordDraft(blankRecord(nextSheet, nextSubject?.name));
    setEditingSheet(false);
    setShowRecordForm(false);
    setEditingRecordId(null);
  };

  const newSheet = (kind: AbilitySheetKind) => {
    const sheet = createSheet(subjectId, kind, subject?.name);
    setSelectedSheetId(sheet.id);
    setDraftSheet(sheet);
    setSheetDraft(toSheetDraft(sheet));
    setEditingSheet(true);
    setShowRecordForm(false);
  };

  const saveSheet = async (event: FormEvent) => {
    event.preventDefault();
    const hierarchyLabels = sheetDraft.hierarchyLabels.split(/[,，]/).map((value) => value.trim()).filter(Boolean).slice(0, 8);
    const columns = sheetDraft.customColumns.split(/[,，]/).map((value) => value.trim()).filter(Boolean).slice(0, 8);
    if (!sheetDraft.name.trim() || !hierarchyLabels.length || !sheetDraft.valueLabel.trim() || !sheetDraft.totalLabel.trim() || !sheetDraft.enabledVisualizations.length) return;
    const previous = snapshot.abilitySheets.find((sheet) => sheet.id === selectedSheet.id);
    const now = new Date().toISOString();
    const sheet: AbilityDataSheet = {
      ...selectedSheet,
      name: sheetDraft.name.trim(),
      kind: sheetDraft.kind,
      hierarchyLabels,
      customColumns: columns.map((value, index) => ({ id: previous?.customColumns[index]?.id ?? `${selectedSheet.id}-extra-${index}`, label: value.replace(/#$/, ""), type: value.endsWith("#") ? "number" : "text" })),
      valueLabel: sheetDraft.valueLabel.trim(),
      totalLabel: sheetDraft.totalLabel.trim(),
      enabledVisualizations: sheetDraft.enabledVisualizations,
      defaultVisualization: sheetDraft.enabledVisualizations.includes(sheetDraft.defaultVisualization) ? sheetDraft.defaultVisualization : sheetDraft.enabledVisualizations[0],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    await persist({ ...snapshot, abilitySheets: previous ? snapshot.abilitySheets.map((item) => item.id === sheet.id ? sheet : item) : [...snapshot.abilitySheets, sheet], meta: { ...snapshot.meta, updatedAt: now } });
    setDraftSheet(null);
    setSheetDraft(toSheetDraft(sheet));
    setActiveVisual(sheet.defaultVisualization);
    setEditingSheet(false);
  };

  const saveDefaultVisual = async () => {
    const now = new Date().toISOString();
    const sheet = { ...selectedSheet, defaultVisualization: activeVisual, updatedAt: now };
    const exists = snapshot.abilitySheets.some((item) => item.id === sheet.id);
    await persist({ ...snapshot, abilitySheets: exists ? snapshot.abilitySheets.map((item) => item.id === sheet.id ? sheet : item) : [...snapshot.abilitySheets, sheet], meta: { ...snapshot.meta, updatedAt: now } });
    setSheetDraft(toSheetDraft(sheet));
  };

  const saveRecord = async (event: FormEvent) => {
    event.preventDefault();
    const score = Number(recordDraft.score);
    const fullScore = Number(recordDraft.fullScore);
    if (!recordDraft.title.trim() || !Number.isFinite(score) || !Number.isFinite(fullScore) || fullScore <= 0 || score < 0 || score > fullScore) return;
    const now = new Date().toISOString();
    const old = snapshot.examRecords.find((item) => item.id === editingRecordId);
    const record: ExamRecord = {
      id: editingRecordId ?? uid("ability-record"),
      subjectId,
      sheetId: selectedSheet.id,
      recordKind: selectedSheet.kind,
      title: recordDraft.title.trim(),
      paperType: "past",
      examDate: recordDraft.examDate,
      score,
      fullScore,
      hierarchyValues: selectedSheet.hierarchyLabels.map((_, index) => recordDraft.hierarchyValues[index]?.trim() ?? ""),
      customValues: Object.fromEntries(selectedSheet.customColumns.map((column) => [column.id, recordDraft.customValues[column.id] ?? ""])),
      durationMinutes: Number(recordDraft.durationMinutes) || undefined,
      note: recordDraft.note.trim() || undefined,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    const hasSheet = snapshot.abilitySheets.some((item) => item.id === selectedSheet.id);
    await persist({
      ...snapshot,
      abilitySheets: hasSheet ? snapshot.abilitySheets : [...snapshot.abilitySheets, selectedSheet],
      examRecords: editingRecordId ? snapshot.examRecords.map((item) => item.id === editingRecordId ? record : item) : [...snapshot.examRecords, record],
      meta: { ...snapshot.meta, updatedAt: now },
    });
    setEditingRecordId(null);
    setRecordDraft(blankRecord(selectedSheet, subject?.name));
    setShowRecordForm(false);
  };

  const editRecord = (record: ExamRecord) => {
    setEditingRecordId(record.id);
    setRecordDraft({
      title: record.title,
      examDate: record.examDate,
      score: String(record.score),
      fullScore: String(record.fullScore),
      durationMinutes: record.durationMinutes ? String(record.durationMinutes) : "",
      note: record.note ?? "",
      hierarchyValues: selectedSheet.hierarchyLabels.map((_, index) => record.hierarchyValues?.[index] ?? ""),
      customValues: Object.fromEntries(selectedSheet.customColumns.map((column) => [column.id, record.customValues?.[column.id] ?? ""])),
    });
    setShowRecordForm(true);
  };

  const deleteRecord = async (record: ExamRecord) => {
    if (deleteArmedId !== record.id) {
      setDeleteArmedId(record.id);
      return;
    }
    const now = new Date().toISOString();
    await persist({ ...snapshot, examRecords: snapshot.examRecords.filter((item) => item.id !== record.id), meta: { ...snapshot.meta, updatedAt: now } });
    setDeleteArmedId(null);
  };

  const deleteSheet = async () => {
    const now = new Date().toISOString();
    await persist({
      ...snapshot,
      abilitySheets: snapshot.abilitySheets.filter((item) => item.id !== selectedSheet.id),
      examRecords: snapshot.examRecords.filter((item) => item.sheetId !== selectedSheet.id),
      meta: { ...snapshot.meta, updatedAt: now },
    });
    const next = savedSheets.find((item) => item.id !== selectedSheet.id) ?? fallbackSheet;
    chooseSheet(next);
  };

  return (
    <>
      <header className="page-head">
        <div><div className="page-kicker">统计 · 分数能力</div><h1>能力数据表</h1></div>
        <button className="btn btn-quiet" onClick={onBack}>返回统计入口</button>
      </header>

      <nav className="score-subject-tabs" aria-label="选择能力科目">
        {snapshot.subjects.map((item) => (
          <button className={subjectId === item.id ? "active" : ""} style={{ "--subject-color": item.color } as React.CSSProperties} key={item.id} onClick={() => chooseSubject(item.id)}>
            <i />{item.name}<span>{snapshot.examRecords.filter((record) => record.subjectId === item.id).length} 条</span>
          </button>
        ))}
      </nav>

      <section className="ability-workspace">
        <aside className="card ability-sheet-sidebar">
          <header><strong>数据表</strong><button onClick={() => newSheet("custom")}>＋ 新建</button></header>
          <div className="ability-sheet-list">
            {(savedSheets.length ? savedSheets : [fallbackSheet]).map((sheet) => (
              <button className={selectedSheet.id === sheet.id ? "active" : ""} key={sheet.id} onClick={() => chooseSheet(sheet)}>
                <i>{sheet.kind === "exam" ? "卷" : sheet.kind === "workbook" ? "练" : "表"}</i>
                <span><strong>{sheet.name}</strong><small>{snapshot.examRecords.filter((record) => record.sheetId === sheet.id || (!record.sheetId && sheet.id === fallbackSheet.id)).length} 条记录</small></span>
              </button>
            ))}
          </div>
          <div className="ability-template-box">
            <strong>快速新建</strong>
            <button onClick={() => newSheet("exam")}>试卷成绩</button>
            <button onClick={() => newSheet("workbook")}>习题册正确率</button>
            <button onClick={() => newSheet("custom")}>自定义表</button>
          </div>
        </aside>

        <div className="ability-main">
          <section className="card ability-toolbar">
            <div><span>{selectedSheet.kind === "exam" ? "试卷" : selectedSheet.kind === "workbook" ? "习题册" : "自定义"}</span><h2>{selectedSheet.name}</h2><p>{selectedSheet.hierarchyLabels.join(" → ")}</p></div>
            <div><button onClick={() => { setSheetDraft(toSheetDraft(selectedSheet)); setEditingSheet((value) => !value); }}>设置表单</button>{snapshot.abilitySheets.some((item) => item.id === selectedSheet.id) && <button className="danger-text" onClick={deleteSheet}>删除表</button>}<button className="btn btn-primary" onClick={() => { setEditingRecordId(null); setRecordDraft(blankRecord(selectedSheet, subject?.name)); setShowRecordForm(true); }}>＋ 添加记录</button></div>
          </section>

          {editingSheet && (
            <form className="card ability-sheet-editor" onSubmit={saveSheet}>
              <header><div><span>表单结构</span><h2>自定义数据表</h2></div><button type="button" onClick={() => setEditingSheet(false)}>关闭</button></header>
              <div className="ability-editor-grid">
                <label><span>数据表名称</span><input required value={sheetDraft.name} onChange={(event) => setSheetDraft({ ...sheetDraft, name: event.target.value })} /></label>
                <label><span>数据类型</span><select value={sheetDraft.kind} onChange={(event) => { const preset = createSheet(subjectId, event.target.value as AbilitySheetKind, subject?.name, selectedSheet.id); setDraftSheet(preset); setSheetDraft({ ...toSheetDraft(preset), name: sheetDraft.name }); }}><option value="exam">试卷分数</option><option value="workbook">习题册正确率</option><option value="custom">自定义指标</option></select></label>
                <label className="wide"><span>细分层级（逗号分隔，最多 8 层）</span><input value={sheetDraft.hierarchyLabels} onChange={(event) => setSheetDraft({ ...sheetDraft, hierarchyLabels: event.target.value })} placeholder="年份，试卷，模块，章节，考点，提醒" /></label>
                <label><span>数值列</span><input value={sheetDraft.valueLabel} onChange={(event) => setSheetDraft({ ...sheetDraft, valueLabel: event.target.value })} /></label>
                <label><span>总量列</span><input value={sheetDraft.totalLabel} onChange={(event) => setSheetDraft({ ...sheetDraft, totalLabel: event.target.value })} /></label>
                <label className="wide"><span>附加列（逗号分隔；数字列名后加 #）</span><input value={sheetDraft.customColumns} onChange={(event) => setSheetDraft({ ...sheetDraft, customColumns: event.target.value })} placeholder="题型，难度，错题数#" /></label>
              </div>
              <div className="ability-visual-picker"><span>可用可视化组件</span>{VISUALS.map((visual) => <button type="button" className={sheetDraft.enabledVisualizations.includes(visual.id) ? "active" : ""} key={visual.id} onClick={() => setSheetDraft((current) => ({ ...current, enabledVisualizations: current.enabledVisualizations.includes(visual.id) ? current.enabledVisualizations.filter((item) => item !== visual.id) : [...current.enabledVisualizations, visual.id] }))}><strong>{visual.label}</strong><small>{visual.hint}</small></button>)}</div>
              <div className="score-form-actions"><button type="button" onClick={() => setEditingSheet(false)}>取消</button><button className="btn btn-primary" type="submit">保存数据表</button></div>
            </form>
          )}

          {showRecordForm && (
            <form className="card ability-record-form" onSubmit={saveRecord}>
              <header><div><span>{editingRecordId ? "修改记录" : "新增一行"}</span><h2>{selectedSheet.name}</h2></div><button type="button" onClick={() => setShowRecordForm(false)}>关闭</button></header>
              <div className="ability-record-grid">
                <label><span>记录名称</span><input required value={recordDraft.title} onChange={(event) => setRecordDraft({ ...recordDraft, title: event.target.value })} placeholder={selectedSheet.kind === "workbook" ? "例如：660题第一轮" : "例如：2024 数学二真题"} /></label>
                <label><span>日期</span><input required type="date" value={recordDraft.examDate} onChange={(event) => setRecordDraft({ ...recordDraft, examDate: event.target.value })} /></label>
                {selectedSheet.hierarchyLabels.map((label, index) => <label key={`${label}-${index}`}><span>{label}</span><input value={recordDraft.hierarchyValues[index] ?? ""} onChange={(event) => { const values = [...recordDraft.hierarchyValues]; values[index] = event.target.value; setRecordDraft({ ...recordDraft, hierarchyValues: values }); }} placeholder={`填写${label}`} /></label>)}
                <label><span>{selectedSheet.valueLabel}</span><input required min="0" step="0.5" type="number" value={recordDraft.score} onChange={(event) => setRecordDraft({ ...recordDraft, score: event.target.value })} /></label>
                <label><span>{selectedSheet.totalLabel}</span><input required min="0.5" step="0.5" type="number" value={recordDraft.fullScore} onChange={(event) => setRecordDraft({ ...recordDraft, fullScore: event.target.value })} /></label>
                {selectedSheet.customColumns.map((column) => <label key={column.id}><span>{column.label}</span><input type={column.type} value={recordDraft.customValues[column.id] ?? ""} onChange={(event) => setRecordDraft({ ...recordDraft, customValues: { ...recordDraft.customValues, [column.id]: event.target.value } })} /></label>)}
                <label><span>用时（分钟）</span><input min="0" step="5" type="number" value={recordDraft.durationMinutes} onChange={(event) => setRecordDraft({ ...recordDraft, durationMinutes: event.target.value })} /></label>
                <label className="wide"><span>备注 / 提醒</span><input value={recordDraft.note} onChange={(event) => setRecordDraft({ ...recordDraft, note: event.target.value })} placeholder="失分原因、错题提醒或下一步改进" /></label>
              </div>
              <div className="record-rate-preview"><span>{selectedSheet.kind === "workbook" ? "本次正确率" : "本次得分率"}</span><strong>{Number(recordDraft.fullScore) > 0 ? pct(Number(recordDraft.score) / Number(recordDraft.fullScore) * 100) : "—"}</strong></div>
              <div className="score-form-actions"><button type="button" onClick={() => setShowRecordForm(false)}>取消</button><button className="btn btn-primary" type="submit">{editingRecordId ? "保存修改" : "添加到表格"}</button></div>
            </form>
          )}

          <section className="card ability-overview">
            <div className="ability-kpis"><div><span>记录数</span><strong>{records.length}</strong></div><div><span>综合{selectedSheet.kind === "workbook" ? "正确率" : "得分率"}</span><strong>{records.length ? pct(average) : "—"}</strong></div><div><span>最近一次</span><strong>{latest ? `${latest.score}/${latest.fullScore}` : "—"}</strong></div><div><span>最好一次</span><strong>{best ? `${best.score}/${best.fullScore}` : "—"}</strong></div></div>
            <div className="ability-component-head"><div><span>可视化组件</span>{selectedSheet.enabledVisualizations.map((id) => { const visual = VISUALS.find((item) => item.id === id); return visual ? <button className={activeVisual === id ? "active" : ""} key={id} onClick={() => setActiveVisual(id)}>{visual.label}{selectedSheet.defaultVisualization === id && <i>默认</i>}</button> : null; })}</div><button onClick={saveDefaultVisual}>设为默认展示</button></div>

            {activeVisual === "trend" && <TrendVisual records={records} />}
            {activeVisual === "bars" && <BarsVisual records={records} />}
            {activeVisual === "progress" && <ProgressVisual average={average} latest={latest} />}
            {activeVisual === "breakdown" && <BreakdownVisual firstLevel={firstLevel} values={breakdown} />}
            {activeVisual === "distribution" && <DistributionVisual records={records} />}
          </section>

          <section className="card ability-table-card">
            <header><div><h2>{selectedSheet.name}明细</h2><p>列由“设置表单”控制；横向滚动可查看全部细分层级。</p></div><button className="btn btn-primary btn-small" onClick={() => { setEditingRecordId(null); setRecordDraft(blankRecord(selectedSheet, subject?.name)); setShowRecordForm(true); }}>＋ 新增一行</button></header>
            {records.length ? <div className="ability-table-scroll"><table><thead><tr><th>日期</th><th>记录</th>{selectedSheet.hierarchyLabels.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}<th>{selectedSheet.valueLabel}</th><th>{selectedSheet.totalLabel}</th><th>比例</th>{selectedSheet.customColumns.map((column) => <th key={column.id}>{column.label}</th>)}<th>操作</th></tr></thead><tbody>{[...records].reverse().map((record) => <tr key={record.id}><td>{record.examDate}</td><td><strong>{record.title}</strong>{record.note && <small>{record.note}</small>}</td>{selectedSheet.hierarchyLabels.map((_, index) => <td key={`${record.id}-${index}`}>{record.hierarchyValues?.[index] || "—"}</td>)}<td>{record.score}</td><td>{record.fullScore}</td><td><b>{pct(rate(record))}</b></td>{selectedSheet.customColumns.map((column) => <td key={`${record.id}-${column.id}`}>{record.customValues?.[column.id] || "—"}</td>)}<td><button onClick={() => editRecord(record)}>修改</button><button className={deleteArmedId === record.id ? "is-armed" : ""} onClick={() => deleteRecord(record)}>{deleteArmedId === record.id ? "确认" : "删除"}</button></td></tr>)}</tbody></table></div> : <div className="score-empty"><strong>这张表还没有记录</strong><span>先添加一行，系统会同步生成表格和可视化。</span></div>}
          </section>
        </div>
      </section>
    </>
  );
}

function TrendVisual({ records }: { records: ExamRecord[] }) {
  const points = records.map((record, index) => ({ record, x: records.length === 1 ? 500 : 55 + index / (records.length - 1) * 890, y: 220 - rate(record) * 1.7 }));
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <div className="ability-trend"><div className="ability-chart-title"><h3>变化趋势</h3><span>统一折算为百分比，方便比较不同满分或题量</span></div>{records.length ? <><svg viewBox="0 0 1000 255" preserveAspectRatio="none" role="img" aria-label="能力趋势图">{[50, 92.5, 135, 177.5, 220].map((y, index) => <g key={y}><line x1="55" y1={y} x2="945" y2={y} /><text x="8" y={y + 4}>{100 - index * 25}%</text></g>)}<path className="ability-trend-area" d={`${path} L ${points.at(-1)?.x} 225 L ${points[0]?.x} 225 Z`} /><path className="ability-trend-line" d={path} />{points.map(({ record, x, y }) => <g key={record.id}><circle cx={x} cy={y} r="6" /><text x={x} y={Math.max(20, y - 13)} textAnchor="middle">{Math.round(rate(record))}%</text></g>)}</svg><div className="ability-chart-axis">{records.map((record) => <span key={record.id}>{record.examDate.slice(5)}</span>)}</div></> : <EmptyVisual />}</div>;
}

function BarsVisual({ records }: { records: ExamRecord[] }) {
  return <div className="ability-horizontal-bars"><div className="ability-chart-title"><h3>记录对比</h3><span>同一比例尺横向比较</span></div>{records.length ? records.slice(-12).reverse().map((record) => <article key={record.id}><span>{record.title}<small>{record.examDate}</small></span><div><i style={{ width: `${rate(record)}%` }} /></div><strong>{pct(rate(record))}</strong></article>) : <EmptyVisual />}</div>;
}

function ProgressVisual({ average, latest }: { average: number; latest?: ExamRecord }) {
  return <div className="ability-progress-view"><div className="ability-progress-ring" style={{ "--ability-rate": `${average * 3.6}deg` } as React.CSSProperties}><div><strong>{latest ? pct(average) : "—"}</strong><span>综合水平</span></div></div><div><h3>当前能力概览</h3><p>按全部记录的总得分 ÷ 总满分计算，题量不同也不会被简单平均扭曲。</p><div className="ability-progress-rail"><i style={{ width: `${average}%` }} /></div><span>{latest ? `最近一次 ${latest.score}/${latest.fullScore} · ${pct(rate(latest))}` : "暂无记录"}</span></div></div>;
}

function BreakdownVisual({ firstLevel, values }: { firstLevel: string; values: { name: string; count: number; value: number }[] }) {
  return <div className="ability-breakdown"><div className="ability-chart-title"><h3>按“{firstLevel}”拆解</h3><span>从低到高排列，优先处理薄弱项</span></div>{values.length ? values.map((item) => <article key={item.name}><span>{item.name}<small>{item.count} 条</small></span><div><i style={{ width: `${item.value}%` }} /></div><strong>{pct(item.value)}</strong></article>) : <EmptyVisual />}</div>;
}

function DistributionVisual({ records }: { records: ExamRecord[] }) {
  const buckets = ["0–59", "60–69", "70–79", "80–89", "90–100"].map((label, index) => ({ label, count: records.filter((record) => { const value = rate(record); return index === 0 ? value < 60 : index === 4 ? value >= 90 : value >= 60 + (index - 1) * 10 && value < 70 + (index - 1) * 10; }).length }));
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return <div className="ability-distribution"><div className="ability-chart-title"><h3>得分率分布</h3><span>按百分比区间汇总记录次数</span></div>{records.length ? <div className="distribution-bars">{buckets.map((bucket) => <div key={bucket.label}><div><i style={{ height: `${bucket.count ? Math.max(8, bucket.count / max * 100) : 3}%` }} /></div><strong>{bucket.count}</strong><span>{bucket.label}%</span></div>)}</div> : <EmptyVisual />}</div>;
}

function EmptyVisual() {
  return <div className="score-empty">添加记录后自动生成可视化。</div>;
}
