# WielerSchema (eerste versie)

Een openbare webapp waarin wielrenners een trainingsschema laten maken door een AI-coach (Groq). De coach stelt eerst vragen, maakt een schema voor de beschikbare dagen en stuurt elke week bij op basis van de terugmelding.

Alles draait op Cloudflare in één project: de Worker (`src/worker.js`) levert zowel de website (`public/`) als de API, met D1 als database.

## Wat kan het nu

- Account maken en inloggen (gebruikersnaam en wachtwoord, geen e-mail nodig).
- Publieke startpagina met uitleg en aparte keuzes om in te loggen of een account te maken.
- Intakewizard in drie stappen: doel, geboortedatum, niveau en wedstrijden; trainingstijd en dagen; meetapparatuur, beperkingen en overige trainingservaring.
- Doel en wedstrijden (maximaal 4) mogen tot 20 weken vooruit. Een schema duurt maximaal 16 weken (8 weken zonder datum); wedstrijden binnen het schema komen in de planning.
- Analyse-tab: fitness, vermoeidheid, vorm, gereedheid, belastingsverhouding, prestatiegrafiek en nachtgegevens. Alles wordt zonder AI berekend. Nachtgegevens vereisen een Intervals.icu-koppeling.
- Eenvoudige weergave (Account): haalt ingewikkelde cijfers weg, toont zones in gewone woorden en laat de coach in eenvoudige taal schrijven. Staat standaard aan voor renners jonger dan 16.
- Voor jeugdrenners van 12–17 houdt de coach rekening met leeftijd, herstel en plezier.
- Intake: doel, datum, niveau, uren per week, beschikbare dagen, ervaring en beperkingen. Een geboortedatum is verplicht; alleen de berekende leeftijd gaat naar Groq.
- Keuze uit vermogensmeter, hartslagmeter, beide of geen van beide. Vijf hartslagzones worden berekend uit je maximale hartslag. Voor vermogen vul je je FTP in en kies je vijf of zeven zones; de standaardgrenzen volgen FTP-percentages en kunnen worden aangepast.
- Trainingsintensiteit wordt weergegeven met de ingestelde hartslag- en/of vermogenszones.
- Intervals.icu kan via OAuth worden gekoppeld. De app haalt recente activiteiten en wellnessgegevens op, waaronder slaap, HRV en rusthartslag, en geeft die als context aan de coach. Garmin en Wahoo zijn alleen voorbereid.
- AI stelt maximaal 5 vervolgvragen in een chatweergave, maakt een overzicht van alle weken en werkt week 1 uit.
- Eén doorlopende, WhatsApp-achtige chat met de coach; de coach krijgt de datum en de training van vandaag uit je actuele schema mee, zonder dat je week of dag hoeft te kiezen.
- Pas trainingsdagen ook zelf aan: trainingstype, duur, zone, titel, beschrijving en optionele intervalblokken. Handmatige wijzigingen worden direct opgeslagen; de beschikbare zones, weeklimiet en gezondheidswaarschuwingen blijven gelden.
- Open een trainingsdag voor details en handmatig aanpassen. Het detailvenster toont een zoneprofiel met warming-up, intervallen en herstel waar die blokken beschikbaar zijn; anders is de opbouw nadrukkelijk als schematisch gemarkeerd.
- Een gelijkmatige training wordt als één zone getoond; intervalblokken houden hun eigen zonehoogte. Deel of download een volledige trainingsweek als PNG-afbeelding.
- De TrainingPeaks-import is verwijderd. Een optionele prompt om een training in TrainingPeaks AI te laten opbouwen is nog beschikbaar vanuit de trainingsdetails en neemt de actuele duur, zones en intervalblokken mee.
- Na afloop vraagt de coach in de chat hoe je week ging; op basis van je antwoord maakt die de volgende week.
- FIT-activiteiten kunnen handmatig worden geïmporteerd, bekeken met grafieken en routekaart, en krijgen na ongeveer tien seconden persoonlijke AI-feedback van de coach. Automatische trainings- of herstelmetrics via externe koppelingen zijn nog niet beschikbaar zolang die koppelingen niet actief zijn.
- Elke voorgestelde wijziging aan een training verschijnt eerst ter beoordeling en wordt pas na bevestiging toegepast.
- Schema van een week downloaden als agenda (.ics).
- Onder Account kun je je geboortedatum, meetapparatuur en trainingszones aanpassen, je gebruikersnaam of wachtwoord wijzigen, je gegevens downloaden en je account verwijderen.
- Privacyverklaring.

Nog niet: wachtwoord vergeten (er is geen e-mail), automatische koppelingen met Garmin, Strava of Wahoo. Intervals.icu vereist OAuth-secrets en een goedgekeurde app.

## Veiligheid en vangrails

- De AI schrijft nooit rechtstreeks naar de database: de worker controleert elk antwoord. Trainingen en wijzigingen worden opgeschoond en de weektotalen begrensd op het maximale aantal uren; een concreet genoemd evenement kan op de opgegeven dag worden gezet.
- Meldt iemand klachten, dan wordt de volgende week hard begrensd op de helft en krijgt de gebruiker een korte melding dat de week extra licht en op herstel gericht is.
- Wachtwoorden worden met PBKDF2 versleuteld, sessies zitten in een beveiligde cookie, schrijfacties van andere websites worden geweigerd, en er zijn limieten voor registreren, inloggen en AI-gebruik per gebruiker en per dag.
- De app staat maximaal 15 AI-aanvragen per account per dag toe en 100 aanvragen totaal per dag (bovenin `src/worker.js`). Dat past bij de gratis Groq-laag (ongeveer 200.000 tokens per dag per model); verhoog de limieten pas na een betaald Groq-account. Een eigen account kan onbeperkt via het secret `AI_UNLIMITED_USER_IDS` (gebruikers-id's, komma-gescheiden), maar de gezamenlijke limiet blijft gelden.
- IP-adressen worden nooit zelf opgeslagen, alleen een dagelijks wisselende hash voor de limieten.
- Coachberichten worden bewaard (maximaal 100 per account). De chat gebruikt recente berichten als gesprekscontext; de server controleert elke voorgestelde aanpassing voordat die wordt opgeslagen.
- De opgegeven leeftijd wordt bij de intake gevalideerd; de coach krijgt voor sporters jonger dan 18 extra, voorzichtige instructies. De openbare inzet voor minderjarigen en de privacy-/toestemmingseisen moeten vóór lancering apart juridisch worden beoordeeld; deze versie vraagt geen afzonderlijke ouderbevestiging.

## Uitrollen op Cloudflare

De code bevat worker-tests en een rooktest die de website tegen de worker draait (nagebootste database en AI). Test na het uitrollen een volledig schema met je Groq-sleutel.

### Voorbereiden (in het Cloudflare-dashboard)
1. **Database maken:** Storage & databases, D1, Create database, naam `wielerschema`. Kopieer het **Database ID**.
2. Zet dat ID in `wrangler.toml` bij `database_id`.

### Route A: via GitHub (aanbevolen, geen programma's nodig)
1. Zet deze map in een nieuwe GitHub-repo (bijvoorbeeld `wielerschema`).
2. Cloudflare, Workers & Pages, Create, **Import a repository**, kies de repo. Laat het buildcommando leeg; het deploy-commando is `npx wrangler deploy`.
3. Na de eerste deploy: Settings, Variables and Secrets, voeg het secret **`GROQ_API_KEY`** toe (dezelfde sleutel als bij ExcuusExpert mag).
4. Open het adres van de worker (eindigt op `.workers.dev`). De site draait ook op een eigen domein, https://wielerschema.me (in te stellen bij de worker onder Settings, Domains & Routes).

### Intervals.icu OAuth
Maak eerst een goedgekeurde OAuth-app aan via Intervals.icu en gebruik als redirect-URL:
`https://wielerschema.me/api/intervals/callback` (of het workers.dev-adres; `INTERVALS_REDIRECT_URI` moet exact dezelfde waarde hebben).
Stel daarna deze secrets in:

```
npx wrangler secret put INTERVALS_CLIENT_ID
npx wrangler secret put INTERVALS_CLIENT_SECRET
npx wrangler secret put INTERVALS_REDIRECT_URI
npx wrangler secret put INTERVALS_TOKEN_KEY
```

`INTERVALS_TOKEN_KEY` moet 32 willekeurige bytes als 64 hex-tekens bevatten. De app vraagt alleen `ACTIVITY:READ` en `WELLNESS:READ`, haalt de laatste 30 dagen op en gebruikt recente activiteiten en slaap-/herstelgegevens als context voor de coach.

### Route B: met wrangler op je computer (Node.js nodig)
```
npx wrangler login
npx wrangler secret put GROQ_API_KEY
npx wrangler deploy
```

De tabellen maakt de worker zelf aan bij het eerste verzoek.

### Lokaal testen
```
npm test                    # alle tests
node test/frontend-smoke.mjs   # rooktest van de website
```

## Eerst nog invullen of nakijken

1. **Contactgegevens in `public/privacy.html`:** staat nu op hessel@wielerschema.me. Controleer dat dit adres bereikbaar is voordat je de site openbaar maakt.
2. **Privacy en AVG.** De app verwerkt trainingsgegevens en mogelijk gezondheidsinformatie (klachten, beperkingen) van anderen en stuurt die naar Groq in de VS. Ik ben geen jurist, dus laat de privacyverklaring en je verplichtingen (zoals verwerkersafspraken met Cloudflare en Groq) nakijken, vooral omdat het openbaar is. Houd de invoer beperkt: velden voor klachten zijn optioneel.
3. **Kosten en limieten van Groq.** Een chatbericht kost ongeveer 4.000 tot 5.000 tokens en een schema iets meer. De app begrenst op 15 AI-aanvragen per gebruiker per dag en 100 voor iedereen samen (zie bovenin `src/worker.js`). Controleer de limieten op console.groq.com/settings/limits.
4. **Wachtwoord vergeten.** Zonder e-mail kan dat niet. Een goede volgende stap is inloggen met een e-maillink (via een dienst zoals Resend), ook handig voor eventuele meldingen.
5. **Opmaak en teksten** zijn een eerste opzet. Kijk of de toon en de vragen van de coach bij je doelgroep passen.

## Mogelijke vervolgstappen

- Officiële Strava-, Garmin- of Wahoo-koppelingen onderzoeken zodra toegang en API-voorwaarden duidelijk zijn.
- Plan voor meer dan één doel, of een weekoverzicht per e-mail.