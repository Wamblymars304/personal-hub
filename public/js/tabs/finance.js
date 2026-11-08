// Finance — same data and rules as finance_tab.py: assets fed by income and drawn down by expenses,
// expense/income logs (deleting refunds/reverses balances), spending trend, income vs spending,
// categories, monthly breakdown, recurring bills with projections, debts with payments, wishlist.
// Efficiency change: the four big forms are one "Log" bar with a type switch.
import { db, commit, newId, today, iso, parseDate, normDate, monthly, recurringOccurrences } from "../store.js";
import { esc, fmtDate, relDay, money, chip, empty, plural, toast, PRIORITY } from "../ui.js";
import { line, dualBars, donut } from "../charts.js";

const DEFAULT_CATS = ["Food", "Transport", "Entertainment", "Shopping", "Health", "Utilities", "Education", "Travel", "Other"];
const CAT_COLORS = ["var(--purple)", "var(--cyan)", "var(--orange)", "var(--pink)", "var(--green)", "var(--amber)", "#a78bfa", "#34d399", "#fdba74", "#60a5fa"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ui = { kind: "expense", trend: "day", range: "month", horizon: 6, expAll: false, incAll: false, pay: null, bills: false };

const sum = (l, k = "amount") => l.reduce((a, x) => a + (+x[k] || 0), 0);
const assetTotal = (type) => sum(db.assets.filter((a) => !type || (a.assetType || "Bank Account") === type));
const curMonth = () => today().slice(0, 7);
function monthTotals(list) { const t = {}; list.forEach((e) => { const d = normDate(e.date); if (d) t[d.slice(0, 7)] = (t[d.slice(0, 7)] || 0) + (+e.amount || 0); }); return t; }
const categories = () => [...DEFAULT_CATS, ...[...new Set(db.oneTimeExpenses.map((e) => (e.category || "").trim()))].filter((c) => c && !DEFAULT_CATS.includes(c)).sort()];

function trendSeries() {
  const by = {};
  db.oneTimeExpenses.forEach((e) => { const d = normDate(e.date); if (d) by[d] = (by[d] || 0) + (+e.amount || 0); });
  const t = parseDate(today());
  if (ui.trend === "day") return Array.from({ length: 30 }, (_, i) => { const d = new Date(t); d.setDate(d.getDate() - 29 + i); return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: by[iso(d)] || 0 }; });
  if (ui.trend === "week") {
    const wk = {}, mon = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
    Object.entries(by).forEach(([d, v]) => (wk[mon(parseDate(d))] = (wk[mon(parseDate(d))] || 0) + v));
    const keys = Object.keys(wk).sort();
    if (!keys.length) return [];
    const thisMon = parseDate(mon(t)), start = new Date(Math.max(parseDate(keys[0]), new Date(thisMon).setDate(thisMon.getDate() - 77)));
    const out = [];
    for (const d = new Date(start); d <= thisMon; d.setDate(d.getDate() + 7)) out.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, value: wk[iso(d)] || 0 });
    return out;
  }
  const mt = monthTotals(db.oneTimeExpenses), keys = Object.keys(mt).sort();
  if (!keys.length) return [];
  const out = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(t.getFullYear(), t.getMonth() - i, 1), k = iso(d).slice(0, 7); if (k >= keys[0]) out.push({ label: d.getMonth() === 0 ? `Jan '${String(d.getFullYear()).slice(2)}` : MON[d.getMonth()], value: mt[k] || 0 }); }
  return out;
}

export default {
  id: "finance", label: "Finance", color: "var(--green)",
  render(root, app) {
    const exp = monthTotals(db.oneTimeExpenses), inc = monthTotals(db.income), cm = curMonth();
    const avgMonth = Object.keys(exp).length ? sum(Object.values(exp).map((v) => ({ amount: v }))) / Object.keys(exp).length : 0;
    const spent = exp[cm] || 0, earned = sum(db.income.filter((e) => String(e.date || "").startsWith(cm)));
    const dates = db.oneTimeExpenses.map((e) => parseDate(e.date)).filter(Boolean);
    const weeks = dates.length ? Math.max(1, (parseDate(today()) - new Date(Math.min(...dates))) / 864e5 / 7) : 1;
    const avgWeek = dates.length ? sum(db.oneTimeExpenses) / weeks : 0;
    const vsAvg = avgMonth ? ((spent - avgMonth) / avgMonth) * 100 : 0;
    const available = assetTotal(), debt = sum(db.debts);

    root.innerHTML = `<div class="page-h"><h1>Finance</h1><span class="sub">${plural(db.oneTimeExpenses.length, "expense")} · ${plural(db.income.length, "income entry")}</span></div>
      <div class="kpis" style="grid-template-columns:1.6fr repeat(4,minmax(0,1fr))">
        <div class="kpi hero"><small>TOTAL AVAILABLE</small><b class="num" style="font-size:28px">${money(available)}</b>
          <span class="chips" style="margin-top:6px"><span class="pill">💵 Cash ${money(assetTotal("Cash"))}</span><span class="pill">🏦 Bank ${money(assetTotal("Bank Account"))}</span>${debt > 0.005 ? `<span class="pill">💳 Debt −${money(debt)}</span>` : ""}</span></div>
        <div class="kpi" style="--c:var(--orange)"><b class="num">${money(spent)}</b><span>This month spent</span>${avgMonth ? `<div class="tag" style="color:${vsAvg > 0 ? "var(--red)" : "var(--green)"}">${vsAvg > 0 ? "▲" : "▼"} ${Math.abs(vsAvg).toFixed(0)}% vs avg</div>` : ""}</div>
        <div class="kpi" style="--c:var(--green)"><b class="num">${money(earned)}</b><span>This month income</span></div>
        <div class="kpi" style="--c:var(--purple)"><b class="num">${money(avgMonth)}</b><span>Avg monthly spend</span></div>
        <div class="kpi" style="--c:var(--pink)"><b class="num">${money(avgWeek)}</b><span>Avg weekly spend</span></div>
      </div>
      ${logBar()}
      <div class="grid g2" style="align-items:start">
        <section class="card"><header class="card-h"><div><h3>Spending trend</h3></div><div class="card-r">${[["day", "Daily 30d"], ["week", "Weekly"], ["month", "Monthly"]].map(([k, l]) => chip(l, ui.trend === k, `data-act="trend" data-k="${k}"`)).join("")}</div></header>
          <div class="card-b">${(() => { const s = trendSeries(); return s.some((p) => p.value) ? line(s, { color: "var(--orange)", avg: true, money: true }) : empty(ui.trend === "day" ? "No spending in the last 30 days — try Weekly or Monthly." : "No expenses yet."); })()}</div></section>
        <section class="card"><header class="card-h"><div><h3>Income vs spending</h3><p class="sub"><span style="color:var(--green)">●</span> income <span style="color:var(--orange)">●</span> spending · last 6 months</p></div></header>
          <div class="card-b">${(() => { const ms = [...new Set([...Object.keys(exp), ...Object.keys(inc)])].sort().slice(-6); return ms.length ? dualBars(ms.map((k) => ({ label: MON[+k.slice(5, 7) - 1], a: inc[k] || 0, b: exp[k] || 0 }))) : empty("Nothing logged yet."); })()}</div></section>
        ${whereItGoes()}
        ${monthlyBreakdown(exp, avgMonth)}
        ${logCard("expense")}
        ${logCard("income")}
        ${billsCard()}
        ${debtsCard()}
      </div>
      ${wishlist(available)}`;
    wire(root, app);
  },
};

function logBar() {
  const assetOpts = `<option value="">don't update a balance</option>` + db.assets.map((a) => `<option value="${a.id}">from ${esc(a.name)} (${money(a.amount)})</option>`).join("");
  const kinds = [["expense", "Expense"], ["income", "Income"], ["bill", "Recurring bill"], ["wish", "Wishlist"], ["debt", "Debt"]];
  const f = {
    expense: `<input class="in grow" name="name" placeholder="What did you buy?" required /><input class="in money" type="number" step="0.01" min="0.01" name="amount" placeholder="$" required />
      <input class="in" name="category" list="cats" placeholder="Category" value="Food" style="width:130px" /><datalist id="cats">${categories().map((c) => `<option>${esc(c)}</option>`).join("")}</datalist>
      <select class="in" name="asset">${assetOpts}</select><input class="in" type="date" name="date" value="${today()}" /><input class="in" name="notes" placeholder="notes" style="width:120px" />`,
    income: `<input class="in grow" name="name" placeholder="Freelance payment, gift…" required /><input class="in money" type="number" step="0.01" min="0.01" name="amount" placeholder="$" required />
      <select class="in" name="type"><option>Cash</option><option selected>Bank Account</option></select><input class="in" type="date" name="date" value="${today()}" /><input class="in" name="notes" placeholder="notes" style="width:140px" />`,
    bill: `<input class="in grow" name="name" placeholder="Service (Netflix, rent…)" required /><input class="in money" type="number" step="0.01" min="0.01" name="price" placeholder="$" required />
      <select class="in" name="freq"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="yearly">Yearly</option></select><label class="tag">next due <input class="in" type="date" name="due" required /></label><input class="in" name="notes" placeholder="notes" style="width:120px" />`,
    wish: `<input class="in grow" name="name" placeholder="Item you want" required /><input class="in money" type="number" step="0.01" min="0" name="price" placeholder="$" />
      <select class="in" name="priority"><option>High</option><option selected>Medium</option><option>Low</option></select><input class="in" name="notes" placeholder="notes" style="width:160px" />`,
    debt: `<input class="in grow" name="name" placeholder="Creditor / what you owe" required /><input class="in money" type="number" step="0.01" min="0.01" name="amount" placeholder="$" required />
      <label class="tag">due <input class="in" type="date" name="due" /></label><input class="in" name="notes" placeholder="notes" style="width:160px" />`,
  };
  return `<form class="addbar" id="log"><div class="seg">${kinds.map(([k, l]) => `<button type="button" class="${ui.kind === k ? "on" : ""}" data-act="kind" data-k="${k}">${l}</button>`).join("")}</div>${f[ui.kind]}<button class="btn">Add</button></form>`;
}

function whereItGoes() {
  const t = parseDate(today());
  const since = ui.range === "month" ? `${curMonth()}-01` : ui.range === "3m" ? iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)) : null;
  const tot = {};
  db.oneTimeExpenses.forEach((e) => { if (since && normDate(e.date) < since) return; const c = (e.category || "Other").trim() || "Other"; tot[c] = (tot[c] || 0) + (+e.amount || 0); });
  const rows = Object.entries(tot).sort((a, b) => b[1] - a[1]), all = rows.reduce((a, r) => a + r[1], 0);
  return `<section class="card"><header class="card-h"><div><h3>Where it goes</h3><p class="sub">${money(all)} total</p></div><div class="card-r">${[["month", "This month"], ["3m", "3 months"], ["all", "All time"]].map(([k, l]) => chip(l, ui.range === k, `data-act="range" data-k="${k}"`)).join("")}</div></header>
    <div class="card-b">${rows.length ? donut(rows.slice(0, 8).map(([c, v], i) => ({ label: c, value: v, color: CAT_COLORS[i % 10] })), { center: money(all).replace(/\.\d+$/, ""), sub: "spent", fmt: (v) => money(v) }) : empty("No spending in this range.")}</div></section>`;
}

function monthlyBreakdown(exp, avg) {
  const keys = Object.keys(exp).sort().reverse(), max = Math.max(1, ...Object.values(exp));
  return `<section class="card"><header class="card-h"><div><h3>Monthly breakdown</h3><p class="sub">${plural(keys.length, "month")} tracked · ${money(sum(Object.values(exp).map((v) => ({ amount: v }))))} total · ${money(avg)} avg</p></div></header>
    <div class="card-b">${keys.map((k) => { const v = exp[k], diff = v - avg;
      return `<div class="hbar" style="grid-template-columns:90px minmax(0,1fr) 92px 90px;--c:${k === curMonth() ? "var(--purple)" : "var(--orange)"}"><span>${MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}</span><span class="tr"><span class="fi" style="display:block;width:${(v / max) * 100}%"></span></span><b class="num" style="text-align:right">${money(v)}</b><span class="p" style="color:${diff > 0 ? "var(--red)" : "var(--green)"}">${diff > 0 ? "+" : "−"}${money(Math.abs(diff)).replace("-", "")}</span></div>`; }).join("") || empty("No expenses logged yet.")}</div></section>`;
}

function logCard(kind) {
  const isExp = kind === "expense", list = [...(isExp ? db.oneTimeExpenses : db.income)].sort((a, b) => (normDate(b.date) || "").localeCompare(normDate(a.date) || ""));
  const open = isExp ? ui.expAll : ui.incAll;
  return `<section class="card flush"><header class="card-h"><div><h3>${isExp ? "Expense log" : "Income log"}</h3><p class="sub">${plural(list.length, "entry")} · ${money(sum(list))}</p></div></header>
    <div class="card-b" style="padding:0 10px 8px">${list.slice(0, open ? 9999 : 8).map((e) => `<div class="row"><span class="t">${esc(e.name)}${e.notes ? `<small>${esc(e.notes)}</small>` : ""}</span>
      ${isExp ? `<span class="tag">${esc(e.category || "—")}</span>` : `<span class="tag">${esc(e.incomeType || "")}</span>`}<b class="num" style="color:${isExp ? "var(--orange)" : "var(--green)"}">${money(e.amount)}</b><span class="m" style="width:84px;text-align:right">${fmtDate(e.date)}</span>
      <span class="acts"><button class="x" data-act="del-${kind}" data-id="${e.id}" title="Delete${isExp && e.deducted ? " and refund the balance" : !isExp && e.incomeType ? " and take it back off the balance" : ""}">×</button></span></div>`).join("") || empty("Nothing logged yet.")}
    ${list.length > 8 ? `<button class="more" data-act="all-${kind}">${open ? "Show less" : `Show all ${list.length}`}</button>` : ""}</div></section>`;
}

function billsCard() {
  const t = parseDate(today()), horizon = new Date(t.getFullYear(), t.getMonth() + ui.horizon, t.getDate());
  const bills = [...db.recurringExpenses].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const perMonth = bills.reduce((a, b) => a + monthly(b.price, b.frequency), 0);
  return `<section class="card flush"><header class="card-h"><div><h3>Recurring bills</h3><p class="sub">${money(perMonth)} / month · shown on the Schedule calendar</p></div>
      <div class="card-r"><label class="tag">project <input class="in" type="number" min="1" max="60" id="horizon" value="${ui.horizon}" style="width:56px" /> months</label></div></header>
    <div class="card-b" style="padding:0 10px 8px">${bills.map((b) => { const occ = recurringOccurrences(b, today(), iso(horizon));
      return `<div class="row"><span class="t">${esc(b.name)}<small>${money(b.price)} / ${esc(b.frequency)} · next ${occ[0] ? `${fmtDate(occ[0])} (${relDay(occ[0])})` : "—"} · ${occ.length} payments, ${money(occ.length * (+b.price || 0))} over ${ui.horizon} mo</small></span><span class="m num">${money(monthly(b.price, b.frequency))}/mo</span><span class="acts"><button class="x" data-act="del-bill" data-id="${b.id}">×</button></span></div>`; }).join("") || empty("No recurring bills — add one with the Log bar.")}</div></section>`;
}

function debtsCard() {
  const paid = (d) => (+d.amount || 0) <= 0.005;
  const list = [...db.debts].sort((a, b) => paid(a) - paid(b) || (normDate(a.dueDate) || "9999").localeCompare(normDate(b.dueDate) || "9999") || b.amount - a.amount);
  const assetOpts = `<option value="">don't update a balance</option>` + db.assets.map((a) => `<option value="${a.id}">pay from ${esc(a.name)} (${money(a.amount)})</option>`).join("");
  return `<section class="card flush"><header class="card-h"><div><h3>Debts</h3><p class="sub">${list.filter((d) => !paid(d)).length} active · ${money(sum(db.debts))} owed</p></div></header>
    <div class="card-b" style="padding:0 10px 8px">${list.map((d) => { const orig = +d.originalAmount || +d.amount || 0, done = orig - (+d.amount || 0), pct = orig ? Math.round((done / orig) * 100) : 0;
      return `<div class="row" style="flex-wrap:wrap"><span class="t">${esc(d.name)}${d.notes ? `<small>${esc(d.notes)}</small>` : ""}</span>
        ${paid(d) ? `<span class="badge" style="--c:var(--green)">✓ PAID</span>` : d.dueDate ? `<span class="m" style="${parseDate(d.dueDate) < parseDate(today()) ? "color:var(--red)" : ""}">due ${relDay(d.dueDate)}</span>` : ""}
        <b class="num" style="color:${paid(d) ? "var(--faint)" : "var(--red)"}">${money(d.amount)}</b>
        <span class="hbar" style="grid-template-columns:80px 34px;width:120px;--c:var(--green)" title="Paid ${money(done)} of ${money(orig)}"><span class="tr"><span class="fi" style="display:block;width:${pct}%"></span></span><span class="p">${pct}%</span></span>
        ${paid(d) ? "" : `<button class="btn ghost sm" data-act="pay" data-id="${d.id}">Log payment</button>`}<span class="acts"><button class="x" data-act="del-debt" data-id="${d.id}">×</button></span>
        ${ui.pay === d.id ? `<form class="toolbar pay" data-id="${d.id}" style="flex-basis:100%;margin:6px 0 2px"><input class="in money" type="number" step="0.01" min="0.01" name="amount" placeholder="$" required /><select class="in" name="asset">${assetOpts}</select><button class="btn sm">Pay</button><button type="button" class="btn ghost sm" data-act="pay" data-id="${d.id}">Cancel</button></form>` : ""}
      </div>`; }).join("") || empty("No debts. 🎉")}</div></section>`;
}

function wishlist(available) {
  const rank = { High: 0, Medium: 1, Low: 2 };
  const want = db.purchases.filter((p) => !p.purchased), bought = db.purchases.filter((p) => p.purchased);
  const groups = ["High", "Medium", "Low"].map((pr) => [pr, want.filter((p) => (p.priority || "Medium") === pr)]).filter(([, l]) => l.length);
  return `<section class="card flush" style="margin-top:16px"><header class="card-h"><div><h3>Wishlist</h3><p class="sub">${plural(want.length, "item")} · ${money(sum(want, "price"))} total · ${bought.length} bought</p></div></header>
    <div class="card-b" style="padding:0 10px 8px">${groups.map(([pr, l]) => `<div class="group-h" style="cursor:default"><span class="badge" style="--c:${PRIORITY[pr]}">${pr}</span><span class="n">${l.length} · ${money(sum(l, "price"))}</span></div>` +
      l.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)).map((p) => { const pct = available > 0 ? (p.price / available) * 100 : 0, ok = p.price <= available && available > 0;
        return `<div class="row"><span class="t">${esc(p.name)}${p.notes ? `<small>${esc(p.notes)}</small>` : ""}</span><b class="num">${money(p.price)}</b>
          <span class="m" style="color:${pct < 10 ? "var(--green)" : pct < 50 ? "var(--orange)" : "var(--red)"}">${pct.toFixed(1)}% of funds</span><span class="m" style="color:${ok ? "var(--green)" : "var(--red)"};width:96px">${ok ? "✓ affordable" : "✗ can't afford"}</span>
          <button class="btn ghost sm" data-act="bought" data-id="${p.id}">Mark bought</button><span class="acts"><button class="x" data-act="del-wish" data-id="${p.id}">×</button></span></div>`; }).join("")).join("") || empty("Your wishlist is empty.")}
    ${bought.length ? `<details style="margin:6px 10px"><summary class="tag" style="cursor:pointer">Bought (${bought.length})</summary>${bought.map((p) => `<div class="row done"><span class="t">${esc(p.name)}</span><b class="num">${money(p.price)}</b><span class="m">${fmtDate(p.purchasedDate)}</span></div>`).join("")}</details>` : ""}
    </div></section>`;
}

function wire(root, app) {
  const assetById = (id) => db.assets.find((a) => a.id === id);
  root.querySelector("#log").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), name = (f.name || "").trim(), date = normDate(f.date) || today();
    if (!name) return;
    if (ui.kind === "expense") {
      const amt = +f.amount; if (!(amt > 0)) return;
      const entry = { id: newId(), name, amount: amt, category: (f.category || "").trim(), date, notes: f.notes.trim() };
      const a = f.asset && assetById(f.asset);
      if (a) { const d = Math.min(+a.amount || 0, amt); a.amount = (+a.amount || 0) - d; entry.assetId = a.id; entry.deducted = d; } // never below $0
      db.oneTimeExpenses.push(entry); toast(`Logged ${money(amt)} on ${name}`);
    } else if (ui.kind === "income") {
      const amt = +f.amount; if (!(amt > 0)) return;
      db.income.push({ id: newId(), name, amount: amt, incomeType: f.type, date, notes: f.notes.trim() });
      let a = db.assets.find((x) => (x.assetType || "Bank Account") === f.type);
      if (!a) { a = { id: newId(), name: f.type === "Cash" ? "Cash" : "Bank Account", assetType: f.type, amount: 0, notes: "" }; db.assets.push(a); }
      a.amount = (+a.amount || 0) + amt; toast(`Added ${money(amt)} to ${a.name}`);
    } else if (ui.kind === "bill") {
      if (!(+f.price > 0) || !normDate(f.due)) return;
      db.recurringExpenses.push({ id: newId(), name, price: +f.price, frequency: f.freq, dueDate: normDate(f.due), notes: f.notes.trim() });
    } else if (ui.kind === "wish") {
      db.purchases.push({ id: newId(), name, price: +f.price || 0, priority: f.priority, notes: f.notes.trim(), purchased: false, purchasedDate: null });
    } else if (ui.kind === "debt") {
      const amt = +f.amount; if (!(amt > 0)) return;
      db.debts.push({ id: newId(), name, amount: amt, originalAmount: amt, dueDate: normDate(f.due), notes: f.notes.trim(), createdDate: today(), payments: [] });
    }
    commit(); app.refresh(); root.querySelector("#log [name=name]")?.focus();
  };
  root.querySelector("#horizon")?.addEventListener("change", (e) => { ui.horizon = Math.max(1, Math.min(60, +e.target.value || 6)); app.refresh(); });
  root.querySelectorAll("form.pay").forEach((form) => (form.onsubmit = (e) => {
    e.preventDefault();
    const d = db.debts.find((x) => x.id === form.dataset.id), f = Object.fromEntries(new FormData(form));
    const pay = Math.min(+f.amount || 0, +d.amount || 0); // payments never overshoot the balance
    if (!(pay > 0)) return;
    if (!("originalAmount" in d)) d.originalAmount = d.amount;
    d.amount = (+d.amount || 0) - pay;
    const p = { id: newId(), amount: pay, date: today() }, a = f.asset && assetById(f.asset);
    if (a) { const x = Math.min(+a.amount || 0, pay); a.amount -= x; p.assetId = a.id; p.deducted = x; }
    (d.payments ||= []).push(p);
    ui.pay = null; commit(); app.refresh(); toast(`Paid ${money(pay)} toward ${d.name}`);
  }));
  root.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case "kind": ui.kind = b.dataset.k; app.refresh(); return root.querySelector("#log [name=name]")?.focus();
      case "trend": ui.trend = b.dataset.k; return app.refresh();
      case "range": ui.range = b.dataset.k; return app.refresh();
      case "all-expense": ui.expAll = !ui.expAll; return app.refresh();
      case "all-income": ui.incAll = !ui.incAll; return app.refresh();
      case "pay": ui.pay = ui.pay === id ? null : id; return app.refresh();
      case "del-expense": { // refund what was actually deducted
        const x = db.oneTimeExpenses.find((y) => y.id === id); if (!confirm(`Delete “${x.name}” (${money(x.amount)})?`)) return;
        const a = x.assetId && x.deducted && assetById(x.assetId); if (a) a.amount = (+a.amount || 0) + +x.deducted;
        db.oneTimeExpenses = db.oneTimeExpenses.filter((y) => y !== x); break;
      }
      case "del-income": { // take the auto-added amount back off the matching pool
        const x = db.income.find((y) => y.id === id); if (!confirm(`Delete “${x.name}” (${money(x.amount)})?`)) return;
        const a = x.incomeType && db.assets.find((y) => (y.assetType || "Bank Account") === x.incomeType); if (a) a.amount = Math.max(0, (+a.amount || 0) - (+x.amount || 0));
        db.income = db.income.filter((y) => y !== x); break;
      }
      case "del-bill": if (!confirm("Delete this recurring bill?")) return; db.recurringExpenses = db.recurringExpenses.filter((y) => y.id !== id); break;
      case "del-debt": if (!confirm("Delete this debt?")) return; db.debts = db.debts.filter((y) => y.id !== id); break;
      case "del-wish": if (!confirm("Remove from wishlist?")) return; db.purchases = db.purchases.filter((y) => y.id !== id); break;
      case "bought": { const p = db.purchases.find((y) => y.id === id); p.purchased = true; p.purchasedDate = today(); toast(`Bought ${p.name}`); break; }
      default: return;
    }
    commit(); app.refresh();
  };
}
