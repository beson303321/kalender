# 26aTB1 – Anleitung zum Online-Stellen

Die Webseite ist fertig. Damit sie online geht und die Klasse Einträge teilen kann, braucht es drei Dinge:

1. **Firebase** speichert die Termine und prüft die Passwörter.
2. **GitHub Pages** zeigt die Webseite gratis an.
3. **Hostpoint** leitet deine Domain auf GitHub weiter.

Zeitaufwand: etwa 30 Minuten.

---

## Teil 1: Firebase einrichten

### 1.1 Projekt erstellen
1. Geh auf <https://console.firebase.google.com> und melde dich mit deinem Google-Konto an.
2. Klick auf **Projekt erstellen**. Als Name eignet sich zum Beispiel `kalender-26atb1`.
3. **Google Analytics** kannst du ausschalten, das brauchst du nicht.
4. Warte, bis das Projekt bereit ist.

### 1.2 Web-App registrieren (für die Konfiguration)
1. Klick auf der Projektübersicht auf das Symbol **`</>`** (Web).
2. Als App-Name passt zum Beispiel `kalender`. **Firebase Hosting nicht ankreuzen.**
3. Firebase zeigt dir einen Code mit `const firebaseConfig = { apiKey: "...", ... }`.
4. Trag diese Werte in die Datei **`js/config.js`** ein, oder schick sie mir.
   *Diese Werte sind nicht geheim. Sie dürfen öffentlich auf GitHub stehen.*

### 1.3 Login aktivieren und die zwei Konten erstellen
1. Links im Menü: **Build → Authentication → Jetzt starten**.
2. Unter **Anmeldemethode** wählst du **E-Mail-Adresse/Passwort**, aktivierst es und speicherst.
3. Im Tab **Nutzer** klickst du auf **Nutzer hinzufügen** und legst diese zwei Konten an:

| Konto | E-Mail (genau so eintippen) | Passwort |
|---|---|---|
| Klasse | `klasse@26atb1.ch` | das Klassen-Passwort |
| Admin (du) | `admin@26atb1.ch` | **ein eigenes, starkes Passwort**, das nur du kennst |

   Es werden nie E-Mails an diese Adressen verschickt. Sie dienen nur als Benutzernamen.
   Auf der Webseite tippt man einfach **`klasse`** oder **`admin`** ein.

4. Unter **Einstellungen → Nutzeraktionen** schaltest du **„Registrierung aktivieren“** aus, falls es diese Option gibt.
   Dann kann niemand selbst ein neues Konto anlegen. Die Datenbank lässt ohnehin nur die zwei Konten oben rein.

### 1.4 Datenbank erstellen
1. Links: **Build → Firestore Database → Datenbank erstellen**.
2. Als Standort wählst du **`europe-west6 (Zürich)`**.
3. Wähle den **Produktionsmodus**.
4. Wenn die Datenbank bereit ist, öffnest du den Tab **Regeln**. Lösch dort alles und füg den ganzen Inhalt der Datei **`firestore.rules`** ein.
   Dann klickst du auf **Veröffentlichen**.

### 1.5 Domains erlauben
**Authentication → Einstellungen → Autorisierte Domains → Domain hinzufügen:**
- `26atb1.ch`
- `www.26atb1.ch`
- `DEINNAME.github.io` (dein GitHub-Benutzername, siehe Teil 2)

---

## Teil 2: GitHub Pages

1. Erstell ein Konto auf <https://github.com>, falls du noch keines hast.
2. Erstell ein neues Repository, zum Beispiel `kalender`. Es muss **öffentlich** sein, damit GitHub Pages gratis ist.
   Das ist kein Problem, denn im Code steht kein Passwort.
3. Lade alle Dateien aus diesem Ordner hoch. Dazu gehören `index.html`, `css/`, `js/`, `CNAME` und `.nojekyll`.
4. Im Repository: **Settings → Pages**
   - **Source:** Deploy from a branch
   - **Branch:** `main`, Ordner `/ (root)`, dann **Save**
   - **Custom domain:** `26atb1.ch`, dann **Save**
   - Sobald es geht, setzt du das Häkchen bei **Enforce HTTPS**. Das kann bis zu 24 Stunden dauern.

---

## Teil 3: Domain bei Hostpoint

Im Hostpoint Control Panel öffnest du **Domains → 26atb1.ch → DNS-Einträge**.

Lösch zuerst allfällige bestehende A-Einträge für `@` und `www`. Dann fügst du diese Einträge hinzu:

| Typ | Name | Wert |
|---|---|---|
| A | @ (leer) | `185.199.108.153` |
| A | @ (leer) | `185.199.109.153` |
| A | @ (leer) | `185.199.110.153` |
| A | @ (leer) | `185.199.111.153` |
| CNAME | www | `DEINNAME.github.io` |

Bis die Änderungen wirken, kann es ein paar Minuten bis einige Stunden dauern.

---

## Teil 4: Erster Start

1. Öffne <https://26atb1.ch>.
2. Melde dich **zuerst als `admin`** an. Dabei werden die Kategorien **Prüfung** und **Event** automatisch erstellt.
3. Weitere Kategorien legst du oben über **Kategorien** an.
4. Teil der Klasse den Link, den Benutzernamen `klasse` und das Klassen-Passwort mit.

## Wer darf was?

| | Klasse | Admin |
|---|:-:|:-:|
| Termine anschauen | ✅ | ✅ |
| Neue Einträge erstellen | ✅ | ✅ |
| Einträge bearbeiten / löschen | ❌ | ✅ |
| Kategorien erstellen / ändern / löschen | ❌ | ✅ |

Diese Regeln prüft die Datenbank selbst. Auch wer am Code der Webseite herumbastelt, kommt nicht daran vorbei.

## Passwort ändern
Die E-Mail-Adressen sind nicht echt. Deshalb funktioniert „Passwort zurücksetzen per E-Mail“ nicht. So geht es stattdessen:

1. Öffne Firebase → **Authentication → Nutzer**.
2. Klick beim Konto auf die drei Punkte und wähle **Konto löschen**.
3. Leg das Konto mit **derselben E-Mail** und dem neuen Passwort gleich wieder an.

Die Termine bleiben dabei erhalten, und am Code muss nichts geändert werden.

---

## Update 1.1 einspielen (Stundenplan, Ferien, App, Neuigkeiten)

Die Reihenfolge ist wichtig: **zuerst die Regeln, dann die Dateien.**

1. **Regeln aktualisieren:** Firebase → Firestore Database → **Regeln**. Lösch alles und füg den neuen Inhalt von `firestore.rules` ein, dann klick auf **Veröffentlichen**.
2. **Dateien auf GitHub hochladen:** Im Repository auf **Add file → Upload files** klicken. Zieh alles aus dem Ordner `26aTB1-website` hinein, auch die neuen Ordner `icons/`. Dann **Commit changes**. Bestehende Dateien werden dabei ersetzt.
3. **Stundenplan importieren:** Melde dich auf https://26atb1.ch als `admin` an. Öffne **Verwaltung → Importieren …** und wähl die Datei `stundenplan-quelle.ics`. Sie liegt im Ordner `2_Students_math`, **nicht** im Website-Ordner. Das Häkchen bei den Infoblatt-Terminen lässt du gesetzt. Dann **Importieren**.

## Stundenplan fürs 2. Semester
Lade in schulNetz die neue Kalender-Datei (.ics) herunter und importiere sie wie oben. Bestehende Prüfungen und Ferien werden dabei aktualisiert, nicht doppelt angelegt.
**Diese Datei nie auf GitHub hochladen.** Sie enthält einen persönlichen schulNetz-Link.

## Neue Version ankündigen
In `js/changelog.js` oben einen neuen Eintrag hinzufügen. Alle sehen dann einen roten Punkt beim Geschenk-Symbol 🎁.

## Update 1.3: Dateien (OneDrive-Ordner)
1. **Regeln aktualisieren:** Den neuen Inhalt von `firestore.rules` in Firebase unter **Regeln** einfügen und auf **Veröffentlichen** klicken.
2. **Dateien auf GitHub hochladen:** wie immer den ganzen Inhalt von `26aTB1-website` hochladen.
3. **Ordner verknüpfen:** Als `admin` anmelden und den Tab **Dateien** öffnen. Dort auf **„Ordner-Link eintragen“** klicken und den Freigabe-Link aus OneDrive einfügen.
   In OneDrive bekommst du ihn so: Ordner auswählen → **Teilen** → bei den Einstellungen „Bearbeiten“ wählen → **Link kopieren**.
