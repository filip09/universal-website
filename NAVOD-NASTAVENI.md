# Nastavení krok po kroku

Dělá se jednou. Počítejte asi s hodinou. Každý krok končí tím, co si máte poznamenat. Hodnoty označené 🔑 jsou tajné, nikam je neposílejte.

---

## 1. GitHub: domov kódu

1. Přihlaste se na github.com (nebo si založte účet).
2. Vpravo nahoře **+ → New repository**. Název `universal-website`, zvolte **Private**, nic dalšího nezaškrtávejte. **Create repository**.
3. Kód do repozitáře nahraju já: pošlete mi odkaz na repozitář a já ho připojím a nahraju.

📝 Poznamenat: `jmeno/universal-website` (adresa repozitáře bez github.com/)

## 2. Google Cloud: robot, který čte tabulky

1. Otevřete console.cloud.google.com, vlevo nahoře **Vybrat projekt → Nový projekt**, název `universal-website`, **Vytvořit**.
2. Nahoře do hledání napište **Google Drive API** → **Povolit**. Totéž pro **Google Sheets API**.
3. Hledání: **Service accounts** (Účty služeb) → **Vytvořit účet služby**. Název `web-robot` → **Hotovo** (role nepřidávejte).
4. Klikněte na nový účet → záložka **Klíče** → **Přidat klíč → Vytvořit nový klíč → JSON**. Stáhne se soubor.

📝 Poznamenat: e-mail robota (`web-robot@….iam.gserviceaccount.com`) a 🔑 stažený soubor JSON

## 3. Cloudflare: hosting

1. Přihlaste se na dash.cloudflare.com (nebo si založte účet zdarma).
2. Na úvodní stránce vpravo najdete **Account ID**. Zkopírujte ho.
3. Vpravo nahoře ikona profilu → **My Profile → API Tokens → Create Token → Create Custom Token**.
   Název `universal-website`, oprávnění **Account → Cloudflare Pages → Edit**. **Continue → Create Token**. Token se ukáže jen jednou.

📝 Poznamenat: Account ID a 🔑 token

## 4. Google Disk: tabulky a složky

1. Na Disku vytvořte složku **Weby**. Do ní budou přibývat složky klientů.
2. Nahrajte do ní `templates/ridici-tabulka.xlsx` a `templates/klient-sablona.xlsx`. Každou otevřete a zvolte **Soubor → Uložit jako tabulku Google**. Původní .xlsx soubory pak smažte.
3. Řídicí tabulku nasdílejte robotovi: **Sdílet**, vložte e-mail robota, role **Editor**, odškrtněte upozornění, **Sdílet**.

📝 Poznamenat: id řídicí tabulky (v adrese mezi `/d/` a `/edit`), odkaz na šablonu klienta, odkaz na složku Weby

## 5. GitHub: tajné hodnoty

V repozitáři **Settings → Secrets and variables → Actions → New repository secret**. Založte čtyři:

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | celý obsah staženého JSON souboru (otevřete ho v textovém editoru, zkopírujte vše) |
| `CONTROL_SHEET_ID` | id řídicí tabulky |
| `CLOUDFLARE_API_TOKEN` | token z Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID z Cloudflare |

Pak token pro tabulku, aby mohla spouštět publikování: vpravo nahoře profil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Název `publikovani`, platnost dle sebe, **Only select repositories → universal-website**, oprávnění **Contents: Read and write**. **Generate**.

📝 Poznamenat: 🔑 GitHub token

## 6. Řídicí tabulka: menu Weby

1. V řídicí tabulce **Rozšíření → Apps Script**. Smažte obsah a vložte celý soubor `apps-script/Ridici-tabulka.gs`. Uložte (ikona diskety).
2. Nahoře vyberte funkci **onOpen** → **Spustit**. Google se zeptá na oprávnění: **Zkontrolovat oprávnění → váš účet → Rozšířené → Přejít na projekt → Povolit**. (Varování „neověřená aplikace“ je normální, je to váš vlastní skript.)
3. **Nasadit → Nové nasazení**, typ **Webová aplikace**. Spustit jako **Já**, přístup **Kdokoli**. **Nasadit** a zkopírujte adresu webové aplikace.
4. Vraťte se do tabulky a obnovte stránku. Nahoře je menu **Weby → Nastavení…** Vyplňte postupně všech šest hodnot z poznámek.

## 7. První klient

1. **Weby → Založit nového klienta…** Zadejte id (např. `studio-x`) a název. Ve složce Weby vznikne složka klienta s tabulkou a složkou media, nasdílená robotovi.
2. Do složky media nahrajte obrázky, v tabulce klienta upravte obsah.
3. V tabulce klienta v listu **site** klikněte na **▶ Publikovat web**. Za minutu až dvě je v řídicí tabulce ve sloupci url adresa webu.

## 8. Vlastní doména

1. Do řídicí tabulky ve sloupci **domain** napište doménu, např. `www.studiox.cz`, a publikujte.
2. U registrátora domény nastavte záznam **CNAME** pro `www` na adresu `uw-studio-x.pages.dev` (je ve sloupci url).
   Pokud doménu spravuje přímo Cloudflare, nastaví se to samo.
3. Po nastavení DNS (minuty až hodiny) se při dalším publikování objeví ve sloupci url už vaše doména.

---

### Když něco nejde

- **Ve sloupci status je „chyba: …“**: zpráva říká, co chybí. Nejčastěji nenasdílená složka nebo překlep v odkazu.
- **V listu stav u klienta jsou upozornění**: web je online, ale něco chybí, třeba obrázek s jiným názvem.
- **Podrobný záznam**: na GitHubu v repozitáři záložka **Actions**, poslední běh.
