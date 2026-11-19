// Big screen for the projector, opened as screen.html?g=GAMEID. Read-only: it only watches the game.
import { connect } from "./firebase.js";
import { activeTeamIds } from "./game.js";
import { $, esc, sortedTeams, connectionBanner, pageLink } from "./ui.js";
import { showQR } from "./qr.js";
import { scoreTableHTML } from "./table.js";

const app = $("#app");
const gameId = new URLSearchParams(location.search).get("g")?.trim().toUpperCase() || null;

let game = null;

main();

async function main() {
  if (!gameId) {
    app.innerHTML = `<div class="card"><h2>Red Green Game</h2><p>Open the big screen link from the facilitator page.</p></div>`;
    return;
  }
  let api;
  try {
    api = await connect();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="card"><h2>Couldn't connect</h2><p>Please check the internet connection and reload the page.</p></div>`;
    return;
  }
  api.watchGame(gameId, (snapshot) => {
    game = snapshot;
    connectionBanner(snapshot.connected);
    render();
  });
}

const STEP = {
  lobby: () => "Teams joining",
  ready: () => "Get ready",
  voting: (r) => `Round ${r}: voting`,
  revealing: (r) => `Round ${r}: revealing…`,
  revealed: (r) => `Round ${r}: results`,
  ended: () => "Game over"
};

function render() {
  if (!game?.state || !game.settings) {
    app.innerHTML = `<div class="card"><h2>Game not found</h2><p>Please open the big screen link from the facilitator page again.</p></div>`;
    return;
  }
  const { status, round } = game.state;
  const screens = { lobby: lobbyHTML, ready: readyHTML, voting: votingHTML, revealing: revealingHTML, revealed: tableHTML, ended: tableHTML };

  app.innerHTML = `
    <header class="screen-top">
      <h1>Red Green Game</h1>
      <span class="screen-step">${esc(STEP[status]?.(round) ?? status)}</span>
    </header>
    ${(screens[status] ?? (() => ""))()}`;

  // The QR code is drawn after the page is built; showQR skips redrawing an unchanged code.
  const qr = $("#qr");
  if (qr) showQR(qr, pageLink("play.html", gameId), 360);
}

// Team names as big tiles. `voting` adds a voted / waiting mark (never the choice).
function tilesHTML(voting) {
  const teams = sortedTeams(game.teams);
  if (!teams.length) return `<p class="screen-empty">Waiting for the first team…</p>`;
  const round = game.state.round;
  return `<ul class="tiles">${teams.map(([id, team]) => {
    if (team.removed) return `<li class="tile removed"><span class="tile-name">${esc(team.name)}</span><span class="tile-status">removed</span></li>`;
    if (!voting) return `<li class="tile"><span class="tile-name">${esc(team.name)}</span></li>`;
    const voted = game.voted?.[round]?.[id] === true;
    return `<li class="tile ${voted ? "voted" : "waiting"}">
      <span class="tile-name">${esc(team.name)}</span>
      <span class="tile-status">${voted ? "✓ Voted" : "Waiting…"}</span>
    </li>`;
  }).join("")}</ul>`;
}

function lobbyHTML() {
  const joined = activeTeamIds(game.teams).length;
  return `
    <div class="lobby-grid">
      <section class="card center">
        <h2>Scan to join</h2>
        <div class="qr" id="qr"></div>
        <p class="screen-link">${esc(pageLink("play.html", gameId))}</p>
        <p class="small muted">One phone per team. Open it in your normal browser (Safari or Chrome).</p>
      </section>
      <section class="card">
        <h2><span class="screen-count">${joined}</span> of ${game.settings.teamCount} teams joined</h2>
        ${tilesHTML(false)}
      </section>
    </div>`;
}

function readyHTML() {
  return `
    <section class="card">
      <h2>Teams are confirmed. Round 1 starts soon.</h2>
      ${tilesHTML(false)}
    </section>`;
}

function votingHTML() {
  const { round } = game.state;
  const ids = activeTeamIds(game.teams);
  const votedCount = ids.filter((id) => game.voted?.[round]?.[id] === true).length;
  return `
    <section class="card">
      <h2>Round ${round} of ${game.settings.rounds}: <span class="screen-count">${votedCount}</span> of ${ids.length} teams have voted</h2>
      ${tilesHTML(true)}
    </section>`;
}

function revealingHTML() {
  return `<section class="card center"><h2>Revealing round ${game.state.round}…</h2></section>`;
}

// After every reveal and at the end: the same table, with more rounds filled in each time.
function tableHTML() {
  const { status, round } = game.state;
  const title = status === "ended" ? "Final results" : `After round ${round} of ${game.settings.rounds}`;
  const rows = sortedTeams(game.teams).length;
  return `
    <section class="card screen-table" style="--rows:${rows}">
      <h2>${title}</h2>
      ${scoreTableHTML(game.settings, game.teams, game.results)}
    </section>`;
}
