// Spreadsheet layout for downloaded results. Pure data: returns rows (arrays of cells);
// the pages hand these to the Excel library to build the .xlsx file.
import { buildTable } from "./scoring.js";

// game: { id, createdAt, settings, state, teams, results } as stored in the database.

const pad = (n) => String(n).padStart(2, "0");

export function formatDate(ms, withTime = true) {
  const d = new Date(ms);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

export function statusText(game) {
  const { status, round } = game.state ?? {};
  if (status === "ended") return "Finished";
  if (status === "lobby" || status === "ready") return "Not started";
  return `Not finished (stopped in round ${round} of ${game.settings.rounds})`;
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

function scoringText(scoring) {
  return `0 reds: ${signed(scoring.allGreen)} each; ` +
    `1 red: red team ${signed(scoring.oneRedWinner)}, others ${signed(scoring.oneRedOthers)}; ` +
    `2+ reds: ${signed(scoring.manyReds)} each`;
}

const voteText = (vote) => (vote === "red" ? "Red" : vote === "green" ? "Green" : "");

function roundHeaders(count) {
  return Array.from({ length: count }, (_, i) => [`Round ${i + 1} vote`, `Round ${i + 1} points`]).flat();
}

function roundCells(cells, count) {
  return Array.from({ length: count }, (_, i) => {
    const cell = cells[i];
    return cell ? [voteText(cell.vote), cell.change] : ["", ""];
  }).flat();
}

// Excel sheet names: max 31 characters, no ":"; "2026-11-12 ABC234".
export function sheetName(game) {
  return `${formatDate(game.createdAt, false)} ${game.id}`;
}

// One sheet per game: details at the top, then one row per team.
export function gameSheetRows(game) {
  const { settings } = game;
  const table = buildTable(settings, game.teams, game.results);
  return [
    ["Red Green Game results"],
    ["Game code", game.id],
    ["Date", formatDate(game.createdAt)],
    ["Status", statusText(game)],
    ["Rounds", settings.rounds],
    ["Starting points", settings.startingPoints],
    ["Scoring", scoringText(settings.scoring)],
    [],
    ["Team", ...roundHeaders(settings.rounds), "Total", "Note"],
    ...table.rows.map((row) => [
      row.name, ...roundCells(row.cells, settings.rounds), row.total, row.removed ? "Removed" : ""
    ])
  ];
}

// "All games" sheet: one row per team per game, newest game first, for filtering and comparing.
export function overviewRows(games) {
  const maxRounds = Math.max(0, ...games.map((g) => g.settings.rounds));
  const header = ["Date", "Game code", "Status", "Team", "Removed", ...roundHeaders(maxRounds), "Total"];
  const rows = [...games]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((game) =>
      buildTable(game.settings, game.teams, game.results).rows.map((row) => [
        formatDate(game.createdAt), game.id, statusText(game), row.name, row.removed ? "Yes" : "",
        ...roundCells(row.cells, maxRounds), row.total
      ])
    );
  return [header, ...rows];
}

// The file name for a download: one game gets its own name, several get a dated bundle.
export function fileName(games, today = Date.now()) {
  return games.length === 1
    ? `Red Green Game ${sheetName(games[0])}.xlsx`
    : `Red Green Game results ${formatDate(today, false)}.xlsx`;
}
