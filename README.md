# VOID Apps

Dashboard aller Apps von GUN642 auf GitHub Pages, im Stil von VOID Files.

* **Öffentlich:** https://gun642.github.io/App-dashboard/ zeigt nur Apps mit `"public": true`.
* **Privat:** https://gun642.github.io/App-dashboard/mein/ zeigt alle Apps. Die Daten liegen verschlüsselt auf der Seite (AES-GCM, Schlüssel aus dem Passwort) und werden erst im Browser mit dem Passwort entschlüsselt.

## Aufbau

| Datei | Inhalt |
|---|---|
| `apps.json` | Katalog: Name, Repo, Beschreibung, Funktionen, Anleitung, Links, `public` |
| `scripts/build.mjs` | Holt Live-Daten über die GitHub-API (letzter Commit, Release, APK, Version, Aktivität 13 Wochen) und baut `site/` |
| `web/` | Seite (HTML, CSS, JS ohne Build-Schritt), `web/mein/` ist die private Ansicht |
| `.github/workflows/pages.yml` | Baut bei jedem Push, alle 3 Stunden und von Hand. Veröffentlicht nur vom Standard-Branch |

## Einrichtung (einmalig)

1. Settings, Pages, Build and deployment, Source: **GitHub Actions**.
2. Settings, Secrets and variables, Actions, New repository secret:
   * `DASHBOARD_PASSWORD`: Passwort für die private Ansicht.
   * `REPOS_TOKEN` (empfohlen): Fine-grained Token, Repository access **All repositories**, Permissions **Contents: Read-only** (Metadata kommt automatisch). Nötig für private Repos wie DEX-reloaded.
3. Actions, Pages, Run workflow.

## App öffentlich zeigen

In der privaten Ansicht den Schalter auf der Karte umlegen. Dafür einmal unter „Bearbeiten“ einen Token hinterlegen (Fine-grained, nur dieses Repo, Contents und Actions: Read and write). Der Schalter ändert `apps.json` per Commit, die Seite baut sich danach neu. Alternativ `public` in `apps.json` direkt ändern.

Hinweis: `apps.json` liegt in diesem öffentlichen Repo. Beschreibungen nicht öffentlicher Apps sind dort also lesbar, nur Live-Daten (Commits, Releases privater Repos) sind ausschließlich verschlüsselt veröffentlicht.

## Neue App aufnehmen

Eintrag in `apps.json` ergänzen. `mono` sind zwei Zeichen für die Kachel, `web` und `apk` optional (sonst APK aus dem neuesten Release), `versionFile` für Repos mit Versionsdatei statt Release.

## Lokal ansehen

```
DASHBOARD_PASSWORD=test DASHBOARD_PLAIN=1 node scripts/build.mjs
cd site && python3 -m http.server
```
