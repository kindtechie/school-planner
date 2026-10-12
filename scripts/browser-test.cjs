/* Run after starting run.py --data-dir <dir> --no-browser.
   NODE_PATH=<playwright node_modules> node scripts/browser-test.cjs <dir>/session.url */
const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(fs.readFileSync(process.argv[2], "utf8").trim());
  await page
    .locator("#save-status")
    .filter({ hasText: "فایل اصلی آماده است" })
    .waitFor();
  const dialog = page.locator("#dialog");
  const save = async () => {
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
  };
  await page.locator(".new-school").click();
  await dialog.locator("[name=name]").fill("مدرسهٔ آزمون مرورگر");
  await save();
  await page.locator("[data-action=school-settings]").click();
  await dialog.locator("[name=name]").fill("مدرسهٔ روشن");
  await save();
  for (const kind of ["classes", "subjects", "teachers", "lessons"]) {
    await page.locator(`nav [data-tab=${kind}]`).click();
    await page.locator(".heading [data-action=add]").click();
    await dialog
      .locator("[name=name]")
      .fill(
        {
          classes: "دهم ریاضی",
          subjects: "ریاضی",
          teachers: "آقای احمدی",
          lessons: "ریاضی دهم",
        }[kind],
      );
    if (kind === "teachers") {
      await dialog.locator("[name=subjectIds]").check();
      await dialog.locator("[name=noGaps]").check();
      await dialog.locator("[name=gapMode]").selectOption("hard");
    }
    if (kind === "lessons") {
      await dialog.locator("[name=classIds]").check();
      await dialog.locator("[name=teacherIds]").check();
      await dialog.locator("[name=count]").fill("3");
    }
    await save();
  }
  await page.locator("nav [data-tab=rules]").click();
  await page.locator(".heading [data-action=add]").click();
  await dialog.locator("[name=name]").fill("ریاضی در سه روز");
  await dialog.locator("[name=kind]").selectOption("day_count");
  await dialog.locator("[name=mode]").selectOption("hard");
  await dialog.locator("[name=min]").fill("3");
  await dialog.locator("[name=max]").fill("3");
  await save();
  await page.locator("nav [data-tab=schedule]").click();
  await page.locator("[data-action=solve]").click();
  await page.locator(".notice.success").waitFor({ timeout: 30000 });
  assert.equal(await page.locator(".lesson-cell").count(), 3);
  await page.screenshot({
    path: "test-results/schedule-desktop.png",
    fullPage: true,
  });
  for (const view of ["class", "grade", "teacher", "school"]) {
    await page.locator("[name=schedule-view]").selectOption(view);
    const pending = page.waitForEvent("download");
    await page.locator("[data-action=pdf]").click();
    const file = await pending;
    await file.saveAs("test-results/" + view + ".pdf");
    assert.equal(
      fs
        .readFileSync("test-results/" + view + ".pdf")
        .subarray(0, 5)
        .toString(),
      "%PDF-",
    );
  }
  await page.locator("nav [data-tab=backups]").click();
  const download = page.waitForEvent("download");
  await page.locator("[data-action=export]").click();
  await (await download).saveAs("test-results/school.json");
  const json = JSON.parse(fs.readFileSync("test-results/school.json", "utf8"));
  assert.equal(json.lessons.length, 1);
  await page.locator("#import-file").setInputFiles("test-results/school.json");
  await page.locator("h1").filter({ hasText: "یک هفتهٔ منظم" }).waitFor();
  await page.reload();
  await page.locator("h1").filter({ hasText: "یک هفتهٔ منظم" }).waitFor();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.locator("nav [data-tab=classes]").click();
  await page.locator("[data-action=edit]").click();
  await dialog.locator("[name=name]").fill("دهم <img src=x onerror=alert(1)>");
  await save();
  assert.equal(await page.locator("main img").count(), 0);
  await page.locator("nav [data-tab=schedule]").click();
  await page.locator("[data-action=pdf][disabled]").waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-action=solve]").click();
  await page.locator(".notice.success").waitFor();
  await page.locator(".lesson-cell").first().click();
  await save();
  await page.locator(".lesson-cell").first().click();
  await save();
  await page.locator("nav [data-tab=rules]").click();
  assert.equal(await page.locator("main tbody tr").count(), 3);
  await page.locator("nav [data-tab=dashboard]").click();
  await page.locator("[data-action=school-settings]").click();
  await dialog.locator("[name=periods]").fill("5");
  page.once("dialog", d => d.accept());
  await save();
  const currentId = await page.locator("#school-select").inputValue();
  const migrated = await page.evaluate(async id => (await fetch('/api/school?id='+id)).json(), currentId);
  assert.equal(migrated.classes[0].bells.length, 5);
  assert.equal(migrated.teachers[0].availability.length, 40);
  assert.equal(migrated.solution.stale, true);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Browser flow passed: CRUD, solve, four PDF views, export/import, reload, mobile, escaping, stale result, pin edit, calendar migration.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
