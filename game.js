// Every database read and write for the Red Green Game, so the pages only hold screen logic.
// The Firebase functions are passed in (fb), so the same code runs in the browser and in Node tests.
import { DEFAULT_SETTINGS, scoreRound, validateSettings } from "./scoring.js";

export class GameError extends Error {}

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes (O/0, I/1)
const KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const NAME_MAX = 24;
const FORBIDDEN = /[.$#[\]/]/;

function randomString(length, chars) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export const newGameId = () => randomString(6, ID_CHARS);
export const newKey = () => randomString(32, KEY_CHARS);
const newCode = () => randomString(4, "0123456789");

// Same normalising as the security rules: lowercase, all spaces removed.
export const normName = (name) => name.toLowerCase().replace(/ /g, "");
export const cleanName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");

// Teams still in the game.
export const activeTeamIds = (teams) =>
  Object.entries(teams ?? {}).filter(([, t]) => t && !t.removed).map(([id]) => id);

// Teams moving to a new phone (Reset phone pressed, new phone not in yet): while any exist,
// the game is on hold.
export const movingTeamIds = (teams, moving) =>
  activeTeamIds(teams).filter((id) => moving?.[id] === true);

// The team this device controls, or null.
export const myTeamId = (teams, uid) =>
  Object.entries(teams ?? {}).find(([, t]) => t?.owner === uid)?.[0] ?? null;

// Message for a name the database would refuse, or null if fine.
export function nameProblem(name) {
  const clean = cleanName(name);
  if (!clean) return "Please type a team name";
  if (clean.length > NAME_MAX) return `Please use at most ${NAME_MAX} characters`;
  if (FORBIDDEN.test(clean)) return "Please leave out these symbols: . $ # [ ] /";
  return null;
}

const same = (a, b) => a?.status === b?.status && a?.round === b?.round;
const NOT_NOW = "That step isn't possible right now. The screen will update in a moment.";
const ON_HOLD = "The game is on hold while a team moves to a new phone. Wait for the new phone, or press Cancel move.";

function toSettings(input) {
  const n = (v) => Number(v);
  return {
    teamCount: n(input.teamCount), rounds: n(input.rounds), startingPoints: n(input.startingPoints),
    scoring: {
      allGreen: n(input.scoring.allGreen), oneRedWinner: n(input.scoring.oneRedWinner),
      oneRedOthers: n(input.scoring.oneRedOthers), manyReds: n(input.scoring.manyReds)
    }
  };
}

export function createGameApi({ db, auth, fb }) {
  const uid = () => auth.currentUser.uid;
  const at = (path) => fb.ref(db, path);
  const g = (gameId, path = "") => at(`games/${gameId}${path ? "/" + path : ""}`);
  const read = async (gameId, path) => (await fb.get(g(gameId, path))).val();

  async function checkNotOnHold(gameId) {
    const [teams, moving] = await Promise.all([read(gameId, "teams"), read(gameId, "moving")]);
    if (movingTeamIds(teams, moving).length) throw new GameError(ON_HOLD);
  }

  // Moves the game from one step to the next. A move another device already made counts as done,
  // so double taps and two facilitator phones are harmless.
  async function advance(gameId, from, to) {
    const state = await read(gameId, "state");
    if (same(state, to)) return;
    if (!same(state, from)) throw new GameError(NOT_NOW);
    await checkNotOnHold(gameId);
    try {
      await fb.set(g(gameId, "state"), to);
    } catch {
      if (!same(await read(gameId, "state"), to)) throw new GameError(NOT_NOW);
    }
  }

  return {
    uid,

    // ---------- setting up ----------

    async createGame(input = DEFAULT_SETTINGS) {
      if (Object.keys(validateSettings(input)).length) throw new GameError("Please fix the settings first");
      const settings = toSettings(input);
      const key = newKey();
      for (let attempt = 0; attempt < 5; attempt++) {
        const gameId = newGameId();
        try {
          await fb.set(g(gameId), {
            settings, state: { status: "lobby", round: 0 }, hostKey: key,
            hosts: { [uid()]: key }, createdAt: fb.serverTimestamp()
          });
          return { gameId, key };
        } catch {
          // Most likely the game code was already taken: try another one.
        }
      }
      throw new GameError("Couldn't create the game. Please check the connection and try again.");
    },

    async claimHost(gameId, key) {
      try {
        await fb.set(g(gameId, `hosts/${uid()}`), key);
      } catch {
        throw new GameError("This facilitator link isn't valid");
      }
    },

    async isHost(gameId) {
      try {
        return (await read(gameId, `hosts/${uid()}`)) != null;
      } catch {
        return false;
      }
    },

    // ---------- watching ----------

    // Calls onChange({ settings, state, teams, voted, results, moving, connected }) once everything
    // has loaded, then on every change. Returns a function that stops watching.
    watchGame(gameId, onChange) {
      const parts = ["settings", "state", "teams", "voted", "results", "moving"];
      const data = { connected: true };
      const loaded = new Set();
      const send = () => { if (loaded.size === parts.length) onChange({ ...data }); };
      const stops = parts.map((part) =>
        fb.onValue(g(gameId, part), (snap) => {
          data[part] = snap.val();
          loaded.add(part);
          send();
        }, () => {
          data[part] = null;
          loaded.add(part);
          send();
        })
      );
      stops.push(fb.onValue(at(".info/connected"), (snap) => {
        data.connected = snap.val() === true;
        send();
      }));
      return () => stops.forEach((stop) => stop());
    },

    // Everything needed for a results download.
    async getGame(gameId) {
      const [settings, state, teams, results, createdAt] = await Promise.all(
        ["settings", "state", "teams", "results", "createdAt"].map((part) => read(gameId, part))
      );
      return { id: gameId, settings, state, teams, results, createdAt };
    },

    // ---------- teams ----------

    async joinTeam(gameId, rawName) {
      const problem = nameProblem(rawName);
      if (problem) throw new GameError(problem);
      const name = cleanName(rawName);
      const me = uid();
      const existing = await read(gameId, `teams/${me}`);
      if (existing) {
        if (existing.owner === me) return me; // already joined (e.g. a repeated tap)
        throw new GameError("This phone's team has moved to another phone");
      }
      try {
        await fb.update(g(gameId), {
          [`teams/${me}`]: { name, owner: me, joinedAt: fb.serverTimestamp() },
          [`teamNames/${normName(name)}`]: me
        });
        return me;
      } catch {
        const state = await read(gameId, "state");
        if (state?.status !== "lobby") throw new GameError("Joining has closed. Ask the facilitator for help.");
        throw new GameError("That name is already taken. Please choose another.");
      }
    },

    async rejoinTeam(gameId, teamId, rawCode) {
      const code = String(rawCode ?? "").trim();
      if (!/^[0-9]{4}$/.test(code)) throw new GameError("Please type the 4-digit code");
      const me = uid();
      const attemptRef = g(gameId, `rejoinAttempts/${teamId}/${me}`);
      const previous = (await fb.get(attemptRef)).val();
      const count = (previous?.count ?? 0) + 1;
      try {
        await fb.set(attemptRef, { count, code });
      } catch {
        if (count > 5) throw new GameError("Too many tries. Ask the facilitator for a new code.");
        throw new GameError("No code is active for this team. Ask the facilitator to press Reset phone.");
      }
      try {
        // Clearing "moving" in the same update lifts the hold for everyone at once.
        await fb.update(g(gameId), {
          [`teams/${teamId}/owner`]: me, [`rejoinCodes/${teamId}`]: null, [`moving/${teamId}`]: null
        });
      } catch {
        const left = 5 - count;
        throw new GameError(left > 0
          ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`
          : "That code isn't right. Ask the facilitator for a new code.");
      }
    },

    // ---------- voting ----------

    // Resolves only once the database has accepted the vote.
    async castVote(gameId, round, teamId, choice) {
      try {
        await fb.update(g(gameId), { [`votes/${round}/${teamId}`]: choice, [`voted/${round}/${teamId}`]: true });
      } catch {
        const [state, voted, team] = await Promise.all([
          read(gameId, "state"), read(gameId, `voted/${round}/${teamId}`), read(gameId, `teams/${teamId}`)
        ]);
        const open = state?.status === "voting" && state.round === round;
        // A repeated tap after the first one went through.
        if (open && voted === true && team?.owner === uid()) return;
        if (team?.removed) throw new GameError("Your team has been removed from the game");
        if (team?.owner !== uid()) throw new GameError("Your team is now on another phone");
        throw new GameError("Voting for this round has closed");
      }
    },

    // ---------- facilitator actions ----------

    async confirmTeams(gameId) {
      const teams = await read(gameId, "teams");
      if (activeTeamIds(teams).length < 2) throw new GameError("At least 2 teams need to join first");
      await advance(gameId, { status: "lobby", round: 0 }, { status: "ready", round: 0 });
    },

    startRound: (gameId) => advance(gameId, { status: "ready", round: 0 }, { status: "voting", round: 1 }),

    nextRound: (gameId, fromRound) =>
      advance(gameId, { status: "revealed", round: fromRound }, { status: "voting", round: fromRound + 1 }),

    endGame: (gameId, lastRound) =>
      advance(gameId, { status: "revealed", round: lastRound }, { status: "ended", round: lastRound }),

    // Also finishes a reveal that was interrupted (status still "revealing").
    async reveal(gameId, round) {
      const done = { status: "revealed", round };
      const state = await read(gameId, "state");
      if (same(state, done)) return;
      if (state?.round !== round) throw new GameError(NOT_NOW);

      if (state.status === "voting") {
        await checkNotOnHold(gameId);
        const [teams, voted] = await Promise.all([read(gameId, "teams"), read(gameId, `voted/${round}`)]);
        if (activeTeamIds(teams).some((id) => !voted?.[id])) throw new GameError("Not every team has voted yet");
        await advance(gameId, { status: "voting", round }, { status: "revealing", round });
      } else if (state.status !== "revealing") {
        throw new GameError(NOT_NOW);
      }

      const [settings, teams, allVotes] = await Promise.all([
        read(gameId, "settings"), read(gameId, "teams"), read(gameId, `votes/${round}`)
      ]);
      const votes = {};
      for (const id of activeTeamIds(teams)) if (allVotes?.[id]) votes[id] = allVotes[id];
      const changes = scoreRound(votes, settings.scoring);
      try {
        await fb.update(g(gameId), { state: done, [`results/${round}`]: { votes, changes } });
      } catch {
        if (!same(await read(gameId, "state"), done)) throw new GameError(NOT_NOW);
      }
    },

    async clearVote(gameId, round, teamId) {
      try {
        await fb.update(g(gameId), { [`votes/${round}/${teamId}`]: null, [`voted/${round}/${teamId}`]: null });
      } catch {
        throw new GameError("Votes can only be cleared while voting is open");
      }
    },

    async deleteTeam(gameId, teamId) {
      const [state, teams] = await Promise.all([read(gameId, "state"), read(gameId, "teams")]);
      const team = teams?.[teamId];
      if (!team || team.removed) return;
      const { status, round } = state;
      let changes;
      if (status === "lobby") {
        changes = { [`teams/${teamId}`]: null, [`teamNames/${normName(team.name)}`]: null };
      } else if (status === "ready" || status === "voting" || status === "revealed") {
        if (activeTeamIds(teams).length <= 2) throw new GameError("A game needs at least 2 teams");
        // A team removed while moving to a new phone no longer holds up the game.
        changes = {
          [`teams/${teamId}/removed`]: true,
          [`moving/${teamId}`]: null, [`rejoinCodes/${teamId}`]: null, [`rejoinAttempts/${teamId}`]: null
        };
        if (status === "voting") {
          changes[`votes/${round}/${teamId}`] = null;
          changes[`voted/${round}/${teamId}`] = null;
        }
      } else {
        throw new GameError(NOT_NOW);
      }
      try {
        await fb.update(g(gameId), changes);
      } catch {
        throw new GameError(NOT_NOW);
      }
    },

    // Returns the one-time 4-digit code the new phone types in. Puts the game on hold
    // until the new phone is in (or the move is cancelled). Pressing it again gives a new code.
    async resetPhone(gameId, teamId) {
      const code = newCode();
      await fb.update(g(gameId), {
        [`rejoinCodes/${teamId}`]: code, [`rejoinAttempts/${teamId}`]: null, [`moving/${teamId}`]: true
      });
      return code;
    },

    // The old phone works after all: forget the code and lift the hold.
    async cancelMove(gameId, teamId) {
      await fb.update(g(gameId), {
        [`rejoinCodes/${teamId}`]: null, [`rejoinAttempts/${teamId}`]: null, [`moving/${teamId}`]: null
      });
    },

    // ---------- records ----------

    async claimRecords(key) {
      try {
        await fb.set(at(`admins/${uid()}`), key);
      } catch {
        throw new GameError("This Records link isn't valid");
      }
    },

    async hasRecordsAccess() {
      try {
        return (await fb.get(at(`admins/${uid()}`))).val() != null;
      } catch {
        return false;
      }
    },

    // All games, newest first, in the shape export.js expects.
    async listGames() {
      const games = (await fb.get(at("games"))).val() ?? {};
      return Object.entries(games)
        .map(([id, game]) => ({ id, ...game }))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    }
  };
}
