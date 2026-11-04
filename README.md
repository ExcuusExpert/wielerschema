# WielerSchema (eerste versie)

Een openbare webapp waarin wielrenners een trainingsschema laten maken door een AI-coach (Groq). De coach stelt eerst vragen, maakt een schema voor de beschikbare dagen en stuurt elke week bij op basis van de terugmelding.

Alles draait op Cloudflare in één project: de Worker (`src/worker.js`) levert zowel de website (`public/`) als de API, met D1 als database.

## Wat kan het nu

- Account maken en inloggen (gebruikersnaam en wachtwoord, geen e-mail nodig).
- Intake: doel, datum, niveau, uren per week, beschikbare dagen, optioneel FTP, ervaring en beperkingen.
- Keuze uit vermogensmeter, hartslagmeter, beide of geen van beide.
- TrainingPeaks-exporten (ZIP met FIT/CSV) importeren; gegevens ouder dan 365 dagen worden genegeerd. Alleen weektotalen en meetwaardegemiddelden worden bewaard; de ruwe bestanden niet.
- AI stelt maximaal 5 vervolgvragen in een chatweergave, maakt een overzicht van alle weken en werkt week 1 uit.
- Eén doorlopende chat met de coach, snel bereikbaar via het menu. Je kunt algemene vragen stellen of een week en training als context kiezen; alleen die workout kan worden aangepast.
- Kopieer per workout een TrainingPeaks AI-prompt met passende hartslag-, vermogens- of RPE-doelen. Dit is geen automatische koppeling met TrainingPeaks.
- Wekelijkse check-in (hoeveel gedaan, hoe voelde het, klachten) waarna de volgende week wordt gemaakt.
- Schema van een week downloaden als agenda (.ics).
- Eigen gegevens downloaden en account verwijderen.
- Privacyverklaring.

Nog niet: wachtwoord vergeten (er is geen e-mail), automatische koppeling met Garmin of TrainingPeaks. Ritten kun je wel handmatig via TrainingPeaks-exportbestanden importeren.

## Veiligheid en vangrails

- De AI mag nooit rechtstreeks wat opslaan: de worker controleert elk antwoord. Trainingen komen alleen op de gekozen dagen, de weektotalen worden begrensd op het maximale aantal uren, en teksten worden opgeschoond.
- Meldt iemand klachten, dan wordt de volgende week hard begrensd op de helft, met een vaste waarschuwing om een arts of fysiotherapeut te raadplegen (dat staat los van wat de AI zegt).
- Wachtwoorden worden met PBKDF2 versleuteld, sessies zitten in een beveiligde cookie, schrijfacties van andere websites worden geweigerd, en er zijn limieten voor registreren, inloggen en AI-gebruik per gebruiker en per dag.
- IP-adressen worden nooit zelf opgeslagen, alleen een dagelijks wisselende hash voor de limieten.
- ZIP-uploads zijn beperkt tot 20 MB en worden alleen in het geheugen verwerkt. Geïmporteerde samenvattingen kunnen eigen meetwaarden bevatten en worden, net als de intake, naar Groq gestuurd om het schema te maken.
- Coachberichten worden met hun week- en trainingscontext bewaard (maximaal 100 berichten per account). De chat gebruikt recente berichten als gesprekscontext; de server controleert elke voorgestelde aanpassing voordat die wordt opgeslagen.

## Uitrollen op Cloudflare

De code bevat worker-tests en een rooktest die de website tegen de worker draait (nagebootste database en AI). Controleer na het uitrollen zelf de import met een TrainingPeaks-export en test een volledig schema met je Groq-sleutel.

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
3. **Kosten en limieten van Groq.** Een schema is een flinke aanvraag. De app begrenst per gebruiker op 12 AI-aanvragen per dag en 1500 voor iedereen samen (zie bovenin `src/worker.js`). Pas die aan op wat je Groq-account aankan.
4. **Wachtwoord vergeten.** Zonder e-mail kan dat niet. Een goede volgende stap is inloggen met een e-maillink (via een dienst zoals Resend), ook handig voor eventuele meldingen.
5. **Opmaak en teksten** zijn een eerste opzet. Kijk of de toon en de vragen van de coach bij je doelgroep passen.

## Mogelijke vervolgstappen

- Garmin Connect Developer Program aanvragen (gratis, alleen zakelijk) voor schema's naar het apparaat en ritten terug.
- Ritten inlezen via een .fit-bestand, zodat de coach echte data gebruikt.
- Plan voor meer dan één doel, of een weekoverzicht per e-mail.
