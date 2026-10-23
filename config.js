// All game rules in one place. Values marked "placeholder" are guesses: adjust them to taste.

export const SCORING = {
  // Taken from the Topscorers "Game rules" page (National League), transferred 1:1 where the NHL data allows it.
  goal: { F: 60, D: 70, G: 100 },
  assist: { F: 40, D: 50, G: 55 },
  shutout: 40,            // goalie
  hattrick: 20,           // 3+ goals in one game
  powerplayGoal: 10,
  win: 15,                // game won in regulation (every player who dressed)
  winOT: 10,              // game won in overtime or shootout
  lossOT: 5,              // game lost in overtime
  lossSO: -10,            // game lost in the shootout
  loss: -15,              // game lost in regulation
  zeroAgainst: 10,        // goalie and defensemen when the team concedes no goal
  blocked: 10,            // per blocked shot
  shot: 5,                // per shot on goal
  lineup: 5,              // player really played in the game
  plusMinus: 5,           // per +1 / -1
  save: 4,                // goalie
  goalAgainst: -15,       // goalie
  shGoal: 20, shAssist: 10, ppAssist: 5,   // shorthanded goal, shorthanded assist, powerplay assist
  gwg: 15,                // game winning goal
  pwg: 15,                // shootout winning goal ("Penalty Winning Goal")
  faceoffWon: 2, faceoffLost: -2,
  missedShot: -5,         // shot wide or on the post
  psFoul: -35,            // foul that gives a penalty shot
  penaltyMatch: -125,
  timeOnIce: 1,           // per full minute on the ice (skaters)
  goalieTime: 1,          // goalie time bonus per 10 minutes played
  emptySlot: -50,         // per unfilled line-up position (16 needed)
  // Penalties by length: 2 min = -10, 5 min (major) = -75, 10 min (misconduct) = -50
  penalty2: -10, penalty5: -75, penalty10: -50,
};

export const PRICE = {
  pctPerPoint: 0.09, // 50 points (one goal) = +4.5 %
  capPct: 15,        // max change per day, up or down
  minPrice: 50_000,
  startBudget: 2_000_000,
  priceFloorStart: 100_000,
  priceCeilStart: 1_800_000,
};

export const RULES = {
  maxRoster: 20,
  maxGoalies: 3,
  rolloverHourZurich: 10, // prices of day D move on D+1 at this hour (Europe/Zurich), once all games of D are final
  liveIntervalMs: 60_000,   // poll while a game is running
  idleIntervalMs: 10 * 60_000,
  timezone: 'Europe/Zurich',
  // Market: 48 offers, every hour the oldest leaves and a new one arrives, so each player stays 48 hours.
  marketSlots: 48,
  marketHours: 48,
  // Starter team given once to every new manager (free): 9 forwards + 6 defensemen + 1 goalie.
  starter: { F: 9, D: 6, G: 1, maxPlayerPrice: 450_000, minTotal: 3_000_000, maxTotal: 3_500_000 },
  userListingHours: 24,   // how long a player offered by a manager stays on the market
  injurySyncMs: 60 * 60_000,
  // true = players whose team plays today cannot be bought, sold or bid on until the day is closed (next morning).
  // Off: the market is always open. Careful: then a player can be bought at the old price after a strong game.
  // The lineup stays locked either way, so nobody can put a player in after he scored.
  marketLock: false,
};

export const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH',
  'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG',
];

export const NHL_API = 'https://api-web.nhle.com/v1';
// NHL statistics API: season totals the web API does not have (blocked shots, faceoffs won). Optional.
export const NHL_STATS_API = 'https://api.nhle.com/stats/rest/en';

// Unofficial injury list (the NHL web API has no injury data). Optional: if it fails, the app still works.
export const INJURY_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries';
