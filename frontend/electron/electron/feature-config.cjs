const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULTS = {
  autoDetect: true,
  autoComplete: false,
  knowledgeReview: true,
  gpaAlert: true,
  reminder: true,
  autoSubmit: false,
  ocr: true,
  notifications: true,
  gpaThreshold: "B",
  remindLeadHours: [24, 6, 1],
  checkIntervalMinutes: 10,
};

async function loadFeatureConfig(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveFeatureConfig(filePath, patch) {
  const current = await loadFeatureConfig(filePath);
  const next = { ...current, ...patch };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { DEFAULTS, loadFeatureConfig, saveFeatureConfig };
