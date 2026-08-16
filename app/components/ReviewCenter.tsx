"use client";

import { useState } from "react";
import type { AppSnapshot, ReviewPeriod, ReviewVarianceReason, StudyReview } from "../types/domain";

const REASONS: ReviewVarianceReason[] = ["高估时间", "临时任务", "状态不佳", "任务难度超预期"];

function localDate(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function formatMinutes(value: number) {
  if (value < 60) return `${Math.max(0, Math.round(value))} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function periodRange(cursor: Date, period: ReviewPeriod) {
  const start = new Date(cursor);
  start.setHours(0, 0, 0, 0);
  if (period === "weekly") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  if (period === "weekly") end.setDate(end.getDate() + 6);
  return { start: localDate(start), end: localDate(end) };
}

function cryptoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `review-${Date.now()}`;
}

function ReviewEditor({ snapshot, record, period, periodStart, periodEnd, subjectId, metrics, persist }: {
  snapshot: AppSnapshot;
  record?: StudyReview;
  period: ReviewPeriod;
  periodStart: string;
  periodEnd: string;
  subjectId?: string;
  metrics: { plannedMinutes: number; actualMinutes: number; completedTasks: number; totalTasks: number };
  persist: (next: AppSnapshot) => Promise<void>;
}) {
  const [reasons, setReasons] = useState<ReviewVarianceReason[]>(record?.varianceReasons ?? []);
  const [note, setNote] = useState(record?.note ?? "");
  const [nextAction, setNextAction] = useState(record?.nextAction ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    const now = new Date().toISOString();
    const nextRecord: StudyReview = {
      id: record?.id ?? cryptoId(), period, periodStart, periodEnd, subjectId,
      ...metrics, varianceReasons: reasons, note: note.trim() || undefined,
      nextAction: nextAction.trim() || undefined, createdAt: record?.createdAt ?? now, updatedAt: now,
    };
    setSaving(true);
    try {
      await persist({
        ...snapshot,
        studyReviews: record ? snapshot.studyReviews.map((item) => item.id === record.id ? nextRecord : item) : [...snapshot.studyReviews, nextRecord],
        meta: { ...snapshot.meta, updatedAt: now },
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally { setSaving(false); }
  };
  return <section className="card review-editor-card">
    <div className="review-editor-head"><div><span>{period === "daily" ? "每日复盘" : "每周复盘"}</span><h2>{periodStart === periodEnd ? periodStart : `${periodStart} — ${periodEnd}`}</h2></div><strong>{record ? "已记录" : "待复盘"}</strong></div>
    <div className="review-auto-metrics">
      <div><span>实际 / 计划</span><strong>{formatMinutes(metrics.actualMinutes)} <i>/ {formatMinutes(metrics.plannedMinutes)}</i></strong></div>
      <div><span>任务完成</span><strong>{metrics.completedTasks}/{metrics.totalTasks}</strong></div>
      <div className={metrics.actualMinutes < metrics.plannedMinutes ? "is-behind" : ""}><span>时间差</span><strong>{metrics.actualMinutes >= metrics.plannedMinutes ? "+" : "−"}{formatMinutes(Math.abs(metrics.actualMinutes - metrics.plannedMinutes))}</strong></div>
    </div>
    <div className="review-field"><span>计划偏差原因</span><div className="variance-reasons">{REASONS.map((reason) => <button type="button" className={reasons.includes(reason) ? "active" : ""} aria-pressed={reasons.includes(reason)} key={reason} onClick={() => setReasons((current) => current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason])}>{reason}</button>)}</div></div>
    <label className="review-field"><span>今天 / 本周最值得保留的做法</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="一句话即可，不强迫写长复盘" /></label>
    <label className="review-field"><span>下一步调整</span><input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="例如：数学真题提前到上午完成" /></label>
    <div className="review-save-row"><small>{saved ? "已保存到本地" : "系统数据已自动统计，你只需补充原因和下一步。"}</small><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "保存中…" : record ? "更新复盘" : "保存复盘"}</button></div>
  </section>;
}

export function ReviewCenter({ snapshot, persist }: { snapshot: AppSnapshot; persist: (next: AppSnapshot) => Promise<void> }) {
  const [period, setPeriod] = useState<ReviewPeriod>("daily");
  const [cursor, setCursor] = useState(() => new Date());
  const [subjectId, setSubjectId] = useState("all");
  const range = periodRange(cursor, period);
  const schedules = snapshot.taskSchedules.filter((item) => item.plannedDate >= range.start && item.plannedDate <= range.end);
  const taskIds = new Set(schedules.map((item) => item.taskId));
  const tasks = snapshot.tasks.filter((task) => taskIds.has(task.id) && (subjectId === "all" || task.subjectId === subjectId));
  const sessions = snapshot.studySessions.filter((session) => session.startedAt.slice(0, 10) >= range.start && session.startedAt.slice(0, 10) <= range.end && (subjectId === "all" || session.subjectId === subjectId));
  const completedTasks = tasks.filter((task) => task.completionMode === "quantity"
    ? snapshot.taskCheckins.some((item) => item.taskId === task.id && item.date >= range.start && item.date <= range.end && item.completed)
    : Boolean(task.completedAt && task.completedAt.slice(0, 10) >= range.start && task.completedAt.slice(0, 10) <= range.end)).length;
  const metrics = { plannedMinutes: tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0), actualMinutes: sessions.reduce((sum, session) => sum + session.durationMinutes, 0), completedTasks, totalTasks: tasks.length };
  const currentRecord = snapshot.studyReviews.find((item) => item.period === period && item.periodStart === range.start && (item.subjectId ?? "all") === subjectId);
  const subjectProgress = snapshot.subjects.map((subject) => {
    const subjectTasks = snapshot.tasks.filter((task) => taskIds.has(task.id) && task.subjectId === subject.id);
    const planned = subjectTasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
    const actual = snapshot.studySessions.filter((session) => session.subjectId === subject.id && session.startedAt.slice(0, 10) >= range.start && session.startedAt.slice(0, 10) <= range.end).reduce((sum, session) => sum + session.durationMinutes, 0);
    return { subject, planned, actual, rate: planned ? Math.min(100, Math.round(actual / planned * 100)) : 0, lag: Math.max(0, planned - actual) };
  }).filter((item) => item.planned > 0).sort((a, b) => b.lag - a.lag);
  const shift = (amount: number) => { const next = new Date(cursor); next.setDate(next.getDate() + amount * (period === "daily" ? 1 : 7)); setCursor(next); };
  const history = [...snapshot.studyReviews].sort((a, b) => b.periodStart.localeCompare(a.periodStart)).slice(0, 8);
  return <>
    <header className="page-head"><div><div className="page-kicker">回顾与调整</div><h1>复盘</h1></div><div className="review-period-controls"><div className="segmented"><button className={period === "daily" ? "active" : ""} onClick={() => setPeriod("daily")}>每日</button><button className={period === "weekly" ? "active" : ""} onClick={() => setPeriod("weekly")}>每周</button></div><button aria-label="上一个周期" onClick={() => shift(-1)}>‹</button><button onClick={() => setCursor(new Date())}>回到当前</button><button aria-label="下一个周期" onClick={() => shift(1)}>›</button></div></header>
    <nav className="review-subject-filter" aria-label="按科目复盘"><button className={subjectId === "all" ? "active" : ""} onClick={() => setSubjectId("all")}>全部科目</button>{snapshot.subjects.map((subject) => <button className={subjectId === subject.id ? "active" : ""} style={{ "--subject-color": subject.color } as React.CSSProperties} key={subject.id} onClick={() => setSubjectId(subject.id)}><i />{subject.name}</button>)}</nav>
    <div className="review-center-grid"><ReviewEditor key={`${period}-${range.start}-${subjectId}-${currentRecord?.updatedAt ?? "new"}`} snapshot={snapshot} record={currentRecord} period={period} periodStart={range.start} periodEnd={range.end} subjectId={subjectId === "all" ? undefined : subjectId} metrics={metrics} persist={persist} />
      <section className="card review-lag-card"><div><span>{period === "daily" ? "今日" : "本周"}科目投入</span><h2>落后科目进度</h2></div>{subjectProgress.length ? <div className="review-lag-list">{subjectProgress.map((item) => <button key={item.subject.id} onClick={() => setSubjectId(item.subject.id)}><div><span><i style={{ background: item.subject.color }} />{item.subject.name}</span><strong>{item.rate}%</strong></div><div><i style={{ width: `${item.rate}%`, background: item.subject.color }} /></div><small>{item.lag ? `比计划少 ${formatMinutes(item.lag)}` : "达到计划投入"}</small></button>)}</div> : <div className="empty-copy">这个周期还没有按科目安排预计时长。</div>}</section>
    </div>
    <section className="card review-history"><div><h2>最近复盘</h2><span>快速回看当时为什么偏离计划，以及下一步怎么调。</span></div>{history.length ? <div>{history.map((item) => <article key={item.id}><time>{item.periodStart}{item.period === "weekly" ? " 周" : ""}</time><strong>{snapshot.subjects.find((subject) => subject.id === item.subjectId)?.name ?? "全部科目"}</strong><span>{item.varianceReasons.join(" · ") || "无明显偏差"}</span><p>{item.nextAction || item.note || "未填写文字复盘"}</p></article>)}</div> : <div className="empty-copy">保存第一次复盘后，会在这里形成可回看的调整记录。</div>}</section>
  </>;
}
