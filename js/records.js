// Records page: past games and Excel downloads. Opened as records.html#k=RECORDSKEY (private link).
import { connect } from "./firebase.js";
import { formatDate, statusText } from "./export.js";
import { downloadGames } from "./download.js";
import { $, esc, toast, friendly, store, connectionBanner } from "./ui.js";

const app = $("#app");
const keyFromHash = new URLSearchParams(location.hash.slice(1)).get("k");

let api;
let games = [];
const selected = new Set();

main();

async function main() {
  try {
    api = await connect();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="card"><h2>Couldn't connect</h2><p>Please check the internet connection and reload the page.</p></div>`;
    return;
  }
  connectionBanner(true);

  if (keyFromHash) {
    try {
      await api.claimRecords(keyFromHash);
      store.set("rgg.recordsLink", location.href);
    } catch (error) {
      return noAccess(friendly(error));
    }
  } else if (!(await api.hasRecordsAccess())) {
    return noAccess("Open your Records link to see past games.");
  }
  await load();
}

// ---------- no access ----------

function noAccess(message) {
  const saved = store.get("rgg.recordsLink");
  app.innerHTML = `
    <h1>Past games</h1>
    <div class="card">
      <p>${esc(message)}</p>
      <p class="muted small">It is the link that ends with <span class="code">#k=…</span>. Paste it here, or open it from your bookmarks or password manager.</p>
      <form id="paste" novalidate>
        <div class="field">
          <label for="link">Records link</label>
          <input id="link" type="text" autocomplete="off" placeholder="https://…/records.html#k=…">
          <div class="error-text" id="link-error"></div>
        </div>
        <button class="wide" type="submit">Open</button>
      </form>
      ${saved ? `<p></p><a class="button secondary wide" href="${esc(saved)}">Use the link saved on this device</a>` : ""}
    </div>
    <a class="button secondary wide" href="host.html">Back to the facilitator page</a>`;

  $("#paste").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("#link").value.trim();
    const key = text.match(/[#&]k=([^&\s]+)/)?.[1] ?? null;
    if (!key) {
      $("#link-error").textContent = "That doesn't look like a Records link.";
      return;
    }
    try {
      await api.claimRecords(key);
      store.set("rgg.recordsLink", `${location.origin}${location.pathname}#k=${key}`);
      history.replaceState(null, "", `#k=${key}`);
      await load();
    } catch (error) {
      $("#link-error").textContent = friendly(error);
    }
  });
}

// ---------- list ----------

async function load() {
  app.innerHTML = `<p class="muted center">Loading games…</p>`;
  try {
    games = await api.listGames();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="card"><p>${esc(friendly(error))}</p></div>`;
    return;
  }
  render();
}

const teamCount = (game) => Object.values(game.teams ?? {}).filter((t) => t && !t.removed).length;

function render() {
  if (!games.length) {
    app.innerHTML = `<h1>Past games</h1><div class="card"><p class="muted">No games yet.</p></div>
      <a class="button secondary wide" href="host.html">Back to the facilitator page</a>`;
    return;
  }
  const all = selected.size === games.length;
  app.innerHTML = `
    <h1>Past games</h1>
    <section class="card">
      <div class="row-buttons records-actions">
        <button class="secondary small" id="all">${all ? "Clear selection" : "Select all"}</button>
        <button class="small" id="download" ${selected.size ? "" : "disabled"}>Download selected${selected.size ? ` (${selected.size})` : ""}</button>
      </div>
      <ul class="records-list">${games.map((game) => `
        <li>
          <label class="record">
            <input type="checkbox" data-id="${esc(game.id)}" ${selected.has(game.id) ? "checked" : ""}>
            <span class="record-main">
              <span><span class="code">${esc(game.id)}</span> <span class="muted">${esc(formatDate(game.createdAt))}</span></span>
              <span class="small muted">${teamCount(game)} teams · ${esc(statusText(game))}</span>
            </span>
          </label>
        </li>`).join("")}
      </ul>
    </section>
    <a class="button secondary wide" href="host.html">Back to the facilitator page</a>`;

  $("#all").addEventListener("click", () => {
    if (all) selected.clear();
    else for (const game of games) selected.add(game.id);
    render();
  });
  app.querySelectorAll("input[data-id]").forEach((box) =>
    box.addEventListener("change", () => {
      box.checked ? selected.add(box.dataset.id) : selected.delete(box.dataset.id);
      render();
    }));
  $("#download").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await downloadGames(games.filter((game) => selected.has(game.id)));
    } catch (error) {
      console.error(error);
      toast(friendly(error));
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
}
