# Browser Testbench Director

Dieses Projekt enthält den wiederverwendbaren [Video-Timeline-Core](docs/video-timeline.md). Beispielproduktionen liegen lokal unter `projects/` und werden nicht eingecheckt. Die erste Produktion ist `projects/youtube/shorts/binderium/guess-the-price`; nur sie benötigt für einen lokalen App-Lauf das Schwesterprojekt `app.collectile.com`.

```bash
npm install
npm run typecheck:timeline
npm run typecheck:guess-the-price
npm run test:timeline
```

Eine Folge wird aus einem Kartenfoto erstellt:

```bash
npm run guess-the-price -- ./assets/int/de/bild1.jpg
```

Die vollständige lokale Binderium-Konfiguration steht unter `projects/youtube/shorts/binderium/guess-the-price/README.md`. Der gesamte `projects/`-Ordner einschließlich Rohfotos und Videoexporten bleibt lokal.
