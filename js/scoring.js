// Pure scoring and table maths for the Red Green Game.
// No Firebase here, so it can be tested on its own and used by every page.

export const DEFAULT_SETTINGS = {
  teamCount: 4,
  rounds: 5,
  startingPoints: 50,
  scoring: {
    allGreen: 10,      // 0 reds: every team
    oneRedWinner: 30,  // exactly 1 red: the red team
    oneRedOthers: 0,   // exactly 1 red: every other team
    manyReds: -30      // 2 or more reds: every team
  }
};

export const LIMITS = {
  teamCount: { min: 2, max: 20 },
  rounds: { min: 1, max: 20 },
  startingPoints: { min: -1000, max: 1000 },
  allGreen: { min: -1000, max: 1000 },
  oneRedWinner: { min: -1000, max: 1000 },
  oneRedOthers: { min: -1000, max: 1000 },
  manyReds: { min: -1000, max: 1000 }
};

// votes: { teamId: "red" | "green" } for the teams still in the game.
// Returns { teamId: score change } for the same teams.
export function scoreRound(votes, scoring) {
  const teamIds = Object.keys(votes);
  for (const id of teamIds) {
    if (votes[id] !== "red" && votes[id] !== "green") {
      throw new Error(`Invalid vote for team ${id}: ${votes[id]}`);
    }
  }
  const reds = teamIds.filter((id) => votes[id] === "red");
  const changes = {};
  for (const id of teamIds) {
    if (reds.length === 0) changes[id] = scoring.allGreen;
    else if (reds.length === 1) changes[id] = votes[id] === "red" ? scoring.oneRedWinner : scoring.oneRedOthers;
    else changes[id] = scoring.manyReds;
  }
  return changes;
}

// Firebase turns objects with number keys (1, 2, 3...) into arrays with gaps,
// so read results the same way whichever shape arrives.
function entriesOf(collection) {
  if (!collection) return [];
  return Object.entries(collection).filter(([, value]) => value != null);
}

// settings: as DEFAULT_SETTINGS
// teams:    { teamId: { name, removed, joinedAt } }
// results:  { round: { votes: { teamId: choice }, changes: { teamId: number } } }
// Returns { rounds: [1..n], rows: [{ teamId, name, removed, cells, total }] }
// Each cell is { vote, change } for a revealed round the team took part in, otherwise null.
export function buildTable(settings, teams, results) {
  const rounds = Array.from({ length: settings.rounds }, (_, i) => i + 1);
  const byRound = new Map(entriesOf(results).map(([round, result]) => [Number(round), result]));

  const rows = entriesOf(teams)
    .sort(([, a], [, b]) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0))
    .map(([teamId, team]) => {
      let total = settings.startingPoints;
      const cells = rounds.map((round) => {
        const result = byRound.get(round);
        const change = result?.changes?.[teamId];
        if (change == null) return null;
        total += change;
        return { vote: result.votes?.[teamId] ?? null, change };
      });
      return { teamId, name: team.name, removed: Boolean(team.removed), cells, total };
    });

  return { rounds, rows };
}

// settings: as DEFAULT_SETTINGS (values may arrive as numbers or form strings).
// Returns { field: message } for each invalid field; an empty object means all valid.
export function validateSettings(settings) {
  const values = {
    teamCount: settings?.teamCount,
    rounds: settings?.rounds,
    startingPoints: settings?.startingPoints,
    allGreen: settings?.scoring?.allGreen,
    oneRedWinner: settings?.scoring?.oneRedWinner,
    oneRedOthers: settings?.scoring?.oneRedOthers,
    manyReds: settings?.scoring?.manyReds
  };
  const errors = {};
  for (const [field, raw] of Object.entries(values)) {
    const { min, max } = LIMITS[field];
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors[field] = "Please enter a whole number";
    } else if (value < min || value > max) {
      errors[field] = `Please enter a number from ${min} to ${max}`;
    }
  }
  return errors;
}
