// The score table (teams × starting points, rounds, running total), shared by the facilitator page and the big screen.
import { buildTable } from "./scoring.js";
import { esc, signed, signClass } from "./ui.js";

const dot = (vote) => (vote === "red" || vote === "green" ? `<span class="dot ${vote}" aria-label="${vote}"></span>` : "");

export function scoreTableHTML(settings, teams, results) {
  const table = buildTable(settings, teams, results);
  const head = table.rounds.map((r) => `<th>R${r}</th>`).join("");
  const body = table.rows.map((row) => `
    <tr class="${row.removed ? "removed" : ""}">
      <td><span class="team-label">${esc(row.name)}</span></td>
      <td class="start">${settings.startingPoints}</td>
      ${row.cells.map((cell) => `<td>${cell
        ? `<span class="cell">${dot(cell.vote)}<span class="${signClass(cell.change)}">${signed(cell.change)}</span></span>`
        : ""}</td>`).join("")}
      <td class="total">${row.total}</td>
    </tr>`).join("");
  return `
    <div class="table-wrap">
      <table class="score-table">
        <thead><tr><th>Team</th><th class="start">Start</th>${head}<th class="total">Total</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
