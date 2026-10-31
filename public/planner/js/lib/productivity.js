const tips = [
  {
    title: "Make the first step tiny",
    body: "Choose an action you can finish in five minutes. Starting small makes it easier to build momentum.",
  },
  {
    title: "Pick your one thing",
    body: "Name the single task that would make today feel worthwhile, then give it your clearest block of time.",
  },
  {
    title: "Match work to your energy",
    body: "Use a high-energy moment for harder thinking and save lighter review or organizing for a slower part of the day.",
  },
  {
    title: "Add a little breathing room",
    body: "Plan a short break between focus blocks. Stand up, stretch, or get some water before choosing what comes next.",
  },
  {
    title: "Make distractions harder to reach",
    body: "Before you begin, silence one notification or move one distracting tab out of sight.",
  },
  {
    title: "Try a quick brain dump",
    body: "Write down the thoughts competing for your attention. Pick one to handle now and let the rest wait.",
  },
  {
    title: "Notice what went well",
    body: "At the end of a study block, name one thing you moved forward. Progress counts even when the whole task isn't done.",
  },
];

export function dailyProductivityTip(date = new Date()) {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  return tips[((day % tips.length) + tips.length) % tips.length];
}
