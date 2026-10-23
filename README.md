# Universal Website

Weby, kterými se listuje jako knihou. Obsah píšete v Google Sheets, obrázky dáváte do složky na Disku, a jedním kliknutím je web online na Cloudflare.

## Jak to celé funguje

```
Řídicí tabulka (vaše)            Složka klienta na Disku
┌──────────────────────┐          ┌───────────────────────────┐
│ klient │ složka │ …  │ ───────▶ │ Klient – web  (tabulka)   │
│ studio │ odkaz  │ …  │          │ media/        (obrázky)   │
└──────────────────────┘          └───────────────────────────┘
          │                                   │
          │ Weby → Publikovat                 │ ▶ Publikovat web
          ▼                                   ▼
   GitHub Actions: přečte tabulku, zpracuje obrázky, sestaví stránky
          │
          ▼
   Cloudflare Pages: web je online (vlastní doména, celosvětově rychlý)
```

- **Řídicí tabulka**: jeden řádek = jeden web. Sem zapisuje i stav posledního publikování.
- **Tabulka klienta**: listy `pages`, `texts`, `media`, `items`, `embeds`, `site`, `styles`. Návod je přímo v ní, v listu „Návod“.
- **Sestavení** probíhá jen při kliknutí na Publikovat. Návštěvník pak dostává hotové soubory, nic se nenačítá z Google.
- **Obrázky** se zmenší do několika velikostí a převedou do AVIF a WebP. Zpracovaný obrázek si sestavení pamatuje a podruhé ho nedělá.

## Co je v repozitáři

| Složka | Co v ní je |
|---|---|
| `src/` | Sestavení webu: čtení tabulky, obsahový jazyk, obrázky, vykreslení stránek, nahrání na Cloudflare |
| `src/client/` | Engine otáčení stránek a vzhled, které běží v prohlížeči návštěvníka |
| `apps-script/` | Skript pro řídicí tabulku (menu Weby a odkaz Publikovat) |
| `templates/` | Šablona tabulky klienta a řídicí tabulky (.xlsx k importu do Google Sheets) |
| `.github/workflows/` | Automatické publikování na GitHubu |
| `examples/media/` | Ukázkové obrázky pro místní zkoušku |
| `examples/fyzioterapie/` | Ukázkový web fyzioterapeutky: vyplněná tabulka a zástupné obrázky |
| `NAVOD-NASTAVENI.md` | Jednorázové nastavení účtů krok po kroku |

## Příkazy (pro vývoj)

```bash
npm install
npm run local                       # sestaví ukázkový web z templates/ do dist/demo
npm test                            # testy obsahového jazyka
node src/cli.js build --local examples/fyzioterapie/ladne-web.xlsx --media examples/fyzioterapie/media --out dist/ladne
node src/cli.js publish --client X  # publikuje klienta X (potřebuje přístupy, viz návod)
node src/cli.js check --client X    # jen kontrola, nic nenahraje
```

## Přístupy (tajné hodnoty v GitHubu → Settings → Secrets → Actions)

| Název | Co to je |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | Klíč robota (JSON) z Google Cloud |
| `CONTROL_SHEET_ID` | Id řídicí tabulky (část odkazu mezi `/d/` a `/edit`) |
| `CLOUDFLARE_API_TOKEN` | Token Cloudflare s oprávněním Cloudflare Pages: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Id účtu Cloudflare |
