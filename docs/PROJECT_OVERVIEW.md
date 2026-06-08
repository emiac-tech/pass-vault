# Pass Vault — Project Overview

> A secure, zero-knowledge password manager for teams and organizations.
> Save, autofill, and share login credentials — without ever exposing your passwords to the server.

---

## Table of Contents

1. [What is Pass Vault?](#1-what-is-pass-vault)
2. [Who is it for?](#2-who-is-it-for)
3. [The big idea: zero-knowledge](#3-the-big-idea-zero-knowledge)
4. [The two parts of Pass Vault](#4-the-two-parts-of-pass-vault)
5. [The Web Dashboard](#5-the-web-dashboard)
6. [The Browser Extension](#6-the-browser-extension)
7. [How it all works together](#7-how-it-all-works-together)
8. [Roles & permissions](#8-roles--permissions)
9. [Secure password sharing](#9-secure-password-sharing)
10. [Security & privacy](#10-security--privacy)
11. [Getting started](#11-getting-started)
12. [Under the hood (technical summary)](#12-under-the-hood-technical-summary)
13. [Frequently asked questions](#13-frequently-asked-questions)
14. [Glossary](#14-glossary)

---

## 1. What is Pass Vault?

Pass Vault is a **password manager built for organizations**. It gives every team member a private,
encrypted vault where they can store logins (usernames, passwords, website addresses, notes), and it
lets them **fill those logins into websites automatically** through a browser extension.

What makes Pass Vault different from a notebook or a shared spreadsheet:

- **Everything is encrypted on your own device** before it ever reaches the server.
- **Passwords can be shared with teammates securely** — without emailing them or putting them in chat.
- **Admins can manage people** (invite, deactivate, assign roles) **without being able to read anyone's passwords.**
- **A browser extension** saves new logins as you sign in and fills them back in later — like the
  password manager built into your browser, but owned and controlled by your organization.

In one sentence: **Pass Vault is your organization's private, encrypted place for passwords, with
convenient autofill and safe team sharing.**

---

## 2. Who is it for?

- **Companies and teams** that want to stop sharing passwords over email, chat, or spreadsheets.
- **Administrators** who need to control who has access to what, onboard and offboard staff, and keep
  an audit trail — without having to *see* the actual passwords.
- **Everyday users** who just want their logins to be saved and filled in automatically, safely.

---

## 3. The big idea: zero-knowledge

This is the most important concept, so it's worth understanding in plain language.

**"Zero-knowledge" means the Pass Vault server never knows your passwords.**

When you save a password:

1. Your device scrambles (encrypts) it using a key that only exists on your device.
2. Only the scrambled version (called *ciphertext*) is sent to the server.
3. The server stores the scrambled version — it **cannot** unscramble it.

When you view a password:

1. The scrambled version comes back to your device.
2. Your device unscrambles it locally, using your key.

Your **master password** — the one you use to unlock your vault — is what protects that key, and it
**never leaves your device**. Not when you log in, not when you sync, never.

**Why this matters:** even if someone broke into the server and stole the entire database, they would
only find encrypted gibberish. Without your master password, it's useless. It also means *we* (and your
administrators) genuinely cannot read your passwords — only you can.

---

## 4. The two parts of Pass Vault

Pass Vault is made of two things you actually use, plus a server that connects them.

| Part | What it is | What you do with it |
|------|------------|---------------------|
| **Web Dashboard** | A website you log into | Manage all your passwords, organize them in folders, share with teammates, manage users, view reports and audit logs |
| **Browser Extension** | A small add-on for Chrome / Edge | Automatically fill saved logins into websites, and save new ones as you sign in |
| **Server (backend)** | Runs behind the scenes | Stores your *encrypted* data and routes sharing between people — but never sees your passwords |

You can use the dashboard on its own. The extension makes everyday browsing convenient by connecting to
the same vault.

---

## 5. The Web Dashboard

The dashboard is the control center. After logging in and unlocking with your master password, you get:

### Passwords
- A searchable list of all your saved logins.
- Add, edit, and delete entries (title, username, password, website, notes).
- A built-in **password strength** indicator and **password generator**.
- Copy a username or password to the clipboard with one click.
- See at a glance which items are **owned by you** and which are **shared with you**.

### Folders
- Organize passwords into folders so large vaults stay tidy.

### Dashboards (Overview)
- **My Dashboard** — your personal view: items you own plus items shared with you.
- **Team Dashboard** — organization-wide totals (how many items, users, shares exist across the team).
  This shows *counts only*, never the contents of other people's vaults.

### Users (for admins)
- Invite new people by email, or create accounts manually.
- See everyone's role and status.
- Per-user **Actions**: change role, deactivate/reactivate, or delete.
- Deactivating someone **blocks their login immediately** and ends their active sessions.

### Audit log
- A running history of important actions (logins, shares, updates, user changes) for accountability.

### Reports
- Summaries and insights about the vault (e.g. password health, activity).

### Settings & theming
- **Light and dark themes**, with the choice remembered.
- Account and security settings.

---

## 6. The Browser Extension

The extension brings your vault into the websites you visit. It works on **Chrome and Microsoft Edge**.

### What it does
- **Autofill** — when you open a site you've saved, Pass Vault offers to fill in your username and password.
- **Capture new logins** — when you sign in somewhere new, it offers to **save** that login to your vault.
- **Update existing logins** — if your password or username changed, it offers to **update** the existing
  entry instead of creating a duplicate.
- **Copy credentials** — quickly copy a username or password from the extension popup.
- **Open in the dashboard** — jump straight to managing or sharing any item in the web app.

### How it stays secure and convenient
- **Auto-connect** — if you're already logged into the Pass Vault web app in the same browser, the
  extension connects automatically. No codes to copy, no separate pairing step.
- **Local unlock** — you unlock the extension with your master password; the keys are derived on your
  device. It stays unlocked for your browsing session and **locks automatically when you close the browser**.
- **Smart field detection** — it recognizes login fields by their labels and names (email, user, username,
  password, etc.), similar to how established password managers work.
- **Respects your privacy** — it only reads or writes the credential fields on a page when you choose to
  autofill or save. It does **not** track your browsing.

---

## 7. How it all works together

A typical journey, end to end:

1. **You get invited.** An admin invites you by email. You click the link, set your password, and your
   personal encryption keys are generated **on your device**.
2. **You log in and unlock.** You sign in to the dashboard and unlock with your master password. Your
   vault decrypts locally.
3. **You browse normally.** With the extension installed and connected, you sign into a website.
4. **Pass Vault offers to save it.** The extension detects the new login and offers to store it —
   encrypted on your device — into your vault.
5. **Next time, it fills automatically.** When you return to that site, Pass Vault offers to autofill.
6. **You share when needed.** Need a teammate to have access to a shared account? You share the item to
   them — it's re-encrypted so only *they* can open it.
7. **Admins manage people, not passwords.** Admins can onboard, offboard, and assign roles, but the
   actual passwords stay private to the people who own or are shared on them.

---

## 8. Roles & permissions

Pass Vault has four roles, from most to least privileged:

| Role | Can do |
|------|--------|
| **Super Admin** | Everything an Admin can, plus promote/demote other admins and super admins |
| **Admin** | Invite/create users, change roles, deactivate or delete users, view team-wide totals |
| **Manager** | Standard user with some elevated team visibility |
| **User** | Manage their own vault and items shared with them |

**Important:** Day-to-day, no role lets you read other people's passwords — an Admin only sees the
contents of items they personally own or that have been shared with them.

**One deliberate exception — the Organization Recovery Key.** So that a departing employee's
credentials are never lost, a **Super Admin** can transfer any user's items to another user, and the
new owner can then open them. This is powered by an organization recovery key, which means a Super
Admin has the technical ability to recover (and therefore decrypt) any user's credentials. This is a
standard enterprise capability (the same model used by Zoho Vault, Bitwarden, etc.). The recovery key
is set up once and is itself protected by each Super Admin's own master password — the server never
holds a key that can read your vault.

---

## 9. Secure password sharing

Sharing is where Pass Vault really shines compared to spreadsheets or chat.

When you share a login with a teammate:

1. The item's encryption key is **re-wrapped** for the recipient using their **public key**.
2. Only the recipient's device — holding the matching private key — can unwrap and read it.
3. The server only ever moves encrypted material around; it never sees the password in the clear.

You can also:
- See who an item is shared with (**Manage Access**).
- **Revoke** access at any time — once revoked, that person can no longer open the item.

This means you can safely give a colleague access to a shared account, and cleanly take it away later
(for example, when someone leaves the team).

---

## 10. Security & privacy

### In plain terms
- Your passwords are **encrypted on your device** and stored only as scrambled data on the server.
- Your **master password and keys never leave your device.**
- Pass Vault **does not sell data, show ads, or run tracking/analytics.**
- The extension only touches credential fields when you autofill or save — it doesn't watch your browsing.
- The extension contains **no remotely-loaded code**; everything ships inside the published package.

### The technical specifics
- **Key derivation:** PBKDF2-SHA256 with 310,000 iterations turns your master password into a strong key.
- **Vault encryption:** AES-256-GCM (authenticated encryption) protects each item.
- **Sharing:** RSA-OAEP 2048-bit public-key encryption securely hands item keys to recipients.
- **Key handling:** encryption keys are *non-extractable* and live only in the browser's secure context.
- **Transport:** all communication with the server uses HTTPS.
- **Sessions:** the extension keeps its unlocked state in memory only and clears it when the browser closes;
  the web app can keep your vault unlocked across page refreshes but **auto-locks after a period of inactivity.**
- **Access enforcement:** the server independently re-checks every request, so deactivating a user or
  changing a role takes effect immediately — not at some later expiry.

---

## 11. Getting started

### As a user (web dashboard)
1. Open the Pass Vault web app and accept your email invitation (or log in if you already have an account).
2. Set / enter your **master password** to unlock your vault.
3. Start adding logins, or organize existing ones into folders.

### As a user (browser extension)
1. Install the Pass Vault extension from the Chrome Web Store / Edge Add-ons.
2. Click the toolbar icon and sign in (or let it auto-connect from your open web-app tab).
3. Unlock with your master password.
4. Browse normally — Pass Vault will offer to save new logins and autofill saved ones.

### As an administrator
1. Log in with an Admin or Super Admin account.
2. Go to **Users** to invite teammates (by email) or create accounts manually.
3. Assign roles, and deactivate accounts when people leave.
4. Use the **Audit log** and **Reports** to keep oversight.

---

## 12. Under the hood (technical summary)

For the technically curious, here's how Pass Vault is built.

| Layer | Technology |
|-------|------------|
| **Web app** | React 19 + Vite + TypeScript |
| **Backend API** | Express 5 + TypeScript (Node.js) |
| **Database** | PostgreSQL (stores only encrypted data) |
| **Browser extension** | Manifest V3 (Chrome / Edge), no build step |
| **Cryptography** | Web Crypto API — PBKDF2, AES-256-GCM, RSA-OAEP |
| **Email** | SMTP (for invitations) |
| **Deployment** | Docker — a single container serves both the web app and the API on one port |

**How a deployment is shaped:** the web dashboard and the API run together in one Docker container. The
container talks to a PostgreSQL database (which holds only ciphertext) and an SMTP provider (for sending
invitation emails). Secrets and connection details are supplied via environment variables and are never
committed to the codebase.

> Note: this is a security-sensitive application. All real secrets (database credentials, mail
> credentials, signing keys) live only in environment configuration — never in the source code or this
> document.

---

## 13. Frequently asked questions

**Can administrators see my passwords?**
Regular admins cannot — roles control who can *manage users and access*, not who can *read secrets*.
The one exception is the **Super Admin**, who holds the Organization Recovery Key so that credentials
can be transferred when an employee leaves; this gives a Super Admin the ability to recover (and decrypt)
any user's items. The server itself never holds a key that can read your vault.

**What happens if I forget my master password?**
Because of the zero-knowledge design, your master password is the only thing that can unlock your vault.
It cannot be recovered from the server. Account recovery (if available) is handled through your
organization's administrator, and may require re-establishing your keys.

**Is my data safe if the server is hacked?**
The server only stores encrypted data. Without your master password, that data is unreadable.

**Does the extension track which websites I visit?**
No. It only reads or writes credential fields when you autofill or save a login. It does not collect
browsing history, and it sends data only to your configured Pass Vault backend.

**Which browsers are supported?**
The extension targets Chromium-based browsers — Google Chrome and Microsoft Edge.

**Can I use the dashboard without the extension?**
Yes. The dashboard is fully usable on its own. The extension simply adds convenient autofill while browsing.

---

## 14. Glossary

- **Vault** — your personal, encrypted collection of saved logins.
- **Master password** — the password you use to unlock your vault; it never leaves your device.
- **Zero-knowledge** — a design where the server never has access to your unencrypted data.
- **Encryption / ciphertext** — turning readable data into scrambled data; the scrambled result is ciphertext.
- **Autofill** — automatically entering your saved username and password into a website's login form.
- **Capture** — the extension noticing a new login and offering to save it.
- **Sharing** — giving a specific teammate access to one of your items, encrypted just for them.
- **Revoke** — removing someone's access to a shared item.
- **Role** — a permission level (Super Admin, Admin, Manager, User) controlling what a person can manage.
- **Audit log** — a record of important actions taken in the system.

---

*Pass Vault — convenient password autofill, without compromising on security.*
