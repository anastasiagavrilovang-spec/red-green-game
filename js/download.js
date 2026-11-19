// Builds and downloads the results .xlsx file with SheetJS, loaded only when needed.
import { GameError } from "./game.js";
import { gameSheetRows, overviewRows, sheetName, fileName } from "./export.js";

const SRC = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let loading;

function load() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => {
      loading = null;
      reject(new GameError("Couldn't load the Excel tool. Please check the connection and try again."));
    };
    document.head.append(script);
  });
  return loading;
}

function sheet(XLSX, rows, firstColumnWidth) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const columns = Math.max(...rows.map((r) => r.length));
  ws["!cols"] = Array.from({ length: columns }, (_, i) => ({ wch: i === 0 ? firstColumnWidth : 14 }));
  return ws;
}

// games: one or more games as returned by getGame / listGames.
export async function downloadGames(games) {
  const XLSX = await load();
  const book = XLSX.utils.book_new();
  if (games.length > 1) XLSX.utils.book_append_sheet(book, sheet(XLSX, overviewRows(games), 18), "All games");
  for (const game of games) XLSX.utils.book_append_sheet(book, sheet(XLSX, gameSheetRows(game), 24), sheetName(game));
  XLSX.writeFile(book, fileName(games));
}
