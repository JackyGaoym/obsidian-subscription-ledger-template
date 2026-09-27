return (app, d) => {
  const { config } = d;
  const err = text => { throw new Error(text); };
  const markdown = () => app.vault.getMarkdownFiles();
  const front = file => app.metadataCache.getFileCache(file)?.frontmatter ?? null;
  const readFront = async file => {
    const cached = front(file);
    if (cached) return cached;
    const source = await app.vault.read(file);
    const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!block) return null;
    const data = {};
    for (const line of block[1].split(/\r?\n/)) {
      const match = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (!match) continue;
      try { data[match[1]] = JSON.parse(match[2]); }
      catch { data[match[1]] = match[2] || null; }
    }
    return data;
  };
  const itemFiles = () => markdown().filter(f => f.path.startsWith(`${config.items}/`) && front(f)?.type === "subscription");
  const paymentFiles = () => markdown().filter(f => f.path.startsWith(`${config.payments}/`) && front(f)?.type === "subscription_payment");
  const getItem = path => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file?.extension || !file.path.startsWith(`${config.items}/`) || front(file)?.type !== "subscription") err("找不到对应的订阅档案");
    return { file, data: front(file) };
  };
  const byId = id => itemFiles().find(f => String(front(f).subscription_id ?? "") === String(id));
  const check = (fm, id, revision) => {
    if (fm.type !== "subscription" || String(fm.subscription_id ?? "") !== String(id)) err("订阅身份已变化，请重新打开");
    if ((Number(fm.revision) || 0) !== revision) err("订阅已在别处修改，请重新打开后重试");
  };
  const ensureFolder = async path => {
    if (app.vault.getAbstractFileByPath(path)) return;
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (parent) await ensureFolder(parent);
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  };
  const yaml = value => value == null ? "null" : typeof value === "string" || Array.isArray(value) ? JSON.stringify(value) : String(value);
  const recordText = data => [
    "---", ...Object.entries({ ...data, cssclasses: ["subscription-payment"] }).map(([key, value]) => `${key}: ${yaml(value)}`), "---", "",
    "```dataviewjs",
    "const bootstrap = new Function(await app.vault.adapter.read(\"90 模板/订阅自动化/scripts/bootstrap.js\"))();",
    "const ledger = await bootstrap(app);",
    "const render = new Function(await app.vault.adapter.read(\"90 模板/订阅自动化/views/payment.js\"))();",
    "await render(dv, app, ledger);",
    "```", ""
  ].join("\n");
  const recordPath = (name, paidOn, kind) => {
    const safe = String(name).replace(/[\\/:*?"<>|]/g, "-").slice(0, 48);
    const label = { initial: "首次付款", history: "支出补记", renewal: "续费记录" }[kind] ?? "付款记录";
    const base = `${config.payments}/${paidOn.slice(0, 4)}/${safe} · ${paidOn} · ${label}`;
    let output = `${base}.md`;
    for (let sequence = 2; app.vault.getAbstractFileByPath(output); sequence++) output = `${base}（${sequence}）.md`;
    return output;
  };
  const listPayments = () => paymentFiles().map(f => ({ file: f, ...d.payment({ ...front(f), file: f }) }));
  const forItem = (item, records = listPayments()) => records.filter(p => p.subscription_id ? p.subscription_id === item.id : p.subscription_path === item.path);
  const duplicate = async (item, paidOn, amount, kind) => {
    for (const file of markdown().filter(f => f.path.startsWith(`${config.payments}/`))) {
      const fm = await readFront(file);
      if (fm?.type !== "subscription_payment") continue;
      const p = d.payment({ ...fm, file });
      if ((p.subscription_id ? p.subscription_id === item.id : p.subscription_path === item.path)
        && d.effective(p) && p.paid_on === paidOn && d.cents(p.amount) === d.cents(amount) && p.kind === kind) return p;
    }
    return null;
  };
  const recoverPending = async () => {
    const results = [];
    for (const f of markdown().filter(file => file.path.startsWith(`${config.payments}/`))) {
      const data = await readFront(f);
      if (!data || !["pending", "undo_pending"].includes(String(data.operation_status))) continue;
      const target = byId(data.subscription_id);
      if (!target) { results.push({ path: f.path, status: "needs_attention" }); continue; }
      try {
        if (data.operation_status === "pending") {
          const revision = Number(data.base_revision) || 0;
          const current = front(target);
          if (String(current.last_operation_id ?? "") !== String(data.operation_id)) {
            const currentRevision = Number(current.revision) || 0;
            const dateChanged = d.asISO(current.next_date) !== d.asISO(data.previous_date);
            const priceChanged = Number(current.price) !== Number(data.price_before);
            if (currentRevision !== revision || dateChanged || priceChanged) {
              // Two or more intervening writes could include this operation followed by
              // another edit. That history cannot be inferred from the final snapshot.
              if (currentRevision > revision + 1) {
                results.push({ path: f.path, status: "needs_attention" }); continue;
              }
              // Another edit won the race before this payment affected the item.
              // Keep the audit trail, but exclude this uncommitted payment from totals.
              await app.fileManager.processFrontMatter(f, fm => {
                if (fm.operation_status === "pending") {
                  fm.operation_status = "failed";
                  fm.failure_reason = "订阅档案在记录提交前发生变化";
                }
              });
              results.push({ path: f.path, status: "reverted" }); continue;
            }
            await app.fileManager.processFrontMatter(target, fm => {
              check(fm, String(data.subscription_id), revision);
              if (d.asISO(fm.next_date) !== d.asISO(data.previous_date)) err("日期已变化，无法自动恢复");
              if (Number(fm.price) !== Number(data.price_before)) err("预计价已变化，无法自动恢复");
              if (data.kind === "renewal") fm.next_date = d.asISO(data.next_date);
              if (data.price_updated === true) fm.price = Number(data.price_after);
              fm.last_operation_id = String(data.operation_id);
              fm.revision = revision + 1;
            });
          }
          await app.fileManager.processFrontMatter(f, fm => { fm.operation_status = "committed"; });
          results.push({ path: f.path, status: "recovered" });
        } else {
          const current = front(target);
          if (String(current.last_operation_id ?? "") === String(data.void_operation_id)) {
            await app.fileManager.processFrontMatter(f, fm => { fm.operation_status = "voided"; fm.voided = true; fm.voided_at = new Date().toISOString(); });
            results.push({ path: f.path, status: "recovered" });
          } else {
            await app.fileManager.processFrontMatter(f, fm => { fm.operation_status = "committed"; fm.void_operation_id = null; });
            results.push({ path: f.path, status: "reverted" });
          }
        }
      } catch (error) { results.push({ path: f.path, status: "needs_attention", error: String(error) }); }
    }
    return results;
  };
  const createSubscription = async (values, templatePath) => {
    const price = d.yuan(d.money(values.price));
    if (!d.validDate(values.next_date)) err("下次日期无效");
    const name = String(values.name ?? "").trim();
    if (!name) err("订阅名称不能为空");
    if (!Object.hasOwn(config.months, values.cycle)) err("订阅周期无效");
    const historical = values.initial_mode === "history" ? d.yuan(d.money(values.historical_spend)) : null;
    await ensureFolder(config.items);
    const safe = name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 70);
    let folder = `${config.items}/${safe}`, suffix = 2;
    while (app.vault.getAbstractFileByPath(folder)) folder = `${config.items}/${safe} ${suffix++}`;
    await app.vault.createFolder(folder);
    const path = `${folder}/${folder.split("/").at(-1)}.md`;
    const sourceFile = app.vault.getAbstractFileByPath(templatePath);
    if (!sourceFile?.extension) err("找不到订阅档案母版");
    let content = await app.vault.read(sourceFile);
    const id = d.uuid();
    const replacements = {
      "{{SUBSCRIPTION_ID}}": yaml(id), "{{NAME_YAML}}": yaml(name), "{{STATUS_YAML}}": yaml(values.status),
      "{{RENEWAL_MODE_YAML}}": yaml(values.renewal_mode), "{{CYCLE_YAML}}": yaml(values.cycle),
      "{{PRICE}}": String(price), "{{NEXT_DATE}}": values.next_date,
      "{{HISTORICAL_SPEND}}": historical == null ? "null" : String(historical),
      "{{HISTORICAL_KNOWN}}": String(values.initial_mode === "history"),
      "{{ANCHOR_DAY}}": String(Number(values.next_date.slice(-2)))
    };
    for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value);
    const file = await app.vault.create(path, content);
    let initialPaymentError = null;
    if (values.initial_mode === "payment") {
      try {
        const paidOn = values.initial_payment_date;
        if (!d.validDate(paidOn)) err("首笔实付日期无效");
        const amount = d.yuan(d.money(values.initial_amount));
        const paymentId = d.uuid();
        await ensureFolder(`${config.payments}/${paidOn.slice(0, 4)}`);
        await app.vault.create(recordPath(name, paidOn, "initial"), recordText({
          type: "subscription_payment", schema_version: 2, payment_id: paymentId, subscription_id: id,
          subscription: `[[${path}|${name}]]`, payment_date: paidOn, paid_on: paidOn,
          amount, currency: config.currency, kind: "initial", cycle: values.cycle,
          previous_date: null, next_date: values.next_date, created_at: new Date().toISOString(),
          operation_id: paymentId, operation_status: "committed", voided: false
        }));
      } catch (error) { initialPaymentError = error; }
    }
    return { file, initialPaymentError };
  };
  const editSubscription = async (path, values) => {
    const { file, data } = getItem(path), id = String(data.subscription_id), revision = Number(data.revision) || 0;
    const price = d.yuan(d.money(values.price));
    const historical = String(values.historical_spend ?? "").trim() === "" ? null : d.yuan(d.money(values.historical_spend));
    if (!String(values.name ?? "").trim()) err("显示名称不能为空");
    if (!d.validDate(values.next_date)) err("下次日期无效");
    if (!Object.hasOwn(config.months, values.cycle)) err("订阅周期无效");
    await app.fileManager.processFrontMatter(file, fm => {
      check(fm, id, revision);
      fm.name = String(values.name).trim(); fm.status = values.status;
      fm.renewal_mode = values.renewal_mode; fm.cycle = values.cycle;
      fm.price = price; fm.next_date = values.next_date;
      fm.historical_spend = historical; fm.historical_spend_known = historical !== null;
      fm.billing_anchor_day = Number(values.next_date.slice(-2));
      fm.revision = revision + 1;
    });
    return file;
  };
  const setStatus = async (path, nextStatus) => {
    const { file, data } = getItem(path), id = String(data.subscription_id), revision = Number(data.revision) || 0;
    if (!["订阅中", "已停用"].includes(nextStatus)) err("订阅状态无效");
    await app.fileManager.processFrontMatter(file, fm => { check(fm, id, revision); fm.status = nextStatus; fm.revision = revision + 1; });
  };
  const recordPayment = async (path, values) => {
    const { file, data } = getItem(path), item = d.subscription({ ...data, file });
    const kind = values.kind === "history" ? "history" : "renewal";
    if (kind === "renewal" && item.status === "已停用") err("已停用的订阅不能续期；可以选择仅补记历史支出");
    if (!d.validDate(values.paid_on)) err("支付日期无效");
    const amount = d.yuan(d.money(values.amount));
    const revisedPrice = values.update_price ? amount : item.price;
    const periods = kind === "renewal" ? Number(values.periods ?? 1) : 0;
    if (!Number.isInteger(periods) || periods < 0 || periods > 120 || (kind === "renewal" && periods < 1)) err("续期数量应为 1 至 120 期");
    if (!item.next_date) err("订阅档案的下次日期无效");
    const override = String(values.next_date_after ?? "").trim();
    if (override && kind !== "renewal") err("仅补记支出不能修改下次日期");
    if (override && !d.validDate(override)) err("续后日期无效");
    const newDate = kind === "renewal" ? override || d.addMonths(
      item.next_date > values.paid_on ? item.next_date : values.paid_on,
      config.months[item.cycle] * periods, item.anchor_day) : item.next_date;
    const op = String(values.operation_id || d.uuid());
    if (!/^[A-Za-z0-9-]{1,80}$/.test(op)) err("操作 ID 无效");
    for (const existingFile of markdown().filter(f => f.path.startsWith(`${config.payments}/`))) {
      const existing = await readFront(existingFile);
      if (String(existing?.operation_id ?? "") !== op) continue;
      if (String(existing.subscription_id) !== item.id || d.asISO(existing.paid_on) !== values.paid_on
        || d.cents(existing.amount) !== d.cents(amount) || String(existing.kind) !== kind
        || Number(existing.periods) !== periods || (existing.price_updated === true) !== (values.update_price === true)
        || (override && d.asISO(existing.next_date) !== override)) err("操作 ID 与已有记录不一致");
      if (existing.operation_status === "pending") {
        await recoverPending();
        const settled = await readFront(existingFile);
        if (settled.operation_status !== "committed") err("上次操作尚未完成，请核对待处理流水");
      } else if (existing.operation_status !== "committed") err("这次操作已关闭，不能重复提交");
      return { output: existingFile.path, nextDate: d.asISO(existing.next_date) };
    }
    if (override && override <= item.next_date) err("续后日期必须晚于原日期");
    const paymentId = op;
    const record = {
      type: "subscription_payment", schema_version: 2, payment_id: paymentId,
      subscription_id: item.id, subscription: `[[${path}|${item.name}]]`,
      payment_date: values.paid_on, paid_on: values.paid_on, amount, currency: config.currency,
      kind, periods, cycle: item.cycle, previous_date: item.next_date, next_date: newDate,
      price_before: item.price, price_after: revisedPrice, price_updated: values.update_price === true,
      base_revision: item.revision, operation_id: op, created_at: new Date().toISOString(),
      operation_status: "pending", voided: false
    };
    await ensureFolder(`${config.payments}/${values.paid_on.slice(0, 4)}`);
    const output = recordPath(item.name, values.paid_on, kind);
    if (app.vault.getAbstractFileByPath(output)) err("本次操作已有暂存流水，请稍后重试");
    await app.vault.create(output, recordText(record));
    try {
      await app.fileManager.processFrontMatter(file, fm => {
        check(fm, item.id, item.revision);
        if (d.asISO(fm.next_date) !== item.next_date || Number(fm.price) !== item.price) err("订阅规则已变化，请检查待恢复记录");
        if (kind === "renewal") fm.next_date = newDate;
        if (values.update_price) fm.price = revisedPrice;
        fm.revision = item.revision + 1;
        fm.last_operation_id = op;
      });
      const recordFile = app.vault.getAbstractFileByPath(output);
      await app.fileManager.processFrontMatter(recordFile, fm => { fm.operation_status = "committed"; });
    } catch (error) {
      throw new Error(`记录已暂存但尚未完成，重新进入订阅模块会尝试恢复。原因：${error.message ?? error}`);
    }
    return { output, nextDate: newDate };
  };
  const voidPayment = async (itemPath, paymentPath) => {
    const { file: itemFile, data: item } = getItem(itemPath);
    const paymentFile = app.vault.getAbstractFileByPath(paymentPath), record = paymentFile?.extension ? front(paymentFile) : null;
    if (!record || record.type !== "subscription_payment") err("找不到这笔续费记录");
    if (record.voided === true || ![undefined, null, "committed"].includes(record.operation_status)) err("这笔记录尚未完成或已撤销");
    const targetId = String(record.subscription_id ?? "");
    if (targetId ? targetId !== String(item.subscription_id) : d.pathOf(record.subscription) !== itemPath) err("流水与订阅不匹配");
    const previous = d.asISO(record.previous_date), after = d.asISO(record.next_date);
    const affectsDate = String(record.kind ?? "renewal") === "renewal" && !!previous && after !== previous;
    const affectsPrice = record.price_updated === true;
    if (affectsDate && d.asISO(item.next_date) !== after) err("之后已修改日期；不能自动撤销，请先核对档案");
    if (affectsPrice && Number(item.price) !== Number(record.price_after ?? record.amount)) err("之后已修改预计价格；不能自动撤销");
    const later = forItem(d.subscription({ ...item, file: itemFile })).filter(p => d.effective(p) && p.path !== paymentPath && p.created_at && p.created_at > String(record.created_at ?? ""));
    if (later.length && (affectsDate || affectsPrice)) err("之后还有操作；不能直接回滚这笔续期");
    const revision = Number(item.revision) || 0, op = d.uuid();
    await app.fileManager.processFrontMatter(paymentFile, fm => {
      if (fm.voided === true) err("这笔记录已经撤销");
      fm.operation_status = "undo_pending"; fm.void_operation_id = op;
    });
    try {
      await app.fileManager.processFrontMatter(itemFile, fm => {
        check(fm, String(item.subscription_id), revision);
        if (affectsDate) fm.next_date = previous;
        if (affectsPrice) fm.price = Number(record.price_before ?? record.standard_price_before);
        fm.revision = revision + 1; fm.last_operation_id = op;
      });
      await app.fileManager.processFrontMatter(paymentFile, fm => {
        fm.operation_status = "voided"; fm.voided = true; fm.voided_at = new Date().toISOString();
      });
    } catch (error) { throw new Error(`撤销尚未完成，下次打开将尝试恢复：${error.message ?? error}`); }
    // The void flag is authoritative; moving to archive is best effort.
    try {
      await ensureFolder(`${config.payments}/_已撤销`);
      const target = `${config.payments}/_已撤销/${paymentFile.name}`;
      if (!app.vault.getAbstractFileByPath(target)) await app.fileManager.renameFile(paymentFile, target);
    } catch (error) { console.warn("续费撤销已生效，但归档移动失败", error); }
  };
  return { config, front, itemFiles, paymentFiles, listPayments, forItem, duplicate,
    recoverPending, getItem, createSubscription, editSubscription, setStatus, recordPayment, voidPayment };
};
