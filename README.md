# Looping Larry ✈️🐔

Ein Multiplayer-Browserspiel nach dem Vorbild des Brettspiel-Klassikers *Looping Louie* –
mit Node.js, three.js und eingebautem Voice- und Videochat (WebRTC), damit man die Gesichter
der Gegner sieht, wenn Larry ihre Hühner abräumt.

## Schnellstart

```bash
npm install
npm start
```

Dann <http://localhost:3000> öffnen, Namen eingeben und **Losfliegen** klicken. Es gibt genau
einen Hof: Alle, die die Seite öffnen, spielen zusammen.

## Spielerzahl

Vor jeder Runde wählt der Host (wer zuerst da war) im Lobby-Fenster **2, 3, 4 oder 5 Spieler**.
Der Hof ordnet die Stationen dann gleichmäßig um den Turm an.

- Die Runde startet erst, wenn alle Plätze besetzt sind. Freie Plätze kann der Host mit Bots füllen.
- Sind mehr Leute da als Plätze, schauen die übrigen zu (mit Video und Ton) und rücken nach, sobald ein Platz frei wird.
- Wer mitten in einer Runde dazukommt, spielt ab der nächsten Runde mit.

## Spielablauf

1. Der Host startet die Runde. Larry steht **senkrecht** auf dem Turm und dreht sich schon.
2. Countdown **3 – 2 – 1 – LOS!** – das Flugzeug kippt aus der Senkrechten und stürzt sich auf den Hof.
3. Kommt Larry an deiner Station vorbei, lässt du die **Leertaste** (oder Maustaste / Enter / ↑ / W) los.
   Deine Wippe schnellt hoch und schleudert das Flugzeug in die Luft.
4. Fliegt Larry tief über deine Hühner, fällt eins vom Stapel. Ohne Hühner bist du raus.
5. Die letzte Farm mit mindestens einem Huhn gewinnt die Runde.

### Flitschen: halten = aufladen

Solange du die Taste hältst, spannt sich deine Wippe (Anzeige am Hebel). Beim **Loslassen** schnellt
sie hoch – je länger du gehalten hast, desto weiter fliegt Larry. Nach **1 Sekunde** ist die Wippe
voll gespannt und schnellt **von selbst** los; aufladen und abwarten geht also nicht. Wer volle Kraft
will, muss eine Sekunde vorher anfangen.

| Ladung | Wirkung (bei 4 Spielern) |
| --- | --- |
| Stupser (kurz tippen) | kleiner Hüpfer – landet kurz vor dem nächsten Spieler |
| halbe Ladung | landet auf den Hühnern des nächsten Spielers |
| volle Ladung | hoher Bogen über den nächsten Spieler hinweg |
| **volle Ladung + perfektes Timing** | **LOOPING** über den Turm – landet etwa drei Stationen weiter |

Das Timing (wo in der Trefferzone der Hebel Larry erwischt) kostet bei schlechten Treffern etwas Kraft
und entscheidet bei voller Ladung über den Looping.

Der Motor wird im Lauf einer Runde schneller. Mit `1`–`4` schickst du Emotes (👍 😂 😱 😡),
`M` schaltet das Mikro, `V` die Kamera.

## Physik

Die Simulation (`shared/physics.js`) läuft deterministisch mit 120 Hz auf Server *und* Client:

- Der Motor dreht den Arm um die senkrechte Achse (Azimut θ, Winkelgeschwindigkeit ω, steigt langsam an).
- Der Arm ist am Turm oben aufgehängt und kann frei nach oben/unten schwingen (Elevation φ).
  Bewegungsgleichung eines angetriebenen, gelenkig gelagerten Arms (Lagrange):
  `φ'' = −cos φ · (G + C·ω²·sin φ) − D·φ'` – Schwerkraft zieht das Flugzeug auf den Tisch,
  die Fliehkraft zieht den Arm Richtung Horizontale, und die Senkrechte ist ein instabiles
  Gleichgewicht (deshalb kippt Larry beim Start).
- Schwingt der Arm über die Senkrechte hinaus, wird er auf die andere Turmseite gespiegelt – ein echter Looping.
- Tischkontakt mit Rückprall, Hühner-Treffer geben dem Flugzeug einen kleinen Stoß nach oben.
- Die Wippen sind zeitgesteuerte Hebel; ein Treffer beim Hochschnellen ergibt einen Kick,
  dessen Stärke von der Position in der Trefferzone abhängt. Eine hochgehaltene Wippe blockt.

## Netzwerk

- **Server-autoritativ mit Rollback:** Jeder Hebeldruck wird mit der (synchronisierten)
  Serverzeit des Clients geschickt. Der Server spult bis zu 250 ms zurück, wendet den Druck
  zum richtigen Zeitpunkt an und rechnet neu – wer rechtzeitig drückt, trifft auch bei Lag.
- **Client-Prediction:** Der Client rechnet den letzten Snapshot mit derselben Physik auf die
  aktuelle Serverzeit hoch, inklusive eigener, noch unbestätigter Hebeldrücke. Korrekturen
  werden weich ausgeblendet.
- **Voice/Video:** WebRTC-Mesh (jeder mit jedem, „perfect negotiation“), Signalisierung über
  denselben WebSocket. Die Videokacheln sitzen so um den Tisch, wie die Spieler am Brett sitzen.

## Online spielen (Internet)

Kamera und Mikrofon funktionieren im Browser nur über **HTTPS** (oder `localhost`). Möglichkeiten:

- Tunnel, z. B. `cloudflared tunnel --url http://localhost:3000` oder `ngrok http 3000`, und den HTTPS-Link teilen.
- Eigenes Zertifikat: `SSL_KEY=key.pem SSL_CERT=cert.pem npm start`.
- Hinter einem Reverse-Proxy (nginx/Caddy) mit WebSocket-Weiterleitung für `/ws`.

Für Spieler hinter strikten NATs wird ggf. ein TURN-Server benötigt:

```bash
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]' npm start
```

Weitere Umgebungsvariablen: `PORT` (Standard 3000, auch im Docker-Image).

## Deployment mit Dokku

Das Repo enthält ein `Dockerfile`; Dokku baut damit automatisch. Auf dem Server:

```bash
dokku apps:create looping-larry
dokku domains:set looping-larry larry.example.com
dokku ports:set looping-larry http:80:3000
dokku config:set looping-larry PORT=3000   # App-Port und Mapping fest übereinander
# HTTPS ist Pflicht für Kamera/Mikro:
dokku letsencrypt:set looping-larry email du@example.com
dokku letsencrypt:enable looping-larry
# Optional: eigener TURN-Server
dokku config:set looping-larry ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}]'
```

Lokal:

```bash
git init && git add . && git commit -m "Looping Larry"
git remote add dokku dokku@dein-server:looping-larry
git push dokku main
```

Hinweise:

- **Genau eine Instanz:** Räume und Spielzustand liegen im Speicher des Prozesses. Nicht auf mehrere
  Container skalieren (`app.json` setzt `web=1`).
- WebSockets laufen über `/ws`; Dokkus nginx leitet Upgrades standardmäßig weiter.
- Bei einem Redeploy werden laufende Runden beendet; die Clients laden automatisch neu.
- Healthcheck: `GET /health` (in `app.json` und im Docker-`HEALTHCHECK`).

Lokal testen: `docker build -t looping-larry . && docker run --rm -p 3000:3000 looping-larry`

## Entwicklung

```bash
npm run dev                          # Server mit Auto-Reload
npm test                             # 30 Bot-Runden offline simulieren (Balance-Check)
npm run tune                         # Flugkurven für verschiedene Kick-Stärken ausgeben
node tools/netclient-test.js 80      # Headless-Client mit 80 ms Latenz gegen einen Bot (Server muss laufen)
```

Struktur:

```
server/index.js    HTTP(S)-Server, WebSocket, Räume
server/room.js     Plätze, Bots, Spielablauf, Rollback, Signalisierung
shared/physics.js  deterministische Simulation (Server + Client)
public/js/         three.js-Szene, Modelle, HUD, Netz, Prediction, WebRTC, Sound
```

Desktop-only – für Tastatur/Maus und große Bildschirme gebaut.
