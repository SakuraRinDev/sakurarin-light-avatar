const fs = require('fs');
const path = require('path');

const skillsPath = path.join(__dirname, 'data', 'skills.json');

function loadSkills() {
  return JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
}

function routeSkill(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) return null;

  const ranked = loadSkills()
    .map((skill) => {
      const score = (skill.triggers || []).reduce((total, trigger) => {
        const normalized = String(trigger || '').toLowerCase();
        return total + (normalized && text.includes(normalized) ? 1 : 0);
      }, 0);
      return { skill, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;
  return {
    ...ranked[0].skill,
    score: ranked[0].score,
  };
}

function formatSkillContext(skill) {
  if (!skill) return '';
  return [
    `参照スキル: ${skill.title} (${skill.id})`,
    `概要: ${skill.summary}`,
    `指針: ${skill.guidance}`,
  ].join('\n');
}

module.exports = {
  formatSkillContext,
  loadSkills,
  routeSkill,
};
