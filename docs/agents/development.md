# Entwicklungsrichtlinien

- Änderungen bleiben auf das aktuelle Ziel begrenzt und folgen KISS, YAGNI, DRY und Clean Code.
- Vorhandene Projektmuster, Design-Tokens und generische Runtime-Abstraktionen werden wiederverwendet; projektspezifische Produktionslogik bleibt im jeweiligen Projekt.
- Fehler werden an ihrer Ursache behoben. Neue Sonderfälle benötigen einen reproduzierbaren Test.
- Auswahl, Bearbeitung, Ausführung, Remote-Vorschau und Aufnahme bleiben getrennte Zustände.
- Das JSON-Projekt ist die einzige ausführbare Produktionsbeschreibung; es wird kein paralleler Timeline-Code erzeugt.
- Vor dem Abschluss laufen `npm run verify:core` sowie die betroffenen Browser-Prüfungen. Ein Release-Kandidat läuft vollständig durch `npm run verify`.
- Reale Videoexporte werden zusätzlich mit `ffprobe` und repräsentativen Frames geprüft.
- Unabhängige Nutzeränderungen werden nicht überschrieben. Commits erfolgen nur auf ausdrücklichen Wunsch.
