import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the yantu application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>考研系统 · 目标任务管理<\/title>/i);
  assert.match(html, /围绕考研目标、科目、计划与每日执行设计的个人学习系统/);
  assert.match(html, /正在读取你的本地学习空间/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("production bundle includes confirmed scheduling and focus interactions", async () => {
  const response = await render();
  const html = await response.text();
  assert.equal(response.status, 200);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const assetDir = path.resolve("dist/client/_next/static");
  const sourceFiles = [
    ...(await fs.readdir(path.join(assetDir, "chunks"))).filter((name) => name.endsWith(".js")).map((name) => path.join(assetDir, "chunks", name)),
    ...(await fs.readdir(path.join(assetDir, "css"))).filter((name) => name.endsWith(".css")).map((name) => path.join(assetDir, "css", name)),
  ];
  const source = (await Promise.all(sourceFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
  assert.match(source, /已选择.*天/);
  assert.match(source, /时间点/);
  assert.match(source, /放到此任务下/);
  assert.match(source, /悬浮窗/);
  assert.match(source, /上午/);
  assert.match(source, /今日专注进度/);
  assert.match(source, /今日学习时长/);
  assert.match(source, /我的考研宏观视图/);
  assert.match(source, /艾宾浩斯计划/);
  assert.match(source, /每日最低完成量/);
  assert.match(source, /到今日任务列表打卡/);
  assert.match(source, /再点勾选可取消/);
  assert.match(source, /今日已达标/);
  assert.match(source, /下一阶段/);
  assert.match(source, /任务已复制/);
  assert.doesNotMatch(source, /任务加权进度/);
  assert.doesNotMatch(source, /沙粒与剩余时间同步/);
  assert.match(source, /任务列表/);
  assert.match(source, /月历/);
  assert.match(source, /calendar-task-item/);
  assert.match(source, /起始日期不能晚于截止日期/);
  assert.match(source, /数据健康检查/);
  assert.match(source, /展开全部/);
  assert.match(source, /时间冲突/);
  assert.match(source, /撤销/);
  assert.match(source, /高拟真 · WebGL 沙粒/);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("production bundle includes category drop targets, completion placement and upgraded analytics", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/components/StudyApp.tsx", import.meta.url), "utf8");
  const reviewSource = await readFile(new URL("../app/components/ReviewCenter.tsx", import.meta.url), "utf8");
  const scoreSource = await readFile(new URL("../app/components/ScoreAnalytics.tsx", import.meta.url), "utf8");
  assert.match(source, /moveTaskToCategory/);
  assert.match(source, /已完成任务的位置/);
  assert.match(source, /科目投入分布/);
  assert.match(source, /学习时长趋势/);
  assert.match(source, /本周落后科目进度/);
  assert.match(source, /专注与执行统计/);
  assert.match(source, /分数能力统计/);
  assert.match(reviewSource, /每周复盘/);
  assert.match(reviewSource, /计划偏差原因/);
  assert.match(reviewSource, /高估时间/);
  assert.match(scoreSource, /能力数据表/);
  assert.match(scoreSource, /习题册正确率/);
  assert.match(scoreSource, /可视化组件/);
  assert.match(scoreSource, /设为默认展示/);
  assert.match(scoreSource, /分数分布/);
  assert.match(source, /按住任务任意空白区域即可拖动/);
  assert.match(source, /打卡月历/);
  assert.match(source, /保存补录/);
  assert.match(source, /最近删除/);
  assert.match(source, /还可恢复/);
  assert.match(source, /备考进度/);
  assert.match(source, /目标进度/);
  assert.match(source, /一个圆点代表一/);
  assert.match(source, /进度圆点单位/);
  assert.match(source, /备考开始时间/);
  assert.match(source, /当前周期不足一个完整周/);
  assert.match(source, /matrix-dot-timeline/);
  assert.match(source, /matrix-dot-groups/);
  assert.match(source, /matrix-dot-group/);
  assert.match(source, /week-grid-nav/);
  assert.match(source, /heatmap-cell/);
  assert.match(source, /execution-weekday-card/);
  assert.match(source, /实际学习/);
  assert.match(source, /双击任务进入时长调整/);
  assert.match(source, /仅显示今日/);
  assert.match(source, /未安排/);
  assert.match(source, /已逾期/);
  assert.match(source, /workspaceMode/);
  assert.match(source, /非备考/);
  assert.match(source, /直接选择常用时长/);
  assert.doesNotMatch(source, /id="focus-minutes" type="number"/);
  assert.doesNotMatch(source, /id="rest-minutes" type="number"/);
  assert.match(source, /搜索最近删除/);
  assert.match(source, /恢复已选/);
  assert.match(source, /删除任务/);
  assert.doesNotMatch(source, /还没有任务分类或任务/);
  assert.doesNotMatch(source, /今日学习工作台/);
});
