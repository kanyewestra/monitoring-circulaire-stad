# Monitoring Omgevingsprogramma Circulaire Stad

Een kleine webapp om het Omgevingsprogramma Circulaire Stad te monitoren. Per programmalijn staan maatregelen, subdoelen en indicatoren, met lijnen die laten zien wat waaraan bijdraagt.

Wat je in de app kunt invullen:

- **Per activiteit uit het uitvoeringsprogramma:** aannames, stand van uitvoering, evaluatie (wat is er gebeurd en welke input is er geweest), resultaten (tastbare opbrengst) en bijdrage aan de gekoppelde subdoelen.
- **Per maatregel als geheel:** aannames, evaluatie en bijdrage en effect.
- Bij elke activiteit staan ook de omschrijving en de dekking uit het uitvoeringsprogramma.
- **Per subdoel:** indicatoren toevoegen en bewerken, en een duiding van de voortgang. Een indicator kan categorieën hebben, bijvoorbeeld banen per R-strategie of weggooigedrag per productgroep. Per periode vul je dan een waarde per categorie in. Tellen de categorieën op tot een totaal, dan toont de app gestapelde staven met het totaal; anders gegroepeerde staven of lijnen. Een doellijn kan als stippellijn in de grafiek.
- **Paginaweergave:** klik op de titel in het rechterpaneel (of op "Open als pagina") voor een volledige pagina van een maatregel of subdoel, met een eigen adres zoals `#bg/BG-M3` en een knop om af te drukken. Met "Terug" of de terugknop van de browser kom je in het overzicht.
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
| `sub` | Subdoelen waaraan de maatregel bijdraagt |
| `randvoorwaarde` | `true` voor maatregelen zonder koppeling met subdoelen |
| `viaDoel` | `true` als de maatregel alleen indirect aan het transitiedoel is gekoppeld (stippellijn) |
| `imp` | Verwachte impact: `z` = zeer veel, `a` = aanzienlijk, `b` = beperkt |
| `act` | Activiteiten als `{ "id": "BG-M3-A3-1", "naam": "...", "periode": "...", "omschrijving": "...", "dekking": "..." }`. Het id koppelt de invoer per activiteit; houd het gelijk. |
| `aan` | Standaardtekst voor de aannames, zolang niemand die heeft aangepast |

Indicatoren en metingen beheer je in de app zelf. De `ind`-blokken in `model.json` worden alleen bij de allereerste start gebruikt.

Bij de overstap naar indicatoren met categorieën (dataversie 2) zet de server bestaande gegevens bij de eerste start automatisch om. Een kopie van de oude gegevens staat dan in `data/data.json.v1-backup`.

## API

Handig als je de data later ook in R of Power BI wilt gebruiken. Gebruik dezelfde basic auth als in de browser.

| Methode | Pad | Doel |
|---|---|---|
| GET | `/api/model` | Programma-inhoud |
| GET | `/api/data` | Alle invoer |
| GET | `/api/historie?item=BG-M3` | Wijzigingen per onderdeel |
| PATCH | `/api/notities/:id` | Voor een maatregel, activiteit of subdoel: velden `aannames`, `status`, `evaluatie`, `resultaten`, `effect`, `toelichting`, `door` |
| PUT | `/api/indicatoren/:id` | Indicator aanmaken of volledig vervangen, inclusief `categorieen`, `optelbaar`, `doel` en `metingen` (`[{ periode, waarden: { categorie: getal }, toelichting }]`; zonder categorieën is de sleutel `""`) |
| DELETE | `/api/indicatoren/:id` | Indicator verwijderen |

Voorbeeld in R:

```r
library(httr2)
d <- request("https://jouw-domein/api/data") |>
  req_auth_basic("circulair", Sys.getenv("APP_PASSWORD")) |>
  req_perform() |>
  resp_body_json()
```
