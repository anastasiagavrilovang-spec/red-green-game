// Team page, opened from the QR code as play.html?g=GAMEID. One phone per team.
import { connect } from "./firebase.js";
import { NAME_MAX, nameProblem, cleanName, myTeamId, activeTeamIds, movingTeamIds } from "./game.js";
import { $, esc, signed, signClass, sortedTeams, friendly, connectionBanner, store } from "./ui.js";

const app = $("#app");
const gameId = new URLSearchParams(location.search).get("g")?.trim().toUpperCase() || null;

let api;
let game = null;
// Screen state kept on this phone between live updates.
const local = {
  view: "join",          // join | confirm-name | rejoin-pick | rejoin-code (only used before having a team)
  name: "",              // name typed, waiting for Confirm
  rejoinTeam: null,      // team picked for rejoining
  choice: null,          // vote tapped, waiting for Confirm
  sending: false,        // vote or join on its way to the database
  message: "",           // problem to show on the current screen
  lastTeamName: null,    // the team this phone had, to explain if it disappears
  sawVoted: {}           // round -> true once this phone's vote was received
};

main();

async function main() {
  if (!gameId) {
    app.innerHTML = `<div class="card"><h2>Red Green Game</h2><p>Please scan the QR code on the big screen to join.</p></div>`;
    return;
  }
  try {
    api = await connect();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="card"><h2>Couldn't connect</h2><p>Please check the internet connection and reload the page.</p></div>`;
    return;
  }
  app.addEventListener("click", onClick);
  app.addEventListener("submit", onSubmit);
  api.watchGame(gameId, (snapshot) => {
    game = snapshot;
    connectionBanner(snapshot.connected);
    render();
  });
}

// ---------- helpers ----------

const voteKey = (round) => `rgg.vote.${gameId}.${round}`;
const card = (html) => `<section class="card">${html}</section>`;
const messageHTML = () => (local.message ? `<p class="notice">${esc(local.message)}</p>` : "");
const ownTeamId = () => myTeamId(game.teams, api.uid());
const moving = () => movingTeamIds(game.teams, game.moving);
const onHold = () => ["ready", "voting", "revealed"].includes(game.state.status) && moving().length > 0;

function total(teamId) {
  let sum = game.settings.startingPoints;
  for (const result of Object.values(game.results ?? {})) {
    if (result?.changes?.[teamId] != null) sum += result.changes[teamId];
  }
  return sum;
}

// Keeps typing in an input when a live update redraws the screen.
function keepInput(render) {
  const input = $("input", app);
  const value = input?.value;
  const focused = input && document.activeElement === input;
  render();
  const again = $("input", app);
  if (again && value != null && again.id === input.id) {
    again.value = value;
    if (focused) again.focus();
  }
}

// ---------- rendering ----------

function render() {
  keepInput(draw);
}

function draw() {
  if (!game?.state || !game.settings) {
    app.innerHTML = card(`<h2>Game not found</h2><p>Please scan the QR code on the big screen again.</p>`);
    return;
  }
  const teamId = ownTeamId();
  const joining = local.sending && local.view === "confirm-name"; // wait for the database, as with votes
  if (teamId && !joining) {
    local.lastTeamName = game.teams[teamId].name;
    app.innerHTML = teamScreen(teamId);
    return;
  }

  // No team on this phone (yet, or any more).
  const movedAway = game.teams?.[api.uid()] && game.teams[api.uid()].owner !== api.uid();
  if (movedAway) {
    app.innerHTML = card(`<h2>Your team is on another phone now</h2>
      <p class="muted">The facilitator moved ${esc(game.teams[api.uid()].name)} to a new phone. Please use that phone.</p>`);
    return;
  }
  if (local.lastTeamName && game.state.status === "lobby" && local.view === "join" && !local.message) {
    local.message = `The facilitator removed "${local.lastTeamName}". You can join again with a new name.`;
    local.lastTeamName = null;
  }
  app.innerHTML = joinScreen();
}

function teamScreen(teamId) {
  const team = game.teams[teamId];
  const { status, round } = game.state;
  const header = `<p class="muted center">Team</p><p class="welcome center">${esc(team.name)}</p>`;

  if (team.removed) {
    return card(`${header}<h2 class="center">You have been removed from the game</h2>
      <p class="muted center">Thanks for playing. Your scores so far stay on the big screen.</p>`);
  }

  // A team is moving to a new phone: everyone waits, then this screen updates by itself.
  if (onHold()) {
    return card(`${header}<h2 class="center">The game will resume shortly</h2>
      <p class="center muted">A team is moving to a new phone. Please wait, there's nothing to do on this phone.</p>`);
  }

  switch (status) {
    case "lobby":
      return card(`<p class="muted center">Welcome,</p><p class="welcome center">team ${esc(team.name)}</p>
        <p class="center muted">Waiting for the other teams to join.</p>`);
    case "ready":
      return card(`${header}<p class="center">Teams are confirmed.</p><p class="center muted">Round 1 starts soon.</p>`);
    case "voting":
      return votingScreen(teamId, round, header);
    case "revealing":
      return card(`${header}<h2 class="center">Revealing round ${round}…</h2>`);
    case "revealed":
      return card(`${header}${roundResultHTML(teamId, round)}
        <p class="center muted">${round < game.settings.rounds ? `Round ${round + 1} starts soon.` : "That was the last round."}</p>`);
    case "ended":
      return card(`${header}<h2 class="center">Game over</h2>
        <p class="center">Your final total</p><p class="big-number center">${total(teamId)}</p>
        <p class="center muted">Thanks for playing!</p>`);
    default:
      return card(header);
  }
}

function votingScreen(teamId, round, header) {
  const voted = game.voted?.[round]?.[teamId] === true;
  const title = `<h2 class="center">Round ${round} of ${game.settings.rounds}</h2>`;

  // Firebase shows this phone's own write straight away, before the database has accepted it,
  // so "Vote received" waits for the confirmation from castVote.
  if (local.sending) {
    return card(`${header}${title}<div class="choice ${local.choice}">${local.choice === "red" ? "RED" : "GREEN"}</div>
      <p class="center"><strong>Sending…</strong></p>`);
  }

  if (voted) {
    local.sawVoted[round] = true;
    const mine = store.get(voteKey(round));
    return card(`${header}${title}
      ${mine ? `<div class="choice ${mine}">${mine === "red" ? "RED" : "GREEN"}</div>` : ""}
      <p class="center"><strong>✓ Vote received</strong></p>
      <p class="center muted">Waiting for the other teams.</p>`);
  }

  // The vote was cleared by the facilitator after it had been received.
  if (local.sawVoted[round]) {
    local.sawVoted[round] = false;
    local.choice = null;
    store.set(voteKey(round), null);
    local.message = "The facilitator cleared your vote. Please vote again.";
  }

  if (local.choice) {
    return card(`${header}${title}
      <p class="center">Are you sure?</p>
      <div class="choice ${local.choice}">${local.choice === "red" ? "RED" : "GREEN"}</div>
      ${messageHTML()}
      <div class="row-buttons">
        <button class="secondary" data-action="change">Change</button>
        <button data-action="send">Confirm</button>
      </div>`);
  }

  return card(`${header}${title}${messageHTML()}
    <div class="vote-buttons">
      <button class="vote-button red" data-action="choose" data-choice="red">RED</button>
      <button class="vote-button green" data-action="choose" data-choice="green">GREEN</button>
    </div>`);
}

function roundResultHTML(teamId, round) {
  const result = game.results?.[round];
  const vote = result?.votes?.[teamId];
  const change = result?.changes?.[teamId];
  if (change == null) return `<p class="center">Round ${round} is revealed.</p>`;
  return `
    <h2 class="center">Round ${round} result</h2>
    ${vote ? `<div class="choice ${vote}">${vote === "red" ? "RED" : "GREEN"}</div>` : ""}
    <p class="center">Points this round</p>
    <p class="big-number center ${signClass(change)}">${signed(change)}</p>
    <p class="center">Total: <strong>${total(teamId)}</strong></p>`;
}

function joinScreen() {
  const lobby = game.state.status === "lobby";

  if (local.view === "rejoin-pick") {
    // While a move is on, only the teams waiting for a new phone are offered.
    const offered = moving().length ? moving() : activeTeamIds(game.teams);
    const teams = sortedTeams(game.teams).filter(([id]) => offered.includes(id));
    return card(`<h2>Rejoin my team</h2>
      <p class="muted">Ask the facilitator to press Reset phone for your team, then pick your team here.</p>
      ${teams.length ? `<div class="team-choices">${teams.map(([id, t]) =>
        `<button class="secondary wide" data-action="pick" data-team="${id}">${esc(t.name)}</button>`).join("")}</div>`
        : `<p class="muted">No teams yet.</p>`}
      <p></p><button class="link-button wide" data-action="back">Back</button>`);
  }

  if (local.view === "rejoin-code") {
    const team = game.teams?.[local.rejoinTeam];
    return card(`<h2>Rejoin ${esc(team?.name ?? "my team")}</h2>
      <form id="rejoin-form" novalidate>
        <div class="field">
          <label for="code">4-digit code from the facilitator</label>
          <input id="code" class="code-input" type="tel" inputmode="numeric" maxlength="4" autocomplete="one-time-code">
        </div>
        ${messageHTML()}
        <button class="wide" type="submit" ${local.sending ? "disabled" : ""}>${local.sending ? "Checking…" : "Rejoin"}</button>
      </form>
      <button class="link-button wide" data-action="rejoin">Pick another team</button>`);
  }

  if (!lobby && moving().length) {
    return card(`<h2>Moving a team to this phone?</h2>
      <p class="muted">Tap Rejoin my team, pick your team and type the 4-digit code from the facilitator.</p>
      <button class="wide" data-action="rejoin">Rejoin my team</button>`);
  }

  if (!lobby) {
    return card(`<h2>The game has started</h2>
      <p class="muted">New teams can't join now. If your team's phone stopped working, you can move your team to this phone.</p>
      <button class="wide" data-action="rejoin">Rejoin my team</button>`);
  }

  if (local.view === "confirm-name") {
    return card(`<h2>Your team name</h2>
      <p class="welcome center">${esc(local.name)}</p>
      ${messageHTML()}
      <div class="row-buttons">
        <button class="secondary" data-action="edit-name" ${local.sending ? "disabled" : ""}>Change</button>
        <button data-action="join" ${local.sending ? "disabled" : ""}>${local.sending ? "Joining…" : "Confirm"}</button>
      </div>`);
  }

  return `
    <h1>Red Green Game</h1>
    <p class="tip">One phone per team. Please open this page in your normal browser (Safari or Chrome), not inside another app.</p>
    ${card(`<form id="name-form" novalidate>
        <div class="field">
          <label for="team-name">Team name</label>
          <input id="team-name" type="text" maxlength="${NAME_MAX}" autocomplete="off" autocapitalize="words" enterkeyhint="next" value="${esc(local.name)}">
        </div>
        ${messageHTML()}
        <button class="wide" type="submit">Continue</button>
      </form>`)}
    <button class="link-button wide" data-action="rejoin">Rejoin my team</button>`;
}

// ---------- actions ----------

function onSubmit(event) {
  event.preventDefault();
  if (event.target.id === "name-form") {
    const value = $("#team-name").value;
    local.message = nameProblem(value) ?? "";
    if (!local.message) {
      local.name = cleanName(value);
      local.view = "confirm-name";
    }
    render();
  } else if (event.target.id === "rejoin-form") {
    rejoin($("#code").value);
  }
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const { action } = button.dataset;
  local.message = "";

  switch (action) {
    case "edit-name":
      local.view = "join";
      break;
    case "join":
      local.sending = true;
      render();
      try {
        await api.joinTeam(gameId, local.name);
        local.view = "join";
      } catch (error) {
        local.message = friendly(error);
      }
      local.sending = false;
      break;
    case "rejoin":
      local.view = "rejoin-pick";
      break;
    case "pick":
      local.rejoinTeam = button.dataset.team;
      local.view = "rejoin-code";
      break;
    case "back":
      local.view = "join";
      break;
    case "choose":
      local.choice = button.dataset.choice;
      break;
    case "change":
      local.choice = null;
      break;
    case "send":
      return sendVote();
  }
  render();
}

async function sendVote() {
  const teamId = ownTeamId();
  const { round } = game.state;
  const choice = local.choice;
  local.sending = true;
  render();
  try {
    await api.castVote(gameId, round, teamId, choice);
    store.set(voteKey(round), choice);
    local.sawVoted[round] = true;
  } catch (error) {
    local.message = friendly(error);
  }
  local.sending = false;
  local.choice = null;
  render();
}

async function rejoin(code) {
  local.sending = true;
  render();
  try {
    await api.rejoinTeam(gameId, local.rejoinTeam, code);
    local.view = "join";
    local.message = "";
  } catch (error) {
    local.message = friendly(error);
  }
  local.sending = false;
  render();
}
