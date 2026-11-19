// Small screen helpers shared by all pages.
import { GameError } from "./game.js";

export const $ = (selector, root = document) => root.querySelector(selector);

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
export const signClass = (n) => (n > 0 ? "plus" : n < 0 ? "minus" : "");

export function voteHTML(vote) {
  if (vote !== "red" && vote !== "green") return "";
  return `<span class="vote"><span class="dot ${vote}"></span>${vote === "red" ? "Red" : "Green"}</span>`;
}

// Teams in joining order, as [id, team] pairs.
export const sortedTeams = (teams) =>
  Object.entries(teams ?? {}).filter(([, t]) => t).sort(([, a], [, b]) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));

let toastTimer;
export function toast(message) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4500);
}

export const friendly = (error) =>
  error instanceof GameError ? error.message : "Something went wrong. Please check the connection and try again.";

// Runs an action from a button: disables it while working and shows any problem as a message.
export async function busy(button, action) {
  if (button) button.disabled = true;
  try {
    return await action();
  } catch (error) {
    console.error(error);
    toast(friendly(error));
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

export function connectionBanner(connected) {
  let el = $("#connection");
  if (!el) {
    el = document.createElement("div");
    el.id = "connection";
    el.className = "banner hidden";
    el.textContent = "Reconnecting…";
    document.body.prepend(el);
  }
  el.classList.toggle("hidden", connected);
}

// localStorage can be unavailable (private browsing): the pages still work without it.
export const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not available */ }
  }
};

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Copy this link:", text);
    return;
  }
  if (button) {
    const label = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = label; }, 1500);
  }
}

// Links to the other pages of the same game, next to this page.
export const pageLink = (page, gameId) => new URL(`${page}?g=${gameId}`, location.href).href;
