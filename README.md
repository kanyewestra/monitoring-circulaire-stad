# Monitoring Omgevingsprogramma Circulaire Stad

Een kleine webapp om het Omgevingsprogramma Circulaire Stad te monitoren. Per programmalijn staan maatregelen, subdoelen en indicatoren, met lijnen die laten zien wat waaraan bijdraagt.

Wat je in de app kunt invullen:

- **Bij een maatregel:** aannames, stand van uitvoering, evaluatie (wat is er gebeurd) en bijdrage en effect.
- **Bij een subdoel:** indicatoren toevoegen, wijzigen en verwijderen, metingen per indicator invoeren, en een duiding van de voortgang.
- **Historie:** elke wijziging wordt met tijd en naam vastgelegd.
- **Export:** de knoppen onderaan downloaden alles als Excel (een tabblad per onderdeel) of als JSON.

De app heeft geen externe afhankelijkheden. Hij gebruikt alleen Node, laadt geen externe fonts of scripts en stuurt niets naar derden.

## Bestanden

| Bestand | Inhoud |
|---|---|
| `server.js` | Webserver en API (Node 18+, geen npm-pakketten) |
| `public/index.html` | De app |
| `public/vendor/xlsx.full.min.js` | SheetJS 0.18.5 voor de Excel-export |
| `model.json` | Programmalijnen, transitiedoelen, subdoelen, maatregelen, activiteiten en aandachtspunten. Bij de eerste start worden hier ook de beginindicatoren uit gehaald. |
| `data/data.json` | Alle invoer: notities, indicatoren en metingen. Wordt bij de eerste start aangemaakt. |
| `data/historie.jsonl` | Logboek van alle wijzigingen, één regel per wijziging |

## Installeren op een Hetzner-server (Docker)

Je hebt nodig: een server met Docker en Docker Compose, en een (sub)domein waarvan het A-record naar het IP-adres van de server wijst.

```bash
# 1. Bestanden op de server zetten
scp -r monitoring-circulaire-stad gebruiker@server:~/
ssh gebruiker@server
cd ~/monitoring-circulaire-stad

# 2. Instellingen
cp .env.example .env
nano .env        # vul DOMEIN en APP_PASSWORD in

# 3. Starten
docker compose up -d --build
```

Caddy regelt automatisch een HTTPS-certificaat via Let's Encrypt. Daarvoor moeten poort 80 en 443 open staan in de Hetzner-firewall. Daarna staat de app op `https://jouw-domein`. Je logt in met `APP_USER` en `APP_PASSWORD`.

Draait er al een reverse proxy op de server (Caddy, nginx of Traefik)? Laat dan de `caddy`-service in `docker-compose.yml` weg. Zet bij de `app`-service `ports: ["127.0.0.1:3000:3000"]` en laat je eigen proxy naar `localhost:3000` wijzen.

### Zonder Docker, met pm2 (Node 18+)

```bash
git clone https://github.com/kanyewestra/monitoring-circulaire-stad
cd monitoring-circulaire-stad
cp .env.example .env && nano .env      # wachtwoord, PORT en HOST=127.0.0.1
pm2 start server.js --name circulair
pm2 save && pm2 startup                # automatisch starten na een reboot
```

`server.js` leest `.env` zelf. Zet er een reverse proxy met HTTPS voor (nginx, Apache of Caddy) die naar `127.0.0.1:PORT` wijst. Laat de app nooit zonder wachtwoord op internet staan.

Bijwerken naar een nieuwe versie: `git pull && pm2 restart circulair`. De map `data/` en `.env` blijven staan.

## Delen met collega's

Geef collega's de URL en het wachtwoord. Ze loggen in via de inlogpagina en blijven dan 30 dagen ingelogd op dat apparaat. Rechtsonder staat een link om uit te loggen. Iedereen met het wachtwoord kan lezen en wijzigen. Bij de historie gebruikt de app de naam die iemand rechtsboven invult.

Wachtwoord wijzigen: pas `APP_PASSWORD` aan in `.env` en herstart de app met `pm2 restart circulair`. Iedereen moet daarna opnieuw inloggen. Na 10 mislukte pogingen blokkeert de app inlogpogingen van dat adres een kwartier.

Scripts (R, curl) kunnen ook inloggen met basic auth: gebruikersnaam `APP_USER` en het wachtwoord.

## Back-up

Alle invoer staat in de map `data/`. Een dagelijkse back-up via cron:

```bash
0 3 * * * tar czf ~/backup/circulair-$(date +\%F).tgz -C ~/monitoring-circulaire-stad data
```

Daarnaast is de Excel-export een handige momentopname, bijvoorbeeld bij elke tweejaarlijkse monitoring.

## Inhoud aanpassen

Wijzigt het programma bij een actualisatie, bijvoorbeeld door nieuwe maatregelen of activiteiten? Pas dan `model.json` aan en herstart met `docker compose up -d --build`. De invoer in `data/` blijft bewaard, omdat die gekoppeld is aan de id's (zoals `BG-M3` en `OI-S2`). Houd die id's dus gelijk.

Velden per maatregel in `model.json`:

| Veld | Betekenis |
|---|---|
| `sub` | Subdoelen waaraan de maatregel bijdraagt. Een `*` achter het id betekent: afgeleide koppeling, getoond als stippellijn. |
| `viaDoel` | `true` als de maatregel alleen aan het transitiedoel is gekoppeld |
| `imp` | Verwachte impact: `z` = zeer veel, `a` = aanzienlijk, `b` = beperkt |
| `act` | Activiteiten als `[naam, periode]` |
| `aan` | Standaardtekst voor de aannames, zolang niemand die heeft aangepast |

Indicatoren en metingen beheer je in de app zelf. De `ind`-blokken in `model.json` worden alleen bij de allereerste start gebruikt.

## API

Handig als je de data later ook in R of Power BI wilt gebruiken. Gebruik dezelfde basic auth als in de browser.

| Methode | Pad | Doel |
|---|---|---|
| GET | `/api/model` | Programma-inhoud |
| GET | `/api/data` | Alle invoer |
| GET | `/api/historie?item=BG-M3` | Wijzigingen per onderdeel |
| PATCH | `/api/notities/:id` | Velden `aannames`, `status`, `evaluatie`, `effect`, `toelichting`, `door` |
| PUT / DELETE | `/api/indicatoren/:id` | Indicator aanmaken, wijzigen of verwijderen |
| POST | `/api/indicatoren/:id/metingen` | Meting toevoegen |
| PUT / DELETE | `/api/indicatoren/:id/metingen/:mid` | Meting wijzigen of verwijderen |

Voorbeeld in R:

```r
library(httr2)
d <- request("https://jouw-domein/api/data") |>
  req_auth_basic("circulair", Sys.getenv("APP_PASSWORD")) |>
  req_perform() |>
  resp_body_json()
```
