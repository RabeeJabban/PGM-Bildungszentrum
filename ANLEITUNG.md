# PGM Planer auf GitHub Pages

Dieser Ordner ist die Oberfläche der App. Die Daten und alle Berechnungen
bleiben in Google Apps Script und in der Tabelle. Hier liegen nur die Seiten,
die im Browser laufen.

## Was drin ist

| Datei | wofür |
|---|---|
| `index.html` | Anmeldung mit E-Mail und Code |
| `betreuer.html` | Mein PGM, die Seite für alle Mitarbeiter |
| `planer.html` | PGM Planer, nur für die Leitung |
| `eltern.html` | Seite für die Eltern, eine je Schule über `?e=` |
| `manifest-pgm.json`, `manifest-planer.json` | Name und Symbol beim Installieren |
| `sw.js` | macht die App installierbar und offline-tauglich |
| `icons/` | die Symbole |

Dieselben vier HTML-Dateien liegen auch weiter in Apps Script. Sie merken
selbst, wo sie laufen. Du pflegst also nur eine Fassung.

## Schritt 1: Adresse eintragen

In **allen vier** HTML-Dateien steht oben im Skript:

```js
var SERVER = 'HIER_DIE_EXEC_ADRESSE_EINTRAGEN';
```

Dort kommt die Adresse deiner Apps-Script-App hinein, die auf `/exec` endet.
Zu finden in Apps Script unter *Bereitstellen → Bereitstellungen verwalten*.

## Schritt 2: Apps Script vorbereiten

1. `WebApp.gs` komplett ersetzen.
2. *Bereitstellungen verwalten → Stift → Neue Version*.
   **Nicht** „Neue Bereitstellung", sonst ändert sich die Adresse.
3. Ausführen als: **Ich**. Zugriff: **Jeder**.

## Schritt 3: Hochladen

1. Auf github.com ein neues Repository anlegen, öffentlich, Name `planer`.
   (Wer den kürzeren Link `https://rabeejabban.github.io/` will, nennt das
   Repository stattdessen genau `RabeeJabban.github.io`. Dann fällt `/planer`
   überall weg.)
2. Den Inhalt dieses Ordners hineinziehen (den Ordner `icons` mit).
3. *Settings → Pages → Source: Deploy from a branch → main → / (root)*.
4. Nach ein bis zwei Minuten läuft die Seite unter
   `https://rabeejabban.github.io/planer/`

## Schritt 4: Neue Links verteilen

| wer | Link |
|---|---|
| alle Mitarbeiter | `https://rabeejabban.github.io/planer/` |
| Eltern einer Schule | `https://rabeejabban.github.io/planer/eltern.html?e=SCHULSCHLÜSSEL` |

Der Schulschlüssel steht in der Tabelle im Tab `Schulen`, Spalte `Eltern`.

Mitarbeiter brauchen keinen eigenen Link mehr. Alle öffnen dieselbe Adresse
und melden sich mit ihrer E-Mail an.

## Auf den Startbildschirm legen

* **iPhone:** in Safari öffnen, Teilen-Knopf, *Zum Home-Bildschirm*.
* **Android:** in Chrome öffnen, Menü, *App installieren*.

Danach liegt das PGM-Symbol auf dem Startbildschirm und die App startet ohne
Adresszeile.

## Nach einer Änderung

Datei austauschen, ein bis zwei Minuten warten, im Browser neu laden.
Die App holt sich immer zuerst die neue Fassung aus dem Netz; die Kopie im
Handy dient nur, wenn gerade kein Netz da ist.

## Was öffentlich ist und was nicht

Öffentlich sichtbar ist der Code dieser Seiten und die `/exec`-Adresse.
**Nicht** im Repository: die Tabelle, die Kinderdaten, die Mitarbeiterdaten,
die Tabellen-ID. Jeder Aufruf an den Server wird gegen den Token und die
Rechte in der Tabelle geprüft.

Das Einzige, was jemand mit der offenen Adresse anstellen könnte: über die
Anmeldeseite Codes anfordern. Deshalb liegt im Backend eine Bremse von
60 Mails am Tag. Wer das nicht öffentlich haben will, lädt denselben Ordner
bei Cloudflare Pages oder Netlify hoch, dort bleibt die Quelle privat.
