# Security design

How Honed keeps a user's cards private on their own device. This is the design milestone 3 (#15-#18)
builds; change it here first, in its own PR, before changing the code. **Only standard building
blocks from the browser's WebCrypto, with standard parameters. No home-made cryptography.**

## What it protects against, and what it doesn't

| Threat | Protected? | How |
| --- | --- | --- |
| Our server, or anyone who takes it over, reading cards | **Yes** | The server never receives cards. In v2 it only stores ciphertext it has no key for. |
| A backup file (`.honed`) found in someone's cloud drive | **Yes** | Backups hold only ciphertext and wrapped keys (#18). |
| Another person using the same computer account, or copying the browser's files | **Yes**, while Honed is locked | Records are encrypted at rest; the key is only ever in memory while unlocked. |
| A lost phone or laptop | By the device | The device's own lock and disk encryption. Honed adds the points above. |
| Malicious code running inside the page while it's unlocked | **No** (encryption can't) | Prevented instead by the strict Content-Security-Policy, no outside scripts, few dependencies. |
| Forgetting the passphrase **and** losing the recovery key | **No: the cards are gone** | Nobody else can unlock them; that is the point. The setup screen says so plainly. |
| Guessing a weak passphrase from stolen browser files | Slowed | PBKDF2 makes every guess cost about half a second. A strong passphrase or a passkey is the real protection. |

## Keys

```
              ┌── passphrase ──PBKDF2──▶ KEK ─┐
user secret ──┼── passkey ─────PRF+HKDF─▶ KEK ─┼──AES-KW──▶ wrapped data key (one per method, in the keyring)
              └── recovery key ──HKDF───▶ KEK ─┘
                                                     data key ──AES-GCM──▶ every record
```

- **Data key:** 256-bit AES-GCM key, made once per user (`crypto.subtle.generateKey`). It
  encrypts every record. It is never stored as-is: only wrapped.
- **Key-encryption keys (KEKs):** 256-bit AES-KW keys, one per way of unlocking, each wrapping its
  own copy of the data key (AES Key Wrap, RFC 3394, which also detects a wrong key).
  - **Passphrase:** PBKDF2-HMAC-SHA-256, **600,000 iterations** (OWASP's recommendation for
    PBKDF2-SHA-256 since 2023), a random 16-byte salt per passphrase. The passphrase is
    Unicode-normalised (NFC) first, so the same words typed on an iPhone and on Windows match.
    WebCrypto has no Argon2; PBKDF2 is what browsers offer without extra code.
  - **Passkey:** the WebAuthn **PRF extension** (Face ID, Touch ID, Windows Hello, security keys,
    where the browser and authenticator support it) gives a 32-byte secret for a random 32-byte
    salt we store; HKDF-SHA-256 turns it into the KEK. Offered only when the browser says it
    supports PRF (`isPrfSupported`); a passphrase is always possible.
  - **Recovery key:** 128 random bits shown once at setup; HKDF-SHA-256 turns them into the KEK.
    It already has full strength, so no slow function is needed.
- **The keyring** is the list of wrapped copies, stored in the database's `meta` store (#16) and
  in backups (#18). Each entry records its method and every parameter used, so iterations or
  methods can change later without breaking old entries.
- **Changing how you unlock** (new passphrase, adding or removing a passkey, a new recovery key)
  rewraps the same data key: no record is re-encrypted. Doing it needs the data key in a form that
  can be wrapped, so Settings asks for the current passphrase or recovery key (or a passkey) first,
  and only then holds an extractable copy for that one operation. For everyday use the data key is
  unwrapped as **non-extractable**: code in the page can use it but never read its bytes.
- **Replacing the data key itself** (re-encrypting everything) isn't needed for anything in
  milestone 3. It would be the answer to "my data key leaked", which the threat model doesn't
  cover while the page is safe.

## Records

- Each record's private part is encrypted with **AES-GCM**, a fresh random 96-bit IV every time
  (`crypto.getRandomValues`), and **additional data** `honed:v1:<store>:<id>`, so a ciphertext copied
  into another record's place fails to decrypt instead of showing the wrong card.
- Stored as `{ v: 1, iv, ct }` (bytes as `Uint8Array`; backups encode them as base64url).
- The plaintext is the JSON of the record's private fields. Random IVs are safe for far more
  records than anyone will write with one key (the limit is around four billion).
- **Files** (slide PDFs) are encrypted the same way but as raw bytes (`encryptBytes`), one record
  per deck, so the ciphertext is the file's size plus a 16-byte tag. Their page text is a separate
  sealed record, so listing decks never decrypts a whole PDF.

### What stays readable on disk

Only what IndexedDB's indexes need, so lists and the planner work without decrypting everything.
Milestone 4 (#24) adds the lecture stores:

| Store | Readable | Encrypted |
| --- | --- | --- |
| courses (classes) | id | name, meeting days and times, term dates, dates |
| exams | id, courseId, date | title, kind, which lectures, dates |
| slideDecks | id, courseId | title, file name, page count, size, dates |
| deckFiles | id (the deck's) | the whole PDF |
| deckPages | id (the deck's) | the text of every page |
| lectures | id, courseId, date | minutes, dates |
| sections | id, courseId, lectureId, deckId, nextDue | page range, the rest of the schedule (budget, minutes studied, extra minutes), dates |
| changes (log) | seq, entity, entityId, op, at | the record data (PDF bytes are not in the log) |
| meta | device id, schema step, the keyring (already wrapped) | nothing else is secret |

The milestone 2 flashcard stores (decks, notes, cards, reviews) are removed in #26; until then
they follow the same rule (ids and links readable; text, FSRS numbers and dates encrypted).

So someone with the browser's files could see *how many* classes, decks, lectures and sections
exist, on which dates lectures and exams fall, and when sections are due, but not a word of the
slides, the class names, notes or scores. (A field may move from "readable" to "encrypted" if no
index needs it; it must not move the other way without changing this table first.)

## How the store applies it (#16, `src/db/store.ts`)

- **Three states:** `'new'` (no keyring yet: records are plain, exactly as in milestone 2),
  `'locked'` (set up, key not given: everything refuses except reading the keyring and unlocking)
  and `'unlocked'` (every record written is sealed). The setup screen (#17) gates the app, so in
  practice nothing is written in `'new'` once it exists.
- **Setting up** saves the keyring, an encrypted check value (so `unlock` can tell a wrong key at
  once) and a "migration running" flag, then seals every plain record (decks, notes, cards,
  reviews and the change log), in batches, and clears the flag. If the page closes half-way, the
  store opens `'locked'` and the next `unlock` finishes the job.
- **The keyring always keeps** at least one passphrase or passkey (to unlock) and at least one
  recovery key; the store refuses changes that would break that. Keyring changes never rewrite a
  record.
- **Schema step 2** bumps the database version, so a milestone 2 tab still open elsewhere can't
  read sealed records as plain or write plain ones among them.

## Recovery key format

- 16 random bytes (128 bits), plus a 4-byte check (the first 4 bytes of the secret's SHA-256):
  20 bytes, written as **32 characters of Crockford base32 in 8 groups of 4**,
  e.g. `7K2M-QX9D-…`.
- Typing is forgiving: case doesn't matter, spaces and dashes are ignored, and I, L and O read as
  1, 1 and 0. A typo is caught by the check (it fails one time in four billion) before any
  unlocking is tried, so the screen can say "that's not quite right" at once.

## Errors

Every failure is a `CryptoError` with a `code` the screens can turn into words:
`'wrong-secret'` (the passphrase, recovery key or passkey doesn't unlock this keyring),
`'invalid'` (badly formed input, such as a recovery key failing its check), `'corrupt'` (a record
or keyring entry that won't decrypt or parse), `'unsupported'` (the browser lacks something, such
as PRF).

## Where it lives

| File | What |
| --- | --- |
| `src/types/crypto.ts` | The shared types: keyring entries, encrypted records, `CryptoError` |
| `src/lib/crypto.ts` | Pure WebCrypto functions (tested in Node, which has the same WebCrypto) |
| `src/lib/passkey.ts` | WebAuthn: create a passkey with PRF, get its PRF output, feature detection |
| `src/db/` (#16) | Uses them to encrypt records and keep the keyring |
| `src/ui/` (#17) | Setup, unlock, recovery, Settings |
| `src/backup/` (#18) | The `.honed` file format (documented here when written) |
