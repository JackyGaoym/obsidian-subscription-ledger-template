// Shared pure rules. Loaded from the vault; no Node.js or Obsidian globals.
return (() => {
  const config = Object.freeze({
    root: "30 订阅",
    items: "30 订阅/项目",
    payments: "30 订阅/_续费记录",
    home: "30 订阅/订阅主页.md",
    currency: "CNY",
    months: { "月度": 1, "季度": 3, "年度": 12 }
  });
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const validDate = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    const actual = new Date(y, m - 1, d);
    return actual.getFullYear() === y && actual.getMonth() === m - 1 && actual.getDate() === d;
  };
  const asISO = value => {
    if (!value) return null;
    if (value instanceof Date) return iso(value);
    if (typeof value.toJSDate === "function") return iso(value.toJSDate());
    const raw = String(value).slice(0, 10);
    return validDate(raw) ? raw : null;
  };
  const addMonths = (value, months, anchorDay) => {
    const source = asISO(value);
    if (!source || !Number.isInteger(months) || months < 0) throw new Error("日期或周期无效");
    const [y, m, day] = source.split("-").map(Number);
    const target = new Date(y, m - 1 + months, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(anchorDay || day, last));
    return iso(target);
  };
  const money = value => {
    const raw = String(value ?? "").trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) throw new Error("金额不能为空，且最多保留两位小数");
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isSafeInteger(cents)) throw new Error("金额过大");
    return cents;
  };
  const yuan = cents => cents / 100;
  const cents = value => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
  };
  const formatMoney = (value, digits = null) => {
    const c = cents(value);
    if (c === null) return "—";
    const n = yuan(c), d = digits ?? (c % 100 === 0 ? 0 : 2);
    return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  };
  const pathOf = value => value?.path ?? String(value ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0];
  const subscription = page => {
    const path = page.file?.path ?? page.path;
    const rawHistorical = page.historical_spend;
    return {
      id: String(page.subscription_id ?? ""), path,
      name: String(page.name || page.file?.name || "未命名订阅"),
      status: String(page.status), renewal_mode: String(page.renewal_mode), cycle: String(page.cycle),
      price: cents(page.price) === null ? null : Number(page.price),
      next_date: asISO(page.next_date),
      anchor_day: Number(page.billing_anchor_day) || Number(asISO(page.next_date)?.slice(-2)) || null,
      historical_spend: cents(rawHistorical) === null ? null : Number(rawHistorical),
      historical_spend_known: page.historical_spend_known === true,
      cover: pathOf(page.cover), revision: Number(page.revision) || 0,
      last_operation_id: String(page.last_operation_id ?? "")
    };
  };
  const payment = page => ({
    id: String(page.payment_id ?? page.file?.path ?? ""),
    path: page.file?.path ?? page.path,
    subscription_id: String(page.subscription_id ?? ""),
    subscription_path: pathOf(page.subscription),
    paid_on: asISO(page.paid_on ?? page.payment_date),
    amount: cents(page.amount) === null ? null : Number(page.amount),
    kind: String(page.kind ?? "renewal"),
    status: String(page.operation_status ?? "committed"),
    voided: page.voided === true,
    created_at: String(page.created_at ?? ""),
    previous_date: asISO(page.previous_date),
    next_date: asISO(page.next_date),
    periods: Number(page.periods) || null,
    price_updated: page.price_updated === true,
    price_before: cents(page.price_before ?? page.standard_price_before) === null ? null : Number(page.price_before ?? page.standard_price_before),
    price_after: cents(page.price_after) === null ? null : Number(page.price_after),
    voided_at: String(page.voided_at ?? ""),
    operation_id: String(page.operation_id ?? "")
  });
  const effective = p => !p.voided && p.status === "committed";
  const aggregate = (items, records, today = iso(new Date())) => {
    const byId = new Map(), byPath = new Map(), itemById = new Map();
    for (const item of items) { byId.set(item.id, []); byPath.set(item.path, item); itemById.set(item.id, item); }
    for (const record of records) {
      if (!effective(record)) continue;
      const target = record.subscription_id ? itemById.get(record.subscription_id) : byPath.get(record.subscription_path);
      if (target) byId.get(target.id).push(record);
    }
    const rows = items.map(item => {
      const list = byId.get(item.id) ?? [];
      const historicalCents = item.historical_spend_known ? (cents(item.historical_spend) ?? 0) : 0;
      const recordCents = list.reduce((n, p) => n + (cents(p.amount) ?? 0), 0);
      return { ...item, records: list, recorded_spend: yuan(historicalCents + recordCents), has_spend_data: item.historical_spend_known || list.length > 0 };
    });
    const active = rows.filter(x => x.status === "订阅中");
    const monthlyCents = active.reduce((n, x) => n + (cents(x.price) ?? 0) / (config.months[x.cycle] || 1), 0);
    const horizon = addDays(today, 30);
    const due = active.filter(x => x.next_date && x.next_date >= today && x.next_date < horizon);
    let dueCents = 0;
    for (const item of due) {
      let date = item.next_date;
      for (let count = 0; date < horizon && count < 31; count++) {
        dueCents += cents(item.price) ?? 0;
        date = addMonths(date, config.months[item.cycle] || 1, item.anchor_day);
      }
    }
    const upcoming = active.filter(x => x.next_date && x.next_date >= today).sort((a, b) => a.next_date.localeCompare(b.next_date));
    const overdue = active.filter(x => x.next_date && x.next_date < today).sort((a, b) => a.next_date.localeCompare(b.next_date));
    return { rows, active, monthly: yuan(monthlyCents), annual: yuan(monthlyCents * 12),
      recorded: rows.reduce((n, x) => n + x.recorded_spend, 0), tracked: rows.filter(x => x.has_spend_data).length,
      due, upcoming, overdue,
      dueTotal: dueCents / 100 };
  };
  const addDays = (value, days) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(y, m - 1, d + days);
    return iso(date);
  };
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { config, iso, asISO, validDate, addMonths, addDays, money, yuan, cents, formatMoney, pathOf, subscription, payment, effective, aggregate, uuid };
})();
