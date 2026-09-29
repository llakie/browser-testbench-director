# Browser Testbench Director

Browser Testbench Director ist ein JSON-basierter Editor und Player für Website-Automationen und darüberliegende Video-Layer. Produktionsprojekte liegen lokal unter `projects/`, werden nicht eingecheckt und bringen ihre projektspezifischen Assets, Prepare-Module und Prüfskripte selbst mit.

Release-Dokumentation: [Browser Testbench Director 0.1.0](docs/releases/0.1.0.md).

## Installation

Browser Testbench Director benötigt Node.js 22.12 oder Node.js 24 und `ffmpeg` sowie `ffprobe` auf dem `PATH` für Videoexporte. Browser Testbench wird als Paketabhängigkeit mitinstalliert und muss nicht separat global eingerichtet werden.

```bash
npm install --global browser-testbench-director
browser-testbench-director start
```

Die Oberfläche ist anschließend standardmäßig unter `http://127.0.0.1:5173` erreichbar. Mit `browser-testbench-director start --https` wird ein lokales Zertifikat im aktuellen Arbeitsverzeichnis erzeugt. Projektdateien und zugehörige Assets bleiben ebenfalls im gewählten Arbeitsverzeichnis.

## Director UI

Der Director-Editor verarbeitet Input-Nodes, eine Website-Root sowie Layer-, JavaScript-, Browser-Aktions-, Warte- und Merge-Nodes. Jeder Layer belegt eine transparente Vollbildfläche; sein Inhalt kann daran ausgerichtet oder an einer geerbten Position platziert werden und bestimmt seine Größe selbst per CSS. Browser-Aktionen und Wartebedingungen werden typisiert konfiguriert; Element-, URL- und Script-Waits sowie Klicks sind vollständig lokal und über Browser Testbench ausführbar. Mehrere Ausgänge einer Node starten parallele Zweige. Ausschließlich eine Merge-Node darf mehrere Eingänge besitzen und setzt den Workflow wahlweise nach allen (`Wait all`) oder nach dem ersten (`Wait any`) abgeschlossenen Zweig fort. Rückgabewerte werden unter der Node-ID gespeichert und stehen späteren Layern und Scripts über `director.results` zur Verfügung. Ein Node-Klick wählt ausschließlich aus. Der Play-Button einer Node lädt die Website neu, rekonstruiert alle Vorgänger samt Datenfluss im Catch-up und spielt nur die gewählte Node live. Die direkte Ausführung auf dem aktuellen Seitenzustand bleibt als Entwickleraktion im Node-Menü verfügbar. Der Play-Button im Graph-Header startet den gesamten Workflow neu.

Änderungen an ausführungsrelevanten Node-Eigenschaften starten niemals automatisch Code. Stattdessen erhält der Play-Button der geänderten Node eine Akzentumrahmung. Erst ein Klick rekonstruiert Website und Vorgänger im Catch-up und gibt die Node mit den aktuellen Eigenschaften wieder; nach erfolgreicher Wiedergabe verschwindet die Umrahmung. Der reine Anzeigename ist davon ausgenommen, weil er den Runtime-Zustand nicht beeinflusst. Damit bleiben Auswahl, Bearbeitung und Ausführung auch bei JavaScript mit beliebigen DOM-Seiteneffekten klar getrennt.

Nodes ohne manuell festgelegte Position tragen im Projekt `"position": null` und werden mit ELK Layered automatisch kompakt angeordnet. Lange Workflows und parallele Zweige werden unter Beibehaltung ihrer Abhängigkeiten angeordnet; JointJS routet die Verbindungen anschließend automatisch orthogonal um die Nodes. Erst ein echtes Verschieben speichert `{ "x": …, "y": … }` für diese Node. Der Auto-Layout-Button setzt alle Nodes wieder auf den automatisch verwalteten Zustand zurück.

Layer können zusätzlich eine Haltedauer besitzen und danach vollständig entfernt werden. So lassen sich endliche Story-Clips abbilden; beim beschleunigten Wiederaufbau wird lediglich ihre Wartezeit ausgelassen, während Seiteneffekte und Rückgabewerte erhalten bleiben.

Die reine Viewport-Vorschau dockt bei Portrait-Projekten rechts und bei Landscape-Projekten oben an. Die Panelgrenzen sind verschiebbar, ihre Positionen werden lokal gespeichert und jedes Panel lässt sich maximieren. Auf kleinen Viewports werden Szenengraph, Node-Einstellungen und Vorschau als drei Tabs innerhalb einer `100dvh`-App-Shell dargestellt; der Szenengraph ist die Startansicht. Der mobile Kopfbereich fasst Projekt-, KI-, Browser-Testbench- und Dateiaktionen in einem Hamburger-Menü zusammen. Projekte lassen sich als versionierte `.btd.json`-Datei laden und speichern.

Der gemeinsame Abspielgeräte-Selektor enthält lokale Viewport-Presets und – solange Browser Testbench im globalen Kopfbereich eingeschaltet ist – kompatible Remote-Targets. Lokale Presets werden automatisch in die verfügbare Fläche eingepasst; einen separaten Vorschau-Zoom gibt es nicht. Ein Remote-Target übernimmt sofort den zuletzt erfolgreich ausgeführten Zustand und wird im Director durch einen klaren Platzhalter dargestellt. Beim Wechsel zurück auf ein lokales Preset wird die Remote-Session geschlossen und derselbe Zustand lokal reproduziert. Die Remote-Auswahl ist reiner Session-Zustand und gehört nicht zum Projektformat. Unabhängig davon wählt der Aufnahmebutton ausschließlich aufnahmefähige Targets aus. Die globalen Projekteinstellungen konfigurieren Sprache, Region und zusätzliche Website-Berechtigungen jeder Browser-Testbench-Session; unterstützte Desktop-Browser stellen die kombinierte Sprache beispielsweise als `navigator.language === "de-DE"` bereit.

Der Aufnahmebutton im Graph-Header startet eine saubere Remote-Session, nimmt deren Viewport während des vollständigen Workflows auf und lädt anschließend ein MP4 herunter. Ist das gewählte Target bereits die Remote-Vorschau, wird deren Session reproduzierbar zurückgesetzt und zeigt nach der Aufnahme den finalen Stand weiter an. Aufnahmen auf einem anderen Target lassen die laufende Vorschau unberührt. Größe und SHA-256 des Browser-Testbench-Artefakts werden geprüft. Echte Geräte, Simulatoren und Emulatoren behalten ihre native feste Videoauflösung. Bei einer Desktop-Aufnahme leitet der Director die Ausgabe aus CSS-Viewport und DPR des zentral definierten Vorschau-Presets ab. Diese Maße bleiben bei der serverseitigen Entfernung ausgelassener Wartezeiten erhalten; im Projekt selbst wird ausschließlich die portable Preset-ID gespeichert.

Desktop-Browser werden beim Aufnehmen headless gestartet. Der Director gleicht Browser-Chrome und Mindestfenstergrößen aus und erhält dabei das Seitenverhältnis des Projekt-Viewports. Damit kann ein Portrait-Short stabil in Chrome aufgenommen werden, ohne sichtbare Browserfenster, abgeschnittene Viewports oder Letterboxing; die interaktive Remote-Vorschau bleibt weiterhin sichtbar.

Projekte deklarieren Laufzeitdateien als Input-Nodes vor der Website-Root. Der Dateiselektor und die aktuelle Auswahl sind direkt in der Node sichtbar; MIME-Typen, Pflichtfeld und Prepare-Module werden in ihren Node-Eigenschaften konfiguriert. Ausgewählte Dateien werden content-addressiert unter `projects/.director-assets/` abgelegt und im Projekt-JSON über Name, Typ, Größe und SHA-256 referenziert. Beim erneuten Öffnen stellt der Director sie automatisch wieder her. Der Director validiert und bereitet alle verbundenen Inputs vor dem Start der Website auf. Kameraquellen werden anschließend binär an Browser Testbench übertragen; andere Dateien stehen Scripts als Data-URLs unter `director.inputs` zur Verfügung. Für lokale Android-URLs aktiviert der Director automatisch Browser Testbenchs sicheres Reverse-Mapping. Ein Projekt kann damit beispielsweise einen Android-Emulator mit Kameraberechtigung, Sprache/Locale, einem injizierten Kamerabild und einer Schrift starten, ohne Binärdaten oder transportspezifische Netzwerkdetails in der `.btd.json`-Datei abzulegen.

Der Director enthält keine fest eingebaute Produktionslogik. Beim Videoexport werden die markierten Layer-Intervalle zusammengeschnitten. Warte-Nodes können mit `omitFromRecording` explizit aus dem Video entfernt oder darin belassen werden.

```bash
npm run dev
npm run dev:https
```

`npm run dev` startet den eigenständigen Director-Server mit eingebetteter Vite-Middleware. `npm run dev:https` erzeugt beim ersten Start ein lokales Zertifikat für `localhost`, `127.0.0.1` und `::1` unter `.certs/` und verwendet es anschließend wieder. Mit `--https-cert` und `--https-key` kann stattdessen ein eigenes Zertifikat verwendet werden. HTTPS-Websites werden für die integrierte Vorschau über eine temporäre Same-Origin-Route des Directors geladen; Browser Testbench verwendet weiterhin unverändert die originale Website-URL.

Für den Produktionsbetrieb werden Client und Node-Server gemeinsam gebaut und anschließend ohne Vite ausgeliefert:

```bash
npm run build
npm start
```

Der CLI-Einstiegspunkt lautet `browser-testbench-director start`. Er akzeptiert `--host`, `--port`, `--https`, `--https-cert`, `--https-key` und `--browser-testbench-url`. Das serverseitige Laufzeitsystem liegt unter `src/server/` und stellt Preview-Routen, den Website-Proxy, Prepare-Module, Videoexport, Browser-Testbench-Lifecycle und den `/browser-testbench-api`-Proxy bereit. Der gebaute Client wird aus `dist/ui` ausgeliefert. Projektdateien werden weiterhin direkt über die Browser-Dateischnittstelle geöffnet und gespeichert; sie benötigen keinen Server-Datenspeicher.

## MCP

Der Director bringt einen stdio-MCP-Server auf Basis des offiziellen TypeScript-SDKs mit. Er listet, liest, validiert und bearbeitet `.btd.json`-Projekte innerhalb eines expliziten Arbeitsverzeichnisses. Änderungen werden vollständig validiert und atomar gespeichert. Der Einrichtungsdialog „KI verbinden“ erkennt Codex, Claude Code, Gemini CLI und VS Code; unterstützte CLI-Clients lassen sich dort registrieren, für andere Clients wird die passende Konfiguration kopiert.

```bash
browser-testbench-director mcp --workspace /path/to/workspace
browser-testbench-director mcp-config --client codex --workspace /path/to/workspace
```

Der MCP-Server stellt Werkzeuge zum Auflisten, Lesen, Erstellen und vollständigen Schreiben von Projekten sowie zum Validieren, Hinzufügen oder Entfernen von Nodes und Verbinden von Nodes bereit. Dateipfade dürfen das konfigurierte Arbeitsverzeichnis nicht verlassen.

## Selektor-Picker

Browser-Aktions-Nodes und elementbasierte Wait-Nodes besitzen neben dem CSS-Selektor einen Fadenkreuz-Button. Der Director öffnet dafür auf dem gewählten Browser-Testbench-Target eine frische Session, führt alle Vorgänger im Catch-up aus und aktiviert anschließend die Elementauswahl. Das Element wird beim Zeigen hervorgehoben; der Klick selbst wird unterdrückt und als stabiler Selektor übernommen. Bevorzugt werden `data-testid`, eindeutige IDs und semantische Attribute, danach eindeutige Klassen und erst zuletzt ein struktureller Pfad. `Escape` oder der aktive Picker-Button brechen die Auswahl ab.

Das Projektformat ist unter [docs/project-format.md](docs/project-format.md) beschrieben.

Projektlizenz und Hinweise zu Abhängigkeiten werden als `LICENSE.txt` und `THIRD_PARTY_LICENSES.txt` mit dem npm-Paket ausgeliefert.

Der reproduzierbare Browser-Test erwartet die laufende Director-UI und eine lokale Browser-Testbench:

```bash
npm run dev
npx browser-testbench start --no-open
npm run test:ui
npm run test:remote
npm run test:recording
```

Der vollständige Release-Gate fasst Typprüfung, Unit-Tests, Produktions-Build und alle vier Browser-Prüfungen zusammen. Director und Browser Testbench müssen dafür wie oben beschrieben laufen:

```bash
npm run verify
```

Über `BROWSER_TESTBENCH_TARGET` kann für `test:ui` ein anderes Ziel gewählt werden, beispielsweise `firefox`. Der Remote-Test steuert standardmäßig die UI in Firefox und die Vorschau in Chrome; `DIRECTOR_CONTROLLER_TARGET` und `DIRECTOR_PREVIEW_TARGET` ändern diese Ziele.

`test:recording` führt über dieselbe UI einen kurzen Workflow in Chrome aus, lädt das Recording herunter und prüft Container, Videodimensionen und Dauer mit `ffprobe`. Mit `DIRECTOR_RECORDING_TARGET` kann derselbe Test auf ein anderes aufnahmefähiges Ziel gelegt werden.
