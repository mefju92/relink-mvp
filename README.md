# ReLink MVP (CLI)

Minimalny, działający szkielet do pierwszej wersji narzędzia:

- skanuje lokalny folder z muzyką (mp3/flac/m4a/wav)
- czyta tagi (title/artist/album, duration)
- tworzy plik CSV z listą utworów
- (hook) wyszukiwanie i tworzenie playlisty w Spotify — z miejscem na kod OAuth

> Celem jest **nauczenie się** narzędzia krok po kroku i szybkie MVP **bez interfejsu graficznego**.
> Później można dołożyć Tauri/Electron (GUI).

## Wymagania
- Node.js 18+
- Yarn lub npm/pnpm
- Konto Spotify for Developers (do etapu integracji z API)

## Start
```bash
# 1) Zainstaluj zależności
npm install

# 2) Utwórz plik .env na bazie .env.example i wklej swoje dane (na razie możesz pominąć)
cp .env.example .env

# 3) Uruchom skan lokalnego folderu (zamień /ścieżka/do/muzyki na swoją)
node src/index.js scan "/ścieżka/do/muzyki"

# 4) Wynik: export/tracks.csv
```

## Co dalej (kamienie milowe)
1. ✅ **scan** – skan + CSV (już jest)
2. 🔜 **auth** – interaktywny OAuth do Spotify (PKCE/Authorization Code)
3. 🔜 **match** – wyszukiwanie w Spotify i zapis `export/matches.csv` (z kolumną `score`)
4. 🔜 **playlist** – tworzenie playlisty i dodawanie dopasowanych utworów

## Struktura
```
relink-mvp-cli/
  ├─ src/
  │   ├─ index.js        # router CLI (scan/match/playlist)
  │   ├─ scan.js         # skan folderu + odczyt tagów
  │   ├─ spotify.js      # szkielet integracji Spotify (auth + search + playlist)
  │   ├─ csv.js          # pomocnik do zapisu CSV
  │   └─ util.js         # helpery
  ├─ export/             # tutaj lądują CSV
  ├─ .env.example
  ├─ package.json
  └─ README.md
```

## Bezpieczeństwo
- Plik `.env` niech zostanie tylko lokalnie.
- Nie commituj tokenów/sekretów.

Powodzenia! Zacznij od `scan`, sprawdź CSV, a ja pomogę Ci dopisać `match` i `playlist`.
