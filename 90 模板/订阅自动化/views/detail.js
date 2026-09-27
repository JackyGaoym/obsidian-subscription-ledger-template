return async function(dv, app, ledger) {
const d = ledger.domain;
const current = dv.current();
const item = d.subscription(current);
const page = { ...current, ...item, file: current.file };
const toDate = value => { const iso = d.asISO(value); return iso ? new Date(`${iso}T00:00:00`) : null; };
const pad = value => String(value).padStart(2, "0");
const formatDate = value => { const date = toDate(value); return date ? `${date.getFullYear()}.${pad(date.getMonth()+1)}.${pad(date.getDate())}` : "未记录"; };
const formatMoney = d.formatMoney;
const amountOrZero = value => Number.isFinite(value) && value >= 0 ? value : 0;
const cycleMonths = d.config.months[page.cycle] ?? 1;
const monthly = amountOrZero(page.price) / cycleMonths;
const today = new Date(); today.setHours(0,0,0,0);
const nextDate = toDate(page.next_date);
const days = nextDate ? Math.round((nextDate-today)/86400000) : null;
const dueAction = page.renewal_mode === "手动续费" ? "到期" : "扣费";
const dueCopy = item.status === "已停用" ? "本地台账已停用 · 日期仅供参考"
  : days === null ? "日期未记录" : days === 0 ? `今天${dueAction}` : days > 0 ? `${days} 天后${dueAction}` : `已过${dueAction}日 ${-days} 天`;
const allRecords = ledger.repository.forItem(item)
  .map(r => ({ ...r, payment_date: r.paid_on, file: { path: r.path } }))
  .sort((a,b) => String(b.created_at || b.paid_on).localeCompare(String(a.created_at || a.paid_on)));
const paymentRecords = allRecords.filter(d.effective);
const voidedRecords = allRecords.filter(r => r.voided || r.status === "voided");
const reviewRecords = allRecords.filter(r => !d.effective(r) && !r.voided && r.status !== "voided");
const recordedSpend = paymentRecords.reduce((sum, r) => sum + amountOrZero(r.amount), item.historical_spend_known ? amountOrZero(item.historical_spend) : 0);
const hasSpendData = item.historical_spend_known || paymentRecords.length > 0;
const launch = type => ledger.commands.launch(dv.container, type, item.path);
const undoPayment = record => ledger.commands.undo(item.path, record.file.path, `${formatDate(record.payment_date)} 的 ${formatMoney(record.amount)}`);

const root = dv.container.createDiv({ cls: "subscription-item-root" });
const topLine = root.createDiv({ cls: "subscription-item-topline" });
const back = topLine.createEl("a", {
  text: "返回订阅账簿",
  cls: "internal-link subscription-item-back"
});
back.setAttr("data-href", "30 订阅/订阅主页");
back.setAttr("href", "30 订阅/订阅主页");
const layout = root.createDiv({ cls: "subscription-item-layout" });
const profile = layout.createDiv({ cls: "subscription-item-profile" });
const content = layout.createDiv({ cls: "subscription-item-content" });
const header = profile.createDiv({ cls: "subscription-item-header" });
const logo = header.createEl("button", {
  cls: "subscription-item-logo",
  attr: { type: "button", "aria-label": page.cover ? "更换订阅 Logo" : "添加订阅 Logo" }
});
const coverPath = d.pathOf(page.cover);
const coverFile = app.vault.getAbstractFileByPath(coverPath);
if (coverFile?.extension) {
  logo.createEl("img", {
    attr: { src: app.vault.getResourcePath(coverFile), alt: String(page.name ?? page.file.name) }
  });
  logo.createSpan({ text: "更换 Logo", cls: "subscription-item-logo-edit" });
} else {
  logo.createSpan({ text: "添加 Logo", cls: "subscription-item-logo-placeholder" });
}
logo.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); launch("cover"); });

const info = header.createDiv({ cls: "subscription-item-info" });
info.createSpan({ text: "PERSONAL SUBSCRIPTION ARCHIVE", cls: "subscription-item-kicker" });
info.createEl("h1", { text: String(page.name ?? page.file.name) });
const badges = info.createDiv({ cls: "subscription-item-badges" });
badges.createSpan({ text: String(page.status ?? "订阅中"), cls: `subscription-item-status is-${String(page.status ?? "订阅中")}` });
badges.createSpan({ text: String(page.renewal_mode ?? "自动续费"), cls: "subscription-item-mode" });

const heroCost = profile.createDiv({ cls: "subscription-item-hero-cost" });
heroCost.createSpan({ text: formatMoney(page.price) });
heroCost.createEl("small", { text: `/ ${String(page.cycle ?? "月度").replace("度", "")}` });

const facts = profile.createDiv({ cls: "subscription-item-facts" });
for (const [label, value, className] of [
  ["月均折算", `${formatMoney(monthly)} / 月`, ""],
  ["已记录实付", hasSpendData ? formatMoney(recordedSpend) : "未录入", ""],
  ["续费方式", String(page.renewal_mode), ""]
]) {
  const fact = facts.createDiv({ cls: "subscription-item-fact" });
  fact.createSpan({ text: label });
  fact.createEl("strong", { text: value, cls: className });
}

const next = content.createDiv({ cls: "subscription-item-next" });
const nextCopy = next.createDiv({ cls: "subscription-item-next-copy" });
nextCopy.createSpan({ text: "NEXT RENEWAL", cls: "subscription-item-kicker" });
nextCopy.createEl("h2", { text: String(page.renewal_mode) === "手动续费" ? "下次到期" : "下次扣费" });
nextCopy.createEl("strong", { text: formatDate(page.next_date), cls: "subscription-item-next-date" });
nextCopy.createSpan({ text: dueCopy, cls: `subscription-item-due${days !== null && days <= 7 ? " is-accent" : ""}` });

const actions = next.createDiv({ cls: "subscription-item-actions" });
const renew = actions.createEl("button", {
  text: String(page.status) === "已停用" ? "补记支出" : "记录续费",
  cls: "subscription-item-action is-primary",
  attr: { type: "button" }
});
renew.addEventListener("click", () => launch("renew"));
const edit = actions.createEl("button", {
  text: "编辑订阅",
  cls: "subscription-item-action",
  attr: { type: "button" }
});
edit.addEventListener("click", () => launch("edit"));
const toggle = actions.createEl("button", {
  text: String(page.status) === "已停用" ? "重新启用（核对规则）" : "停用订阅",
  cls: "subscription-item-action is-text",
  attr: { type: "button" }
});
toggle.addEventListener("click", () => String(page.status) === "已停用" ? launch("edit") : ledger.commands.toggleStatus(item.path));

const history = content.createDiv({ cls: "subscription-item-history" });
const historyHeading = history.createDiv({ cls: "subscription-item-history-heading" });
const historyTitle = historyHeading.createDiv();
historyTitle.createSpan({ text: "THE RENEWAL LEDGER", cls: "subscription-item-kicker" });
historyTitle.createEl("h2", { text: "续费记录" });
const tabs = history.createDiv({ cls: "subscription-item-history-tabs", attr: { role: "tablist", "aria-label": "流水状态" } });
const categories = [
  ["有效流水", paymentRecords], ["已撤销", voidedRecords], ["待核对", reviewRecords]
];
const tabButtons = [], panels = [];
for (const [index, [label, records]] of categories.entries()) {
  const button = tabs.createEl("button", { text: `${label} ${records.length}`, cls: index === 0 ? "is-active" : "",
    attr: { type: "button", role: "tab", "aria-selected": index === 0 ? "true" : "false" } });
  tabButtons.push(button);
  const panel = history.createDiv({ cls: "subscription-item-history-panel", attr: { role: "tabpanel" } });
  panel.hidden = index !== 0;
  panels.push(panel);
  if (!records.length) {
    panel.createDiv({ text: index === 0 ? "还没有实付记录。第一次记录续费后会出现在这里。" : "暂无记录。", cls: "subscription-item-history-empty" });
    continue;
  }
  const list = panel.createDiv({ cls: "subscription-item-history-list" });
  const columns = list.createDiv({ cls: "subscription-item-history-columns" });
  for (const title of ["日期", "金额", "说明", "操作"]) columns.createSpan({ text: title });
  const extra = [];
  for (const [position, record] of records.entries()) {
    const row = list.createDiv({ cls: "subscription-item-history-row" });
    if (position >= 8) { row.hidden = true; extra.push(row); }
    row.createSpan({ text: formatDate(record.payment_date) });
    row.createEl("strong", { text: formatMoney(record.amount) });
    const description = row.createDiv({ cls: "subscription-item-history-description" });
    description.createSpan({ text: record.kind === "history" ? "仅补记 · 日期未变"
      : record.kind === "initial" ? "首笔实付"
      : record.next_date ? `续期至 ${formatDate(record.next_date)}` : "续期日期未记录" });
    if (record.price_updated) description.createSpan({ text: `预计价改为 ${formatMoney(record.price_after)}` });
    const controls = row.createDiv({ cls: "subscription-item-history-controls" });
    const recordLink = controls.createEl("a", { text: "查看记录", cls: "internal-link subscription-item-history-source" });
    recordLink.setAttr("data-href", record.path); recordLink.setAttr("href", record.path);
    if (index === 0) {
      const undo = controls.createEl("button", { text: "撤销", cls: "subscription-item-history-undo",
        attr: { type: "button", "aria-label": `撤销 ${formatDate(record.payment_date)} 的 ${formatMoney(record.amount)} 记录` } });
      undo.addEventListener("click", () => undoPayment(record));
    }
  }
  if (extra.length) {
    const more = panel.createEl("button", { text: `查看全部 ${records.length} 笔`, cls: "subscription-item-history-more", attr: { type: "button" } });
    more.addEventListener("click", () => {
      const expand = extra.some(row => row.hidden);
      for (const row of extra) row.hidden = !expand;
      more.setText(expand ? "收起较早记录" : `查看全部 ${records.length} 笔`);
    });
  }
}
for (const [index, button] of tabButtons.entries()) button.addEventListener("click", () => {
  for (const [i, tab] of tabButtons.entries()) {
    const active = i === index;
    tab.classList.toggle("is-active", active);
    tab.setAttr("aria-selected", active ? "true" : "false");
    panels[i].hidden = !active;
  }
});

};
