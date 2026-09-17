# Fahrtwert

Eine installierbare, iPhone-optimierte Web-App zum Vergleichen von Autofahrten anhand von Bordcomputer-Fotos.

## Funktionen

- Foto direkt mit der iPhone-Kamera aufnehmen oder auswählen
- Strecke, Verbrauch, Fahrzeit und Durchschnittstempo per OCR erkennen
- Erkannte Werte vor dem Speichern korrigieren
- Fahr-Effizienz-Index (FEI) berechnen und Fahrten sortieren
- Fahrten und verkleinerte Fotos lokal im Browser speichern
- Als Web-App zum iPhone-Home-Bildschirm hinzufügen

Die OCR-Bibliothek wird beim ersten Einsatz aus dem Internet geladen. Die Fahrtdaten selbst werden nicht an einen eigenen Server übertragen. Je nach Browser kann die OCR-Bibliothek das Bild technisch im Gerät verarbeiten; Fahrtwert lädt es nicht in eine Datenbank hoch.

## FEI

`FEI = 100 × sqrt((Verbrauch / 6) × (100 × Stunden / Kilometer))`

Ein FEI von 100 entspricht der Referenz von 6 l/100 km bei 100 km/h Durchschnittsgeschwindigkeit. Je kleiner der FEI, desto effizienter die Kombination aus Verbrauch und Zeit.

## Lokal testen

Öffne den Ordner mit einem statischen Webserver, zum Beispiel über die Vorschau deiner Entwicklungsumgebung. Wegen Service Worker und Kamera-Zugriff sollte die App über HTTPS oder `localhost` laufen.

## Auf GitHub Pages veröffentlichen

1. Neues GitHub-Repository anlegen und diese Dateien auf den Branch `main` hochladen.
2. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
3. Nach dem ersten Workflow-Lauf erscheint die App unter der von GitHub angezeigten Pages-Adresse.

Auf dem iPhone anschließend in Safari **Teilen → Zum Home-Bildschirm** wählen.
