# Chrome Web Store — Submission Notes (Pass Vault)

Copy-paste the sections below into the Chrome Web Store Developer Dashboard.

---

## Single purpose (Dashboard → "Single purpose")

> Pass Vault is a password manager. Its single purpose is to securely autofill, capture,
> and update the user's login credentials on websites, with all encryption performed
> locally on the user's device.

---

## Permission justifications (Dashboard → "Privacy practices")

**storage**
> Stores the user's authentication session token, user preferences (theme, backend
> environment), and a non-secret index of which sites already have a saved login
> (hostname + username only — never passwords) on the user's device.

**activeTab**
> Lets the extension act on the tab the user is currently viewing — to autofill a saved
> login or to capture a credential the user is entering — only when the user invokes it.

**scripting**
> Injects the autofill/capture logic into the active page, and reads the session of an
> already-logged-in Pass Vault web-app tab so the extension can connect without re-entering
> credentials.

**clipboardWrite**
> Allows the user to copy a username or password to the clipboard from the extension popup.

**Host permissions — `http://*/*` and `https://*/*`**
> As a password manager, the extension must detect login forms, autofill saved credentials,
> and offer to save or update logins on whatever websites the user chooses to use. Page
> content is accessed only to read or write credential fields during an explicit autofill or
> save action. The extension does not collect browsing history or page content for any other
> purpose, and transmits data only to the user's configured Pass Vault backend over HTTPS.

**Remote code use**
> No. The extension does not load or execute any remotely-hosted code. All logic ships inside
> the published package.

---

## Data usage disclosures (check these in "Privacy practices")

Data collected / used:
- **Authentication information** — account email + session token (used to sign in to the
  user's Pass Vault backend).
- **Personal communications / Website content** — credential field values, only to autofill
  or save logins at the user's request.

Certifications (must check all three):
- ☑ I do not sell or transfer user data to third parties (outside approved use cases).
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending.

Privacy policy URL: **<paste the hosted privacy-policy.html URL here>**

---

## Notes to reviewer (Dashboard → "Notes for reviewers")

> Pass Vault requires a user account on a Pass Vault backend to function. Please use this
> demo account to test autofill and capture:
>
>   Email:    kabir@emiactech.com
>   Password: emiac1617   (used as both the account password and the master/unlock password)
>
> Steps to test:
>   1. Click the Pass Vault toolbar icon to open the popup.
>   2. Sign in with the demo email + password above, then unlock with the same password.
>   3. Visit any website with a login form. Pass Vault will offer to autofill saved logins,
>      and will offer to save new credentials after you sign in.
>
> All encryption/decryption happens locally in the browser; the backend stores only
> encrypted ciphertext. The extension contains no remote code.

---

## Privacy policy hosting (pick one)

The file `docs/privacy-policy.html` is ready to host. Easiest options:

1. **GitHub Pages** — in the `emiac-tech/pass-vault` repo: Settings → Pages → Source =
   `main` branch, `/docs` folder. The policy will be served at
   `https://emiac-tech.github.io/pass-vault/privacy-policy.html`.
2. **Your own server** — copy `privacy-policy.html` to the Pass Vault host, e.g.
   `https://passvault.103.180.163.41.sslip.io/privacy-policy.html`.

Paste the resulting URL into the dashboard's "Privacy policy URL" field.

---

## Quick pre-submit checklist

- ☑ Removed unused `contextMenus` permission from manifest.
- ☐ Privacy policy hosted and URL added to dashboard.
- ☐ Permission justifications pasted (above).
- ☐ Data-usage disclosures checked + 3 certifications.
- ☐ Reviewer notes with demo account added.
- ☐ Store listing: description, screenshots, 128×128 icon, category (Productivity), language.
- ☐ Production backend is reachable (default, not the localhost/dev environment).
