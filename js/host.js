// Facilitator page: setup, then one screen per game step. Opened as host.html (new game)
// or host.html?g=GAMEID#k=KEY (the private facilitator link).
import { connect } from "./firebase.js";
import { DEFAULT_SETTINGS, LIMITS, validateSettings } from "./scoring.js";
import { activeTeamIds, movingTeamIds } from "./game.js";
import { $, esc, signed, signClass, voteHTML, sortedTeams, toast, friendly, connectionBanner, store, copyText, pageLink } from "./ui.js";
import { showQR } from "./qr.js";
import { scoreTableHTML } from "./table.js";
import { downloadGames } from "./download.js";

const app = $("#app");
const gameId = new URLSearchParams(location.search).get("g")?.trim().toUpperCase() || null;
const key = new URLSearchParams(location.hash.slice(1)).get("k");

let api;
let game = null;        // latest live snapshot
let working = false;    // an action is in progress: buttons are disabled
let resuming = false;   // finishing an interrupted reveal
const codes = {};       // Reset phone codes shown on this device: teamId -> { code, owner }

main();

async function main() {
  try {
    api = await connect();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="card"><h2>Couldn't connect</h2><p>Please check the internet connection and reload the page.</p></div>`;
    return;
  }
  if (gameId) openGame();
  else showSetup();
}

// ---------- setup ----------

const FIELDS = [
  { id: "teamCount", label: "Expected number of teams", hint: "More teams can still join" },
  { id: "rounds", label: "Number of rounds" },
  { id: "startingPoints", label: "Starting points per team" },
  { id: "allGreen", label: "No reds", hint: "every team gets", scoring: true },
  { id: "manyReds", label: "Two or more reds", hint: "every team gets", scoring: true },
  { id: "oneRedWinner", label: "Exactly one red", hint: "the red team gets", scoring: true },
  { id: "oneRedOthers", label: "Exactly one red", hint: "every other team gets", scoring: true }
];

function showSetup() {
  const saved = store.get("rgg.settings") ?? DEFAULT_SETTINGS;
  const value = (f) => (f.scoring ? saved.scoring?.[f.id] : saved[f.id]) ?? (f.scoring ? DEFAULT_SETTINGS.scoring[f.id] : DEFAULT_SETTINGS[f.id]);
  const field = (f) => `
    <div class="field">
      <label for="${f.id}">${f.label}${f.hint ? ` <span class="hint">${f.hint}</span>` : ""}</label>
      <input id="${f.id}" type="number" inputmode="numeric" step="1" min="${LIMITS[f.id].min}" max="${LIMITS[f.id].max}" value="${esc(value(f))}">
      <div class="error-text" id="${f.id}-error"></div>
    </div>`;
  const last = store.get("rgg.hostLink");

  app.innerHTML = `
    <h1>Red Green Game</h1>
    <p class="muted">Set up a new game. Adjust the scoring if needed.</p>
    ${last?.link ? `<div class="card"><p>Your last game: <span class="code">${esc(last.gameId)}</span></p>
      <a class="button secondary wide" href="${esc(last.link)}">Back to game ${esc(last.gameId)}</a></div>` : ""}
    <form id="setup" class="card" novalidate>
      <fieldset><legend>Game</legend>${FIELDS.filter((f) => !f.scoring).map(field).join("")}</fieldset>
      <fieldset><legend>Points per round</legend>${FIELDS.filter((f) => f.scoring).map(field).join("")}</fieldset>
      <button id="create" class="wide" type="submit">Create game</button>
    </form>
    <a class="button secondary wide" href="records.html">Past games</a>`;

  const form = $("#setup");
  const read = () => {
    const v = (id) => $(`#${id}`).value;
    return {
      teamCount: v("teamCount"), rounds: v("rounds"), startingPoints: v("startingPoints"),
      scoring: { allGreen: v("allGreen"), oneRedWinner: v("oneRedWinner"), oneRedOthers: v("oneRedOthers"), manyReds: v("manyReds") }
    };
  };
  const check = () => {
    const errors = validateSettings(read());
    for (const f of FIELDS) {
      $(`#${f.id}-error`).textContent = errors[f.id] ?? "";
      $(`#${f.id}`).classList.toggle("invalid", Boolean(errors[f.id]));
    }
    $("#create").disabled = Object.keys(errors).length > 0;
    return errors;
  };
  form.addEventListener("input", check);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (Object.keys(check()).length) return;
    const button = $("#create");
    button.disabled = true;
    button.textContent = "Creating…";
    try {
      const settings = read();
      const created = await api.createGame(settings);
      store.set("rgg.settings", settings);
      const link = `${location.origin}${location.pathname}?g=${created.gameId}#k=${created.key}`;
      store.set("rgg.hostLink", { gameId: created.gameId, link });
      location.assign(link);
    } catch (error) {
      toast(friendly(error));
      button.textContent = "Create game";
      check();
    }
  });
  check();
}

// ---------- game ----------

async function openGame() {
  if (key) {
    try {
      await api.claimHost(gameId, key);
      store.set("rgg.hostLink", { gameId, link: location.href });
    } catch (error) {
      return notHost(friendly(error));
    }
  } else if (!(await api.isHost(gameId))) {
    return notHost("This phone isn't the facilitator for this game.");
  }

  app.innerHTML = `
    <header class="topbar">
      <h1>Game <span class="code">${esc(gameId)}</span></h1>
      <span class="pill" id="step"></span>
    </header>
    <div id="join-toggle"></div>
    <div id="hold"></div>
    <section id="lobby-qr" class="card center hidden">
      <h2 id="qr-title">Teams join here</h2>
      <div class="qr" id="qr"></div>
      <p class="link-text">${esc(pageLink("play.html", gameId))}</p>
    </section>
    <div id="screen"></div>
    <details class="card" id="links">
      <summary>Links for this game</summary>
      ${linkRow("Big screen (projector)", pageLink("screen.html", gameId), true)}
      ${linkRow("Teams' join link", pageLink("play.html", gameId))}
      ${linkRow("Your private facilitator link: keep it to yourself", `${location.origin}${location.pathname}?g=${gameId}#k=${key ?? ""}`, false, !key)}
    </details>
    <a class="button secondary wide" href="host.html">New game</a>`;

  $("#links").addEventListener("click", onLinkClick);
  $("#screen").addEventListener("click", onAction);
  $("#hold").addEventListener("click", onAction);
  $("#join-toggle").addEventListener("click", onAction);
  showQR($("#qr"), pageLink("play.html", gameId));

  api.watchGame(gameId, (snapshot) => {
    game = snapshot;
    connectionBanner(snapshot.connected);
    render();
  });
}

function notHost(message) {
  app.innerHTML = `
    <div class="card">
      <h2>Game ${esc(gameId)}</h2>
      <p>${esc(message)}</p>
      <p class="muted">Open your private facilitator link: the one that ends with <span class="code">#k=…</span></p>
    </div>
    <a class="button secondary wide" href="host.html">Set up a new game</a>`;
}

function linkRow(label, link, canOpen = false, missing = false) {
  if (missing) return `<p class="small muted">${esc(label)}: open the full link from when you created the game to copy it.</p>`;
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <p class="link-text">${esc(link)}</p>
      <div class="row-buttons">
        <button class="small secondary" data-copy="${esc(link)}">Copy link</button>
        ${canOpen ? `<a class="button small secondary" href="${esc(link)}" target="_blank" rel="noopener">Open</a>` : ""}
      </div>
    </div>`;
}

function onLinkClick(event) {
  const button = event.target.closest("[data-copy]");
  if (button) copyText(button.dataset.copy, button);
}

// ---------- rendering ----------

const STEP = {
  lobby: () => "Teams joining",
  ready: () => "Teams confirmed",
  voting: (r) => `Round ${r}: voting`,
  revealing: () => "Revealing…",
  revealed: (r) => `Round ${r}: revealed`,
  ended: () => "Game over"
};

function render() {
  if (!game?.state || !game.settings) {
    $("#screen").innerHTML = `<div class="card"><p>Game ${esc(gameId)} wasn't found. Please check the link.</p></div>`;
    return;
  }
  const { status, round } = game.state;
  const hold = onHold();
  $("#step").textContent = hold ? "On hold" : STEP[status]?.(round) ?? status;
  $("#lobby-qr").classList.toggle("hidden", status !== "lobby" && !hold);
  $("#qr-title").textContent = hold ? "New phone: scan to rejoin" : "Teams join here";

  // Forget Reset phone codes once the new phone has taken over or the move was cancelled.
  for (const [id, shown] of Object.entries(codes)) {
    const team = game.teams?.[id];
    if (team?.owner !== shown.owner || team?.removed || game.moving?.[id] !== true) delete codes[id];
  }

  const screens = { lobby: lobbyHTML, ready: readyHTML, voting: votingHTML, revealing: revealingHTML, revealed: revealedHTML, ended: endedHTML };
  $("#hold").innerHTML = hold ? holdHTML() : "";
  $("#join-toggle").innerHTML = joinToggleHTML(hold);
  $("#screen").innerHTML = (screens[status] ?? (() => ""))();
  // On hold: the next step waits until the new phone is in.
  if (hold) for (const b of $("#screen").querySelectorAll(".sticky-action button")) b.disabled = true;
  if (working) for (const b of app.querySelectorAll("#join-toggle button, #hold button, #screen button")) b.disabled = true;

  if (status === "revealing" && !resuming) {
    resuming = true;
    run(() => api.reveal(gameId, round)).finally(() => { resuming = false; });
  }
}

const active = () => activeTeamIds(game.teams);
const canDelete = () => game.state.status === "lobby" || active().length > 2;
const moving = () => movingTeamIds(game.teams, game.moving);
const onHold = () => ["ready", "voting", "revealed"].includes(game.state.status) && moving().length > 0;

// During the game: puts the joining QR code on the big screen, e.g. for a team that closed its page.
// Not needed in the lobby or on hold (the QR code is shown anyway), nor after the game.
function joinToggleHTML(hold) {
  if (!["ready", "voting", "revealing", "revealed"].includes(game.state.status) || hold) return "";
  return game.showJoin
    ? `<div class="card join-on"><p><strong>The joining QR code is on the big screen.</strong></p>
        <button class="wide secondary" data-action="hide-join">Hide QR code on big screen</button></div>`
    : `<button class="wide secondary join-button" data-action="show-join">Show joining QR code on big screen</button>`;
}

// Shown at the top while a team is moving to a new phone.
function holdHTML() {
  return `
    <section class="card hold">
      <h2>On hold: moving to a new phone</h2>
      <p class="muted small">Teams' phones show "The game will resume shortly". It carries on by itself once the new phone is in.</p>
      <ul class="teams">${moving().map((id) => {
        const team = game.teams[id];
        const code = codes[id];
        return `
          <li class="team">
            <div class="team-head"><span class="team-name">${esc(team.name)}</span><span class="status no">Waiting for new phone…</span></div>
            ${code
              ? `<div class="rejoin-code">Code for the new phone: <span class="code">${code.code}</span><br>
                <span class="small">On the new phone: scan the QR code (big screen or below), choose "Rejoin my team", pick ${esc(team.name)} and type this code.</span></div>`
              : `<p class="notice small">This page was reloaded, so the code is no longer shown. Press New code to get a fresh one.</p>`}
            <div class="row-buttons">
              <button class="small secondary" data-action="newcode" data-team="${id}">New code</button>
              <button class="small secondary" data-action="cancel-move" data-team="${id}">Cancel move</button>
            </div>
          </li>`;
      }).join("")}</ul>
    </section>`;
}

function teamListHTML({ showVoted = false, actions = [] } = {}) {
  const { round } = game.state;
  const teams = sortedTeams(game.teams);
  if (!teams.length) return `<p class="muted">No teams yet. Show the big screen so teams can scan the QR code.</p>`;
  return `<ul class="teams">${teams.map(([id, team]) => {
    if (team.removed) {
      return `<li class="team removed"><div class="team-head"><span class="team-name">${esc(team.name)}</span><span class="status no">Removed</span></div></li>`;
    }
    const voted = game.voted?.[round]?.[id] === true;
    const buttons = [];
    if (actions.includes("clear") && voted) buttons.push(`<button class="small secondary" data-action="clear" data-team="${id}">Clear vote</button>`);
    const isMoving = game.moving?.[id] === true;
    if (actions.includes("reset") && !isMoving) buttons.push(`<button class="small secondary" data-action="reset" data-team="${id}">Reset phone</button>`);
    if (actions.includes("delete")) buttons.push(`<button class="small danger" data-action="delete" data-team="${id}" ${canDelete() ? "" : "disabled"}>Delete team</button>`);
    return `
      <li class="team">
        <div class="team-head">
          <span class="team-name">${esc(team.name)}</span>
          ${showVoted ? `<span class="status ${voted ? "yes" : "no"}">${voted ? "✓ Voted" : "Waiting…"}</span>` : ""}
        </div>
        ${buttons.length ? `<div class="row-buttons">${buttons.join("")}</div>` : ""}
        ${isMoving ? `<p class="small muted">Moving to a new phone: see the top of the page.</p>` : ""}
      </li>`;
  }).join("")}</ul>
  ${actions.includes("delete") && !canDelete() ? `<p class="small muted">A game needs at least 2 teams, so no more teams can be deleted.</p>` : ""}`;
}

function lobbyHTML() {
  const joined = active().length;
  const enough = joined >= 2;
  return `
    <section class="card">
      <h2>Teams</h2>
      <p><span class="big-number">${joined}</span> of ${game.settings.teamCount} joined</p>
      ${teamListHTML({ actions: ["delete"] })}
    </section>
    <div class="sticky-action">
      <button class="wide" data-action="confirm" ${enough ? "" : "disabled"}>Confirm teams</button>
      ${enough ? "" : `<p class="small muted center">At least 2 teams need to join first.</p>`}
    </div>`;
}

function readyHTML() {
  return `
    <section class="card">
      <h2>Teams confirmed</h2>
      <p class="muted">Press Start round 1 when everyone is ready.</p>
      ${teamListHTML({ actions: ["reset", "delete"] })}
    </section>
    <div class="sticky-action"><button class="wide" data-action="start">Start round 1</button></div>`;
}

function votingHTML() {
  const { round } = game.state;
  const ids = active();
  const votedCount = ids.filter((id) => game.voted?.[round]?.[id] === true).length;
  const waiting = ids.length - votedCount;
  return `
    <section class="card">
      <h2>Round ${round} of ${game.settings.rounds}</h2>
      <p><span class="big-number">${votedCount}</span> of ${ids.length} teams voted</p>
      ${teamListHTML({ showVoted: true, actions: ["clear", "reset", "delete"] })}
    </section>
    <div class="sticky-action">
      <button class="wide" data-action="reveal" ${waiting ? "disabled" : ""}>
        ${waiting ? `Waiting for ${waiting} ${waiting === 1 ? "team" : "teams"}` : `Reveal round ${round}`}
      </button>
    </div>`;
}

function revealingHTML() {
  return `<section class="card center"><h2>Revealing round ${game.state.round}…</h2><p class="muted">Working out the scores.</p></section>`;
}

function roundResultsHTML(round) {
  const result = game.results?.[round];
  const totals = totalsByTeam();
  const rows = sortedTeams(game.teams).filter(([id]) => result?.changes?.[id] != null);
  return `
    <table class="results">
      <thead><tr><th>Team</th><th>Vote</th><th class="num">Points</th><th class="num">Total</th></tr></thead>
      <tbody>${rows.map(([id, team]) => `
        <tr class="${team.removed ? "removed" : ""}">
          <td>${esc(team.name)}${team.removed ? " <span class=\"small\">(removed)</span>" : ""}</td>
          <td>${voteHTML(result.votes?.[id])}</td>
          <td class="num ${signClass(result.changes[id])}">${signed(result.changes[id])}</td>
          <td class="num"><strong>${totals[id]}</strong></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function totalsByTeam() {
  const totals = {};
  for (const id of Object.keys(game.teams ?? {})) {
    totals[id] = game.settings.startingPoints;
    for (const result of Object.values(game.results ?? {})) {
      if (result?.changes?.[id] != null) totals[id] += result.changes[id];
    }
  }
  return totals;
}

function revealedHTML() {
  const { round } = game.state;
  const last = round >= game.settings.rounds;
  return `
    <section class="card">
      <h2>Round ${round} results</h2>
      ${roundResultsHTML(round)}
    </section>
    <details class="card">
      <summary>Manage teams</summary>
      ${teamListHTML({ actions: ["reset", "delete"] })}
    </details>
    <div class="sticky-action">
      ${last
        ? `<button class="wide" data-action="end">End game</button>`
        : `<button class="wide" data-action="next">Start round ${round + 1}</button>`}
    </div>`;
}

function endedHTML() {
  const totals = totalsByTeam();
  return `
    <section class="card">
      <h2>Final scores</h2>
      <table class="results">
        <thead><tr><th>Team</th><th class="num">Total</th></tr></thead>
        <tbody>${sortedTeams(game.teams).map(([id, team]) => `
          <tr class="${team.removed ? "removed" : ""}">
            <td>${esc(team.name)}${team.removed ? " <span class=\"small\">(removed)</span>" : ""}</td>
            <td class="num"><strong>${totals[id]}</strong></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </section>
    <details class="card">
      <summary>Round by round</summary>
      ${scoreTableHTML(game.settings, game.teams, game.results)}
    </details>
    <button class="wide" data-action="download">Download results (Excel)</button>
    <p></p>`;
}

// ---------- actions ----------

async function run(action) {
  working = true;
  render();
  try {
    await action();
  } catch (error) {
    console.error(error);
    toast(friendly(error));
  } finally {
    working = false;
    if (game) render();
  }
}

function onAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const { action, team: teamId } = button.dataset;
  const { round, status } = game.state;
  const team = teamId ? game.teams?.[teamId] : null;
  const name = team ? `"${team.name}"` : "";

  switch (action) {
    case "confirm":
      return run(() => api.confirmTeams(gameId));
    case "start":
      return run(() => api.startRound(gameId));
    case "reveal":
      if (!confirm(`Reveal round ${round}? Votes can't be changed after this.`)) return;
      return run(() => api.reveal(gameId, round));
    case "next":
      return run(() => api.nextRound(gameId, round));
    case "end":
      if (!confirm("End the game and show the final scores?")) return;
      return run(() => api.endGame(gameId, round));
    case "clear":
      if (!confirm(`Clear the vote of ${name}? They can then vote again.`)) return;
      return run(() => api.clearVote(gameId, round, teamId));
    case "delete": {
      const detail = status === "lobby"
        ? "Their phone can join again with a new name."
        : "Their scores so far stay in the table, marked as removed.";
      if (!confirm(`Delete team ${name}? ${detail}`)) return;
      return run(() => api.deleteTeam(gameId, teamId));
    }
    case "reset":
      if (!confirm(`Move team ${name} to a new phone? The game goes on hold and the QR code shows again until the new phone is in. You'll get a 4-digit code for the new phone.`)) return;
    // falls through
    case "newcode":
      return run(async () => {
        const code = await api.resetPhone(gameId, teamId);
        codes[teamId] = { code, owner: team.owner };
      });
    case "show-join":
      return run(() => api.setShowJoin(gameId, true));
    case "hide-join":
      return run(() => api.setShowJoin(gameId, false));
    case "cancel-move":
      if (!confirm(`Cancel moving ${name}? Their current phone keeps playing for the team.`)) return;
      return run(() => api.cancelMove(gameId, teamId));
    case "download":
      return run(async () => downloadGames([await api.getGame(gameId)]));
  }
}
