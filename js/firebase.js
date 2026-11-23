// Connects a page to Firebase: loads the SDK from Google's CDN, signs this browser in
// anonymously (the same ID comes back after a refresh), and returns the game API.
// Keep the version in step with the "firebase" version in package.json, which the tests use.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, initializeAuth, inMemoryPersistence, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import * as fb from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { createGameApi } from "./game.js";

// Opened from this computer (rehearsals): use the local test database, never the real one.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const LOCAL_CONFIG = {
  apiKey: "demo-key",
  projectId: "demo-red-green",
  databaseURL: "https://demo-red-green-default-rtdb.firebaseio.com"
};

async function open(name) {
  const config = LOCAL ? LOCAL_CONFIG : firebaseConfig;
  const app = name ? initializeApp(config, name) : initializeApp(config);
  // A named device is forgotten when the page closes; the page's own sign-in is kept.
  const auth = name ? initializeAuth(app, { persistence: inMemoryPersistence }) : getAuth(app);
  const db = fb.getDatabase(app);
  if (LOCAL) {
    // The emulators listen on 127.0.0.1 only ("localhost" can resolve to another address on Windows).
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fb.connectDatabaseEmulator(db, "127.0.0.1", 9000);
  }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return createGameApi({ db, auth, fb });
}

export const connect = () => open();

// An extra signed-in "phone" inside the same page (used by the Check page).
export const connectDevice = (name) => open(name);
