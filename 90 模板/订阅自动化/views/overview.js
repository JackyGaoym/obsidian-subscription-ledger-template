return async function(dv, app, ledger) {
const d = ledger.domain;
const summary = d.aggregate(
  dv.pages('"30 订阅/项目"').where(p => p.type === "subscription").array().map(d.subscription),
  ledger.repository.listPayments(), d.iso(new Date())
);
const today = new Date(); today.setHours(0, 0, 0, 0);
const pad = value => String(value).padStart(2, "0");
const toDate = value => { const iso = d.asISO(value); return iso ? new Date(`${iso}T00:00:00`) : null; };
const formatDate = value => { const date = toDate(value); return date ? `${date.getFullYear()}.${pad(date.getMonth()+1)}.${pad(date.getDate())}` : "未记录"; };
const formatShortDate = value => { const date = toDate(value); return date ? `${pad(date.getMonth()+1)}.${pad(date.getDate())}` : "—"; };
const formatMoney = d.formatMoney;
const amountOrZero = value => Number.isFinite(value) && value >= 0 ? value : 0;
const cycleMonths = cycle => d.config.months[cycle] ?? 1;
const monthlyCost = item => amountOrZero(item.price) / cycleMonths(item.cycle);
const dayDistance = value => { const date = toDate(value); return date ? Math.round((date-today)/86400000) : null; };
const eventCopy = item => {
  if (item.status === "已停用") return "本地已停用 · 日期仅供参考";
  const days = dayDistance(item.next_date), action = item.renewal_mode === "自动续费" ? "扣费" : "到期";
  if (days === null) return "日期未记录";
  if (days === 0) return `今天${action}`;
  if (days > 0) return `${days}天后${action}`;
  return item.renewal_mode === "自动续费" ? `已过扣费日${-days}天` : `已到期${-days}天`;
};
const dateLabel = item => item.status === "已停用" ? "原计划日期" : item.renewal_mode === "自动续费" ? "下次扣费" : "到期";
const subscriptions = [...summary.rows].sort((a, b) => String(a.next_date ?? "9999").localeCompare(String(b.next_date ?? "9999"))), active = summary.active;
const monthlyTotal = summary.monthly, annualTotal = summary.annual, recordedTotal = summary.recorded;
const trackedSpendCount = summary.tracked;
const recordedSummary = trackedSpendCount === 0 ? "未录入" : formatMoney(recordedTotal, 0);
const dueWithin30Total = summary.dueTotal;
const upcoming = summary.upcoming.slice(0, 4);
const makeInternalLink = (parent, text, path, className = "") => {
  const link = parent.createEl("a", { text, cls: `internal-link ${className}`.trim() });
  link.setAttr("data-href", path);
  link.setAttr("href", path);
  return link;
};
const launchCreate = () => ledger.commands.launch(dv.container, "create");
const launchRenew = item => ledger.commands.launch(dv.container, "renew", item?.path ?? null);

const root = dv.container.createDiv({ cls: "subscription-overview-root" });

const masthead = root.createDiv({ cls: "subscription-masthead" });
const titleBlock = masthead.createDiv({ cls: "subscription-titleblock" });
titleBlock.createSpan({ text: "THE RECURRING EDITION", cls: "subscription-kicker" });
titleBlock.createEl("h1", { text: "订阅账簿" });
titleBlock.createEl("p", {
  text: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 · 管理每一笔持续发生的支出`
});

const costBlock = masthead.createDiv({ cls: "subscription-costblock" });
costBlock.createSpan({ text: "月均折算 · 不是本月实付", cls: "subscription-cost-label" });
const costMain = costBlock.createDiv({ cls: "subscription-cost-main" });
costMain.createSpan({ text: formatMoney(monthlyTotal, 0) });
costMain.createEl("small", { text: "/ 月" });
const costMeta = costBlock.createDiv({ cls: "subscription-cost-meta" });
for (const [label, value] of [
  ["年度折算", formatMoney(annualTotal, 0)],
  ["未来30天预计*", formatMoney(dueWithin30Total, 0)],
  ["已记录实付", recordedSummary]
]) {
  const item = costMeta.createDiv();
  item.createSpan({ text: label });
  item.createEl("strong", { text: value });
}
costMeta.createSpan({ text: "* 含手动续费假设；过期需核对。", cls: "subscription-cost-note" });

const actions = masthead.createDiv({ cls: "subscription-actions" });
const renewMain = actions.createEl("button", {
  text: "记录续费",
  cls: "subscription-action is-primary",
  attr: { type: "button" }
});
renewMain.addEventListener("click", () => launchRenew(null));
const createMain = actions.createEl("button", {
  text: "新增订阅",
  cls: "subscription-action",
  attr: { type: "button" }
});
createMain.addEventListener("click", launchCreate);
titleBlock.createSpan({ text: `当前 ${active.length} 项订阅`, cls: "subscription-active-count" });

const workspace = root.createDiv({ cls: "subscription-workspace" });
const timelineSection = workspace.createDiv({ cls: "subscription-timeline-section" });
const timelineHeading = timelineSection.createDiv({ cls: "subscription-section-heading" });
const timelineTitle = timelineHeading.createDiv({ cls: "subscription-section-title" });
timelineTitle.createSpan({ text: "UPCOMING RENEWALS", cls: "subscription-kicker" });
timelineTitle.createEl("h2", { text: "续费提醒" });
timelineHeading.createSpan({ text: `最近 ${upcoming.length} 项` });
if (summary.overdue.length) {
  const overdue = timelineSection.createDiv({ cls: "subscription-timeline-overdue", attr: { role: "note" } });
  overdue.createEl("strong", { text: `${summary.overdue.length} 项已过日期待核对` });
  const all = overdue.createEl("button", { text: "在账本中查看", attr: { type: "button" } });
  all.addEventListener("click", () => {
    filterButtons.time.find(button => button.dataset.filter === "overdue")?.click();
    ledgerHeading.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
const timeline = timelineSection.createDiv({ cls: "subscription-timeline" });
if (upcoming.length) {
  for (const item of upcoming) {
    const event = timeline.createDiv({ cls: "subscription-timeline-event" });
    const timelineDays = dayDistance(item.next_date);
    event.classList.toggle("is-urgent", timelineDays !== null && timelineDays <= 7);
    const when = event.createDiv({ cls: "subscription-timeline-when" });
    when.createSpan({ text: formatShortDate(item.next_date), cls: "subscription-timeline-date" });
    when.createSpan({ text: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][toDate(item.next_date).getDay()], cls: "subscription-timeline-weekday" });
    const marker = event.createSpan({ cls: "subscription-timeline-marker" });
    marker.setAttr("aria-hidden", "true");
    const body = event.createDiv({ cls: "subscription-timeline-body" });
    const coverFile = app.vault.getAbstractFileByPath(item.cover);
    if (coverFile?.extension) {
      body.createEl("img", {
        attr: { src: app.vault.getResourcePath(coverFile), alt: "", loading: "lazy" }
      });
    }
    const copy = body.createDiv();
    makeInternalLink(copy, item.name, item.path, "subscription-timeline-name");
    copy.createSpan({ text: eventCopy(item), cls: "subscription-timeline-copy" });
    const meta = copy.createDiv({ cls: "subscription-timeline-meta" });
    meta.createEl("small", { text: `${formatMoney(item.price)}/${item.cycle.replace("度", "")} · ${item.renewal_mode}` });
    const action = copy.createEl("button", {
      text: "记录续费",
      cls: "subscription-timeline-action",
      attr: { type: "button", "aria-label": `为 ${item.name} 记录续费` }
    });
    action.addEventListener("click", () => launchRenew(item));
  }
} else {
  timeline.createSpan({ text: summary.overdue.length ? "暂无后续扣费或到期安排；请先核对逾期项目" : "近期没有扣费或到期安排", cls: "subscription-timeline-empty" });
}

const ledgerPanel = workspace.createDiv({ cls: "subscription-ledger-panel" });
const ledgerHeading = ledgerPanel.createDiv({ cls: "subscription-ledger-heading" });
const ledgerTitle = ledgerHeading.createDiv({ cls: "subscription-ledger-title" });
ledgerTitle.createSpan({ text: "THE LEDGER", cls: "subscription-kicker" });
ledgerTitle.createEl("h2", { text: "订阅账本" });
const filters = ledgerHeading.createDiv({ cls: "subscription-filters" });
const filterState = { time: "all", mode: "all", status: "all", query: "" };
const filterButtons = { time: [], mode: [], status: [] };
for (const [group, label, definitions] of [
  ["time", "时间", [["全部", "all"], ["30 天内", "due30"], ["已过日期", "overdue"]]],
  ["mode", "方式", [["全部", "all"], ["自动", "auto"], ["手动", "manual"]]],
  ["status", "状态", [["全部", "all"], ["订阅中", "active"], ["已停用", "stopped"]]]
]) {
  const box = filters.createDiv({ cls: `subscription-filter-group is-${group}` });
  box.createSpan({ text: label, cls: "subscription-filter-label" });
  for (const [text, key] of definitions) {
    const button = box.createEl("button", {
      text, cls: `subscription-filter${key === "all" ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": key === "all" ? "true" : "false", "aria-label": `${label}：${text}` }
    });
    button.dataset.filter = key;
    filterButtons[group].push(button);
  }
}
const filterTools = ledgerHeading.createDiv({ cls: "subscription-filter-tools" });
const search = filterTools.createEl("input", { attr: { type: "search", placeholder: "搜索服务名称", "aria-label": "搜索订阅服务名称" } });
const sort = filterTools.createEl("select", { attr: { "aria-label": "订阅排序" } });
for (const [value, label] of [["date", "按下次日期"], ["cost", "按月均金额"]]) sort.createEl("option", { text: label, attr: { value } });
const clear = filterTools.createEl("button", { text: "清除筛选", attr: { type: "button" } });
const filterResult = ledgerPanel.createDiv({ cls: "subscription-filter-result", text: `显示 ${subscriptions.length} / ${subscriptions.length} 项${subscriptions.length > 4 ? " · 列表内可滚动" : ""}`, attr: { role: "status", "aria-live": "polite" } });

const ledgerEl = ledgerPanel.createDiv({ cls: "subscription-ledger" });
const ledgerHeader = ledgerEl.createDiv({ cls: "subscription-ledger-header" });
for (const label of ["服务", "预计续费", "下次扣费 / 到期", "状态", "操作"]) {
  ledgerHeader.createSpan({ text: label });
}

const rows = [];
for (const item of subscriptions) {
  const row = ledgerEl.createDiv({ cls: "subscription-ledger-row" });
  row.dataset.status = item.status;
  row.dataset.mode = item.renewal_mode;
  row.dataset.name = item.name.toLocaleLowerCase();
  row.dataset.monthly = String(monthlyCost(item));
  const itemDays = dayDistance(item.next_date);
  row.dataset.days = itemDays === null ? "" : String(itemDays);
  rows.push(row);

  const service = row.createDiv({ cls: "subscription-ledger-service" });
  const icon = service.createDiv({ cls: "subscription-service-icon" });
  const coverFile = app.vault.getAbstractFileByPath(item.cover);
  if (coverFile?.extension) {
    icon.createEl("img", {
      attr: { src: app.vault.getResourcePath(coverFile), alt: `${item.name} 图标`, loading: "lazy" }
    });
  }
  if (item.path) makeInternalLink(service, item.name, item.path, "subscription-service-name");
  else service.createEl("strong", { text: item.name, cls: "subscription-service-name" });

  const price = row.createDiv({ cls: "subscription-row-price" });
  price.createSpan({ text: `${formatMoney(item.price)} / ${item.cycle.replace("度", "")}` });
  price.createEl("small", { text: `折合 ${formatMoney(monthlyCost(item))} / 月` });
  const next = row.createDiv({ cls: "subscription-row-next" });
  next.createSpan({ text: `${formatDate(item.next_date)} ${dateLabel(item)}` });
  next.createEl("small", { text: eventCopy(item) });
  const state = row.createDiv({ cls: "subscription-row-state" });
  state.createSpan({ text: item.status, cls: `subscription-status is-${item.status}` });
  state.createEl("small", { text: item.renewal_mode });
  const spend = row.createSpan({
    text: item.has_spend_data ? formatMoney(item.recorded_spend) : "—",
    cls: `subscription-row-value${item.has_spend_data ? "" : " is-untracked"}`
  });
  if (!item.has_spend_data) spend.setAttr("title", "尚未录入历史支出或续费记录");
  const renew = row.createEl("button", {
    text: item.status === "已停用" ? "补记支出" : "记录续费",
    cls: "subscription-row-renew",
    attr: { type: "button", "aria-label": `为 ${item.name} ${item.status === "已停用" ? "补记支出" : "记录续费"}` }
  });
  renew.addEventListener("click", () => launchRenew(item));
}

const empty = ledgerEl.createDiv({ cls: "subscription-ledger-empty" });
const emptyTitle = empty.createEl("strong", { text: "还没有订阅" });
const emptyCopy = empty.createSpan({ text: "新增第一项订阅，开始记录预计费用与实际付款。" });
empty.hidden = rows.length > 0;
const unknownHistory = subscriptions.filter(item => !item.historical_spend_known).length;
const invalidItems = subscriptions.filter(item => !item.next_date || !Number.isFinite(item.price)
  || !Object.hasOwn(d.config.months, item.cycle) || !["订阅中", "已停用"].includes(item.status)).length;
if (unknownHistory || invalidItems) {
  const health = ledgerPanel.createDiv({ cls: "subscription-data-health", attr: { role: "note" } });
  health.createEl("strong", { text: "数据核对" });
  health.createSpan({ text: [
    unknownHistory ? `${unknownHistory} 项此前累计支出未核实` : null,
    invalidItems ? `${invalidItems} 项规则字段需修复` : null
  ].filter(Boolean).join(" · ") + "。已记录实付不代表历史完整。" });
}
const applyFilters = () => {
  let visible = 0;
  for (const row of rows) {
    const days = row.dataset.days === "" ? null : Number(row.dataset.days);
    const timeMatches = filterState.time === "all" || (filterState.time === "due30" && days !== null && days >= 0 && days < 30)
      || (filterState.time === "overdue" && days !== null && days < 0);
    const modeMatches = filterState.mode === "all" || row.dataset.mode === (filterState.mode === "auto" ? "自动续费" : "手动续费");
    const statusMatches = filterState.status === "all" || row.dataset.status === (filterState.status === "active" ? "订阅中" : "已停用");
    const show = timeMatches && modeMatches && statusMatches && row.dataset.name.includes(filterState.query);
    row.hidden = !show;
    if (show) visible += 1;
  }
  empty.hidden = visible > 0;
  emptyTitle.setText(rows.length ? "没有符合条件的订阅" : "还没有订阅");
  emptyCopy.setText(rows.length ? "试试清除筛选，或换一个搜索词。" : "新增第一项订阅，开始记录预计费用与实际付款。");
  filterResult.setText(`显示 ${visible} / ${rows.length} 项${visible > 4 ? " · 列表内可滚动" : ""}`);
};
for (const [group, buttons] of Object.entries(filterButtons)) for (const button of buttons) {
  button.addEventListener("click", () => {
    filterState[group] = button.dataset.filter;
    for (const candidate of buttons) {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttr("aria-pressed", active ? "true" : "false");
    }
    applyFilters();
  });
}
search.addEventListener("input", () => { filterState.query = search.value.trim().toLocaleLowerCase(); applyFilters(); });
sort.addEventListener("change", () => {
  const sorted = [...rows].sort((a, b) => sort.value === "cost"
    ? Number(b.dataset.monthly) - Number(a.dataset.monthly)
    : (Number(a.dataset.days || 99999) - Number(b.dataset.days || 99999)));
  for (const row of sorted) ledgerEl.insertBefore(row, empty);
});
clear.addEventListener("click", () => {
  for (const [group, buttons] of Object.entries(filterButtons)) {
    filterState[group] = "all";
    for (const button of buttons) {
      const active = button.dataset.filter === "all";
      button.classList.toggle("is-active", active);
      button.setAttr("aria-pressed", active ? "true" : "false");
    }
  }
  filterState.query = ""; search.value = ""; applyFilters();
});

};
