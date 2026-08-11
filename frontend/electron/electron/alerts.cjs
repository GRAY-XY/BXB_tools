const fs = require("node:fs/promises");
const path = require("node:path");

const LEVEL_RANK = { A: 4, B: 3, C: 2, D: 1 };

function evaluateGpaAlert(overview, threshold = "B") {
  if (!overview?.averageLevel) {
    return [];
  }
  const level = String(overview.averageLevel).toUpperCase();
  const thresholdRank = LEVEL_RANK[String(threshold || "B").toUpperCase()] ?? LEVEL_RANK.B;
  return [
    {
      subject: overview.context?.currentSubject?.subjectName || "当前科目",
      level,
      dangerous: (LEVEL_RANK[level] ?? 0) <= thresholdRank,
    },
  ];
}

function evaluateReminders(tasks, now = new Date(), leadHours = [24, 6, 1]) {
  const items = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const end = task?.endTime ? new Date(task.endTime) : null;
    if (!end || Number.isNaN(end.getTime())) {
      continue;
    }
    const hoursLeft = (end - now) / 36e5;
    const subject = task?.subjectName || task?.subject || "";
    if (hoursLeft < 0) {
      items.push({
        taskId: String(task?.id ?? ""),
        title: task?.title || "未命名作业",
        subject,
        endTime: task.endTime,
        status: "overdue",
        hoursLeft: 0,
      });
    } else {
      for (const lead of leadHours) {
        if (hoursLeft <= lead && hoursLeft > lead - 1) {
          items.push({
            taskId: String(task?.id ?? ""),
            title: task?.title || "未命名作业",
            subject,
            endTime: task.endTime,
            status: "upcoming",
            hoursLeft: Math.ceil(hoursLeft),
          });
          break;
        }
      }
    }
  }
  return items;
}

async function loadAlertState(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return { gpaNotified: {}, remindersNotified: {} };
  }
}

async function saveAlertState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

module.exports = { evaluateGpaAlert, evaluateReminders, loadAlertState, saveAlertState };
