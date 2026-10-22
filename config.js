// All game rules in one place. Values marked "placeholder" are guesses: adjust them to taste.

export const SCORING = {
  // Skaters (placeholder, except goal = 50 which the owner named)
  goal: 50,
  assist: 25,
  shot: 2,          // per shot on goal
  blocked: 2,       // per blocked shot
  pim: -2,          // per penalty minute
  plusMinus: 5,     // per +1 / -1
  // Goalies (placeholder)
  save: 1,
  goalAgainst: -15,
  win: 20,
  shutout: 30,
};

export const PRICE = {
  pctPerPoint: 0.09, // 50 points (one goal) = +4.5 %
  capPct: 15,        // max change per day, up or down
  minPrice: 50_000,
  startBudget: 5_000_000,
  priceFloorStart: 100_000,
  priceCeilStart: 1_800_000,
};

export const RULES = {
  maxRoster: 18,
  maxGoalies: 3,
  rolloverHourZurich: 10, // prices of day D move on D+1 at this hour (Europe/Zurich), once all games of D are final
  liveIntervalMs: 60_000,   // poll while a game is running
  idleIntervalMs: 10 * 60_000,
  timezone: 'Europe/Zurich',
};

export const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH',
  'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG',
];

export const NHL_API = 'https://api-web.nhle.com/v1';
