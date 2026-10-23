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

## Öffentlich ins Internet stellen: gratis, ohne Kreditkarte (Render)

Ein Codespace schaltet sich nach etwa 30 Minuten ohne Aktivität ab. Auf **Render** (Gratis-Plan, ohne Kreditkarte) läuft die App dauerhaft. Weil Render gratis keine bleibende Festplatte hat, speichert die App ihre Datenbank alle 10 Minuten (und beim Herunterfahren) in ein **privates GitHub-Repo** und lädt sie beim Start von dort zurück (`backup.js`, `start.js`). Damit sie nicht einschläft, ruft sie sich alle 10 Minuten selbst auf. Alles geht auch am Handy:

1. **Daten-Repo:** Auf github.com → **+** → **New repository**. Name `NHL-Topscorrer-data`, **Private**, **Add a README file** ankreuzen, **Create repository**.
2. **Token:** github.com → Profilbild → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   - Name: `nhl-backup`, Expiration: **No expiration** (oder 1 Jahr)
   - Repository access: **Only select repositories** → `NHL-Topscorrer-data`
   - Permissions → Repository permissions → **Contents: Read and write**
   - **Generate token** und den Token (`github_pat_...`) kopieren
3. **Render:** Auf https://render.com mit **GitHub** anmelden. **New** → **Blueprint** → Repo `NHL-Topscorrer` wählen. Render liest `render.yaml` und fragt nach drei Werten:
   - `INVITE_CODE`: dein Einladungscode für Freunde
   - `BACKUP_REPO`: `ncioyanick3939/NHL-Topscorrer-data`
   - `BACKUP_TOKEN`: der Token aus Schritt 2
4. **Apply** tippen. Nach ein paar Minuten steht oben die Adresse, z.B. `https://nhl-topscorer.onrender.com`. Diese schickst du deinen Freunden.

Bei jedem Push auf `main` veröffentlicht Render automatisch neu, die Daten bleiben dank Backup erhalten. Im schlimmsten Fall (Absturz ohne sauberes Herunterfahren) gehen die letzten bis zu 10 Minuten verloren. Kann das Backup beim Start nicht geladen werden, startet die App absichtlich nicht (Render versucht es wieder), damit sie nie ein gutes Backup mit einer leeren Datenbank überschreibt.

Bestehende Daten aus dem Codespace mitnehmen: im Codespace einmal mit denselben Werten `BACKUP_REPO=... BACKUP_TOKEN=... npm run start:hosted` starten und mit Strg+C beenden: Dabei wird `data/app.db` ins Daten-Repo gesichert. Danach Render starten.

### Alternative: eigener Server

Ein Codespace schaltet sich nach etwa 30 Minuten ohne Aktivität ab. Dauerhaft und gratis läuft die App auf einem **Google Cloud „Always Free“-Server** (e2-micro). Er kostet nichts, schaltet sich nie ab und behält die Datenbank. Google verlangt bei der Anmeldung eine Kreditkarte zur Überprüfung, belastet sie aber nicht, solange du in den Gratis-Grenzen bleibst.

1. Auf https://console.cloud.google.com mit einem Google-Konto anmelden und das kostenlose Konto aktivieren.
2. **Compute Engine → VM-Instanzen → Instanz erstellen**:
   - Region: **us-central1**, **us-west1** oder **us-east1** (nur dort ist er gratis)
   - Maschinentyp: **e2-micro**
   - Bootlaufwerk: **Ubuntu 24.04 LTS**, Typ **Standard persistent disk**, 30 GB
   - Firewall: **HTTP- und HTTPS-Traffic zulassen** ankreuzen
3. Bei der neuen Instanz auf **SSH** klicken. Im Fenster, das aufgeht, diesen einen Befehl einfügen:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/ncioyanick3939/NHL-Topscorrer/main/deploy/setup.sh | sudo bash
   ```

4. Am Ende steht die Adresse (z.B. `https://34-12-56-78.sslip.io`) und der Einladungscode. Diese Adresse schickst du deinen Freunden.

Das Skript richtet alles ein: Node.js, die App als Dienst (startet nach Absturz oder Neustart von selbst), HTTPS mit Zertifikat und ein **automatisches Update alle 10 Minuten**: Was auf `main` gepusht wird, ist kurz danach online.

- Eigener Einladungscode: `sudo nano /etc/nhl-topscorer.env`, dort `INVITE_CODE=dein-code` eintragen, dann `sudo systemctl restart nhl-topscorer`.
- Log ansehen: `sudo journalctl -u nhl-topscorer -f`
- Backup: die Datei `/var/lib/nhl-topscorer/app.db`
- Bestehende Daten aus dem Codespace mitnehmen: `data/app.db` im Codespace herunterladen, im SSH-Fenster über **Datei hochladen** hochladen, dann `sudo systemctl stop nhl-topscorer && sudo mv ~/app.db /var/lib/nhl-topscorer/app.db && sudo chown nhl:nhl /var/lib/nhl-topscorer/app.db && sudo systemctl start nhl-topscorer`

Das Skript läuft genauso auf Oracle Cloud „Always Free“ (Ubuntu) oder einem Raspberry Pi. Es gibt auch ein `Dockerfile` für Docker-Hosting (bleibender Speicher unter `/data` nötig).

## Spielregeln

| Regel | Wert |
| --- | --- |
| Startteam | gratis und zufällig: 9 Stürmer, 6 Verteidiger, 1 Torhüter (Gesamtwert höchstens 3,5 Mio.) |
| Startbudget | 2'000'000 |
| Kader | max. 20 Spieler, davon max. 3 Torhüter |
| Markt | 48 Angebote. Jede Stunde verschwindet eines, und ein neues kommt. Jeder Spieler bleibt 48 Stunden |
| Kaufen | nur Spieler auf dem Markt, zum aktuellen Preis |
| Verkaufen | jederzeit, zum aktuellen Preis |
| Sperre | Transfermarkt: keine, jederzeit bieten, kaufen, verkaufen (einschaltbar mit `marketLock` in `config.js`). Aufstellung: Spieler, deren Team heute spielt oder gespielt hat, bleiben bis zum Tagesabschluss wo sie sind |
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
- `index.html`, `style.css`, `app.js`, `fx.js`: die App im Browser (`fx.js`: Konfetti, Torlicht, Feiern). Nur diese Dateien und die Bilder werden ausgeliefert
- `flow.test.js`: automatische Tests
- `data/app.db`: die Datenbank (SQLite). **Das ist die Datei für dein Backup.**

## Wichtig

- **Die NHL-API ist inoffiziell.** Die Adressen und Feldnamen im Code stammen aus dem Gedächtnis und konnten nicht gegen die echte API getestet werden. Prüfe nach dem ersten Start: Erscheinen Spieler im Markt? Zeigt der Live-Tab Spiele? Falls etwas fehlt, steht der Grund im Terminal.
- **Fotos und Logos** kommen direkt von der NHL und sind nur für den privaten Gebrauch gedacht. Fehlen sie, zeigt die App Initialen.
- **Läuft nur, solange der Server läuft.** Für den Dauerbetrieb braucht es einen Rechner oder Hosting, der durchläuft. Dann `COOKIE_SECURE=1` setzen und HTTPS verwenden.
- **Startpreise** kommen aus den Punkten der letzten Saison. Das ist eine Schätzung und lässt sich in `startPrice` in `nhl.js` ändern.
