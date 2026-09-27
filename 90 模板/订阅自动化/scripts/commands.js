return (app, d, repo) => {
  const message = value => new Notice(value);
  const refresh = async () => {
    try { await app.commands.executeCommandById("dataview:refresh-views"); }
    catch (error) { console.warn("Dataview 刷新失败；下次自动刷新仍会更新页面", error); }
  };
  const launch = async (container, kind, targetPath = null) => {
    const current = app.__subscriptionLedgerContext;
    if (current && Date.now() - current.startedAt < 30 * 60 * 1000) {
      message("已有订阅操作正在进行，请先完成或关闭表单"); return;
    }
    const scope = container.closest(".markdown-preview-view, .markdown-reading-view");
    const selector = kind === "create" ? "subscription-create-trigger"
      : kind === "renew" ? "subscription-renew-trigger" : `subscription-item-${kind}-trigger`;
    const trigger = scope?.querySelector(`.callout[data-callout="${selector}"] button`);
    const context = { kind, targetPath, startedAt: Date.now() };
    app.__subscriptionLedgerContext = context;
    if (trigger) { trigger.click(); return; }
    // Some rendered detail pages do not expose the hidden Meta Bind button.
    // This is the same Templater evaluation path used by Meta Bind's action.
    try {
      const plugin = app.plugins?.plugins?.["templater-obsidian"];
      const templater = plugin?.templater;
      const name = { create: "新建订阅", renew: "记录续费", edit: "编辑订阅", cover: "选择订阅图片" }[kind];
      const template = app.vault.getAbstractFileByPath(`90 模板/订阅自动化/${name}.md`);
      const target = app.vault.getAbstractFileByPath(targetPath ?? d.config.home);
      if (!templater?.read_and_parse_template || !template?.extension || !target?.extension) throw new Error("Templater 操作入口未就绪");
      const config = templater.create_running_config(template, target, 4);
      await templater.read_and_parse_template(config);
    } catch (error) { console.error(error); message(`打开订阅操作失败：${error.message ?? error}`); }
    finally { if (app.__subscriptionLedgerContext === context) app.__subscriptionLedgerContext = null; }
  };
  const open = (tp, title, initial, build, validate) => new Promise(resolve => {
    const { Modal, Setting } = tp.obsidian;
    class Form extends Modal {
      constructor(app) { super(app); this.done = false; this.values = { ...initial }; }
      finish(value) { if (this.done) return; this.done = true; resolve(value); this.close(); }
      onOpen() {
        this.modalEl.addClass("subscription-form-modal");
        this.contentEl.createEl("h2", { text: title });
        build(this.contentEl, this.values, Setting);
        new Setting(this.contentEl).setClass("subscription-form-actions")
          .addButton(button => button.setButtonText("取消").onClick(() => this.finish(null)))
          .addButton(button => button.setButtonText(title === "新增订阅" ? "建立订阅" : "保存").setCta().onClick(() => {
            try { this.finish(validate(this.values)); }
            catch (error) { message(error.message ?? String(error)); }
          }));
      }
      onClose() { this.contentEl.empty(); if (!this.done) { this.done = true; resolve(null); } }
    }
    new Form(app).open();
  });
  const confirmPreview = (tp, title, description, changes) => new Promise(resolve => {
    const { Modal, Setting } = tp.obsidian;
    class Preview extends Modal {
      constructor(app) { super(app); this.done = false; }
      finish(value) { if (this.done) return; this.done = true; resolve(value); this.close(); }
      onOpen() {
        this.modalEl.addClass("subscription-preview-modal");
        this.contentEl.createEl("h2", { text: title });
        this.contentEl.createEl("p", { text: description, cls: "subscription-preview-intro" });
        const list = this.contentEl.createDiv({ cls: "subscription-preview-list" });
        for (const [label, value] of changes) {
          const row = list.createDiv({ cls: "subscription-preview-row" });
          row.createSpan({ text: label }); row.createEl("strong", { text: String(value) });
        }
        new Setting(this.contentEl).setClass("subscription-form-actions")
          .addButton(button => button.setButtonText("取消").onClick(() => this.finish(false)))
          .addButton(button => button.setButtonText("确认写入").setCta().onClick(() => this.finish(true)));
      }
      onClose() { this.contentEl.empty(); if (!this.done) { this.done = true; resolve(false); } }
    }
    new Preview(app).open();
  });
  const field = (el, Setting, name, value, onChange, type = "text", desc = "") => {
    const s = new Setting(el).setName(name); if (desc) s.setDesc(desc);
    s.addText(text => {
      text.inputEl.type = type;
      if (type === "number") { text.inputEl.min = "0"; text.inputEl.step = "0.01"; }
      text.setValue(String(value ?? "")).onChange(onChange);
    });
    return s;
  };
  const select = (el, Setting, name, options, value, onChange, desc = "") => {
    const s = new Setting(el).setName(name); if (desc) s.setDesc(desc);
    s.addDropdown(dropdown => dropdown.addOptions(options).setValue(String(value)).onChange(onChange));
    return s;
  };
  const validateCommon = v => {
    const name = String(v.name ?? "").trim();
    if (!name) throw new Error("请填写订阅名称");
    d.money(v.price);
    if (!d.validDate(v.next_date)) throw new Error("请填写有效的下次扣费或到期日期");
    if (!Object.hasOwn(d.config.months, v.cycle)) throw new Error("订阅周期无效");
    return { ...v, name };
  };
  const create = async tp => {
    const today = d.iso(new Date());
    const v = await open(tp, "新增订阅", {
      name: "", status: "订阅中", renewal_mode: "自动续费", cycle: "月度", price: "",
      next_date: d.addMonths(today, 1), initial_mode: "none", historical_spend: "",
      initial_payment_date: today, initial_amount: ""
    }, (el, v, Setting) => {
      el.createEl("p", { text: "填写订阅规则；首笔实付可以和预计价不同。", cls: "subscription-form-intro" });
      field(el, Setting, "订阅名称", v.name, x => { v.name = x; });
      select(el, Setting, "订阅状态", { "订阅中": "订阅中", "已停用": "已停用" }, v.status, x => { v.status = x; });
      select(el, Setting, "续费方式", { "自动续费": "自动续费", "手动续费": "手动续费" }, v.renewal_mode, x => { v.renewal_mode = x; });
      select(el, Setting, "订阅周期", { "月度": "月度", "季度": "季度", "年度": "年度" }, v.cycle, x => { v.cycle = x; });
      field(el, Setting, "预计续费价", v.price, x => { v.price = x; }, "number");
      field(el, Setting, "下次扣费 / 到期日期", v.next_date, x => { v.next_date = x; }, "date");
      select(el, Setting, "初始支出", { none: "暂不录入", payment: "把本次购买记为首笔支出", history: "填写此前累计支出" }, v.initial_mode, x => { v.initial_mode = x; refreshInitial(); });
      const paid = field(el, Setting, "首笔实际支付", v.initial_amount, x => { v.initial_amount = x; }, "number");
      const paidOn = field(el, Setting, "首笔支付日期", v.initial_payment_date, x => { v.initial_payment_date = x; }, "date");
      const history = field(el, Setting, "此前累计支出", v.historical_spend, x => { v.historical_spend = x; }, "number");
      const refreshInitial = () => {
        paid.settingEl.toggle(v.initial_mode === "payment"); paidOn.settingEl.toggle(v.initial_mode === "payment");
        history.settingEl.toggle(v.initial_mode === "history");
      };
      refreshInitial();
    }, v => {
      const result = validateCommon(v);
      if (v.initial_mode === "payment") { d.money(v.initial_amount); if (!d.validDate(v.initial_payment_date)) throw new Error("首笔支付日期无效"); }
      if (v.initial_mode === "history") d.money(v.historical_spend);
      return result;
    });
    if (!v) return;
    const initial = v.initial_mode === "payment" ? `首笔实付 ${d.formatMoney(v.initial_amount)} · ${v.initial_payment_date}`
      : v.initial_mode === "history" ? `此前累计 ${d.formatMoney(v.historical_spend)}` : "暂不录入";
    if (!await confirmPreview(tp, "确认新增订阅", "将创建一份订阅档案；首笔实付与预计价格分别保存。", [
      ["服务", v.name], ["状态 / 方式", `${v.status} · ${v.renewal_mode}`],
      ["预计价", `${d.formatMoney(v.price)} / ${v.cycle.replace("度", "")}`],
      ["下次日期", v.next_date], ["初始支出", initial]
    ])) return;
    const outcome = await repo.createSubscription(v, "90 模板/订阅自动化/订阅档案母版.md");
    if (outcome.initialPaymentError) message("订阅已建立，但首笔支出未保存。请在档案中选择“仅补记支出”，不会额外顺延日期。");
    else message(`「${v.name}」已加入订阅账簿`);
    await app.workspace.getLeaf(false).openFile(outcome.file);
  };
  const edit = async (tp, path) => {
    const { data, file } = repo.getItem(path);
    const v = await open(tp, "编辑订阅", {
      name: String(data.name ?? file.basename), status: String(data.status),
      renewal_mode: String(data.renewal_mode), cycle: String(data.cycle),
      price: String(data.price ?? ""), next_date: d.asISO(data.next_date) ?? "",
      historical_spend: data.historical_spend_known === true ? String(data.historical_spend ?? 0) : ""
    }, (el, v, Setting) => {
      el.createEl("p", { text: data.status === "已停用"
        ? "重新启用前请核对预计价和下次日期，并将状态改为“订阅中”；实际支出另行记录。"
        : "这里修改未来规则；实际支出由记录续费负责。", cls: "subscription-form-intro" });
      field(el, Setting, "显示名称", v.name, x => { v.name = x; });
      select(el, Setting, "订阅状态", { "订阅中": "订阅中", "已停用": "已停用" }, v.status, x => { v.status = x; });
      select(el, Setting, "续费方式", { "自动续费": "自动续费", "手动续费": "手动续费" }, v.renewal_mode, x => { v.renewal_mode = x; });
      select(el, Setting, "订阅周期", { "月度": "月度", "季度": "季度", "年度": "年度" }, v.cycle, x => { v.cycle = x; });
      field(el, Setting, "预计续费价", v.price, x => { v.price = x; }, "number");
      field(el, Setting, "下次扣费 / 到期日期", v.next_date, x => { v.next_date = x; }, "date");
      field(el, Setting, "此前累计支出", v.historical_spend, x => { v.historical_spend = x; }, "number", "留空表示历史未核实；明确填 0 表示确认没有此前支出");
    }, validateCommon);
    if (!v) return;
    const changes = [
      ["名称", data.name, v.name], ["状态", data.status, v.status], ["续费方式", data.renewal_mode, v.renewal_mode],
      ["周期", data.cycle, v.cycle], ["预计价", data.price, v.price],
      ["下次日期", d.asISO(data.next_date), v.next_date],
      ["此前累计", data.historical_spend_known === true ? data.historical_spend : "未核实", v.historical_spend || "未核实"]
    ].filter(([, before, after]) => String(before ?? "") !== String(after ?? ""))
      .map(([label, before, after]) => [label, `${before ?? "未填"} → ${after ?? "未填"}`]);
    if (!changes.length) { message("没有需要保存的修改"); return; }
    if (!await confirmPreview(tp, "确认编辑订阅", "仅修改未来规则；已有实付流水不会重算。", changes)) return;
    await repo.editSubscription(path, v);
    message("订阅信息已更新"); await refresh();
  };
  const renew = async (tp, initialPath) => {
    const all = repo.itemFiles().map(f => ({ file: f, item: d.subscription({ ...repo.front(f), file: f }) }));
    if (!all.length) { message("还没有可记录的订阅"); return; }
    let selected = all.find(x => x.file.path === initialPath) ?? all.find(x => x.item.status === "订阅中") ?? all[0];
    const v = await open(tp, "记录续费", {
      target_path: selected.file.path, kind: selected.item.status === "已停用" ? "history" : "renewal",
      paid_on: d.iso(new Date()), amount: String(selected.item.price ?? ""), periods: "1",
      next_date_after: "", update_price: false
    }, (el, v, Setting) => {
      el.createEl("p", { text: "确认本期续费会顺延日期；仅补记支出不会改变日期。", cls: "subscription-form-intro" });
      const options = Object.fromEntries(all.map(x => [x.file.path, x.item.name]));
      if (initialPath) new Setting(el).setName("续费项目").setDesc("已从当前订阅进入，本次项目已锁定").setClass("subscription-form-locked-project").controlEl.createSpan({ text: selected.item.name });
      else select(el, Setting, "续费项目", options, v.target_path, x => {
        v.target_path = x; selected = all.find(a => a.file.path === x);
        v.amount = String(selected.item.price ?? ""); amountInput?.setValue(v.amount);
        if (selected.item.status === "已停用") {
          v.kind = "history"; kindSetting.settingEl.querySelector("select").value = "history";
          periodField.settingEl.toggle(false); afterField.settingEl.toggle(false);
        }
      });
      const kindSetting = select(el, Setting, "记录方式", { renewal: "确认本期续费（顺延日期）", history: "仅补记支出（日期不变）" }, v.kind, x => {
        v.kind = x; periodField.settingEl.toggle(x === "renewal"); afterField.settingEl.toggle(x === "renewal");
      });
      let amountInput;
      new Setting(el).setName("本次实际支付").addText(text => {
        text.inputEl.type = "number"; text.inputEl.min = "0"; text.inputEl.step = "0.01";
        amountInput = text; text.setValue(v.amount).onChange(x => { v.amount = x; });
      });
      field(el, Setting, "支付日期", v.paid_on, x => { v.paid_on = x; }, "date");
      const periodField = field(el, Setting, "续费期数", v.periods, x => { v.periods = x; }, "number", "一次购买多期时填写期数");
      periodField.settingEl.toggle(v.kind === "renewal");
      const afterField = field(el, Setting, "续后下次日期", v.next_date_after, x => { v.next_date_after = x; }, "date", "留空按期数计算；服务商给出明确日期时可填写");
      afterField.settingEl.toggle(v.kind === "renewal");
      new Setting(el).setName("同步更新预计价").setDesc("仅以后大概率都按这个价格时启用")
        .addToggle(t => t.setValue(false).onChange(x => { v.update_price = x; }));
    }, v => {
      d.money(v.amount);
      if (selected.item.status === "已停用" && v.kind === "renewal") throw new Error("已停用项目只能补记支出；重新启用请先核对规则");
      if (!d.validDate(v.paid_on)) throw new Error("支付日期无效");
      if (v.kind === "renewal" && (!/^\d+$/.test(String(v.periods)) || Number(v.periods) < 1 || Number(v.periods) > 120)) throw new Error("续费期数应为 1 至 120");
      if (v.kind === "renewal" && v.next_date_after && !d.validDate(v.next_date_after)) throw new Error("续后下次日期无效");
      if (v.kind === "renewal" && v.next_date_after && v.next_date_after <= selected.item.next_date) throw new Error("续后下次日期必须晚于原日期");
      return v;
    });
    if (!v) return;
    const item = d.subscription({ ...repo.getItem(v.target_path).data, file: repo.getItem(v.target_path).file });
    const next = v.kind === "history" ? item.next_date : v.next_date_after ||
      d.addMonths(item.next_date > v.paid_on ? item.next_date : v.paid_on, d.config.months[item.cycle] * Number(v.periods), item.anchor_day);
    if (!await confirmPreview(tp, "确认记录实付", "请核对这次操作会修改的账目。", [
      ["服务", item.name], ["记录方式", v.kind === "history" ? "仅补记支出" : `确认续费 · ${v.periods} 期`],
      ["实付 / 日期", `${d.formatMoney(v.amount)} · ${v.paid_on}`],
      ["下次日期", v.kind === "history" ? `${item.next_date}（不变）` : `${item.next_date} → ${next}`],
      ["预计价", v.update_price ? `${d.formatMoney(item.price)} → ${d.formatMoney(v.amount)}` : `${d.formatMoney(item.price)}（不变）`]
    ])) return;
    const existing = await repo.duplicate(item, v.paid_on, Number(v.amount), v.kind);
    if (existing && !window.confirm("已有同项目、同日、同金额的有效记录。确认这是另一笔独立付款？")) return;
    const result = await repo.recordPayment(v.target_path, v);
    message(v.kind === "history" ? "历史支出已记录，服务日期未改变" : `续费已记录，下次日期为 ${result.nextDate}`);
    await refresh();
    if (app.workspace.getActiveFile()?.path !== d.config.home) await app.workspace.getLeaf(false).openFile(repo.getItem(v.target_path).file);
  };
  const run = async (kind, tp) => {
    const context = app.__subscriptionLedgerContext;
    try {
      const recovery = await repo.recoverPending();
      const unresolved = recovery.filter(x => x.status === "needs_attention");
      if (unresolved.length) throw new Error(`有 ${unresolved.length} 笔未完成操作需要核对，已暂停新增写入`);
      if (recovery.some(x => x.status === "recovered")) {
        message("此前未完成的订阅记录已恢复，请先核对账目，再进行下一笔操作");
        await refresh(); return;
      }
      if (recovery.some(x => x.status === "reverted")) {
        message("此前未完成的操作已回退，请先核对账目，再重新操作");
        await refresh(); return;
      }
      const active = app.workspace.getActiveFile();
      const path = context?.kind === kind ? context.targetPath : active && repo.front(active)?.type === "subscription" ? active.path : null;
      if (kind === "create") await create(tp);
      else if (kind === "edit") await edit(tp, path);
      else if (kind === "renew") await renew(tp, path);
      else throw new Error("未知订阅操作");
    } catch (error) { console.error(error); message(error.message ?? String(error)); }
    finally { if (app.__subscriptionLedgerContext === context) app.__subscriptionLedgerContext = null; }
  };
  const toggleStatus = async path => {
    try {
      const recovery = await repo.recoverPending();
      if (recovery.some(x => x.status === "needs_attention")) throw new Error("有待核对的续费操作，暂不能修改状态");
      if (recovery.length) { await refresh(); message("此前未完成的操作已处理，请先核对账目，再修改状态"); return; }
      const item = repo.getItem(path).data;
      if (item.status === "已停用") throw new Error("重新启用前请在编辑表单核对预计价和下次日期");
      if (!window.confirm(`在本地台账停用「${item.name}」？\n\n停用后它不会计入未来预计支出；这不会取消服务平台的自动续费，请另行确认平台设置。`)) return;
      await repo.setStatus(path, "已停用"); await refresh();
      message("已在本地台账停用；请另行确认服务平台的续费设置");
    } catch (error) { message(error.message ?? String(error)); }
  };
  const undo = async (itemPath, paymentPath, summary) => {
    try {
      const recovery = await repo.recoverPending();
      if (recovery.some(x => x.status === "needs_attention")) throw new Error("有待核对的续费操作，暂不能撤销");
      if (recovery.length) { await refresh(); message("此前未完成的操作已处理，请先核对账目，再撤销"); return; }
      const paymentFile = app.vault.getAbstractFileByPath(paymentPath);
      const record = paymentFile?.extension ? repo.front(paymentFile) : null;
      if (!record || record.type !== "subscription_payment") throw new Error("找不到这笔续费记录");
      const effects = ["这笔实付将从累计支出中剔除，原记录会保留在已撤销归档。"];
      if (record.kind === "renewal" && d.asISO(record.previous_date) && d.asISO(record.previous_date) !== d.asISO(record.next_date))
        effects.push(`下次日期：${d.asISO(record.next_date)} → ${d.asISO(record.previous_date)}`);
      if (record.price_updated === true)
        effects.push(`预计价：${d.formatMoney(record.price_after ?? record.amount)} → ${d.formatMoney(record.price_before ?? record.standard_price_before)}`);
      if (!window.confirm(`撤销 ${summary} 的支出记录？\n\n${effects.join("\n")}\n\n确认后才会修改账目。`)) return;
      await repo.voidPayment(itemPath, paymentPath); await refresh(); message("记录已撤销"); }
    catch (error) { console.error(error); message(error.message ?? String(error)); }
  };
  return { run, launch, toggleStatus, undo, refresh };
};
