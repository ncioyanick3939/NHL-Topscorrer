# NHL Topscorer

Private NHL-Fantasy-App. Spieler haben einen Preis. Während der Spiele zählen die echten Live-Punkte, am nächsten Morgen ändert sich der Preis nach den Tagespunkten.

## Starten

Du brauchst Node.js 22.5 oder neuer. Es gibt keine weiteren Pakete zu installieren.

```bash
npm start
```

Beim ersten Start erscheint im Terminal ein **Einladungscode** (er steht auch in `data/invite-code.txt`). Öffne http://localhost:3000, wähle "Konto erstellen" und gib Name, Passwort und den Code ein. Freunde brauchen denselben Code.

Beim ersten Start lädt der Server automatisch alle 32 NHL-Kader und den Spielplan. Das dauert eine Minute. Danach läuft alles von selbst:

- Alle 10 Minuten wird der Spielplan geprüft, während Spiele laufen jede Minute.
- Laufende Spiele aktualisieren die Live-Punkte.
- Am nächsten Tag ab 10:00 Uhr (Zürich), wenn alle Spiele des Tages fertig sind, wird der Tag abgeschlossen: Preise ändern sich, Statistiken und Manager-Punkte werden gebucht.

Kader von Hand neu laden: `npm run sync`. Einen Durchlauf von Hand starten: `npm run process`. Tests: `npm test`.

## Spielregeln

| Regel | Wert |
| --- | --- |
| Startbudget | 5'000'000 |
| Kader | max. 18 Spieler, davon max. 3 Torhüter |
| Kaufen und Verkaufen | zum aktuellen Preis |
| Sperre | Spieler, deren Team heute spielt oder gespielt hat, sind bis zum Tagesabschluss gesperrt |
| Preisänderung | einmal pro Tag, nach den Tagespunkten |
| Maximale Änderung | ±15 % pro Tag |

Alle Werte stehen in `config.js`.

## Punkte

Skater: Tor 50, Assist 25, Schuss aufs Tor 2, geblockter Schuss 2, Strafminute −2, Plus/Minus ±5.
Torhüter: Parade 1, Gegentor −15, Sieg 20, Shutout 30.

**Nur "Tor = 50" stammt von dir. Alle anderen Werte sind Platzhalter** und in `config.js` anpassbar.

Der Preis ändert sich um 0,09 % pro Punkt: ein Tor (50 Punkte) gibt +4,5 %.

## Dateien

Alle Dateien liegen in einem Ordner.

- `server.js`: Web-Server und Schnittstelle
- `nhl.js`: Abruf der NHL-API, Live-Punkte, Tagesabschluss
- `scoring.js`: Punkte und Preisformel
- `game.js`: Konten, Kaufen und Verkaufen, Liga
- `config.js`: alle Spielregeln und Punktewerte
- `db.js`, `util.js`: Datenbank und Hilfsfunktionen
- `index.html`, `style.css`, `app.js`: die App im Browser (nur diese drei werden ausgeliefert)
- `flow.test.js`: automatische Tests
- `data/app.db`: die Datenbank (SQLite). **Das ist die Datei für dein Backup.**

## Wichtig

- **Die NHL-API ist inoffiziell.** Die Adressen und Feldnamen im Code stammen aus dem Gedächtnis und konnten nicht gegen die echte API getestet werden. Prüfe nach dem ersten Start: Erscheinen Spieler im Markt? Zeigt der Live-Tab Spiele? Falls etwas fehlt, steht der Grund im Terminal.
- **Fotos und Logos** kommen direkt von der NHL und sind nur für den privaten Gebrauch gedacht. Fehlen sie, zeigt die App Initialen.
- **Läuft nur, solange der Server läuft.** Für den Dauerbetrieb braucht es einen Rechner oder Hosting, der durchläuft. Dann `COOKIE_SECURE=1` setzen und HTTPS verwenden.
- **Startpreise** kommen aus den Punkten der letzten Saison. Das ist eine Schätzung und lässt sich in `startPrice` in `nhl.js` ändern.
