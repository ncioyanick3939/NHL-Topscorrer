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

Kader von Hand neu laden: `npm run sync`. Verletzungen von Hand laden: `npm run injuries`. Einen Durchlauf von Hand starten: `npm run process`. Tests: `npm test`.

## Öffentlich ins Internet stellen (läuft immer)

Ein Codespace schaltet sich nach etwa 30 Minuten ohne Aktivität ab. Für eine Webseite, die immer läuft, braucht es ein Hosting. Am einfachsten ist **Railway** (ca. 5 USD pro Monat, Abrechnung nach Verbrauch):

1. Auf https://railway.com mit dem GitHub-Konto anmelden.
2. **New Project → Deploy from GitHub repo** und dieses Repository wählen. Railway findet das `Dockerfile` selbst.
3. Im Dienst rechts klicken → **Attach Volume**, Mount Path: `/data`. Dort liegt die Datenbank, sie bleibt bei jedem Update erhalten.
4. Unter **Variables** `INVITE_CODE` auf einen eigenen Code setzen (sonst steht ein zufälliger im Log).
5. Unter **Settings → Networking → Generate Domain** klicken. Das ergibt eine feste Adresse wie `nhl-topscorer.up.railway.app`, die du deinen Freunden schicken kannst.

Danach wird bei jedem Push auf `main` automatisch neu veröffentlicht. Beim ersten Start lädt der Server die NHL-Kader (etwa eine Minute).

Das `Dockerfile` läuft auch auf Fly.io, Render (mit Disk) oder einem eigenen Server. Wichtig ist immer: ein bleibender Speicher unter `/data`. Ohne ihn ist die Datenbank nach jedem Neustart leer.

| Variable | Bedeutung |
| --- | --- |
| `DATA_DIR` | Ordner für Datenbank und Einladungscode (im Dockerfile `/data`) |
| `INVITE_CODE` | fester Einladungscode |
| `COOKIE_SECURE=1` | Login-Cookie nur über HTTPS (im Dockerfile gesetzt) |
| `TRUST_PROXY=1` | echte Besucher-IP vom Hosting übernehmen, für die Login-Sperre (im Dockerfile gesetzt) |

## Spielregeln

| Regel | Wert |
| --- | --- |
| Startteam | gratis und zufällig: 9 Stürmer, 6 Verteidiger, 1 Torhüter (Gesamtwert höchstens 3,5 Mio.) |
| Startbudget | 2'000'000 |
| Kader | max. 20 Spieler, davon max. 3 Torhüter |
| Markt | 48 Angebote. Jede Stunde verschwindet eines, und ein neues kommt. Jeder Spieler bleibt 48 Stunden |
| Kaufen | nur Spieler auf dem Markt, zum aktuellen Preis |
| Verkaufen | jederzeit, zum aktuellen Preis |
| Sperre | Spieler, deren Team heute spielt oder gespielt hat, sind bis zum Tagesabschluss gesperrt |
| Preisänderung | einmal pro Tag, nach den Tagespunkten |
| Maximale Änderung | ±15 % pro Tag |

Alle Werte stehen in `config.js`. Das Startteam bekommt jeder einmal beim ersten Login, auch Konten, die schon vorher erstellt wurden und noch keinen Kader haben.

## Statistiken

Spiele, Tore, Assists, Plus/Minus, Schüsse und Strafminuten sind die **echten Saisonwerte der NHL**. Sie werden alle 3 Stunden und nach jedem Tagesabschluss neu geladen (`npm run stats` von Hand). Die Saisonpunkte werden aus diesen Werten mit den Punktewerten berechnet. Geblockte Schüsse fehlen in der NHL-Saisontabelle, deshalb sind die Saisonpunkte etwas niedriger als die Tagespunkte. Auf der Spielerseite stehen die letzten 5 Spiele direkt von der NHL.

## Verletzungen und Abwesenheit

- **Verletzt oder fraglich:** Die NHL-API hat keine Verletzungsdaten. Deshalb liest der Server stündlich eine öffentliche Verletztenliste (ESPN) und ordnet die Spieler über den Namen zu. Das ist eine Schätzung: Bei zwei Spielern mit gleichem Namen wird keiner markiert. Verletzte ("Out") Spieler verschwinden vom Markt und kommen nicht ins Startteam. Beim Kauf eines verletzten oder fraglichen Spielers fragt die App nach.
- **Im letzten Spiel nicht dabei:** Stand ein Feldspieler im letzten Spiel seines Teams nicht im Einsatz, zeigt die App das an, aber nur wenn dieses Spiel schon ausgewertet ist. Torhüter bekommen den Hinweis nie (Ersatztorhüter sitzen oft). Der Grund (verletzt, überzählig, abwesend) ist nicht bekannt.
- Von Hand laden: `npm run injuries`. Klappt der Abruf nicht, funktioniert die App trotzdem, nur ohne Verletzungsinfos.

## Punkte

Skater: Tor 50, Assist 25, Schuss aufs Tor 2, geblockter Schuss 2, Strafminute −2, Plus/Minus ±5.
Torhüter: Parade 1, Gegentor −15, Sieg 20, Shutout 30.

**Nur "Tor = 50" stammt von dir. Alle anderen Werte sind Platzhalter** und in `config.js` anpassbar.

Der Preis ändert sich um 0,09 % pro Punkt: ein Tor (50 Punkte) gibt +4,5 %.

## Dateien

Alle Dateien liegen in einem Ordner.

- `server.js`: Web-Server und Schnittstelle
- `nhl.js`: Abruf der NHL-API, Live-Punkte, Tagesabschluss
- `market.js`: Markt mit 48-Stunden-Angeboten
- `injuries.js`: Verletzungsinfos
- `scoring.js`: Punkte und Preisformel
- `game.js`: Konten, Startteam, Kaufen und Verkaufen, Liga
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
