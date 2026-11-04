# WielerSchema (eerste versie)

Een openbare webapp waarin wielrenners een trainingsschema laten maken door een AI-coach (Groq). De coach stelt eerst vragen, maakt een schema voor de beschikbare dagen en stuurt elke week bij op basis van de terugmelding.

Alles draait op Cloudflare in één project: de Worker (`src/worker.js`) levert zowel de website (`public/`) als de API, met D1 als database.

## Wat kan het nu

- Account maken en inloggen (gebruikersnaam en wachtwoord, geen e-mail nodig).
- Publieke startpagina met uitleg en aparte keuzes om in te loggen of een account te maken.
- Intakewizard in drie stappen: doel, geboortedatum en niveau; trainingstijd en dagen; meetapparatuur, beperkingen en overige trainingservaring.
- Jeugdrenners van 12–17 krijgen terughoudender coachinstructies en een zichtbare oproep om een ouder/verzorger en jeugdtrainer mee te laten kijken.
- Intake: doel, datum, niveau, uren per week, beschikbare dagen, ervaring en beperkingen. Een geboortedatum is verplicht; alleen de berekende leeftijd gaat naar Groq.
- Keuze uit vermogensmeter, hartslagmeter, beide of geen van beide. Voor hartslagtraining vul je maximale en drempelhartslag in; voor vermogen je FTP. Per gekozen meetmethode kun je de zes zonegrenzen aanpassen. De voorgestelde startzones zijn schattingen op basis van gangbare percentages, geen medisch advies of vervanging van een test.
- Een aparte activiteitenpagina en een voorbereide Garmin-koppelingspagina. Garmin API-toegang en automatische synchronisatie zijn nog niet beschikbaar.
- AI stelt maximaal 5 vervolgvragen in een chatweergave, maakt een overzicht van alle weken en werkt week 1 uit.
- Eén doorlopende, WhatsApp-achtige chat met de coach; de coach gebruikt je schema zonder dat je week of dag hoeft te kiezen.
- Pas trainingsdagen ook zelf aan: trainingstype, duur, zone, titel en beschrijving. Handmatige wijzigingen worden direct opgeslagen; de weeklimiet en gezondheidswaarschuwingen blijven gelden.
- Open een trainingsdag voor details en handmatig aanpassen. Een optionele TrainingPeaks AI-prompt kan vanuit het detailvenster worden gekopieerd; er worden geen TrainingPeaks-gegevens geïmporteerd.
- Na afloop vraagt de coach in de chat hoe je week ging; op basis van je antwoord maakt die de volgende week.
- Dashboard met analyse van geïmporteerde trainingsweken en handmatige dagelijkse herstelmetingen (rusthartslag, slaap, Body Battery, stress en HRV; maximaal één jaar terug).
- De coach kan mogelijke veranderingen in herstelwaarden bespreken, maar stelt geen medische diagnose. Elke voorgestelde wijziging aan een training verschijnt eerst ter beoordeling en wordt pas na bevestiging toegepast.
- Schema van een week downloaden als agenda (.ics).
- Onder Account kun je je geboortedatum, meetapparatuur en trainingszones aanpassen, je gebruikersnaam of wachtwoord wijzigen, je gegevens downloaden en je account verwijderen.
- Privacyverklaring.

Nog niet: wachtwoord vergeten (er is geen e-mail), automatische koppelingen met Garmin, Strava of Wahoo. De Garmin-koppelingspagina is alleen een voorbereiding; er is nog geen login of synchronisatie.

## Veiligheid en vangrails

- De AI schrijft nooit rechtstreeks naar de database: de worker controleert elk antwoord. Trainingen en wijzigingen worden opgeschoond en de weektotalen begrensd op het maximale aantal uren; een concreet genoemd evenement kan op de opgegeven dag worden gezet.
- Meldt iemand klachten, dan wordt de volgende week hard begrensd op de helft, met een vaste waarschuwing om een arts of fysiotherapeut te raadplegen (dat staat los van wat de AI zegt).
- Wachtwoorden worden met PBKDF2 versleuteld, sessies zitten in een beveiligde cookie, schrijfacties van andere websites worden geweigerd, en er zijn limieten voor registreren, inloggen en AI-gebruik per gebruiker en per dag.
- De app staat maximaal 100 AI-aanvragen per account per dag toe en 2000 aanvragen totaal per dag. Dit is ruim voor een kleine groep, maar er blijft een gezamenlijke noodlimiet tegen misbruik en onverwachte kosten.
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
4. Open het adres van de worker (eindigt op `.workers.dev`).

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

1. **Contactgegevens in `public/privacy.html`.** Zoek `VUL_HIER_JE_CONTACTGEGEVENS_IN` en vervang dat. Zonder dit mag je de site niet openbaar maken.
2. **Privacy en AVG.** De app verwerkt trainingsgegevens en mogelijk gezondheidsinformatie (klachten, beperkingen) van anderen en stuurt die naar Groq in de VS. Ik ben geen jurist, dus laat de privacyverklaring en je verplichtingen (zoals verwerkersafspraken met Cloudflare en Groq) nakijken, vooral omdat het openbaar is. Houd de invoer beperkt: velden voor klachten zijn optioneel.
3. **Kosten en limieten van Groq.** Een schema is een flinke aanvraag. De app begrenst op 100 AI-aanvragen per gebruiker per dag en 2000 voor iedereen samen (zie bovenin `src/worker.js`). Controleer Groq-kosten en pas deze limieten aan als dat nodig is.
4. **Wachtwoord vergeten.** Zonder e-mail kan dat niet. Een goede volgende stap is inloggen met een e-maillink (via een dienst zoals Resend), ook handig voor eventuele meldingen.
5. **Opmaak en teksten** zijn een eerste opzet. Kijk of de toon en de vragen van de coach bij je doelgroep passen.

## Mogelijke vervolgstappen

- Officiële Strava-, Garmin- of Wahoo-koppelingen onderzoeken zodra toegang en API-voorwaarden duidelijk zijn.
- Plan voor meer dan één doel, of een weekoverzicht per e-mail.
