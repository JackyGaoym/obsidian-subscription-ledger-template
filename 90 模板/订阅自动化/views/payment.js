return async function(dv, app, ledger) {
const d = ledger.domain;
const page = dv.current();
const record = d.payment(page);
const subscriptionPath = record.subscription_path;
const subscriptionFile = app.vault.getAbstractFileByPath(subscriptionPath);
const subscriptionName = subscriptionFile?.basename || page.subscription?.display
  || String(page.subscription ?? "").match(/\|([^\]]+)\]\]$/)?.[1] || "对应订阅";
const formatDate = value => d.asISO(value)?.replaceAll("-", ".") ?? "未记录";
const kindLabel = { renewal: "续费", initial: "首次付款", history: "支出补记" }[record.kind] ?? "付款";
const statusLabel = record.voided || record.status === "voided" ? "已撤销"
  : record.status === "committed" ? "已生效"
  : record.status === "pending" || record.status === "undo_pending" ? "待核对" : "未生效";
const root = dv.container.createDiv({ cls: "subscription-payment-root" });
const back = root.createEl("a", { text: `返回 ${subscriptionName}`, cls: "internal-link subscription-payment-back" });
if (subscriptionPath) {
  back.setAttr("data-href", subscriptionPath);
  back.setAttr("href", subscriptionPath);
}

const hero = root.createDiv({ cls: "subscription-payment-hero" });
const identity = hero.createDiv({ cls: "subscription-payment-identity" });
identity.createSpan({ text: "PAYMENT RECORD", cls: "subscription-payment-kicker" });
identity.createEl("h1", { text: `${subscriptionName} · ${kindLabel}记录` });
const status = identity.createSpan({ text: statusLabel, cls: `subscription-payment-status is-${statusLabel}` });
status.setAttr("aria-label", `记录状态：${statusLabel}`);
const amount = hero.createDiv({ cls: "subscription-payment-amount" });
amount.createSpan({ text: "本笔实付" });
amount.createEl("strong", { text: d.formatMoney(record.amount) });

const facts = root.createDiv({ cls: "subscription-payment-facts" });
for (const [label, value] of [
  ["支付日期", formatDate(record.paid_on)],
  ["记录方式", kindLabel],
  ["订阅周期", String(page.cycle ?? "未记录")]
]) {
  const fact = facts.createDiv({ cls: "subscription-payment-fact" });
  fact.createSpan({ text: label });
  fact.createEl("strong", { text: value });
}

const change = root.createDiv({ cls: "subscription-payment-change" });
change.createSpan({ text: "WHAT CHANGED", cls: "subscription-payment-kicker" });
change.createEl("h2", { text: "本次记录" });
if (record.kind === "renewal") {
  change.createEl("p", { text: record.periods ? `续费 ${record.periods} 期，已将下次日期顺延。` : "已记录本次续费，并顺延下次日期。" });
  const dates = change.createDiv({ cls: "subscription-payment-date-change" });
  const before = dates.createDiv();
  before.createSpan({ text: "续费前下次日期" });
  before.createEl("strong", { text: formatDate(record.previous_date) });
  dates.createSpan({ text: "→", cls: "subscription-payment-arrow" });
  const after = dates.createDiv();
  after.createSpan({ text: "续费后下次日期" });
  after.createEl("strong", { text: formatDate(record.next_date) });
} else if (record.kind === "history") {
  change.createEl("p", { text: "这笔支出仅补记到台账，下次日期没有改变。" });
} else {
  change.createEl("p", { text: "这是订阅档案登记时记录的首笔实付。" });
  if (record.next_date) change.createDiv({ text: `档案登记的下次日期：${formatDate(record.next_date)}`, cls: "subscription-payment-initial-next" });
}
if (record.price_updated) change.createDiv({
  text: `预计续费价：${d.formatMoney(record.price_before)} → ${d.formatMoney(record.price_after)}`,
  cls: "subscription-payment-price-change"
});
if (statusLabel !== "已生效") root.createDiv({
  text: statusLabel === "已撤销" ? "这笔记录已撤销，不再计入已记录实付。" : "这笔记录尚未生效，不计入已记录实付；请返回订阅档案核对。",
  cls: "subscription-payment-notice"
});
};
