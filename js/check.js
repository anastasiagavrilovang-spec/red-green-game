// Check page (check.html): before an event, plays a short test game on the real site with
// simulated teams and says "all good" or which step failed. Test games are marked as tests,
// so they stay out of Records.
import { connect, connectDevice } from "./firebase.js";
import { buildTable } from "./scoring.js";
import { $, esc, pageLink } from "./ui.js";
import { showQR } from "./qr.js";
import { buildWorkbook } from "./download.js";

const app = $("#app");
const SETTINGS = {
  teamCount: 3, rounds: 2, startingPoints: 50,
  scoring: { allGreen: 10, oneRedWinner: 30, oneRedOthers: 0, manyReds: -30 }
};
const LIMIT = 45000; // per step; generous for slow connections
let run = 0;

// Everything one check run shares between steps.
let ctx;

const STEPS = [
  { label: "Connect to the game database", go: async () => {
    ctx.host = await connect();
  } },
  { label: "Create a test game", go: async () => {
    ctx.gameId = (await ctx.host.createGame(SETTINGS, { test: true })).gameId;
    return `Test game ${ctx.gameId}`;
  } },
  { label: "Three test teams join from their \"phones\"", go: async () => {
    ctx.phones = await Promise.all(["a", "b", "c"].map((p) => connectDevice(`check${run}${p}`)));
    ctx.ids = [];
    for (const [i, phone] of ctx.phones.entries()) ctx.ids.push(await phone.joinTeam(ctx.gameId, `Check ${"ABC"[i]}`));
  } },
  { label: "Round 1: teams vote, facilitator reveals", go: async () => {
    const { host, gameId, phones, ids } = ctx;
    await host.confirmTeams(gameId);
    await host.startRound(gameId);
    const votes = ["red", "green", "green"];
    for (const i of [0, 1, 2]) await phones[i].castVote(gameId, 1, ids[i], votes[i]);
    await host.reveal(gameId, 1);
    const changes = (await host.getGame(gameId)).results?.[1]?.changes ?? {};
    expect([changes[ids[0]], changes[ids[1]], changes[ids[2]]], [30, 0, 0], "Round 1 points");
  } },
  { label: "Reset phone: game on hold, new phone takes over", go: async () => {
    const { host, gameId, ids } = ctx;
    const code = await host.resetPhone(gameId, ids[1]);
    let held = false;
    try { await host.nextRound(gameId, 1); } catch (error) { held = /on hold/.test(error.message); }
    if (!held) throw new Error("The game didn't go on hold");
    ctx.newPhone = await connectDevice(`check${run}new`);
    await ctx.newPhone.rejoinTeam(gameId, ids[1], code);
  } },
  { label: "Show and hide the joining QR code on the big screen", go: async () => {
    await ctx.host.setShowJoin(ctx.gameId, true);
    await ctx.host.setShowJoin(ctx.gameId, false);
  } },
  { label: "Round 2 and end of game: totals are right", go: async () => {
    const { host, gameId, phones, newPhone, ids } = ctx;
    await host.nextRound(gameId, 1); // works only once the hold is lifted
    await phones[0].castVote(gameId, 2, ids[0], "green");
    await newPhone.castVote(gameId, 2, ids[1], "red");
    await phones[2].castVote(gameId, 2, ids[2], "red");
    await host.reveal(gameId, 2);
    await host.endGame(gameId, 2);
    ctx.game = await host.getGame(gameId);
    const totals = Object.fromEntries(buildTable(ctx.game.settings, ctx.game.teams, ctx.game.results).rows.map((r) => [r.name, r.total]));
    expect([totals["Check A"], totals["Check B"], totals["Check C"]], [50, 20, 20], "Final totals");
  } },
  { label: "Big screen page shows the final results", go: () =>
    pageShows("screen.html", (text) => text.includes("Final results") && text.includes("Check A"))
  },
  { label: "Team page opens", go: () =>
    pageShows("play.html", (text) => /Rejoin my team|Game over/.test(text))
  },
  { label: "QR code can be drawn", go: async () => {
    const box = document.createElement("div");
    box.className = "offscreen";
    document.body.append(box);
    await showQR(box, pageLink("play.html", ctx.gameId));
    const ok = box.querySelector("img, canvas");
    box.remove();
    if (!ok) throw new Error("The QR code tool didn't load");
  } },
  { label: "Excel file can be made", go: async () => {
    const { XLSX, book } = await buildWorkbook([ctx.game]);
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
    if (!(bytes?.byteLength > 1000)) throw new Error("The Excel file came out empty");
  } },
  { label: "Records page", go: async () => {
    if (!(await ctx.host.hasRecordsAccess())) {
      return { skipped: "Skipped: this device hasn't opened your Records link. Open it once here to include this step." };
    }
    const games = await ctx.host.listGames();
    if (games.some((g) => g.id === ctx.gameId)) throw new Error("The test game shows up in Records");
    return `Records opens (${games.length} ${games.length === 1 ? "game" : "games"}); the test game is hidden`;
  } }
];

function expect(actual, wanted, what) {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${what}: expected ${wanted.join(", ")}, got ${actual.join(", ")}`);
  }
}

// Opens one of the site's pages for the test game in a hidden frame and waits until it shows what it should.
function pageShows(page, isRight) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.className = "offscreen";
    frame.src = `${page}?g=${ctx.gameId}`;
    document.body.append(frame);
    const started = Date.now();
    const look = () => {
      let text = "";
      try { text = frame.contentDocument?.body?.innerText ?? ""; } catch { /* not loaded yet */ }
      if (isRight(text)) { frame.remove(); resolve(); }
      else if (Date.now() - started > LIMIT - 2000) {
        frame.remove();
        reject(new Error(text.includes("Connecting") ? "The page stayed on \"Connecting…\"" : "The page didn't show what it should"));
      } else setTimeout(look, 300);
    };
    look();
  });
}

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("This step took too long (over 45 seconds)")), ms));

// ---------- screen ----------

const ICON = { waiting: "", running: "…", ok: "✓", skipped: "–", failed: "✗" };

function draw(state) {
  const done = state.finished;
  const failed = state.steps.find((s) => s.status === "failed");
  app.innerHTML = `
    <h1>Check the game</h1>
    <p class="muted">Plays a short test game on the real site with 3 test teams, to check nothing broke since the last event. Takes about a minute. The test game doesn't appear in Records.</p>
    ${done ? (failed
      ? `<div class="check-result failed"><strong>Something isn't working.</strong><br>The step marked ✗ failed. Note it down (or take a screenshot) and ask Claude to look at it.</div>`
      : `<div class="check-result ok"><strong>✓ All good: the game works.</strong></div>`) : ""}
    <ol class="check-list">${state.steps.map((s) => `
      <li class="${s.status}">
        <span class="check-icon">${ICON[s.status]}</span>
        <span><span class="check-label">${esc(s.label)}</span>${s.note ? `<br><span class="small ${s.status === "failed" ? "error-text" : "muted"}">${esc(s.note)}</span>` : ""}</span>
      </li>`).join("")}
    </ol>
    <button class="wide" id="go" ${state.running ? "disabled" : ""}>${state.running ? "Checking…" : done ? "Run the check again" : "Run the check"}</button>
    ${done && !failed ? `
      <section class="card check-manual">
        <h2>On the day, also check</h2>
        <ul>
          <li>The big screen link opens on the projector laptop, readable from the back of the room</li>
          <li>One real phone can scan the QR code and join</li>
          <li>The venue Wi-Fi works, or phones have mobile data</li>
        </ul>
      </section>` : ""}
    <p></p><a class="button secondary wide" href="host.html">Back to the start page</a>`;
  $("#go").addEventListener("click", start);
}

async function start() {
  run += 1;
  ctx = {};
  const state = { running: true, finished: false, steps: STEPS.map((s) => ({ label: s.label, status: "waiting", note: "" })) };
  draw(state);
  for (const [i, step] of STEPS.entries()) {
    const shown = state.steps[i];
    shown.status = "running";
    draw(state);
    try {
      const result = await Promise.race([step.go(), timeout(LIMIT)]);
      if (result?.skipped) { shown.status = "skipped"; shown.note = result.skipped; }
      else { shown.status = "ok"; shown.note = typeof result === "string" ? result : ""; }
    } catch (error) {
      console.error(error);
      shown.status = "failed";
      shown.note = error?.message || String(error);
      break;
    }
  }
  state.running = false;
  state.finished = true;
  draw(state);
}

draw({ running: false, finished: false, steps: STEPS.map((s) => ({ label: s.label, status: "waiting", note: "" })) });
