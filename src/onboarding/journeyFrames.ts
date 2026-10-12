export const journeyScenes = [
  ['01-door', '门口出发', '天亮了。走吧。'],
  ['02-spring', '春日木桥', '桥在林子里，沿着水声走。'],
  ['03-harbor', '落日海港', '灯塔亮了，船快到了。'],
  ['04-autumn', '秋日钟楼', '听，钟声从山那边传来。'],
  ['05-winter', '雪地足迹', '这里的雪，比想象中深。'],
  ['06-glass-sea', '玻璃海', '别急，看看水下面。'],
  ['07-gravity', '悬岛石阶', '踩稳这一级，再往上走。'],
  ['08-world', '世界与归路', '地图远不止这一角。'],
  ['09-ledger', '翻开账簿', '到了。今天的事，记在这里。'],
] as const;

// Millisecond edit points selected from the slowed source's measured musical onsets.
const cuts = [0,650,1200,2550,3300,4000,5200,5825,6175,7350,8000,8575,10425,11000,11600,12800,13450,14300,15825,17050,18275,19775,20675,21275,21925,22525,23150,24166];
export const journeyMusic = '/onboarding/journey-comic/score/devils-love-09.mp3';
export const journeyDuration = cuts[cuts.length - 1];

export const journeyFrames = journeyScenes.flatMap(([key, description, caption], scene) =>
  [1, 2, 3].map((beat, step) => ({
    src: `/onboarding/journey-comic/nine/${key}-${beat}.png`,
    description,
    scene,
    caption,
    start: cuts[scene * 3 + step],
    duration: cuts[scene * 3 + step + 1] - cuts[scene * 3 + step],
  })),
);

export const journeyFrameAt = (milliseconds: number) => {
  const found = journeyFrames.findIndex(frame => milliseconds < frame.start + frame.duration);
  return found < 0 ? journeyFrames.length - 1 : found;
};

export const lastJourneyImage = journeyFrames[journeyFrames.length - 1].src;
export const normalizeJourneyFrame = (value: unknown): number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < journeyFrames.length ? value as number : 0;
