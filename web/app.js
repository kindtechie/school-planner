const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fa = (n) => Number(n).toLocaleString("fa-IR");
const uid = () => crypto.randomUUID();
const clone = (v) => structuredClone(v);
let state,
  school = null,
  tab = "dashboard",
  editor = null,
  busy = false,
  job = null;
let scheduleView = "class",
  scheduleTarget = "",
  toastTimer;
const nav = [
  ["dashboard", "نمای کلی", "◫"],
  ["classes", "کلاس‌ها", "▤"],
  ["subjects", "درس‌ها", "▥"],
  ["teachers", "دبیران و حضور", "♙"],
  ["lessons", "جلسات و تجمیع", "⊞"],
  ["rules", "محدودیت‌ها", "☷"],
  ["schedule", "برنامهٔ هفتگی", "▦"],
  ["backups", "ذخیره و بازیابی", "↥"],
];
const names = {
  classes: "کلاس",
  subjects: "درس",
  teachers: "دبیر",
  lessons: "جلسهٔ درسی",
  rules: "محدودیت",
};
const hintText = {
  classes: "پایه، رشته و ساعت زنگ‌های هر کلاس را مشخص کنید.",
  subjects: "فهرست درس‌هایی که در مدرسه ارائه می‌شوند.",
  teachers: "تخصص، روزهای حضور و ترجیح‌های هر دبیر.",
  lessons: "سهمیهٔ هفتگی هر درس؛ کلاس‌های مشترک را در یک جلسه انتخاب کنید.",
  rules: "قیدهای الزامی باید رعایت شوند؛ ترجیح‌ها بر اساس وزن بهینه می‌شوند.",
};
async function api(path, body) {
  const res = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "ارتباط با برنامه برقرار نشد.");
  return data;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5500);
}
function status(message) {
  $("#save-status").textContent = message;
}
async function refresh() {
  state = await api("state");
}
function lookup(kind, id) {
  return school?.[kind]?.find((r) => r.id === id);
}
function joined(kind, ids) {
  return (ids || []).map((id) => lookup(kind, id)?.name || "—").join("، ");
}
function actions(kind, id) {
  return `<div class="row-actions"><button data-action="edit" data-kind="${kind}" data-id="${esc(id)}">ویرایش</button><button class="danger" data-action="delete-row" data-kind="${kind}" data-id="${esc(id)}">حذف</button></div>`;
}
function button(action, text, css = "", extra = "") {
  return `<button data-action="${action}" class="${css}" ${extra}>${text}</button>`;
}
function heading(title, sub, action = "") {
  return `<div class="heading"><div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${action}</div></div>`;
}
function empty(text, sub, action = "") {
  return `<div class="card empty"><div class="empty-icon">▦</div><h2>${text}</h2><p>${sub}</p>${action}</div>`;
}
function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function render() {
  $("#school-select").innerHTML =
    '<option value="">همهٔ مدرسه‌ها</option>' +
    state.schools
      .map(
        (s) =>
          `<option value="${esc(s.id)}" ${s.id === school?.id ? "selected" : ""}>${esc(s.name)}</option>`,
      )
      .join("");
  $("#school-name").textContent = school?.name || "مدرسه‌های من";
  $("#navigation").innerHTML = nav
    .map(
      ([id, label, icon]) =>
        `<button data-action="tab" data-tab="${id}" class="${tab === id && school ? "active" : ""}"><span class="nav-icon">${icon}</span>${label}</button>`,
    )
    .join("");
  if (!school) {
    renderSchools();
    return;
  }
  if (tab === "dashboard") renderDashboard();
  else if (tab === "schedule") renderSchedule();
  else if (tab === "backups") renderBackups();
  else renderCollection();
}
function renderSchools() {
  $("#main").innerHTML =
    heading(
      "مدرسه‌های من",
      "برنامه‌ریزی را از یک مدرسه شروع کنید.",
      button("import", "بازیابی فایل مدرسه") +
        button("new-school", "＋ مدرسهٔ جدید", "primary"),
    ) +
    (state.schools.length
      ? `<div class="school-cards">${state.schools.map((s) => `<article class="card school-card"><span class="badge">ذخیره‌شده روی این دستگاه</span><h2>${esc(s.name)}</h2><small>آخرین تغییر: ${new Date(s.updated).toLocaleString("fa-IR")}</small><div class="actions">${button("open-school", "ادامهٔ کار", "primary", `data-id="${esc(s.id)}"`)}</div></article>`).join("")}</div>`
      : empty(
          "به هم‌درس خوش آمدید",
          "کلاس‌ها و دبیران را تعریف کنید و برنامه‌ای مطابق محدودیت‌های مدرسه بسازید.",
          button("new-school", "ساخت اولین مدرسه", "primary"),
        ));
}
function renderDashboard() {
  const sol = school.solution;
  const steps = [
    ["classes", "کلاس‌های مدرسه", "پایه، رشته و زنگ‌بندی"],
    ["subjects", "درس‌های ارائه‌شده", "فهرست درس‌ها"],
    ["teachers", "دبیران و حضور", "تخصص و زمان‌های حضور"],
    ["lessons", "جلسات هفتگی", "تعداد جلسات و کلاس‌های تجمیعی"],
    ["rules", "محدودیت‌ها و ترجیح‌ها", "تنظیم قواعد برنامه‌ریزی"],
  ];
  $("#main").innerHTML =
    heading(
      "یک هفتهٔ منظم، از اینجا",
      "اطلاعات مدرسه را کامل کنید؛ چیدن برنامه با هم‌درس.",
      button("school-settings", "تنظیمات مدرسه"),
    ) +
    `<section class="card hero"><div class="eyebrow">برنامه‌ریزی هفتگی</div><h2>${esc(school.name)}</h2><p>زمان دبیران، نیاز کلاس‌ها و محدودیت‌های مدرسه را کنار هم بگذارید و یک برنامهٔ قابل اجرا بسازید.</p>${button("tab", "مشاهده و ساخت برنامه ←", "primary", 'data-tab="schedule"')}<span class="hero-mark">▦</span></section>` +
    `<div class="stats">${[
      ["classes", "کلاس"],
      ["subjects", "درس"],
      ["teachers", "دبیر"],
      ["lessons", "تعریف جلسه"],
    ]
      .map(
        ([k, n]) =>
          `<div class="stat"><strong>${fa(school[k].length)}</strong><span>${n}</span></div>`,
      )
      .join("")}</div>` +
    `<div class="two-cols"><section class="card"><h2>مراحل آماده‌سازی مدرسه</h2>${steps.map(([id, title, sub], i) => `<div class="step ${school[id].length ? "done" : ""}"><span class="step-no">${school[id].length ? "✓" : fa(i + 1)}</span><div><b>${title}</b><p>${sub}</p></div>${button("tab", "ورود ←", "", 'data-tab="' + id + '"')}</div>`).join("")}</section><div><section class="card"><h2>وضعیت برنامه</h2><span class="badge ${sol?.stale ? "soft" : ""}">${!sol ? "هنوز ساخته نشده" : sol.stale ? "نیازمند ساخت مجدد" : "ممیزی‌شده و معتبر"}</span><p class="muted">${sol && !sol.stale ? "همهٔ الزام‌ها بررسی و رعایت شده‌اند. ترجیح‌های رعایت‌نشده در بخش برنامه نمایش داده می‌شوند." : "پس از ورود جلسات و قواعد، برنامهٔ هفتگی را بسازید."}</p><small>ظرفیت هر کلاس: ${fa(school.days.length * school.periods)} زنگ در هفته</small></section><section class="card"><h2>داده‌ها همراه شما</h2><p class="muted">هر تغییر ثبت‌شده، خودکار در فایل اصلی ذخیره می‌شود. برای انتقال مدرسه به دستگاه دیگر، یک نسخهٔ پشتیبان بگیرید.</p>${button("export", "دریافت فایل مدرسه ↥")}</section></div></div>`;
}
function renderCollection() {
  const kind = tab,
    items = school[kind];
  let rows, headers;
  if (kind === "classes") {
    headers = ["نام کلاس", "پایه / رشته", "سهمیهٔ تعریف‌شده", ""];
    rows = items.map((c) => [
      esc(c.name),
      `${esc(c.grade || "—")} / ${esc(c.track || "عمومی")}`,
      fa(
        school.lessons
          .filter((l) => l.classIds.includes(c.id))
          .reduce((a, l) => a + (l.count * l.duration) / 2, 0),
      ) + " زنگ",
      actions(kind, c.id),
    ]);
  }
  if (kind === "subjects") {
    headers = ["نام درس", "دبیران این درس", ""];
    rows = items.map((s) => [
      esc(s.name),
      esc(
        school.teachers
          .filter((t) => t.subjectIds.includes(s.id))
          .map((t) => t.name)
          .join("، "),
      ) || "—",
      actions(kind, s.id),
    ]);
  }
  if (kind === "teachers") {
    headers = ["دبیر", "درس‌ها", "حضور مجاز", "نوع حضور", ""];
    rows = items.map((t) => [
      esc(t.name),
      esc(joined("subjects", t.subjectIds)),
      esc(
        school.days
          .filter((_, d) =>
            t.availability.some(
              (h) => Math.floor(h / (school.periods * 2)) === d,
            ),
          )
          .join("، "),
      ) || "هیچ روزی",
      `<span class="badge ${t.availabilityMode === "soft" ? "soft" : ""}">${t.availabilityMode === "soft" ? "ترجیح" : "الزام"}</span>`,
      actions(kind, t.id),
    ]);
  }
  if (kind === "lessons") {
    headers = ["عنوان", "کلاس‌ها", "دبیر / گزینه‌های دبیر", "جلسات هفتگی", ""];
    rows = items.map((l) => [
      esc(l.name) +
        (l.classIds.length > 1 ? '<span class="badge">تجمیعی</span>' : ""),
      esc(joined("classes", l.classIds)),
      esc(joined("teachers", l.teacherIds)) || "بدون دبیر",
      `${fa(l.count)} × ${l.duration === 1 ? "نیم‌زنگ" : "یک زنگ"}`,
      actions(kind, l.id),
    ]);
  }
  if (kind === "rules") {
    headers = ["فعال", "محدودیت", "دامنه", "نوع / وزن", ""];
    rows = items.map((r) => [
      `<input type="checkbox" aria-label="فعال بودن ${esc(r.name)}" data-toggle-rule="${esc(r.id)}" ${r.enabled !== false ? "checked" : ""}>`,
      esc(r.name) + `<br><small>${esc(state.kinds[r.kind])}</small>`,
      esc(
        [
          joined("teachers", r.teacherIds),
          joined("classes", r.classIds),
          joined("subjects", r.subjectIds),
          joined("lessons", r.lessonIds),
          r.eventIds?.length ? fa(r.eventIds.length) + " جلسهٔ مشخص" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ) || "همهٔ جلسات",
      `<span class="badge ${r.mode === "soft" ? "soft" : ""}">${r.mode === "hard" ? "الزام" : "ترجیح · " + fa(r.weight)}</span>`,
      actions(kind, r.id),
    ]);
  }
  $("#main").innerHTML =
    heading(
      nav.find((n) => n[0] === kind)[1],
      hintText[kind],
      button(
        "add",
        "＋ افزودن " + names[kind],
        "primary",
        `data-kind="${kind}"`,
      ),
    ) +
    (items.length
      ? table(headers, rows)
      : empty(
          "هنوز " + names[kind] + "ی ثبت نشده",
          hintText[kind],
          button(
            "add",
            "افزودن " + names[kind],
            "primary",
            `data-kind="${kind}"`,
          ),
        ));
}
function field(name, label, value = "", type = "text", extra = "") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function select(name, label, options, value) {
  return `<label class="field"><span>${label}</span><select name="${name}">${options.map((o) => `<option value="${esc(o[0])}" ${String(value) === String(o[0]) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select></label>`;
}
function checks(name, label, options, values = []) {
  return `<fieldset><legend>${label}</legend><div class="check-list">${options.map((o) => `<label><input type="checkbox" name="${name}" value="${esc(o.id)}" ${values.includes(o.id) ? "checked" : ""}>${esc(o.name)}</label>`).join("") || "<small>هنوز موردی تعریف نشده است.</small>"}</div></fieldset>`;
}
function mode(name = "mode", value = "hard") {
  return select(
    name,
    "نوع قید",
    [
      ["hard", "الزام — حتماً رعایت شود"],
      ["soft", "ترجیح — تا حد امکان"],
    ],
    value,
  );
}
function slots(name, values) {
  return `<div class="slot-help">هر زنگ دو نیمه دارد. تیک‌ها = زمان‌های مجاز. کلیک روی نام روز، تمام نیم‌زنگ‌های آن روز را تغییر می‌دهد.</div><div class="table-wrap"><table class="availability"><thead><tr><th>روز</th>${Array.from({ length: school.periods }, (_, p) => `<th>زنگ ${fa(p + 1)}</th>`).join("")}</tr></thead><tbody>${school.days
    .map(
      (day, d) =>
        `<tr><th><button type="button" class="text-button" data-action="toggle-day" data-field="${name}" data-day="${d}">${esc(day)}</button></th>${Array.from(
          { length: school.periods },
          (_, p) =>
            `<td><div class="half-pair">${[0, 1]
              .map((h) => {
                const i = d * school.periods * 2 + p * 2 + h;
                return `<label title="${esc(day)}، زنگ ${fa(p + 1)}، نیمهٔ ${fa(h + 1)}"><input type="checkbox" name="${name}" value="${i}" ${values.includes(i) ? "checked" : ""}><span>${fa(h + 1)}</span></label>`;
              })
              .join("")}</div></td>`,
        ).join("")}</tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><div class="actions">${button("all-slots", "انتخاب همه", "text-button", `type="button" data-field="${name}"`)}${button("none-slots", "پاک کردن", "text-button", `type="button" data-field="${name}"`)}</div>`;
}
function showEditor(title, html, onSave) {
  editor = onSave;
  $("#dialog-title").textContent = title;
  $("#dialog-fields").innerHTML = html;
  $("#form-error").textContent = "";
  $("#editor").reset();
  $("#dialog").showModal();
}
function selectedValues(form, name) {
  return new FormData(form).getAll(name);
}
async function save(doc) {
  status("در حال ذخیره…");
  try {
    school = await api("save", doc);
    await refresh();
    status("✓ تغییرات در فایل اصلی ذخیره شد");
    render();
  } catch (e) {
    status("ذخیره نشد — دوباره تلاش کنید");
    throw e;
  }
}
function editClass(row) {
  const c = row || {
    id: uid(),
    name: "",
    grade: "دهم",
    track: "ریاضی",
    bells: Array.from({ length: school.periods }, (_, p) => [
      450 + p * 105,
      540 + p * 105,
    ]),
  };
  const clock = (n) =>
    String(Math.floor(n / 60)).padStart(2, "0") +
    ":" +
    String(n % 60).padStart(2, "0");
  showEditor(
    row ? "ویرایش کلاس" : "کلاس جدید",
    field("name", "نام کلاس", c.name, "text", 'required maxlength="150"') +
      `<div class="form-grid">${field("grade", "پایه", c.grade, "text", 'required list="grades"')}${field("track", "رشته", c.track, "text", 'list="tracks"')}</div><datalist id="grades">${["هفتم", "هشتم", "نهم", "دهم", "یازدهم", "دوازدهم"].map((x) => `<option>${x}</option>`).join("")}</datalist><datalist id="tracks"><option>عمومی</option><option>ریاضی</option><option>تجربی</option><option>انسانی</option></datalist><h3>ساعت واقعی زنگ‌ها</h3><p class="hint">برای جلوگیری از تداخل دبیران مشترک بین دوره‌ها استفاده می‌شود.</p>` +
      c.bells
        .map(
          (b, i) =>
            `<div class="form-grid">${field("start" + i, "شروع زنگ " + fa(i + 1), clock(b[0]), "time", "required")}${field("end" + i, "پایان زنگ " + fa(i + 1), clock(b[1]), "time", "required")}</div>`,
        )
        .join(""),
    async (form) => {
      const f = new FormData(form),
        minutes = (v) => {
          const [h, m] = v.split(":").map(Number);
          return h * 60 + m;
        };
      await upsert("classes", {
        ...c,
        name: f.get("name").trim(),
        grade: f.get("grade").trim(),
        track: f.get("track").trim(),
        bells: c.bells.map((_, i) => [
          minutes(f.get("start" + i)),
          minutes(f.get("end" + i)),
        ]),
      });
    },
  );
}
function editSubject(row) {
  const c = row || { id: uid(), name: "" };
  showEditor(
    "تعریف درس",
    field("name", "نام درس", c.name, "text", 'required maxlength="150"'),
    async (form) =>
      upsert("subjects", { ...c, name: new FormData(form).get("name").trim() }),
  );
}
function editTeacher(row) {
  const t = row || {
    id: uid(),
    name: "",
    subjectIds: [],
    availability: Array.from(
      { length: school.days.length * school.periods * 2 },
      (_, i) => i,
    ),
    availabilityMode: "hard",
    availabilityWeight: 10,
  };
  const gap = school.rules.find((r) => r.id === "gap-" + t.id);
  showEditor(
    row ? "ویرایش دبیر" : "دبیر جدید",
    field("name", "نام دبیر", t.name, "text", 'required maxlength="150"') +
      checks(
        "subjectIds",
        "چه درس‌هایی تدریس می‌کند؟",
        school.subjects,
        t.subjectIds,
      ) +
      `<h3>روزها و زنگ‌های حضور</h3>` +
      slots("availability", t.availability) +
      `<div class="form-grid">${mode("availabilityMode", t.availabilityMode)}${field("availabilityWeight", "وزن ترجیح حضور", t.availabilityWeight, "number", 'min="1" max="1000" required')}</div><details open><summary>پیوستگی برنامهٔ دبیر</summary><label class="check-line"><input name="noGaps" type="checkbox" ${gap?.enabled ? "checked" : ""}>بین دو زنگ دبیر، زنگ خالی نباشد</label>${mode("gapMode", gap?.mode || "soft")}<p class="hint">سایر قواعد مثل تعداد روز حضور، سقف تدریس روزانه و جلوگیری از روز تک‌زنگ را در «محدودیت‌ها» اضافه کنید.</p></details>`,
    async (form) => {
      const f = new FormData(form),
        doc = clone(school),
        teacher = {
          ...t,
          name: f.get("name").trim(),
          subjectIds: f.getAll("subjectIds"),
          availability: f.getAll("availability").map(Number),
          availabilityMode: f.get("availabilityMode"),
          availabilityWeight: Number(f.get("availabilityWeight")),
        };
      replace(doc.teachers, teacher);
      if (f.has("noGaps") || gap)
        replace(doc.rules, {
          id: "gap-" + t.id,
          name: "بدون زنگ خالی: " + teacher.name,
          kind: "no_gaps",
          enabled: f.has("noGaps"),
          mode: f.get("gapMode"),
          weight: 10,
          teacherIds: [t.id],
          unit: "period",
        });
      await save(doc);
    },
  );
}
function editLesson(row) {
  if (!school.classes.length || !school.subjects.length) {
    toast("ابتدا کلاس و درس تعریف کنید.");
    return;
  }
  const l = row || {
    id: uid(),
    name: "",
    subjectId: school.subjects[0].id,
    classIds: [],
    teacherIds: [],
    count: 1,
    duration: 2,
    titles: {},
  };
  showEditor(
    row ? "ویرایش جلسات" : "جلسات هفتگی جدید",
    field(
      "name",
      "عنوان در برنامه",
      l.name,
      "text",
      'required maxlength="150" placeholder="مثلاً ریاضی دهم / حسابان یازدهم"',
    ) +
      select(
        "subjectId",
        "درس",
        school.subjects.map((s) => [s.id, s.name]),
        l.subjectId,
      ) +
      checks(
        "classIds",
        "کلاس‌ها (انتخاب چند کلاس = کلاس تجمیعی و هم‌زمان)",
        school.classes,
        l.classIds,
      ) +
      `<div id="lesson-teachers"></div><p class="hint">اگر چند دبیر انتخاب کنید، برنامه از بین آن‌ها انتخاب می‌کند. برای یکسان بودن دبیر جلسات، قید «یک دبیر برای همهٔ جلسات» اضافه کنید. بدون انتخاب دبیر برای آزاد، خودخوان یا آزمون بدون مراقب است.</p><div class="form-grid">${field("count", "تعداد جلسه در هفته", l.count, "number", 'required min="1" max="100"')}${select(
        "duration",
        "طول هر جلسه",
        [
          [2, "یک زنگ کامل"],
          [1, "نیم‌زنگ"],
        ],
        l.duration,
      )}</div><details><summary>عنوان متفاوت برای کلاس‌های تجمیعی</summary>${school.classes.map((c) => field("title-" + c.id, c.name, l.titles?.[c.id] || "")).join("")}</details><p class="hint">برای سهمیهٔ ۲٫۵ زنگ: یک تعریف با ۲ جلسهٔ کامل و یک تعریف با ۱ نیم‌زنگ بسازید.</p>`,
    async (form) => {
      const f = new FormData(form),
        classIds = f.getAll("classIds"),
        titles = {};
      for (const id of classIds) {
        const text = f.get("title-" + id)?.trim();
        if (text) titles[id] = text;
      }
      await upsert("lessons", {
        ...l,
        name: f.get("name").trim(),
        subjectId: f.get("subjectId"),
        classIds,
        teacherIds: f.getAll("teacherIds"),
        count: Number(f.get("count")),
        duration: Number(f.get("duration")),
        titles,
      });
    },
  );
  const update = () => {
    $("#lesson-teachers").innerHTML = checks(
      "teacherIds",
      "دبیران مجاز برای این درس",
      school.teachers.filter((t) =>
        t.subjectIds.includes($("[name=subjectId]", $("#editor")).value),
      ),
      l.teacherIds,
    );
  };
  update();
  $("[name=subjectId]", $("#editor")).addEventListener("change", update);
}
function ruleFields(r) {
  const kind = r.kind,
    all = Array.from(
      { length: school.days.length * school.periods * 2 },
      (_, i) => i,
    );
  let html = "";
  if (kind === "allowed") html = slots("slots", r.slots ?? all);
  if (
    ["daily_load", "day_count", "spread", "balance", "day_compare"].includes(
      kind,
    )
  ) {
    const isHalf = ["daily_load", "balance", "day_compare"].includes(kind),
      div = isHalf ? 2 : 1;
    const label =
      kind === "day_count" ? "روز" : kind === "spread" ? "جلسه" : "زنگ";
    html += `<div class="form-grid">${["daily_load", "day_count", "day_compare"].includes(kind) ? field("min", (kind === "day_compare" ? "حداقل اختلاف" : "حداقل") + " (" + label + ")", (r.min || 0) / div, "number", `min="0" max="1500" step="${isHalf ? ".5" : "1"}" required`) : ""}${kind !== "day_compare" ? field("max", "حداکثر (" + label + ")", (r.max ?? (kind === "day_count" ? school.days.length : kind === "spread" ? 1 : school.periods * 2)) / div, "number", `min="0" max="1500" step="${isHalf ? ".5" : "1"}" required`) : ""}</div>`;
  }
  if (kind === "day_compare")
    html += `<div class="form-grid">${select(
      "dayA",
      "این روز بیشتر باشد",
      school.days.map((d, i) => [i, d]),
      r.dayA ?? 0,
    )}${select(
      "dayB",
      "نسبت به این روز",
      school.days.map((d, i) => [i, d]),
      r.dayB ?? 1,
    )}</div>`;
  if (
    [
      "daily_load",
      "spread",
      "no_gaps",
      "no_single",
      "balance",
      "pattern",
    ].includes(kind)
  )
    html += checks(
      "days",
      "روزهای اعمال قید (خالی = همهٔ روزها)",
      school.days.map((name, id) => ({ name, id: String(id) })),
      (r.days || []).map(String),
    );
  if (kind === "no_gaps")
    html += select(
      "unit",
      "تعریف فاصلهٔ خالی",
      [
        ["period", "زنگ کامل"],
        ["half", "حتی یک نیم‌زنگ"],
      ],
      r.unit || "period",
    );
  if (kind === "pattern")
    html += `<label class="field"><span>الگوهای مجاز؛ هر خط یک الگو، برای هر نیم‌زنگ ۰ یا ۱ انگلیسی</span><textarea name="patterns" dir="ltr" required>${esc((r.patterns || [Array.from({ length: school.periods * 2 }, (_, i) => (i < 4 ? 1 : 0))]).map((p) => p.join("")).join("\n"))}</textarea></label><p class="hint">برای ۴ زنگ، دو زنگ اول: 11110000 و دو زنگ آخر: 00001111. هر دو را در دو خط بنویسید تا انتخاب یکی مجاز باشد.</p>`;
  if (kind === "consecutive")
    html +=
      '<p class="hint">تمام جلسات انتخابی در یک روز و بدون نیم‌زنگ خالی قرار می‌گیرند.</p>';
  if (kind === "no_single")
    html +=
      '<p class="hint">مجموع تدریس انتخابی در هیچ روز دقیقاً یک زنگ کامل نباشد.</p>';
  if (kind === "paired_halves")
    html +=
      '<p class="hint">برای نیم‌زنگ‌های آزاد یک کلاس استفاده کنید. نیمه‌های آزاد جفت می‌شوند؛ اگر مجموع فرد باشد، یک نیمهٔ تنها مجاز است.</p>';
  if (kind === "not_adjacent")
    html +=
      '<p class="hint">جلسات انتخابی نباید در دو زنگ همسایه باشند. برای هر درس و کلاس یک قید جدا بسازید.</p>';
  if (kind === "balance")
    html +=
      '<p class="hint">اختلاف بار روزانهٔ روزهای انتخابی، با احتساب روزهای خالی، از سقف تعیین‌شده بیشتر نشود.</p>';
  return html;
}
function editRule(row) {
  const r = row || {
    id: uid(),
    name: "",
    kind: "no_gaps",
    mode: "soft",
    weight: 10,
    enabled: true,
  };
  const evs = school.lessons.flatMap((l) =>
    Array.from({ length: l.count }, (_, i) => ({
      id: l.id + ":" + i,
      name: l.name + " · جلسهٔ " + fa(i + 1),
    })),
  );
  showEditor(
    row ? "ویرایش محدودیت" : "محدودیت جدید",
    field("name", "عنوان محدودیت", r.name, "text", 'required maxlength="150"') +
      select("kind", "نوع محدودیت", Object.entries(state.kinds), r.kind) +
      `<div class="form-grid">${mode("mode", r.mode)}${field("weight", "وزن ترجیح (بزرگ‌تر = مهم‌تر)", r.weight, "number", 'min="1" max="1000" required')}</div><label class="check-line"><input name="enabled" type="checkbox" ${r.enabled !== false ? "checked" : ""}>این محدودیت فعال باشد</label><details open><summary>این محدودیت برای چه کسانی اعمال شود؟</summary><p class="hint">انتخاب خالی یعنی همه. بین گروه‌ها «و» و بین موارد یک گروه «یا» است. مثلاً دبیر احمدی و کلاس دهم فقط جلسات مشترک همین دو را انتخاب می‌کند. انتخاب چند دبیر، مجموع برنامهٔ آن‌ها را بررسی می‌کند؛ برای قواعد جداگانه، قید جدا بسازید.</p>${checks("teacherIds", "دبیران", school.teachers, r.teacherIds)}${checks("classIds", "کلاس‌ها", school.classes, r.classIds)}${checks("subjectIds", "درس‌ها", school.subjects, r.subjectIds)}${checks("lessonIds", "تعریف جلسات", school.lessons, r.lessonIds)}<details><summary>انتخاب جلسهٔ مشخص از هفته</summary>${checks("eventIds", "جلسه‌های مشخص", evs, r.eventIds)}</details></details><div id="rule-options">${ruleFields(r)}</div>`,
    async (form) => {
      const f = new FormData(form),
        kind = f.get("kind"),
        half = ["daily_load", "balance", "day_compare"].includes(kind) ? 2 : 1;
      const value = {
        id: r.id,
        name: f.get("name").trim(),
        kind,
        mode: f.get("mode"),
        weight: Number(f.get("weight")),
        enabled: f.has("enabled"),
      };
      for (const key of [
        "teacherIds",
        "classIds",
        "subjectIds",
        "lessonIds",
        "eventIds",
      ])
        value[key] = f.getAll(key);
      value.days = f.getAll("days").map(Number);
      if (kind === "allowed") value.slots = f.getAll("slots").map(Number);
      if (
        [
          "daily_load",
          "day_count",
          "spread",
          "balance",
          "day_compare",
        ].includes(kind)
      ) {
        value.min = Number(f.get("min") || 0) * half;
        value.max =
          kind === "day_compare" ? 3000 : Number(f.get("max") || 0) * half;
      }
      if (kind === "no_gaps") value.unit = f.get("unit");
      if (kind === "day_compare") {
        value.dayA = Number(f.get("dayA"));
        value.dayB = Number(f.get("dayB"));
      }
      if (kind === "pattern")
        value.patterns = f
          .get("patterns")
          .trim()
          .split(/\n+/)
          .map((p) => p.replace(/\s/g, "").split("").map(Number));
      await upsert("rules", value);
    },
  );
  $("[name=kind]", $("#editor")).addEventListener(
    "change",
    (e) =>
      ($("#rule-options").innerHTML = ruleFields({ kind: e.target.value })),
  );
}
function replace(list, row) {
  const i = list.findIndex((x) => x.id === row.id);
  if (i < 0) list.push(row);
  else list[i] = row;
}
async function upsert(kind, row) {
  const doc = clone(school);
  replace(doc[kind], row);
  await save(doc);
}
function openEdit(kind, id) {
  const row = id ? lookup(kind, id) : null;
  ({
    classes: editClass,
    subjects: editSubject,
    teachers: editTeacher,
    lessons: editLesson,
    rules: editRule,
  })[kind](row);
}
function settings() {
  showEditor(
    "تنظیمات مدرسه",
    field(
      "name",
      "نام مدرسه",
      school.name,
      "text",
      'required maxlength="150"',
    ) +
      field(
        "days",
        "روزهای مدرسه، با ویرگول فارسی جدا کنید",
        school.days.join("، "),
        "text",
        "required",
      ) +
      field(
        "periods",
        "تعداد زنگ هر روز",
        school.periods,
        "number",
        'required min="1" max="10"',
      ) +
      '<p class="hint">روزها بر اساس نام تطبیق داده می‌شوند. روز تازه برای دبیران آزاد است و زمان تازه به قیدهای قبلی اضافه نمی‌شود. هنگام حذف روز یا زنگ، زمان‌های مربوط حذف می‌شوند؛ قبل از تغییر از مدرسه خروجی بگیرید.</p>',
    async (form) => {
      const f = new FormData(form),
        doc = clone(school),
        days = f
          .get("days")
          .split(/[،,]/)
          .map((x) => x.trim())
          .filter(Boolean),
        periods = Number(f.get("periods"));
      if (
        periods !== doc.periods ||
        JSON.stringify(days) !== JSON.stringify(doc.days)
      ) {
        if (
          !confirm(
            "تقویم تغییر کند؟ حضورها و قیود زمانی با روزهای جدید تطبیق داده می‌شوند. قیود مربوط به روز حذف‌شده غیرفعال خواهند شد.",
          )
        )
          throw new Error("تغییر تقویم لغو شد.");
        const oldH = doc.periods * 2,
          newH = periods * 2;
        const remap = (values) =>
          (values || []).flatMap((h) => {
            const d = days.indexOf(doc.days[Math.floor(h / oldH)]),
              p = h % oldH;
            return d < 0 || p >= newH ? [] : [d * newH + p];
          });
        for (const c of doc.classes) {
          c.bells = c.bells.slice(0, periods);
          while (c.bells.length < periods) {
            const end = c.bells.at(-1)?.[1] || 435;
            c.bells.push([end + 15, end + 105]);
          }
        }
        for (const t of doc.teachers) {
          t.availability = remap(t.availability);
          days.forEach((d, i) => {
            if (!doc.days.includes(d))
              for (let h = 0; h < newH; h++) t.availability.push(i * newH + h);
          });
        }
        for (const l of doc.lessons) if (l.starts) l.starts = remap(l.starts);
        for (const r of doc.rules) {
          if (r.slots) r.slots = remap(r.slots);
          if (r.days?.length) {
            r.days = r.days
              .map((d) => days.indexOf(doc.days[d]))
              .filter((d) => d >= 0);
            if (!r.days.length) r.enabled = false;
          }
          if (r.patterns)
            r.patterns = r.patterns.map((p) =>
              Array.from({ length: newH }, (_, i) => p[i] || 0),
            );
          for (const k of ["dayA", "dayB"])
            if (k in r) {
              r[k] = days.indexOf(doc.days[r[k]]);
              if (r[k] < 0) {
                r[k] = 0;
                r.enabled = false;
              }
            }
        }
      }
      doc.name = f.get("name").trim();
      doc.days = days;
      doc.periods = periods;
      await save(doc);
    },
  );
}
function reportOptions() {
  if (scheduleView === "teacher")
    return school.teachers.map((t) => [t.id, t.name]);
  if (scheduleView === "grade")
    return [...new Set(school.classes.map((c) => c.grade || "بدون پایه"))].map(
      (g) => [g, g],
    );
  if (scheduleView === "school") return [];
  return school.classes.map((c) => [c.id, c.name]);
}
function renderSchedule() {
  const options = reportOptions();
  if (!options.some((o) => o[0] === scheduleTarget))
    scheduleTarget = options[0]?.[0] || "";
  const sol = school.solution;
  $("#main").innerHTML =
    heading(
      "برنامهٔ هفتگی",
      "ساخت برنامه، بررسی ترجیح‌ها و دریافت خروجی.",
      button(
        "solve",
        job ? "در حال ساخت…" : "✦ ساخت برنامه",
        "primary",
        job ? "disabled" : "",
      ),
    ) +
    `<div class="card"><div class="filters">${select(
      "solve-seconds",
      "زمان جست‌وجو",
      [
        [10, "۱۰ ثانیه"],
        [30, "۳۰ ثانیه"],
        [60, "۱ دقیقه"],
        [180, "۳ دقیقه"],
        [300, "۵ دقیقه"],
      ],
      30,
    )}${select(
      "preserve-weight",
      "حفظ برنامهٔ قبلی",
      [
        [0, "بدون ترجیح"],
        [1, "ترجیح کم (وزن ۱)"],
        [10, "ترجیح متوسط (وزن ۱۰)"],
        [100, "ترجیح زیاد (وزن ۱۰۰)"],
      ],
      sol ? 10 : 0,
    )}</div><p class="hint">هیچ الزام کاربر خودکار حذف نمی‌شود. اگر برنامه ناممکن باشد، محدودیت‌های مرتبط برای بررسی نمایش داده می‌شوند.</p><div id="solve-result">${job ? '<span class="running">● در حال جست‌وجوی برنامهٔ مناسب…</span>' : ""}</div></div>`;
  if (!sol) {
    $("#main").insertAdjacentHTML(
      "beforeend",
      empty(
        "برنامهٔ این هفته هنوز ساخته نشده",
        "پس از تکمیل جلسات، روی «ساخت برنامه» بزنید.",
      ),
    );
    return;
  }
  if (sol.stale)
    $("#main").insertAdjacentHTML(
      "beforeend",
      '<div class="notice">این جدول متعلق به داده‌های قبلی است. برای خروجی معتبر، برنامه را دوباره بسازید.</div>',
    );
  else
    $("#main").insertAdjacentHTML(
      "beforeend",
      `<div class="notice success">✓ همهٔ الزام‌ها تأیید شدند. ${sol.status === "OPTIMAL" ? "بهترین مقدار تابع ترجیح‌ها اثبات شده است." : "برنامه معتبر است؛ بهترین بودن آن هنوز اثبات نشده است."} زمان حل: ${fa(sol.seconds)} ثانیه · تغییر جلسات قبلی: ${fa(sol.changed || 0)}</div>`,
    );
  $("#main").insertAdjacentHTML(
    "beforeend",
    `<div class="filters">${select(
      "schedule-view",
      "نمایش",
      [
        ["class", "بر اساس کلاس"],
        ["grade", "بر اساس پایه"],
        ["teacher", "بر اساس دبیر"],
        ["school", "کل مدرسه"],
      ],
      scheduleView,
    )}${options.length ? select("schedule-target", "انتخاب", options, scheduleTarget) : ""}${button("pdf", "دریافت PDF", "", sol.stale ? "disabled" : "")}${button("pdf-all", "PDF همهٔ " + (scheduleView === "teacher" ? "دبیران" : scheduleView === "grade" ? "پایه‌ها" : "کلاس‌ها"), "", sol.stale || scheduleView === "school" ? "hidden" : "")}</div><div id="schedule-table"></div>`,
  );
  renderGrid();
  const unsatisfied = (sol.audit?.rules || []).filter(
    (r) => r.mode === "soft" && !r.satisfied,
  );
  $("#main").insertAdjacentHTML(
    "beforeend",
    `<section class="card"><h2>گزارش ترجیح‌ها</h2>${unsatisfied.length ? unsatisfied.map((r) => `<p><span class="badge soft">رعایت نشده · وزن ${fa(r.weight)}</span> ${esc(r.name)}</p>`).join("") : '<p class="muted">همهٔ ترجیح‌های فعال در آخرین حل رعایت شده‌اند.</p>'}${sol.stale ? "<small>این گزارش نیز متعلق به حل قبلی است.</small>" : ""}</section>`,
  );
  $("[name=schedule-view]").addEventListener("change", (e) => {
    scheduleView = e.target.value;
    scheduleTarget = "";
    renderSchedule();
  });
  $("[name=schedule-target]")?.addEventListener("change", (e) => {
    scheduleTarget = e.target.value;
    renderGrid();
  });
}
function renderGrid() {
  const H = school.periods * 2,
    sol = school.solution,
    classes = school.classes.filter((c) =>
      scheduleView === "class"
        ? c.id === scheduleTarget
        : scheduleView === "grade"
          ? (c.grade || "بدون پایه") === scheduleTarget
          : true,
    );
  const events = new Map(
    school.lessons.flatMap((l) =>
      Array.from({ length: l.count }, (_, i) => [
        l.id + ":" + i,
        { ...l, eventId: l.id + ":" + i },
      ]),
    ),
  );
  const scheduled = sol.schedule
    .map((r) => ({ row: r, event: events.get(r.id) }))
    .filter((x) => x.event);
  const cell = (d, p, cid = null) =>
    scheduled
      .filter(
        ({ row: r, event: e }) =>
          Math.floor(r.start / H) === d &&
          Math.floor((r.start % H) / 2) === p &&
          (scheduleView === "teacher"
            ? r.teacherId === scheduleTarget
            : e.classIds.includes(cid)),
      )
      .map(
        ({ row: r, event: e }) =>
          `<div tabindex="0" role="button" aria-label="تثبیت یا تغییر زمان ${esc(e.name)}" class="lesson-cell ${e.classIds.length > 1 ? "joint" : ""}" data-action="pin" data-event="${esc(e.eventId)}" data-start="${r.start}">${esc(e.titles?.[cid] || e.name)}<small>${esc(scheduleView === "teacher" ? joined("classes", e.classIds) : lookup("teachers", r.teacherId)?.name || "بدون دبیر")}</small>${e.duration === 1 ? `<span class="badge gray">نیمهٔ ${fa((r.start % 2) + 1)}</span>` : ""}${e.classIds.length > 1 ? "<small>تجمیعی</small>" : ""}</div>`,
      )
      .join("") || '<span class="muted">—</span>';
  let rows = [];
  for (let d = 0; d < school.days.length; d++) {
    const groups = scheduleView === "teacher" ? [null] : classes;
    for (const c of groups)
      rows.push(
        `<tr><th>${esc(school.days[d])}${c ? "<br><small>" + esc(c.name) + "</small>" : ""}</th>${Array.from({ length: school.periods }, (_, p) => `<td>${cell(d, p, c?.id)}</td>`).join("")}</tr>`,
      );
  }
  $("#schedule-table").innerHTML =
    `<div class="table-wrap"><table class="matrix"><thead><tr><th>روز / کلاس</th>${Array.from({ length: school.periods }, (_, p) => `<th>زنگ ${fa(p + 1)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div><p class="hint">برای ثابت کردن یا تغییر زمان یک جلسه، روی آن کلیک کنید؛ زمان در قالب قید ذخیره می‌شود و سپس باید برنامه را دوباره بسازید.</p>`;
}
function renderBackups() {
  $("#main").innerHTML =
    heading(
      "ذخیره و بازیابی",
      "ادامهٔ کار روی همین دستگاه یا انتقال مدرسه به دستگاه دیگر.",
    ) +
    `<div class="two-cols"><section class="card"><h2>فایل مدرسه</h2><p class="muted">شامل کلاس‌ها، درس‌ها، دبیران، محدودیت‌ها و آخرین برنامه است. بازیابی همیشه یک مدرسهٔ جداگانه می‌سازد.</p><div class="actions">${button("export", "دریافت فایل JSON", "primary")}${button("import", "بازیابی از فایل")}</div></section><section class="card"><h2>ذخیره‌سازی خودکار</h2><p class="muted">هر تغییر پس از ثبت فرم، در فایل زیر ذخیره می‌شود. ۳۰ نسخهٔ قبلی هر مدرسه نیز نگهداری می‌شود.</p><code>${esc(state.database)}</code></section></div><section class="card"><h2>تاریخچهٔ تغییرات</h2><div id="history-list">در حال دریافت…</div></section><section class="card"><h2>حذف مدرسه</h2><p class="muted">مدرسه و تاریخچهٔ آن از این دستگاه حذف می‌شوند. قبل از حذف، فایل پشتیبان را دریافت کنید.</p>${button("delete-school", "حذف این مدرسه", "danger")}</section>`;
  const id = school.id;
  api("history?id=" + encodeURIComponent(id))
    .then((rows) => {
      if (tab !== "backups" || school?.id !== id) return;
      $("#history-list").innerHTML = rows.length
        ? table(
            ["نسخه", "زمان جایگزینی", ""],
            rows.map((r) => [
              fa(r.revision),
              new Date(r.updated).toLocaleString("fa-IR"),
              button(
                "restore",
                "بازگردانی",
                "",
                `data-revision="${r.revision}"`,
              ),
            ]),
          )
        : '<p class="muted">هنوز نسخهٔ قبلی وجود ندارد.</p>';
    })
    .catch((e) => toast(e.message));
}
async function download(url, filename) {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error);
  }
  const blob = await res.blob(),
    u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
async function pollJob(id, schoolId) {
  try {
    const result = await api("job?id=" + encodeURIComponent(id));
    if (result.state === "running") {
      setTimeout(() => pollJob(id, schoolId), 1000);
      return;
    }
    job = null;
    sessionStorage.removeItem("planner-job");
    if (result.school && school?.id === schoolId) {
      school = result.school;
      await refresh();
    }
    render();
    if (result.state === "error") toast(result.message);
    else if (result.result.schedule)
      toast("برنامه ساخته و در فایل اصلی ذخیره شد.");
    else {
      const message =
        result.result.message +
        "\n" +
        (result.result.conflicts || []).join("\n");
      if (tab === "schedule" && school?.id === schoolId)
        $("#solve-result").innerHTML =
          `<div class="notice"><strong>${esc(result.result.status === "INFEASIBLE" ? "برنامه با این شرایط ممکن نیست" : "جست‌وجو به زمان بیشتری نیاز دارد")}</strong><p>${esc(result.result.message)}</p>${(result.result.conflicts || []).map((x) => "<div>• " + esc(x) + "</div>").join("")}</div>`;
      else toast(message);
    }
  } catch (e) {
    job = null;
    toast(e.message);
    render();
  }
}
const commands = {
  "new-school": () =>
    showEditor(
      "مدرسهٔ جدید",
      field(
        "name",
        "نام مدرسه",
        "",
        "text",
        'required maxlength="150" autofocus',
      ),
      async (form) => {
        school = await api("create", {
          name: new FormData(form).get("name").trim(),
        });
        await refresh();
        localStorage.setItem("planner-school", school.id);
        tab = "dashboard";
        render();
        status("✓ مدرسه ذخیره شد");
      },
    ),
  "open-school": async (el) => {
    school = await api("school?id=" + encodeURIComponent(el.dataset.id));
    localStorage.setItem("planner-school", school.id);
    tab = "dashboard";
    render();
  },
  tab: (el) => {
    if (!school) {
      toast("ابتدا یک مدرسه انتخاب کنید.");
      return;
    }
    tab = el.dataset.tab;
    render();
  },
  add: (el) => openEdit(el.dataset.kind),
  edit: (el) => openEdit(el.dataset.kind, el.dataset.id),
  "school-settings": settings,
  "close-dialog": () => $("#dialog").close(),
  "toggle-day": (el) => {
    const inputs = $$(`input[name="${el.dataset.field}"]`, $("#editor")).filter(
      (i) =>
        Math.floor(Number(i.value) / (school.periods * 2)) ===
        Number(el.dataset.day),
    );
    const value = !inputs.every((i) => i.checked);
    inputs.forEach((i) => (i.checked = value));
  },
  "all-slots": (el) =>
    $$(`input[name="${el.dataset.field}"]`, $("#editor")).forEach(
      (i) => (i.checked = true),
    ),
  "none-slots": (el) =>
    $$(`input[name="${el.dataset.field}"]`, $("#editor")).forEach(
      (i) => (i.checked = false),
    ),
  "delete-row": async (el) => {
    const { kind, id } = el.dataset;
    if (
      !confirm(
        "«" +
          lookup(kind, id).name +
          "» حذف شود؟ اگر در جلسات یا قیود استفاده شده باشد، ابتدا آن ارجاع‌ها را ویرایش کنید.",
      )
    )
      return;
    const doc = clone(school);
    doc[kind] = doc[kind].filter((r) => r.id !== id);
    if (kind === "teachers")
      doc.rules = doc.rules.filter((r) => r.id !== "gap-" + id);
    await save(doc);
    toast("حذف و ذخیره شد.");
  },
  export: () =>
    download(
      "/api/export?id=" + encodeURIComponent(school.id),
      school.name + ".json",
    ),
  import: () => $("#import-file").click(),
  restore: async (el) => {
    if (
      !confirm(
        "اطلاعات مدرسه به نسخهٔ " +
          fa(el.dataset.revision) +
          " برگردد؟ نسخهٔ جاری در تاریخچه باقی می‌ماند.",
      )
    )
      return;
    school = await api("restore", {
      id: school.id,
      revision: Number(el.dataset.revision),
    });
    await refresh();
    render();
    toast("نسخهٔ قبلی بازیابی شد.");
  },
  "delete-school": async () => {
    if (!confirm("مدرسهٔ «" + school.name + "» و تاریخچهٔ آن حذف شوند؟"))
      return;
    await api("delete", { id: school.id, revision: school.revision });
    school = null;
    localStorage.removeItem("planner-school");
    await refresh();
    render();
  },
  solve: async () => {
    const result = await api("solve", {
      id: school.id,
      seconds: Number($("[name=solve-seconds]").value),
      preserveWeight: Number($("[name=preserve-weight]").value),
    });
    job = result.jobId;
    sessionStorage.setItem(
      "planner-job",
      JSON.stringify({ id: job, schoolId: school.id }),
    );
    renderSchedule();
    pollJob(job, school.id);
  },
  pdf: () =>
    download(
      "/api/pdf?id=" +
        encodeURIComponent(school.id) +
        "&view=" +
        scheduleView +
        "&target=" +
        encodeURIComponent(scheduleTarget),
      school.name + " - برنامه.pdf",
    ),
  "pdf-all": () =>
    download(
      "/api/pdf?id=" + encodeURIComponent(school.id) + "&view=" + scheduleView,
      school.name + " - مجموعه برنامه‌ها.pdf",
    ),
  pin: (el) => {
    const id = el.dataset.event,
      start = Number(el.dataset.start),
      l = school.lessons.find((x) => id.startsWith(x.id + ":"));
    if (!l) return;
    const existing = school.rules.find(
      (r) =>
        r.kind === "allowed" &&
        r.eventIds?.length === 1 &&
        r.eventIds[0] === id,
    );
    if (existing) {
      editRule(existing);
      return;
    }
    editRule({
      id: uid(),
      name: "زمان جلسهٔ " + l.name,
      kind: "allowed",
      mode: "hard",
      weight: 10,
      enabled: true,
      eventIds: [id],
      slots: Array.from({ length: l.duration }, (_, i) => start + i),
    });
  },
  quit: async () => {
    if (!confirm("برنامه بسته شود؟ تغییرات ثبت‌شده ذخیره شده‌اند.")) return;
    await api("quit", {});
    document.body.innerHTML =
      '<main class="empty"><h1>برنامه بسته شد</h1><p>برای ادامه، هم‌درس را دوباره اجرا کنید.</p></main>';
  },
};
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled || busy) return;
  try {
    await commands[el.dataset.action]?.(el);
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("keydown", (e) => {
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches(".lesson-cell")
  ) {
    e.preventDefault();
    e.target.click();
  }
});
$("#editor").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  busy = true;
  $("#form-error").textContent = "";
  const btn = $("[type=submit]", $("#editor"));
  btn.disabled = true;
  try {
    await editor(e.target);
    $("#dialog").close();
    toast("تغییرات ذخیره شد.");
  } catch (err) {
    $("#form-error").textContent = err.message;
  } finally {
    busy = false;
    btn.disabled = false;
  }
});
$("#school-select").addEventListener("change", async (e) => {
  try {
    school = e.target.value
      ? await api("school?id=" + encodeURIComponent(e.target.value))
      : null;
    if (school) localStorage.setItem("planner-school", school.id);
    else localStorage.removeItem("planner-school");
    tab = "dashboard";
    render();
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.dataset.toggleRule) {
    try {
      const doc = clone(school);
      doc.rules.find((r) => r.id === e.target.dataset.toggleRule).enabled =
        e.target.checked;
      await save(doc);
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message);
    }
  }
});
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  try {
    if (!file) return;
    if (file.size > 8000000)
      throw new Error("حجم فایل باید کمتر از ۸ مگابایت باشد.");
    const data = JSON.parse(await file.text());
    school = await api("import", { school: data });
    await refresh();
    localStorage.setItem("planner-school", school.id);
    tab = "dashboard";
    render();
    toast("مدرسه در یک نسخهٔ مستقل بازیابی شد.");
  } catch (err) {
    toast("بازیابی انجام نشد: " + err.message);
  } finally {
    e.target.value = "";
  }
});
try {
  await refresh();
  const last = localStorage.getItem("planner-school");
  const reopen = state.schools.find((s) => s.id === last) || state.schools[0];
  if (reopen) school = await api("school?id=" + encodeURIComponent(reopen.id));
  render();
  status("✓ فایل اصلی آماده است");
  const previous = sessionStorage.getItem("planner-job");
  if (previous) {
    const j = JSON.parse(previous);
    job = j.id;
    pollJob(j.id, j.schoolId);
  }
} catch (e) {
  $("#main").innerHTML = empty("برنامه باز نشد", esc(e.message));
}
