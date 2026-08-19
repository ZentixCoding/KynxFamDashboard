# Familie Kynx – Panel (Grand RP DE03)

Discord-geschütztes Family-Panel mit:

- **Echter Discord-Login** (OAuth2)
- **Server-Mitgliedschaft + Rollen-Check**
- **Sanktionskatalog** (editierbar in `config.json`)
- **Einstellungstest** (Fragen IC stellen → im Panel Richtig/Falsch markieren)
- Test-Historie speichern

## Schnellstart

```bash
cd grand-rp-de03
node server.js
```

Öffne: **http://localhost:3000**

## Discord einrichten (Pflicht)

1. Gehe zu [Discord Developer Portal](https://discord.com/developers/applications)
2. **New Application** erstellen
3. Unter **OAuth2 → General**:
   - Client ID kopieren
   - Client Secret kopieren (Reset Secret falls nötig)
   - Redirects hinzufügen: `http://localhost:3000/auth/callback`
4. Unter **Bot**:
   - Bot erstellen → Token kopieren
   - Privileged Intent: **Server Members Intent** aktivieren
5. Bot auf deinen Discord-Server einladen (mit Berechtigung Mitglieder zu sehen):
   ```
   https://discord.com/api/oauth2/authorize?client_id=DEINE_CLIENT_ID&permissions=0&scope=bot
   ```
6. **Server-ID** und **Rollen-ID** holen (Discord → Einstellungen → Erweitert → Entwicklermodus → Rechtsklick auf Server/Rolle → ID kopieren)

### In `config.json` eintragen:

```json
"discord": {
  "clientId": "1234567890",
  "clientSecret": "abc...",
  "botToken": "MTAx...",
  "guildId": "9876543210",
  "requiredRoleId": "1122334455",
  "redirectUri": "http://localhost:3000/auth/callback"
}
```

Ohne gültige Werte zeigt der Login eine Konfigurations-Hinweis-Seite.

## Sanktionen ändern

In `config.json` unter `"sanktionen"` Einträge anpassen/hinzufügen:

```json
{
  "verstoß": "Fail-RP (leicht)",
  "kategorie": "rp",
  "erst": "VW",
  "zweit": "VW + 3 Tage",
  "dritt": "VW + 7 Tage"
}
```

Kategorien: `rp` | `chat` | `technisch` | `sonstiges`

Server neu starten, damit Änderungen geladen werden.

## Einstellungstest ändern

In `config.json` unter `"einstellungstest"`:

- `minBestehen`: Prozent zum Bestehen (Standard 70)
- `fragen`: Array mit `id`, `frage`, `hinweis` (Hinweis nur für Prüfer sichtbar)

Ablauf:
1. Fragen **IC** dem Bewerber stellen
2. Im Panel bei jeder Frage **Richtig** oder **Falsch** klicken
3. Bewerber-Name eintragen → **Test speichern**
4. Ergebnis erscheint in der **Test-Historie**

## Dateien

```
grand-rp-de03/
├── config.json          ← Discord, Sanktionen, Test-Fragen
├── server.js            ← Backend (Node, ohne Extra-Dependencies)
├── public/
│   ├── index.html
│   ├── dashboard.html
│   ├── css/style.css
│   └── js/dashboard.js
├── data/                ← Sessions & gespeicherte Tests (automatisch)
└── README.md
```

## Produktion

- `redirectUri` auf deine Domain setzen (auch im Discord Portal)
- `sessionSecret` in config ändern
- HTTPS verwenden
- Server hinter Nginx/Caddy betreiben

Nur autorisierte Nutzer mit der konfigurierten Discord-Rolle kommen ins Panel.
